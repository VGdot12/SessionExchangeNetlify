import { Problem, hash, validateCatalogue } from './model.mjs';

const key = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const fields = ['title', 'date', 'start_time', 'end_time', 'room'];

// Runs inside Repository.mutate: all rows and the workflow watermark commit
// together, using the same conditional write as student swap operations.
export function receiveCatalogueUpload(d, payload, now = Date.now()) {
  if (!Number.isSafeInteger(payload.version) || payload.version < 1 ||
      typeof payload.commit !== 'string' || !/^[a-f0-9]{40}$/.test(payload.commit)) {
    throw new Problem('A valid GitHub workflow version and commit are required.');
  }
  const incoming = validateCatalogue(payload);
  const digest = hash(JSON.stringify(incoming));
  const previous = d.catalogueUpload;
  if (previous && payload.version < previous.version) return { ok: true, older: true };
  if (previous && payload.version === previous.version) {
    if (previous.digest !== digest || previous.commit !== payload.commit) throw new Problem('This workflow version already imported a different workbook.', 409);
    return { ok: true, duplicate: true };
  }
  let added = 0, updated = 0, unchanged = 0, cancelled = 0;
  const touched = new Set();
  for (const candidate of incoming) {
    let old = d.sessions.find(s => s.id === candidate.id);
    if (!old) {
      const matches = d.sessions.filter(s => key(s.title) === key(candidate.title) && s.date === candidate.date && s.start_time === candidate.start_time);
      if (matches.length > 1) throw new Problem('More than one existing event matches a workbook row. Use the original session_id to choose it.');
      old = matches[0];
    }
    if (old) {
      if (touched.has(old.id)) throw new Problem('Several workbook rows identify the same existing session.');
      touched.add(old.id);
      if (!old.active) throw new Problem('A workbook row matches an event that was deactivated. Review that event before importing.');
      if (fields.every(k => old[k] === candidate[k])) { unchanged++; continue; }
      if (fields.slice(0, 4).some(k => old[k] !== candidate[k])) {
        for (const r of d.requests) {
          if (r.status === 'OPEN' && (r.offered_id === old.id || r.desired_id === old.id)) {
            r.status = 'CANCELLED'; r.closed_at = new Date(now).toISOString();
            r.close_reason = 'Session schedule changed; post again after reviewing the new details'; cancelled++;
          }
        }
      }
      // Preserve existing IDs, course grouping, assignments and accepted snapshots.
      for (const k of fields) old[k] = candidate[k];
      updated++;
    } else {
      if (d.sessions.length >= 20000) throw new Problem('Catalogue capacity reached.');
      // No roster, private email fields or instructor details are imported.
      d.sessions.push({ ...candidate, instructor: '' });
      touched.add(candidate.id); added++;
    }
  }
  d.demo = false;
  d.catalogueUpload = { version: payload.version, commit: payload.commit, digest };
  d.metadata.sync = { source: 'Excel uploaded to GitHub', synced_at: new Date(now).toISOString(),
    sessions: d.sessions.filter(s => s.active).length, added, updated, unchanged, cancelled_requests: cancelled };
  return { ok: true, added, updated, unchanged, cancelled };
}
