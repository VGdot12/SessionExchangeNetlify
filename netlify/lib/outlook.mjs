import { hash, Problem, validateCatalogue } from './model.mjs';

const key = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const dates = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export const SUBJECT_RULE = 'Upcoming Event | PGP Co 2027 | Pre Placement Talk :';
export function matchesSubject(subject) {
  return typeof subject === 'string' && /\bUpcoming\s+Event\s*\|\s*PGP\s+Co\s+2027\s*\|\s*Pre\s+Placement\s+Talk\s*:/i.test(subject);
}
export function outlookState(d) {
  return d.outlook ??= { processed: {}, reviews: [], latest: {}, scan: null, checked_through: null };
}

export function plainText(body) {
  if (typeof body !== 'string' || body.length > 500000) throw new Problem('Email body is missing or too large.');
  const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', middot: '·' };
  return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/?t[dh]\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
      if (name.startsWith('#')) {
        const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2),16) : Number(name.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return entities[name.toLowerCase()] ?? whole;
    }).normalize('NFKC').replace(/\r/g, '').replace(/\u00a0/g, ' ');
}

export function parseInvite(body) {
  const text = plainText(body);
  const labels = /(?:^|\n)\s*(Company Name|Industry|CBD Name|Event Type|Event Date|Event Time|Duration|Mode|Venue|Presenter['’]s Designation|Presenter['’]s Profile)\s*:\s*/gi;
  const matches = [...text.matchAll(labels)], fields = {};
  matches.forEach((match, i) => {
    const name = match[1].toLowerCase();
    if (name in fields) throw new Problem('Multiple event blocks found. Review the email manually.');
    fields[name] = text.slice(match.index + match[0].length, matches[i+1]?.index ?? text.length).trim().split('\n')[0].trim();
  });
  for (const label of ['company name','event type','event date','event time']) {
    if (!fields[label]) throw new Problem(`Missing ${label}.`);
  }
  let date = fields['event date'].replace(/\.$/, '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const m = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/i.exec(date);
    const month = m && dates.findIndex(v => v === m[2].toLowerCase() || v.slice(0,3) === m[2].toLowerCase());
    if (!m || month < 0) throw new Problem('Unrecognised event date.');
    date = `${m[3]}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  const times = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(fields['event time']);
  if (!times) throw new Problem('Use a same-day 24-hour start and end time.');
  const title = `${fields['company name']} · ${fields['event type']}`;
  const start_time = times[1].padStart(5, '0'), end_time = times[2].padStart(5, '0');
  const id = 'outlook-' + hash(JSON.stringify([key(title),date,start_time])).slice(0,32);
  return validateCatalogue({ sessions: [{ session_id: id, course_id: id, title, section: 'Main', date,
    start_time, end_time, room: fields.venue || 'TBD', instructor: '' }] })[0];
}

function cancelOpen(d, id, now, reason) {
  let count = 0;
  for (const r of d.requests) {
    if (r.status === 'OPEN' && (r.offered_id === id || r.desired_id === id)) {
      r.status = 'CANCELLED'; r.closed_at = new Date(now).toISOString(); r.close_reason = reason; count++;
    }
  }
  return count;
}

export function putEvent(d, candidate, now, selectedId = null, forceNew = false) {
  let old = selectedId ? d.sessions.find(s => s.id === selectedId) : null;
  if (selectedId && !old) throw new Problem('Choose an existing session.', 404);
  if (!selectedId && !forceNew) {
    const matches = d.sessions.filter(s => key(s.title) === key(candidate.title) && s.date === candidate.date && s.start_time === candidate.start_time);
    if (matches.length > 1) throw new Problem('More than one existing session matches. Choose the correct session for this email.');
    old = matches[0];
    if (!old && d.sessions.some(s => key(s.title) === key(candidate.title) && s.date === candidate.date)) {
      throw new Problem('An event with this title and date has a different time. Confirm a new event or select the existing one.');
    }
    if (old && (!old.active || old.section !== 'Main')) throw new Problem('This matches an inactive event or a section. Confirm the intended session.');
  }
  let cancelled = 0;
  if (old) {
    if (['title','date','start_time','end_time'].some(k => old[k] !== candidate[k])) {
      cancelled = cancelOpen(d, old.id, now, 'Session schedule changed; post again after reviewing the new details');
    }
    // Preserve the IDs used by existing swaps and assignment records.
    Object.assign(old, { title: candidate.title, date: candidate.date, start_time: candidate.start_time,
      end_time: candidate.end_time, room: candidate.room, active: 1 });
  } else {
    if (d.sessions.some(s => s.id === candidate.id)) throw new Problem('Session ID collision. Review the catalogue.');
    if (d.sessions.length >= 20000) throw new Problem('Catalogue capacity reached.');
    d.sessions.push(structuredClone(candidate));
  }
  d.demo = false;
  d.metadata.sync = { synced_at: new Date(now).toISOString(), source: 'Outlook cloud sync', sessions: d.sessions.filter(s => s.active).length };
  return { id: old?.id || candidate.id, cancelled };
}

export function deactivateSession(d, id, now = Date.now()) {
  const target = d.sessions.find(s => s.id === id);
  if (!target) throw new Problem('Select the session to deactivate.');
  target.active = 0;
  const cancelled = cancelOpen(d, target.id, now, 'Session deactivated by coordinator');
  d.metadata.sync = { synced_at: new Date(now).toISOString(), source: 'Outlook cloud sync', sessions: d.sessions.filter(s => s.active).length };
  return { ok: true, cancelled };
}

function addReview(state, message, reason, candidate, now) {
  const id = hash(message.id).slice(0,24);
  if (state.reviews.length >= 1000 && !state.reviews.some(r => r.id === id)) throw new Problem('The Outlook review queue is full. Review or dismiss entries before syncing more mail.');
  state.reviews = state.reviews.filter(r => r.id !== id);
  state.reviews.push({ id, subject: message.subject.slice(0,250), received_at: message.receivedDateTime,
    reason, candidate: candidate || null, queued_at: new Date(now).toISOString() });
}

export function ingestMessage(d, message, sender, now = Date.now()) {
  const state = outlookState(d);
  if (typeof message.id !== 'string' || typeof message.subject !== 'string' ||
      !Number.isFinite(Date.parse(message.receivedDateTime))) throw new Problem('Outlook returned an invalid message envelope.');
  if (message.from?.emailAddress?.address?.toLowerCase() !== sender.toLowerCase()) return 'ignored';
  const text = message.body?.content;
  const digest = hash(JSON.stringify([message.subject,text]));
  const identity = hash(message.internetMessageId || message.id);
  if (state.processed[identity] === digest) return 'duplicate';
  if (!matchesSubject(message.subject)) return 'ignored';
  let candidate, reason;
  try { candidate = parseInvite(text); } catch (error) { reason = error instanceof Problem ? error.message : 'Unable to parse this invite.'; }
  if (/cancel|reschedul|postpon|revis|correction|updated/i.test(message.subject) ||
      (typeof text === 'string' && text.length <= 500000 && /\b(cancelled|canceled|postponed|rescheduled)\b/i.test(plainText(text)))) {
    reason = 'Possible cancellation or schedule correction. Confirm the affected session before applying.';
  } else if (typeof text === 'string' && text.length <= 500000 && /\bsection\s*[:\-]?\s*[a-z0-9]+/i.test(plainText(text))) {
    reason = 'The email mentions sections. Confirm which session it describes.';
  }
  let result = 'review';
  if (!reason) {
    const eventKey = hash(JSON.stringify([key(candidate.title),candidate.date,candidate.start_time]));
    const previous = state.latest[eventKey];
    if (previous && Date.parse(message.receivedDateTime) <= Date.parse(previous)) result = 'older';
    else {
      try {
        putEvent(d, candidate, now);
        state.latest[eventKey] = message.receivedDateTime;
        result = 'updated';
      } catch (error) {
        if (!(error instanceof Problem)) throw error;
        reason = error.message;
      }
    }
  }
  if (reason) addReview(state, message, reason, candidate, now);
  if (Object.keys(state.processed).length >= 30000 && !(identity in state.processed)) {
    throw new Problem('Outlook checkpoint capacity reached. Contact the coordinator before importing more mail.');
  }
  state.processed[identity] = digest;
  return result;
}

export function reviewMessage(d, input, now = Date.now()) {
  const state = outlookState(d), item = state.reviews.find(r => r.id === input.id);
  if (!item) throw new Problem('Review item not found or already resolved.', 404);
  if (!['apply','cancel','dismiss'].includes(input.action)) throw new Problem('Choose apply, cancel or dismiss.');
  let result = { ok: true };
  if (input.action === 'apply') {
    if (!item.candidate) throw new Problem('This email could not be parsed. Correct the source invite and resend it.');
    if (!input.session_id && input.confirm_new !== true) throw new Problem('Select an existing session or explicitly confirm a new session.');
    const candidate = item.candidate;
    const previous = input.session_id ? d.sessions.find(s => s.id === input.session_id) : null;
    if (previous) {
      const oldKey = hash(JSON.stringify([key(previous.title),previous.date,previous.start_time]));
      if (!state.latest[oldKey] || state.latest[oldKey] < item.received_at) state.latest[oldKey] = item.received_at;
    }
    result = putEvent(d, candidate, now, input.session_id || null, input.confirm_new === true && !input.session_id);
    const eventKey = hash(JSON.stringify([key(candidate.title),candidate.date,candidate.start_time]));
    const received = state.latest[eventKey];
    if (!received || received < item.received_at) state.latest[eventKey] = item.received_at;
  } else if (input.action === 'cancel') {
    const target = d.sessions.find(s => s.id === input.session_id);
    if (!target) throw new Problem('Select the session to cancel.');
    const oldKey = hash(JSON.stringify([key(target.title),target.date,target.start_time]));
    if (!state.latest[oldKey] || state.latest[oldKey] < item.received_at) state.latest[oldKey] = item.received_at;
    result = deactivateSession(d, target.id, now);
  }
  state.reviews = state.reviews.filter(r => r.id !== input.id);
  return result;
}

export function adminStatus(d, configuration = {}) {
  const state = outlookState(d);
  return { ...configuration, checked_through: state.checked_through, last_attempt: state.last_attempt || null,
    last_success: state.last_success || null, last_error: state.last_error || null, last_counts: state.last_counts || null,
    catching_up: Boolean(state.scan), reviews: state.reviews,
    sessions: d.sessions.map(({id,title,date,start_time,end_time,room,active}) => ({id,title,date,start_time,end_time,room,active})) };
}
