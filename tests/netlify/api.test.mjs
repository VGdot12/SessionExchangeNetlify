import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository, DOCUMENT_KEY } from '../../netlify/lib/repository.mjs';
import { createHandler } from '../../netlify/lib/handler.mjs';
import { emptyDocument, seedDocument, createRequest, login, getState, isFuture } from '../../netlify/lib/model.mjs';

// This store implements the documented atomic conditional-write contract. All
// reads return independent copies, so concurrent requests can actually collide.
class Store {
  constructor() { this.value = null; this.version = 0; this.conflicts = 0; }
  async getWithMetadata(key) {
    assert.equal(key, DOCUMENT_KEY);
    await new Promise(r => setImmediate(r));
    return this.value ? { data: structuredClone(this.value), etag: String(this.version) } : null;
  }
  async setJSON(key, value, options) {
    assert.equal(key, DOCUMENT_KEY);
    await new Promise(r => setImmediate(r));
    if ((options.onlyIfNew && this.value) || (options.onlyIfMatch && options.onlyIfMatch !== String(this.version))) {
      this.conflicts++; return { modified: false };
    }
    this.value = structuredClone(value); this.version++;
    return { modified: true, etag: String(this.version) };
  }
}

function setup() {
  const store = new Store();
  const repository = new Repository(store, seedDocument);
  const handler = createHandler(repository, { adminToken: 'a'.repeat(40) });
  async function request(path, data, cookie = '', extra = {}, ip = '127.0.0.1') {
    const headers = { cookie, ...extra };
    if (data !== undefined) { headers['content-type'] = 'application/json'; headers['x-swap-request'] ??= '1'; }
    const response = await handler(new Request(`https://example.netlify.app/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data),
    }), { ip });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function signin(pgid, name = 'Test Student', ip = pgid) {
    const r = await request('login', { pgid, name }, '', {}, ip);
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  return { store, repository, request, signin };
}

test('configuration, health and real storage initialization use the Netlify contract', async () => {
  const { request, store } = setup();
  assert.equal((await request('config')).data.pgid_only, true);
  assert.equal(store.value.sessions.length, 12);
  assert.equal((await request('health')).data.storage, 'netlify-blobs');
  assert.equal((await request('state')).status, 401);
});

test('registering a new PGID persists across cold handlers and sets secure cookies', async () => {
  const { request, repository } = setup();
  const r = await request('login', { name: 'New Student', pgid: '00999' });
  const token = r.headers.get('set-cookie');
  assert.match(token, /HttpOnly; SameSite=Lax/); assert.match(token, /Secure/);
  const cold = createHandler(new Repository(repository.store, emptyDocument));
  const view = await cold(new Request('https://example.netlify.app/api/state', { headers: { cookie: token.split(';')[0] } }));
  assert.equal((await view.json()).user.pgid, '00999');
});

test('cross-event acceptance leaves public board, records partner for both, and excludes other accounts', async () => {
  const { request, signin } = setup();
  const poster = await signin('00901', 'Poster Name'), acceptor = await signin('00902', 'Acceptor Name'), other = await signin('00903');
  const { id } = (await request('requests', { offered_id: 'STR-A', desired_id: 'DAT-A' }, poster)).data;
  assert.equal((await request(`requests/${id}/accept`, { accepted_session_id: 'DAT-A' }, acceptor)).status, 200);
  const a = (await request('state', undefined, poster)).data, b = (await request('state', undefined, acceptor)).data;
  assert.equal(a.requests.some(r => r.id === id), false);
  assert.equal(a.personal.find(r => r.id === id).partner.pgid, '00902');
  assert.equal(b.personal.find(r => r.id === id).poster.pgid, '00901');
  assert.equal((await request('state', undefined, other)).data.personal.length, 0);
  assert.ok(b.assignments.some(s => s.id === 'STR-A'));
});

test('concurrent acceptors produce one winner and rerun the loser against fresh state', async () => {
  const { request, signin, store } = setup();
  const poster = await signin('00901'), a = await signin('00902'), b = await signin('00903');
  const { id } = (await request('requests', { offered_id: 'STR-A', desired_id: 'DAT-A' }, poster)).data;
  const results = await Promise.all([a, b].map(cookie => request(`requests/${id}/accept`, { accepted_session_id: 'DAT-A' }, cookie)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.ok(store.conflicts > 0);
  assert.equal(store.value.requests.filter(r => r.id === id && r.status === 'ACCEPTED').length, 1);
});

test('simultaneous registrations do not lose either student or login', async () => {
  const { signin, store } = setup();
  await Promise.all([signin('00901'), signin('00902')]);
  assert.ok(store.value.students.find(s => s.pgid === '00901'));
  assert.ok(store.value.students.find(s => s.pgid === '00902'));
  assert.equal(store.value.logins.length, 2);
});

test('flexible swap requires an actual offered event and accepts across company topics', async () => {
  const { request, signin } = setup();
  const poster = await signin('00901'), acceptor = await signin('00902');
  const { id } = (await request('requests', { offered_id: 'STR-A' }, poster)).data;
  assert.equal((await request(`requests/${id}/accept`, {}, acceptor)).status, 400);
  assert.equal((await request(`requests/${id}/accept`, { accepted_session_id: 'FIN-C' }, acceptor)).status, 200);
});

test('self-acceptance, wrong target, duplicate posts and unauthorized cancellation are rejected', async () => {
  const { request, signin } = setup(); const a = await signin('00901'), b = await signin('00902');
  const input = { offered_id: 'STR-A', desired_id: 'DAT-A' };
  const { id } = (await request('requests', input, a)).data;
  assert.equal((await request('requests', input, a)).status, 409);
  assert.equal((await request(`requests/${id}/accept`, {}, a)).status, 403);
  assert.equal((await request(`requests/${id}/accept`, { accepted_session_id: 'FIN-A' }, b)).status, 400);
  assert.equal((await request(`requests/${id}/cancel`, {}, b)).status, 404);
  assert.equal((await request(`requests/${id}/cancel`, {}, a)).status, 200);
});

test('acceptance cancels posts for exchanged events and preserves unrelated requests', async () => {
  const { request, signin } = setup(); const a = await signin('00901'), b = await signin('00902');
  const { id } = (await request('requests', { offered_id: 'STR-A', desired_id: 'DAT-A' }, a)).data;
  const own = (await request('requests', { offered_id: 'DAT-A' }, b)).data.id;
  const unrelated = (await request('requests', { offered_id: 'FIN-A' }, b)).data.id;
  await request(`requests/${id}/accept`, {}, b);
  const all = (await request('state', undefined, b)).data.personal;
  assert.equal(all.find(r => r.id === own).status, 'CANCELLED');
  assert.equal(all.find(r => r.id === unrelated).status, 'OPEN');
});

test('Excel imports retain accepted history, reject bad data atomically, and deactivate omitted events', async () => {
  const { request, signin, store } = setup(); const a = await signin('00901'), b = await signin('00902');
  const { id } = (await request('requests', { offered_id: 'STR-A', desired_id: 'DAT-A' }, a)).data;
  await request(`requests/${id}/accept`, {}, b);
  const snapshot = { sessions: store.value.sessions.map(({ id, active, ...s }) => ({ session_id: id, ...s })) };
  snapshot.sessions.find(s => s.session_id === 'STR-A').room = 'Updated room';
  const auth = { authorization: 'Bearer ' + 'a'.repeat(40) };
  assert.equal((await request('admin/import', snapshot, '', auth)).status, 200);
  assert.equal((await request('config')).data.demo, false);
  assert.notEqual((await request('state', undefined, a)).data.personal.find(r => r.id === id).offered.room, 'Updated room');
  const oldRevision = store.version;
  snapshot.sessions[0].date = '2026-02-30';
  assert.equal((await request('admin/import', snapshot, '', auth)).status, 400);
  assert.equal(store.version, oldRevision);
});

test('CSRF, sync credentials, method routing, rate limit and logout are enforced', async () => {
  const { request, signin } = setup(); const cookie = await signin('00901');
  assert.equal((await request('requests', { offered_id: 'STR-A' }, cookie, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('requests', { offered_id: 'STR-A' }, cookie, { 'x-swap-request': '' })).status, 403);
  assert.equal((await request('admin/import', { sessions: [] })).status, 403);
  assert.equal((await request('missing')).status, 404);
  assert.equal((await request('logout', {}, cookie)).status, 200);
  assert.equal((await request('state', undefined, cookie)).status, 401);
  for (let i = 0; i < 15; i++) await request('login', { pgid: 'bad pgid', name: 'Test Name' }, '', {}, 'limited');
  assert.equal((await request('login', { pgid: '00999', name: 'Test Name' }, '', {}, 'limited')).status, 429);
});

test('campus timezone boundaries and expired requests are independent of server timezone', () => {
  const now = Date.parse('2026-10-27T16:00:00Z'); // 21:30 in Kolkata
  const s = { date: '2026-10-27', start_time: '21:30' };
  assert.equal(isFuture(s, now, 'Asia/Kolkata'), false);
  assert.equal(isFuture(s, now - 1000, 'Asia/Kolkata'), true);
  const d = seedDocument(now); login(d, { pgid: '00901', name: 'Test Name' });
  const id = createRequest(d, '00901', { offered_id: 'STR-A' }, now);
  d.sessions.find(s => s.id === 'STR-A').date = '2026-10-26';
  assert.equal(getState(d, '00901', now).personal.find(r => r.id === id).status, 'EXPIRED');
});

test('a fresh empty catalogue supports PGID entry without silently seeding sample sessions', async () => {
  const repository = new Repository(new Store(), emptyDocument);
  const d = (await repository.read()).data;
  assert.equal(d.sessions.length, 0); assert.equal(d.demo, false);
});
