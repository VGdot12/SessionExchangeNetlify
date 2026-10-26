import { randomBytes } from 'node:crypto';
import { Problem } from './model.mjs';
import { ingestMessage, outlookState, matchesSubject, SUBJECT_RULE } from './outlook.mjs';

export function outlookConfiguration(env = process.env) {
  const enabled = env.SWAP_OUTLOOK_ENABLED === '1';
  const missing = ['OUTLOOK_TENANT_ID','OUTLOOK_CLIENT_ID','OUTLOOK_CLIENT_SECRET','OUTLOOK_MAILBOX'].filter(k => !env[k]);
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (enabled && missing.length) throw new Problem(`Missing Netlify settings: ${missing.join(', ')}.`, 503);
  if (enabled && (!guid.test(env.OUTLOOK_TENANT_ID) || !guid.test(env.OUTLOOK_CLIENT_ID))) throw new Problem('Use the Microsoft directory tenant ID and application client ID, both in GUID format.', 503);
  if (enabled && !/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(env.OUTLOOK_MAILBOX)) throw new Problem('OUTLOOK_MAILBOX must be the mailbox email address.', 503);
  const days = Number(env.OUTLOOK_LOOKBACK_DAYS || 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Problem('OUTLOOK_LOOKBACK_DAYS must be an integer between 1 and 90.', 503);
  return { enabled, tenant: env.OUTLOOK_TENANT_ID, client: env.OUTLOOK_CLIENT_ID, secret: env.OUTLOOK_CLIENT_SECRET,
    mailbox: env.OUTLOOK_MAILBOX, folder: env.OUTLOOK_FOLDER || 'inbox', sender: 'casevents@isb.edu', days };
}

export function publicConfiguration(env = process.env) {
  try {
    const c = outlookConfiguration(env);
    return { enabled: c.enabled, configured: c.enabled, mailbox: c.mailbox || '', folder: c.folder, sender: c.sender, subject_rule: SUBJECT_RULE };
  } catch (error) {
    return { enabled: env.SWAP_OUTLOOK_ENABLED === '1', configured: false, configuration_error: error.message };
  }
}

function firstPage(config, through, now) {
  const end = new Date(now - 60000).toISOString();
  const start = through ? new Date(Date.parse(through) - 600000).toISOString() : new Date(now - config.days * 86400000).toISOString();
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(config.folder)}/messages`);
  url.searchParams.set('$filter', `receivedDateTime ge ${start} and receivedDateTime le ${end} and from/emailAddress/address eq '${config.sender}'`);
  url.searchParams.set('$orderby', 'receivedDateTime asc');
  url.searchParams.set('$top', '5');
  // Fetch message bodies only after both the sender and subject checks pass.
  url.searchParams.set('$select', 'id,internetMessageId,subject,from,receivedDateTime');
  return { url: url.href, end, mailbox: config.mailbox, folder: config.folder };
}

function safeGraphUrl(value, config) {
  const url = new URL(value);
  const expected = `/v1.0/users/${config.mailbox}/mailFolders/${config.folder}/messages`;
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || decodeURIComponent(url.pathname) !== expected) {
    throw new Problem('Outlook returned an unexpected pagination URL.', 503);
  }
  return url.href;
}

async function jsonResponse(response, label, limit = 8000000) {
  if (!response.ok) {
    const explanation = response.status === 401 || response.status === 403 ? 'Check the Microsoft app credentials, Mail.Read application permission, admin consent and mailbox access scope.' :
      response.status === 429 ? 'Microsoft is rate limiting requests; the next scheduled run will retry.' : 'The next scheduled run will retry. Check Microsoft service availability and the mailbox/folder settings.';
    // Never include the raw response: OAuth error bodies may contain sensitive context.
    throw new Problem(`${label} returned HTTP ${response.status}. ${explanation}`, 503);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Problem(`${label} returned an empty response.`, 503);
  const chunks = []; let length = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Problem(`${label} response exceeded the import size limit.`, 503); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Problem(`${label} returned invalid JSON.`, 503); }
}

export async function runOutlookSync(repository, config, options = {}) {
  if (!config.enabled) return { skipped: 'Outlook cloud sync is disabled.' };
  const fetcher = options.fetch || fetch, clock = options.clock || Date.now;
  const started = clock(), leaseId = randomBytes(16).toString('hex');
  const claim = await repository.mutate(d => {
    const state = outlookState(d);
    if (state.lease?.expires > started) return false;
    if (state.scope && (state.scope.mailbox !== config.mailbox || state.scope.folder !== config.folder)) {
      throw new Problem('The mailbox or folder setting changed. Reset the scan through the admin page to scan the new mailbox.', 409);
    }
    if (state.scan && (state.scan.mailbox !== config.mailbox || state.scan.folder !== config.folder)) {
      throw new Problem('The mailbox or folder changed during a scan. Restore its previous setting or reset the scan through the admin page.', 409);
    }
    state.lease = { id: leaseId, expires: started + 60000 };
    state.scope = { mailbox: config.mailbox, folder: config.folder };
    state.last_attempt = new Date(started).toISOString();
    state.scan ??= firstPage(config, state.checked_through, started);
    return structuredClone(state.scan);
  });
  if (!claim) return { skipped: 'Another Outlook sync is running.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  let scan = claim, pages = 0, counts = { updated: 0, review: 0, duplicate: 0, older: 0, ignored: 0 };
  try {
    const token = await jsonResponse(await fetcher(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.client, client_secret: config.secret,
        grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
    }), 'Microsoft sign-in', 100000);
    if (typeof token.access_token !== 'string') throw new Problem('Microsoft did not return an access token.', 503);
    while (scan && pages < 4 && clock() - started < 18000) {
      const page = await jsonResponse(await fetcher(safeGraphUrl(scan.url, config), {
        signal: controller.signal, redirect: 'error', headers: { Authorization: `Bearer ${token.access_token}`,
          Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
      }), 'Outlook mailbox');
      if (!Array.isArray(page.value) || page.value.length > 25) throw new Problem('Outlook returned an invalid message page.', 503);
      const next = page['@odata.nextLink'] ? { ...scan, url: safeGraphUrl(page['@odata.nextLink'], config) } : null;
      const messages = await Promise.all(page.value.map(async message => {
        if (message.from?.emailAddress?.address?.toLowerCase() !== config.sender.toLowerCase() || !matchesSubject(message.subject)) return message;
        if (typeof message.id !== 'string' || !message.id) throw new Problem('Outlook returned an invalid message ID.', 503);
        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(message.id)}?$select=body`;
        const details = await jsonResponse(await fetcher(url, { signal: controller.signal, redirect: 'error',
          headers: { Authorization: `Bearer ${token.access_token}`, Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' } }), 'Outlook invite');
        return { ...message, body: details.body };
      }));
      const pageCounts = await repository.mutate(d => {
        const state = outlookState(d);
        if (state.lease?.id !== leaseId || state.scan?.url !== scan.url) throw new Problem('The sync checkpoint changed. The next run will retry.', 409);
        const result = { updated: 0, review: 0, duplicate: 0, older: 0, ignored: 0 };
        // Events and cursor commit in one conditional write; a crash cannot lose a page.
        for (const message of messages) result[ingestMessage(d, message, config.sender, clock())]++;
        state.scan = next;
        if (!next) state.checked_through = scan.end;
        state.last_success = new Date(clock()).toISOString(); state.last_error = null;
        state.last_counts = result;
        return result;
      });
      for (const name of Object.keys(counts)) counts[name] += pageCounts[name];
      scan = next; pages++;
    }
    return { ok: true, pages, ...counts, catching_up: Boolean(scan) };
  } catch (error) {
    const message = error instanceof Problem ? error.message : controller.signal.aborted ? 'Outlook sync reached its time limit; the next run resumes from its saved checkpoint.' : 'Outlook connection failed; the next run resumes from its saved checkpoint.';
    // A failed page leaves its checkpoint unchanged. Do not log mail bodies or secrets.
    await repository.mutate(d => {
      const state = outlookState(d);
      if (state.lease?.id === leaseId) state.last_error = message;
    });
    throw new Problem(message, 503);
  } finally {
    clearTimeout(timeout);
    await repository.mutate(d => {
      const state = outlookState(d);
      if (state.lease?.id === leaseId) delete state.lease;
    });
  }
}

export function resetOutlookScan(d, now = Date.now()) {
  const state = outlookState(d);
  if (state.lease?.expires > now) throw new Problem('Wait for the current sync to finish before resetting.', 409);
  state.scan = null; state.checked_through = null; delete state.scope;
  return { ok: true };
}
