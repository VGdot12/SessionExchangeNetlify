import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDocument, emptyDocument, login, createRequest, acceptRequest } from '../../netlify/lib/model.mjs';
import { receiveCatalogueUpload } from '../../netlify/lib/catalogue-upload.mjs';
import { Repository } from '../../netlify/lib/repository.mjs';
import { createHandler } from '../../netlify/lib/handler.mjs';
import { deliverCatalogue, ENDPOINT } from '../../scripts/deliver-catalogue.mjs';

const TOKEN = 'excel-token-123456789012345678901234567890';
const NOW = Date.parse('2026-10-27T00:00:00Z');
const row = s => { const { id, active, ...fields } = s; return { session_id: id, ...fields }; };
const payload = (sessions, version = 1) => ({ sessions, version, commit: 'a'.repeat(40) });
class Store {
  value = null; version = 0;
  async getWithMetadata() { await new Promise(r => setImmediate(r)); return this.value ? { data: structuredClone(this.value), etag: String(this.version) } : null; }
  async setJSON(key, value, o) { await new Promise(r => setImmediate(r)); if ((o.onlyIfNew && this.value) || (o.onlyIfMatch && o.onlyIfMatch !== String(this.version))) return { modified: false }; this.value = structuredClone(value); this.version++; return { modified: true }; }
}
function setup(options = {}) {
  const store = new Store(), repo = new Repository(store, () => seedDocument(NOW));
  const handler = createHandler(repo, { excelUpload: { enabled: true, production: true, token: TOKEN, ...options } });
  const send = async (data, headers = {}) => {
    const r = await handler(new Request('https://example.test/api/integrations/catalogue', { method: data ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', 'x-swap-request': '1', ...headers },
      ...(data ? { body: JSON.stringify(data) } : {}) }));
    return { status: r.status, data: await r.json() };
  };
  return { store, repo, send };
}

test('a room correction matches legacy IDs and keeps open swaps, unrelated sessions and students', () => {
  const d = seedDocument(NOW);
  login(d, { pgid: '90001', name: 'Poster' }, '', NOW);
  const id = createRequest(d, '90001', { offered_id: 'STR-A', desired_id: 'DAT-A' }, NOW);
  const incoming = row(d.sessions.find(s => s.id === 'STR-A'));
  incoming.session_id = incoming.course_id = 'new-generated-id'; incoming.room = 'LT 99';
  const before = d.sessions.length;
  const result = receiveCatalogueUpload(d, payload([incoming]), NOW);
  assert.equal(result.updated, 1); assert.equal(result.added, 0);
  assert.equal(d.sessions.length, before); assert.equal(d.sessions.find(s => s.id === 'STR-A').room, 'LT 99');
  assert.equal(d.requests.find(r => r.id === id).status, 'OPEN');
  assert.equal(d.sessions.find(s => s.id === 'DAT-A').active, 1);
  assert.ok(d.students.find(s => s.pgid === '90001'));
});

test('schedule correction cancels affected open requests and retains immutable accepted history', () => {
  const d = seedDocument(NOW);
  for (const [pgid, name] of [['90001', 'Poster'], ['90002', 'Acceptor'], ['90003', 'Other']]) login(d, { pgid, name }, '', NOW);
  const accepted = createRequest(d, '90001', { offered_id: 'STR-A', desired_id: 'DAT-A' }, NOW);
  acceptRequest(d, '90002', accepted, 'DAT-A', NOW);
  const snapshot = structuredClone(d.requests.find(r => r.id === accepted));
  const open = createRequest(d, '90003', { offered_id: 'STR-A' }, NOW);
  const changed = row(d.sessions.find(s => s.id === 'STR-A'));
  changed.date = '2027-01-01';
  receiveCatalogueUpload(d, payload([changed]), NOW);
  assert.equal(d.requests.find(r => r.id === open).status, 'CANCELLED');
  assert.deepEqual(d.requests.find(r => r.id === accepted), snapshot);
});

test('duplicate delivery and reordered workflow execution cannot reverse the current workbook', async () => {
  const { repo, store, send } = setup();
  const d = (await repo.read()).data;
  const current = row(d.sessions[0]); current.room = 'Newest';
  const results = await Promise.all([send(payload([current], 3)), send(payload([current], 3))]);
  assert.equal(results.filter(r => r.data.duplicate).length, 1);
  const old = { ...current, room: 'Old' };
  assert.equal((await send(payload([old], 2))).data.older, true);
  assert.equal(store.value.sessions[0].room, 'Newest');
  assert.equal((await send(payload([old], 3))).status, 409);
});

test('invalid or ambiguous later rows roll back the entire import, including its version watermark', async () => {
  const { repo, store, send } = setup();
  const d = (await repo.read()).data, good = row(d.sessions[0]);
  good.room = 'Must not save';
  const inactive = row(d.sessions[1]);
  await repo.mutate(doc => { doc.sessions[1].active = 0; });
  const version = store.version;
  assert.equal((await send(payload([good, inactive]))).status, 400);
  assert.equal(store.version, version); assert.notEqual(store.value.sessions[0].room, good.room);
  assert.equal(store.value.catalogueUpload, undefined);
  assert.equal((await send(payload([]))).status, 400);
});

test('concurrent imports and student writes survive together in shared storage', async () => {
  const { repo, store, send } = setup();
  const d = (await repo.read()).data, incoming = row(d.sessions[0]); incoming.room = 'Updated';
  await Promise.all([send(payload([incoming])), repo.mutate(doc => login(doc, { pgid: '90001', name: 'Concurrent student' }, '', NOW))]);
  assert.equal(store.value.sessions[0].room, 'Updated');
  assert.ok(store.value.students.find(s => s.pgid === '90001'));
});

test('workbook endpoint rejects disabled integrations, previews and unauthenticated or cross-site writes', async () => {
  const sample = payload([row(seedDocument(NOW).sessions[0])]);
  for (const options of [{ enabled: false }, { production: false }, { production: undefined }, { token: '' }]) {
    const s = setup(options); assert.ok([403, 503].includes((await s.send(sample)).status)); assert.equal(s.store.value, null);
  }
  const s = setup();
  for (const h of [{ authorization: 'Bearer wrong' }, { origin: 'https://other.test' }, { 'x-swap-request': '' }]) assert.equal((await s.send(sample, h)).status, 403);
  assert.equal(s.store.value, null);
  assert.equal((await s.send()).data.ready, true);
});

test('a fresh upload appends only event data and treats a repeated workbook as unchanged', () => {
  const d = emptyDocument(), incoming = row(seedDocument(NOW).sessions[0]); incoming.instructor = 'Should be discarded';
  assert.equal(receiveCatalogueUpload(d, payload([incoming]), NOW).added, 1);
  assert.equal(d.sessions[0].instructor, '');
  assert.equal(receiveCatalogueUpload(d, payload([incoming], 2), NOW).unchanged, 1);
  assert.equal(d.sessions.length, 1);
});

test('GitHub delivery uses the fixed endpoint and retries lost acknowledgements safely', async () => {
  const d = emptyDocument(), sample = payload([row(seedDocument(NOW).sessions[0])]); let calls = 0;
  const result = await deliverCatalogue({ payload: sample, token: TOKEN, pause: async () => {}, fetcher: async (url, options) => {
    assert.equal(url, ENDPOINT); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    const saved = receiveCatalogueUpload(d, JSON.parse(options.body), NOW);
    if (++calls === 1) throw new Error('connection lost after save');
    return Response.json(saved);
  } });
  assert.equal(result.duplicate, true); assert.equal(calls, 2); assert.equal(d.sessions.length, 1);
});

test('GitHub connection checks are read-only and delivery errors do not expose response bodies', async () => {
  const result = await deliverCatalogue({ check: true, token: TOKEN, fetcher: async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    return Response.json({ ok: true, ready: true, private: 'SECRET' });
  } });
  assert.deepEqual(result, { ok: true, ready: true });
  await assert.rejects(deliverCatalogue({ check: true, token: TOKEN, fetcher: async () => new Response('PRIVATE DETAILS', { status: 403 }) }), error => /403/.test(error.message) && !error.message.includes('PRIVATE'));
});
