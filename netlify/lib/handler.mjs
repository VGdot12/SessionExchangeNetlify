import {
  Problem, hash, secureEqual, login, authenticate, getState, createRequest,
  acceptRequest, cancelRequest, importCatalogue,
} from './model.mjs';
import { adminStatus, reviewMessage, deactivateSession } from './outlook.mjs';
import { resetOutlookScan } from './outlook-sync.mjs';
import { receivePowerAutomate } from './power-automate.mjs';

const securityHeaders = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
};
function cookieToken(request) {
  const part = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('swap_session='));
  return part?.slice('swap_session='.length) || '';
}
function cookie(request, value, maxAge = 43200) {
  return `swap_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}

export function createHandler(repository, options = {}) {
  const timezone = options.timezone || 'Asia/Kolkata';
  return async (request, context = {}) => {
    let headers = { ...securityHeaders };
    try {
      const path = new URL(request.url).pathname;
      const method = request.method;
      if (method !== 'GET' && method !== 'POST') throw new Problem('Method not allowed.', 405);
      let data;
      if (method === 'POST') {
        if ((request.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') throw new Problem('Send application/json.', 415);
        if (Number(request.headers.get('content-length')) > 5_000_000) throw new Problem('Request is too large.', 413);
        // Streaming enforces the limit even if Content-Length is absent or false.
        const reader = request.body?.getReader();
        const chunks = []; let length = 0;
        if (!reader) throw new Problem('Request body is required.');
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 5_000_000) { await reader.cancel(); throw new Problem('Request is too large.', 413); }
          chunks.push(Buffer.from(value));
        }
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new Problem('Invalid JSON.'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Problem('Expected a JSON object.');
        if (path !== '/api/admin/import') {
          if (request.headers.get('x-swap-request') !== '1') throw new Problem('Refresh the page and try again.', 403);
          const origin = request.headers.get('origin');
          if (origin && origin !== new URL(request.url).origin) throw new Problem('Cross-site requests are not allowed.', 403);
        }
      }
      let result, status = 200;
      if (path.startsWith('/api/admin/outlook/')) {
        const secret = options.adminToken || '';
        if (secret.length < 32 || !secureEqual(request.headers.get('authorization') || '', `Bearer ${secret}`)) throw new Problem('Invalid administrator token.', 403);
      }
      if (path === '/api/health' && method === 'GET') {
        // This confirms that storage is usable, not merely that a function exists.
        await repository.read();
        result = { ok: true, runtime: 'netlify-functions', storage: 'netlify-blobs' };
      } else if (path === '/api/config' && method === 'GET') {
        const { data: saved } = await repository.read();
        result = { demo: saved.demo, pgid_only: true, timezone };
      } else if (path === '/api/login' && method === 'POST') {
        const response = await repository.mutate(d => login(d, data, context.ip || 'unknown'));
        if (response.error) throw new Problem(response.error, response.status);
        headers['Set-Cookie'] = cookie(request, response.token);
        result = { ok: true };
      } else if (path === '/api/integrations/outlook' && method === 'POST') {
        const integration = options.powerAutomate || {};
        if (!integration.enabled) throw new Problem('Set SWAP_POWER_AUTOMATE_ENABLED=1 in Netlify and redeploy to enable this endpoint.', 503);
        if (integration.production === false) throw new Problem('Power Automate delivery is only allowed on the production site.', 403);
        if ((integration.token || '').length < 32 || !secureEqual(request.headers.get('authorization') || '', `Bearer ${integration.token}`)) throw new Problem('Invalid Power Automate token. Check SWAP_FLOW_TOKEN and the HTTP Authorization header.', 403);
        result = await repository.mutate(d => receivePowerAutomate(d, data));
      } else if (path === '/api/admin/import' && method === 'POST') {
        const secret = options.adminToken || '';
        if (secret.length < 32 || !secureEqual(request.headers.get('authorization') || '', `Bearer ${secret}`)) throw new Problem('Invalid sync token.', 403);
        if (options.outlook?.enabled) throw new Problem('Outlook cloud sync is enabled. Disable it before using full Excel catalogue imports.', 409);
        result = await repository.mutate(d => importCatalogue(d, data, Date.now(), timezone));
      } else if (path === '/api/admin/outlook/status' && method === 'GET') {
        const { data: saved } = await repository.read();
        result = adminStatus(saved, options.outlook || { enabled: false, configured: false });
      } else if (path === '/api/admin/outlook/run' && method === 'POST') {
        if (!options.runOutlook) throw new Problem('Outlook cloud sync is not configured.', 503);
        result = await options.runOutlook();
      } else if (path === '/api/admin/outlook/review' && method === 'POST') {
        result = await repository.mutate(d => reviewMessage(d, data));
      } else if (path === '/api/admin/outlook/reset' && method === 'POST') {
        result = await repository.mutate(d => resetOutlookScan(d));
      } else if (path === '/api/admin/outlook/session' && method === 'POST') {
        result = await repository.mutate(d => deactivateSession(d, data.session_id));
      } else if (path === '/api/state' && method === 'GET') {
        const { data: saved } = await repository.read();
        const pgid = authenticate(saved, cookieToken(request));
        result = getState(saved, pgid, Date.now(), timezone);
      } else if (method === 'POST' && (path === '/api/logout' || path === '/api/requests' || /^\/api\/requests\/[a-f0-9]{24}\/(accept|cancel)$/.test(path))) {
        const token = cookieToken(request);
        result = await repository.mutate(d => {
          const pgid = authenticate(d, token);
          if (path === '/api/logout') { d.logins = d.logins.filter(l => l.token_hash !== hash(token)); return { ok: true }; }
          if (path === '/api/requests') return { id: createRequest(d, pgid, data, Date.now(), timezone) };
          const [, , , id, action] = path.split('/');
          if (action === 'accept') acceptRequest(d, pgid, id, data.accepted_session_id, Date.now(), timezone);
          else cancelRequest(d, pgid, id);
          return { ok: true };
        });
        if (path === '/api/logout') headers['Set-Cookie'] = cookie(request, '', 0);
        if (path === '/api/requests') status = 201;
      } else throw new Problem('Endpoint not found.', 404);
      return new Response(JSON.stringify(result), { status, headers });
    } catch (error) {
      if (!(error instanceof Problem)) console.error('SessionExchange API failure:', error.message);
      return new Response(JSON.stringify({ error: error instanceof Problem ? error.message : 'The server could not access shared storage. Check the Netlify function logs and redeploy.' }),
        { status: error instanceof Problem ? error.status : 503, headers });
    }
  };
}
