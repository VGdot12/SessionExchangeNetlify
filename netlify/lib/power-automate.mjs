import { Problem } from './model.mjs';
import { ingestMessage, outlookState } from './outlook.mjs';

function normalize(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Problem('Send the Outlook trigger body as a JSON object.');
  for (const [key,limit] of [['id',2048],['subject',2000],['receivedDateTime',100]]) {
    if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > limit) throw new Problem(`Outlook payload needs ${key}. Use the full triggerBody() expression, not Body Preview.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(row.receivedDateTime) || !Number.isFinite(Date.parse(row.receivedDateTime))) throw new Problem('receivedDateTime must be a valid timestamp with a timezone.');
  const sender = typeof row.from === 'string' ? row.from : row.from?.emailAddress?.address;
  if (typeof sender !== 'string' || sender.length > 320 || !/^[^\s<>@]+@[^\s<>@]+$/.test(sender.trim())) throw new Problem('Outlook payload needs the actual From email address.');
  const content = typeof row.body === 'string' ? row.body : row.body?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Problem('Outlook payload needs the complete message body. Use triggerBody(), not Body Preview.');
  if (content.length > 500000) throw new Problem('The email body exceeds the 500,000 character limit.');
  if (row.internetMessageId !== undefined && (typeof row.internetMessageId !== 'string' || row.internetMessageId.length > 2048)) throw new Problem('Invalid internetMessageId.');
  return { id:row.id, subject:row.subject, receivedDateTime:new Date(row.receivedDateTime).toISOString(),
    internetMessageId:row.internetMessageId || undefined, from:{emailAddress:{address:sender.trim()}}, body:{content} };
}

export function receivePowerAutomate(d, payload, now = Date.now()) {
  const rows = Array.isArray(payload.value) ? payload.value : [payload];
  if (!rows.length || rows.length > 25) throw new Problem('Send 1–25 Outlook messages per request.');
  const messages = rows.map(normalize);
  const counts = {updated:0,review:0,duplicate:0,older:0,ignored:0};
  for (const message of messages) counts[ingestMessage(d,message,'casevents@isb.edu',now)]++;
  const state = outlookState(d);
  state.last_attempt = new Date(now).toISOString(); state.last_success = new Date(now).toISOString();
  state.last_error = null; state.last_counts = counts; state.last_source = 'power-automate';
  if (counts.updated) d.metadata.sync.source = 'Outlook via Power Automate';
  return {ok:true,...counts};
}
