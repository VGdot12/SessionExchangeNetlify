import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class Problem extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const stamp = () => new Date().toISOString();
const uid = () => randomBytes(12).toString('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function secureEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// The catalogue uses campus local times. Comparing local ISO parts avoids
// machine-timezone assumptions and handles DST through Intl's timezone data.
export function isFuture(session, now = Date.now(), timezone = 'Asia/Kolkata') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return `${session.date}T${session.start_time}:00` > local;
}

export function emptyDocument() {
  return { schema: 1, demo: false, students: [], sessions: [], assignments: [], requests: [], logins: [], attempts: [], metadata: {} };
}

export function seedDocument(now = Date.now()) {
  const d = emptyDocument(); d.demo = true;
  const courses = [
    ['STR', 'Strategic Thinking', 'Prof. Meera Shah', 'LT 201'],
    ['DAT', 'Data-driven Decisions', 'Prof. Arjun Rao', 'LT 104'],
    ['COM', 'Leadership Communication', 'Prof. Kavya Iyer', 'Seminar Hall'],
    ['FIN', 'Finance Fundamentals', 'Prof. Rohan Das', 'LT 302'],
  ];
  for (const [i, [code, title, instructor, room]] of courses.entries()) {
    for (const [j, section] of ['A', 'B', 'C'].entries()) {
      const date = new Date(now + (3 + i) * 86400000).toISOString().slice(0, 10);
      d.sessions.push({ id: `${code}-${section}`, course_id: code, title, section, date,
        start_time: ['09:00', '11:00', '14:00'][j], end_time: ['10:30', '12:30', '15:30'][j], room, instructor, active: 1 });
    }
  }
  ['Aarav Sharma', 'Ananya Patel', 'Riya Mehta', 'Kabir Sethi', 'Ishaan Nair', 'Sara Khan'].forEach((name, i) => {
    d.students.push({ pgid: `2600${i + 1}`, name, active: 1 });
  });
  for (const [pgid, offered_id, desired_id, notes] of [
    ['26002', 'STR-B', 'DAT-B', 'Interested in the data session instead. Happy to swap!'],
    ['26003', 'DAT-A', null, 'Flexible on the event. Looking for a different time.'],
    ['26004', 'COM-C', 'COM-A', 'The earlier section works better with my schedule.'],
    ['26005', 'FIN-B', null, ''], ['26006', 'STR-C', null, 'Open to another event.'],
  ]) createRequest(d, pgid, { offered_id, desired_id, notes }, now);
  d.metadata.sync = { synced_at: new Date(now).toISOString(), source: 'Sample catalogue · fictional students', sessions: 12 };
  return d;
}

function getSession(d, id) {
  const s = d.sessions.find(s => s.id === id);
  if (!s) throw new Problem('Session not found.', 404);
  return s;
}
function available(d, id, now, timezone) {
  const s = getSession(d, id);
  if (!s.active || !isFuture(s, now, timezone)) throw new Problem('This session is no longer available for swapping.', 409);
  return s;
}
function person(d, pgid) {
  const p = d.students.find(p => p.pgid === pgid && p.active);
  if (!p) throw new Problem('Please enter your name and PGID to continue.', 401);
  return { pgid: p.pgid, name: p.name };
}
export function expire(d, now = Date.now(), timezone = 'Asia/Kolkata') {
  for (const r of d.requests) {
    if (r.status !== 'OPEN') continue;
    if (!isFuture(getSession(d, r.offered_id), now, timezone) ||
        (r.desired_id && !isFuture(getSession(d, r.desired_id), now, timezone))) {
      r.status = 'EXPIRED'; r.closed_at = new Date(now).toISOString(); r.close_reason = 'Session has started';
    }
  }
}

export function login(d, input, ip = 'unknown', now = Date.now()) {
  d.attempts = d.attempts.filter(a => a.at > now - 300000);
  const ipKey = hash(ip);
  if (d.attempts.filter(a => a.ip === ipKey).length >= 15) return { error: 'Too many sign-in attempts. Please try again in five minutes.', status: 429 };
  d.attempts.push({ ip: ipKey, at: now });
  const { pgid, name } = input;
  if (typeof pgid !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(pgid)) return { error: 'Enter a valid PGID.', status: 400 };
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100) return { error: 'Enter your name (2–100 characters).', status: 400 };
  let p = d.students.find(p => p.pgid === pgid);
  if (!p) { p = { pgid, name: name.trim(), active: 1 }; d.students.push(p); }
  else { p.name = name.trim(); p.active = 1; }
  const token = randomBytes(32).toString('base64url');
  d.logins = d.logins.filter(l => l.expires > now);
  d.logins.push({ token_hash: hash(token), pgid, expires: now + 43200000 });
  return { token };
}

export function authenticate(d, token, now = Date.now()) {
  const found = d.logins.find(l => l.token_hash === hash(token) && l.expires > now);
  if (!found) throw new Problem('Please enter your name and PGID to continue.', 401);
  person(d, found.pgid);
  return found.pgid;
}

function view(d, row, viewer) {
  const r = structuredClone(row), snap = r.snapshot; delete r.snapshot;
  r.offered = snap?.offered || getSession(d, r.offered_id);
  r.desired = snap?.desired || (r.desired_id ? getSession(d, r.desired_id) : null);
  r.poster = snap?.poster || person(d, r.poster_pgid);
  r.partner = r.accepted_by ? snap?.partner || person(d, r.accepted_by) : null;
  r.accepted_session = r.accepted_session_id ? snap?.accepted_session || getSession(d, r.accepted_session_id) : null;
  r.can_accept = r.status === 'OPEN' && r.poster_pgid !== viewer;
  r.accept_reason = r.can_accept ? '' : r.status === 'OPEN' ? 'This is your request.' : 'This request is closed.';
  r.your_session = null;
  return r;
}

export function getState(d, pgid, now = Date.now(), timezone = 'Asia/Kolkata') {
  expire(d, now, timezone);
  const sort = (a, b) => b.created_at.localeCompare(a.created_at);
  return {
    user: person(d, pgid), requests: d.requests.filter(r => r.status === 'OPEN').sort(sort).map(r => view(d, r, pgid)),
    personal: d.requests.filter(r => r.poster_pgid === pgid || r.accepted_by === pgid).sort(sort).map(r => view(d, r, pgid)),
    assignments: d.assignments.filter(a => a.pgid === pgid).map(a => getSession(d, a.current_session_id)).filter(s => s.active)
      .filter((s, i, all) => all.findIndex(v => v.id === s.id) === i).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)),
    sessions: d.sessions.filter(s => s.active && isFuture(s, now, timezone)).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)),
    metadata: d.metadata,
  };
}

function declare(d, pgid, offered) {
  const a = d.assignments.find(a => a.pgid === pgid && a.slot_id === offered);
  if (a) { a.source_session_id = offered; a.current_session_id = offered; }
  else d.assignments.push({ pgid, slot_id: offered, source_session_id: offered, current_session_id: offered });
}

export function createRequest(d, pgid, input, now = Date.now(), timezone = 'Asia/Kolkata') {
  person(d, pgid); expire(d, now, timezone);
  const { offered_id, notes = '' } = input, desired_id = input.desired_id || null;
  if (typeof offered_id !== 'string' || (desired_id !== null && typeof desired_id !== 'string')) throw new Problem('Choose an event from the list.');
  if (typeof notes !== 'string' || notes.length > 300) throw new Problem('Notes must be 300 characters or fewer.');
  const offered = available(d, offered_id, now, timezone);
  if (desired_id) {
    available(d, desired_id, now, timezone);
    if (desired_id === offered_id) throw new Problem('Choose a different event or section.');
  } else if (!d.sessions.some(s => s.id !== offered_id && s.active && isFuture(s, now, timezone))) {
    throw new Problem('There are no other upcoming events for a swap.');
  }
  if (d.requests.some(r => r.poster_pgid === pgid && r.offered_id === offered_id && r.status === 'OPEN')) throw new Problem('You already have an open request for this event. Cancel it before posting another.', 409);
  const id = uid();
  d.requests.push({ id, poster_pgid: pgid, course_id: offered.course_id, offered_id, desired_id, notes: notes.trim(),
    status: 'OPEN', accepted_by: null, accepted_session_id: null, created_at: new Date(now).toISOString(), closed_at: null, close_reason: null, snapshot: null });
  declare(d, pgid, offered_id);
  return id;
}

export function acceptRequest(d, pgid, id, given, now = Date.now(), timezone = 'Asia/Kolkata') {
  person(d, pgid); expire(d, now, timezone);
  const r = d.requests.find(r => r.id === id);
  if (!r) throw new Problem('Request not found.', 404);
  if (r.status !== 'OPEN') throw new Problem('This request is no longer open. Refresh to see available swaps.', 409);
  if (r.poster_pgid === pgid) throw new Problem('You cannot accept your own request.', 403);
  const offer = available(d, r.offered_id, now, timezone);
  const giving = given || r.desired_id;
  if (typeof giving !== 'string') throw new Problem('Select the assigned event you are offering in exchange.');
  const other = available(d, giving, now, timezone);
  if (other.id === offer.id) throw new Problem('Select a different event or section.');
  if (r.desired_id && giving !== r.desired_id) throw new Problem('The event you offer must match the requested event.');
  r.snapshot = structuredClone({ offered: offer, desired: r.desired_id ? getSession(d, r.desired_id) : null,
    accepted_session: other, poster: person(d, r.poster_pgid), partner: person(d, pgid) });
  r.status = 'ACCEPTED'; r.accepted_by = pgid; r.accepted_session_id = other.id; r.closed_at = new Date(now).toISOString();
  d.assignments = d.assignments.filter(a => !((a.pgid === r.poster_pgid && a.current_session_id === offer.id) || (a.pgid === pgid && a.current_session_id === other.id)));
  for (const [owner, source, received] of [[r.poster_pgid, offer.id, other.id], [pgid, other.id, offer.id]]) {
    const a = d.assignments.find(a => a.pgid === owner && a.slot_id === source);
    if (a) a.current_session_id = received;
    else d.assignments.push({ pgid: owner, slot_id: source, source_session_id: source, current_session_id: received });
  }
  for (const open of d.requests) {
    if (open.status === 'OPEN' && ((open.poster_pgid === pgid && open.offered_id === other.id) || (open.poster_pgid === r.poster_pgid && open.offered_id === offer.id))) {
      open.status = 'CANCELLED'; open.closed_at = r.closed_at; open.close_reason = 'Another swap changed your declared event';
    }
  }
}

export function cancelRequest(d, pgid, id, now = Date.now()) {
  const r = d.requests.find(r => r.id === id && r.poster_pgid === pgid);
  if (!r) throw new Problem('Request not found.', 404);
  if (r.status !== 'OPEN') throw new Problem('Only open requests can be cancelled.', 409);
  r.status = 'CANCELLED'; r.closed_at = new Date(now).toISOString(); r.close_reason = 'Cancelled by you';
}

export function validateCatalogue(payload) {
  if (!object(payload) || !Array.isArray(payload.sessions) || !payload.sessions.length || payload.sessions.length > 20000) throw new Problem('Provide 1–20,000 sessions in the workbook snapshot.');
  const ids = new Set(), sections = new Set(), titles = new Map();
  return payload.sessions.map(row => {
    if (!object(row)) throw new Problem('Each session must be an object.');
    const s = {};
    for (const key of ['session_id', 'course_id', 'title', 'section', 'date', 'start_time', 'end_time', 'room', 'instructor']) {
      const value = row[key] ?? '';
      if (typeof value !== 'string' || value.length > 200 || (!['room', 'instructor'].includes(key) && !value.trim())) throw new Problem(`${key} must contain valid text of 200 characters or fewer.`);
      s[key] = value.trim();
    }
    if (ids.has(s.session_id)) throw new Problem(`Duplicate session ID: ${s.session_id}.`);
    ids.add(s.session_id);
    const sectionKey = JSON.stringify([s.course_id, s.section]);
    if (sections.has(sectionKey)) throw new Problem('A session topic cannot repeat a section label.');
    sections.add(sectionKey);
    if (titles.has(s.course_id) && titles.get(s.course_id) !== s.title) throw new Problem('All sections of an event must have the same title.');
    titles.set(s.course_id, s.title);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Number.isFinite(Date.parse(`${s.date}T12:00:00Z`)) || new Date(`${s.date}T12:00:00Z`).toISOString().slice(0, 10) !== s.date) throw new Problem('Use a valid YYYY-MM-DD event date.');
    if (![s.start_time, s.end_time].every(v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) || s.end_time <= s.start_time) throw new Problem('Use HH:MM times with the end after the start on the same day.');
    const { session_id: id, ...fields } = s;
    return { id, ...fields, active: 1 };
  });
}

export function importCatalogue(d, payload, now = Date.now(), timezone = 'Asia/Kolkata') {
  const incoming = validateCatalogue(payload);
  for (const s of incoming) {
    const old = d.sessions.find(v => v.id === s.id);
    if (old && old.course_id !== s.course_id) throw new Problem(`Event grouping changed for ${s.id}. Use a new session ID.`);
  }
  for (const s of d.sessions) s.active = 0;
  for (const s of incoming) {
    const old = d.sessions.find(v => v.id === s.id);
    if (old) Object.assign(old, s); else d.sessions.push(s);
  }
  let cancelled = 0;
  for (const r of d.requests) {
    if (r.status !== 'OPEN') continue;
    if (!getSession(d, r.offered_id).active || (r.desired_id && !getSession(d, r.desired_id).active) || (!r.desired_id && !incoming.some(s => s.id !== r.offered_id && isFuture(s, now, timezone)))) {
      r.status = 'CANCELLED'; r.closed_at = new Date(now).toISOString(); r.close_reason = 'Event changed during Excel sync'; cancelled++;
    }
  }
  d.demo = false;
  d.metadata.sync = { synced_at: new Date(now).toISOString(), source: 'Excel sync', sessions: incoming.length, cancelled_requests: cancelled };
  expire(d, now, timezone);
  return d.metadata.sync;
}
