import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../../netlify/lib/repository.mjs';
import { emptyDocument, seedDocument, acceptRequest, getState, hash } from '../../netlify/lib/model.mjs';
import { ingestMessage, parseInvite, reviewMessage, outlookState, matchesSubject } from '../../netlify/lib/outlook.mjs';
import { runOutlookSync, outlookConfiguration, resetOutlookScan } from '../../netlify/lib/outlook-sync.mjs';
import { createHandler } from '../../netlify/lib/handler.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const BODY = `Dear Student,
Company Name : Nagarro
Industry : Technology
Event Type : Pre Placement Talk
Event Date : 27 October, 2026
Event Time : 21:30 - 22:30
Duration : 1 hr
Mode : Offline
Venue : TBD
Presenter's Designation : Director`;
const SENDER = 'casevents@isb.edu';
const mail = (id = 'm1', body = BODY, extra = {}) => ({ id, internetMessageId: `<${id}@example.test>`,
  from: {emailAddress: {address: SENDER}}, subject: 'Upcoming Event | PGP Co 2027 | Pre Placement Talk : Session Scheduled',
  receivedDateTime: '2026-10-26T10:00:00Z', body: {content: body, contentType: 'text'}, ...extra });
const config = {enabled:true,tenant:'a',client:'b',secret:'PRIVATE-SECRET',mailbox:'student@school.test',folder:'inbox',sender:SENDER,days:30};

class Store {
  constructor() { this.value = null; this.version = 0; this.conflicts = 0; }
  async getWithMetadata() {
    await new Promise(r=>setImmediate(r));
    return this.value ? { data:structuredClone(this.value), etag:String(this.version) } : null;
  }
  async setJSON(key,value,options) {
    await new Promise(r=>setImmediate(r));
    if ((options.onlyIfNew && this.value) || (options.onlyIfMatch && options.onlyIfMatch !== String(this.version))) {this.conflicts++;return {modified:false};}
    this.value = structuredClone(value);this.version++;return {modified:true};
  }
}
const repo = (initial = emptyDocument) => new Repository(new Store(), initial);
const json = value => Response.json(value);

test('the screenshot template parses from plain text and Outlook HTML tables into only event details',()=>{
  const s = parseInvite(BODY);
  assert.equal(s.title,'Nagarro · Pre Placement Talk'); assert.equal(s.date,'2026-10-27');
  assert.equal(s.start_time,'21:30'); assert.equal(s.end_time,'22:30');assert.equal(s.room,'TBD');assert.equal(s.instructor,'');
  const html = '<table>'+BODY.split('\n').slice(1).map(line=>{const i=line.indexOf(':');return `<tr><td><b>${line.slice(0,i)}</b>:</td><td>${line.slice(i+1)}</td></tr>`;}).join('')+'</table>';
  assert.deepEqual(parseInvite(html),s);
  for (const body of [BODY.replace('27 October, 2026','30 February, 2026'),BODY.replace('21:30 - 22:30','22:30 - 21:30'),BODY.replace('21:30 - 22:30','25:00 - 26:00'),BODY+'\nCompany Name : Different']) assert.throws(()=>parseInvite(body));
});

test('only the exact sender and requested cohort/event subject can trigger a body fetch or import',async()=>{
  assert.equal(matchesSubject('FW: Upcoming Event  | PGP Co 2027 | Pre Placement Talk : Session Scheduled'),true);
  for(const subject of ['Upcoming Event | PGP Co 2028 | Pre Placement Talk :','Upcoming Event | PGP Co 2027 | Workshop :','Upcoming Event | PGP Co 2027 | Pre Placement Talk','Other Event']) assert.equal(matchesSubject(subject),false);
  const repository=repo();let bodies=0;
  const fetcher=async url=>{
    if(url.includes('login.microsoftonline.com'))return json({access_token:'ACCESS'});
    if(new URL(url).pathname.includes('/messages/')){bodies++;return json({body:{content:BODY}});}
    const query=new URL(url).searchParams;assert.equal(query.get('$select').includes('body'),false);
    assert.match(query.get('$filter'),/from\/emailAddress\/address eq 'casevents@isb.edu'/);
    return json({value:[mail('valid'),mail('wrong-subject',BODY,{subject:'Upcoming Event | PGP Co 2028 | Pre Placement Talk :'}),mail('wrong-sender',BODY,{from:{emailAddress:{address:'other@school.test'}}})]});
  };
  const result=await runOutlookSync(repository,config,{fetch:fetcher,clock:()=>NOW});
  assert.equal(bodies,1);assert.equal(result.updated,1);assert.equal(result.ignored,2);assert.equal(repository.store.value.sessions.length,1);
});

test('new events retain all existing sessions, open requests and accepted swap snapshots',()=>{
  const d = seedDocument(NOW);
  acceptRequest(d,'26001',d.requests[0].id,'DAT-B',NOW);
  const existing = structuredClone({sessions:d.sessions, requests:d.requests, assignments:d.assignments, students:d.students});
  assert.equal(ingestMessage(d,mail(),SENDER,NOW),'updated');
  assert.deepEqual(d.sessions.slice(0,12),existing.sessions);assert.equal(d.sessions.length,13);
  assert.deepEqual(d.requests,existing.requests);assert.deepEqual(d.assignments,existing.assignments);assert.deepEqual(d.students,existing.students);
  assert.equal(ingestMessage(d,mail(),SENDER,NOW),'duplicate');assert.equal(d.sessions.length,13);
  assert.equal(JSON.stringify(getState(d,'26001',NOW)).includes('internetMessageId'),false);
  assert.equal(Object.hasOwn(getState(d,'26001',NOW),'outlook'),false);
});

test('matching a four-column Excel event preserves IDs, and old mail cannot overwrite its room',()=>{
  const d=emptyDocument(), existing={...parseInvite(BODY),id:'event-from-excel',course_id:'event-from-excel'};d.sessions.push(existing);
  ingestMessage(d,mail(),SENDER,NOW);
  ingestMessage(d,mail('new',BODY.replace('Venue : TBD','Venue : LT 3'),{receivedDateTime:'2026-10-26T11:00:00Z'}),SENDER,NOW);
  assert.equal(d.sessions.length,1);assert.equal(d.sessions[0].id,'event-from-excel');assert.equal(d.sessions[0].room,'LT 3');
  assert.equal(ingestMessage(d,mail('older'),SENDER,NOW),'older');assert.equal(d.sessions[0].room,'LT 3');
});

test('room updates preserve open requests; reschedules require review and only close affected open posts',()=>{
  const d=emptyDocument();ingestMessage(d,mail(),SENDER,NOW);const id=d.sessions[0].id;
  d.requests=[{id:'open',status:'OPEN',offered_id:id},{id:'accepted',status:'ACCEPTED',offered_id:id,snapshot:{test:'history'}},{id:'other',status:'OPEN',offered_id:'other'}];
  ingestMessage(d,mail('room',BODY.replace('Venue : TBD','Venue : LT 3'),{receivedDateTime:'2026-10-26T11:00:00Z'}),SENDER,NOW);
  assert.equal(d.requests[0].status,'OPEN');
  ingestMessage(d,mail('correction',BODY.replace('27 October, 2026','28 October, 2026'),{subject:'Revised: Upcoming Event | PGP Co 2027 | Pre Placement Talk : Nagarro',receivedDateTime:'2026-10-26T12:00:00Z'}),SENDER,NOW);
  assert.equal(d.sessions[0].date,'2026-10-27');assert.equal(d.outlook.reviews.length,1);
  reviewMessage(d,{id:d.outlook.reviews[0].id,action:'apply',session_id:id},NOW);
  assert.equal(d.sessions[0].date,'2026-10-28');assert.equal(d.sessions[0].id,id);assert.equal(d.requests[0].status,'CANCELLED');
  assert.deepEqual(d.requests[1],{id:'accepted',status:'ACCEPTED',offered_id:id,snapshot:{test:'history'}});assert.equal(d.requests[2].status,'OPEN');
});

test('cancellation, malformed mail and ambiguous times enter private review; cancellation does not delete history',()=>{
  const d=emptyDocument();ingestMessage(d,mail(),SENDER,NOW);const id=d.sessions[0].id;
  ingestMessage(d,mail('cancel','This event is cancelled',{subject:'Cancelled: Upcoming Event | PGP Co 2027 | Pre Placement Talk : Nagarro'}),SENDER,NOW);
  assert.equal(d.sessions[0].active,1);
  reviewMessage(d,{id:d.outlook.reviews[0].id,action:'cancel',session_id:id},NOW);
  assert.equal(d.sessions[0].active,0);assert.equal(d.sessions.length,1);
  ingestMessage(d,mail('bad','Incomplete invite'),SENDER,NOW);assert.equal(d.outlook.reviews.length,1);
  assert.throws(()=>reviewMessage(d,{id:d.outlook.reviews[0].id,action:'apply',confirm_new:true},NOW));
  reviewMessage(d,{id:d.outlook.reviews[0].id,action:'dismiss'},NOW);assert.equal(d.outlook.reviews.length,0);
  assert.equal(ingestMessage(d,mail('bad','Incomplete invite'),SENDER,NOW),'duplicate');
  assert.equal(ingestMessage(d,mail('wrong',BODY,{from:{emailAddress:{address:'other@school.test'}}}),SENDER,NOW),'ignored');
});

test('review can explicitly add a second time slot without silently changing an existing event',()=>{
  const d=emptyDocument();ingestMessage(d,mail(),SENDER,NOW);
  ingestMessage(d,mail('second',BODY.replace('21:30 - 22:30','18:00 - 19:00')),SENDER,NOW);
  assert.equal(d.sessions.length,1);assert.equal(d.outlook.reviews.length,1);
  reviewMessage(d,{id:d.outlook.reviews[0].id,action:'apply',confirm_new:true},NOW);
  assert.equal(d.sessions.length,2);
});

test('Graph pagination is checkpointed with event writes and a cold run resumes after a failed page',async()=>{
  const repository=repo();let phase=1, tokenCalls=0;
  const next='https://graph.microsoft.com/v1.0/users/student%40school.test/mailFolders/inbox/messages?$skip=25';
  const fetcher=async(url,options)=>{
    if(url.includes('login.microsoftonline.com')){tokenCalls++;assert.equal(options.redirect,'error');assert.equal(options.body.get('client_secret'),'PRIVATE-SECRET');return json({access_token:'ACCESS'});}
    assert.equal(options.headers.Authorization,'Bearer ACCESS');
    if(new URL(url).pathname.includes('/messages/'))return json({body:{content:url.includes('/m2?')?BODY.replace('Nagarro','Other Company'):BODY}});
    if(url===next){if(phase===1)return new Response('secret upstream text',{status:503});return json({value:[mail('m2',BODY.replace('Nagarro','Other Company'))]});}
    assert.match(new URL(url).searchParams.get('$filter'),/receivedDateTime ge/);
    return json({value:[mail()], '@odata.nextLink':next});
  };
  await assert.rejects(runOutlookSync(repository,config,{fetch:fetcher,clock:()=>NOW}),/HTTP 503/);
  assert.equal(repository.store.value.sessions.length,1);assert.equal(repository.store.value.outlook.scan.url,next);
  assert.equal(repository.store.value.outlook.lease,undefined);assert.equal(repository.store.value.outlook.checked_through,null);
  phase=2;const result=await runOutlookSync(new Repository(repository.store,emptyDocument),config,{fetch:fetcher,clock:()=>NOW});
  assert.equal(result.pages,1);assert.equal(repository.store.value.sessions.length,2);assert.equal(repository.store.value.outlook.scan,null);
  assert.equal(repository.store.value.outlook.checked_through,new Date(NOW-60000).toISOString());assert.equal(tokenCalls,2);
});

test('leases prevent overlapping syncs, and concurrent student writes are preserved',async()=>{
  const repository=repo();let release;const held=new Promise(r=>release=r);
  let entered;const ready=new Promise(r=>entered=r);
  const fetcher=async url=>{if(url.includes('login.microsoftonline.com'))return json({access_token:'ACCESS'});if(new URL(url).pathname.includes('/messages/'))return json({body:{content:BODY}});entered();await held;return json({value:[mail()]});};
  const first=runOutlookSync(repository,config,{fetch:fetcher,clock:()=>NOW});await ready;
  assert.match((await runOutlookSync(repository,config,{fetch:fetcher,clock:()=>NOW})).skipped,/Another/);
  await repository.mutate(d=>d.students.push({pgid:'00999',name:'Concurrent Student',active:1}));release();await first;
  assert.equal(repository.store.value.sessions.length,1);assert.equal(repository.store.value.students[0].pgid,'00999');
});

test('failed or unsafe Graph pages never advance the checkpoint or disclose credentials',async()=>{
  for (const malicious of ['https://evil.test/steal','https://graph.microsoft.com/v1.0/users/other@school.test/messages']) {
    const repository=repo();let calls=0;
    const fetcher=async url=>{calls++;return url.includes('login.microsoftonline.com')?json({access_token:'PRIVATE-ACCESS'}):json({value:[mail()],'@odata.nextLink':malicious});};
    await assert.rejects(runOutlookSync(repository,config,{fetch:fetcher,clock:()=>NOW}),/unexpected pagination/);
    assert.equal(calls,2);assert.equal(repository.store.value.sessions.length,0);assert.equal(repository.store.value.outlook.checked_through,null);
    assert.equal(JSON.stringify(repository.store.value).includes('PRIVATE-ACCESS'),false);
  }
  const repository=repo();const result=await runOutlookSync(repository,{enabled:false});assert.match(result.skipped,/disabled/);assert.equal(repository.store.value,null);
  await assert.rejects(runOutlookSync(repository,config,{fetch:async()=>new Response('PRIVATE-SECRET',{status:401}),clock:()=>NOW}),/HTTP 401/);
  assert.equal(JSON.stringify(repository.store.value).includes('PRIVATE-SECRET'),false);
});

test('configuration rejects missing credentials and admin APIs require the coordinator token and same origin',async()=>{
  assert.throws(()=>outlookConfiguration({SWAP_OUTLOOK_ENABLED:'1'}),/Missing Netlify/);
  const repository=repo();await repository.mutate(d=>ingestMessage(d,mail('bad','Incomplete'),SENDER,NOW));
  const handler=createHandler(repository,{adminToken:'a'.repeat(40),outlook:{enabled:true,configured:true}});
  const request=async(path,body,auth=true,origin='https://example.test')=>handler(new Request('https://example.test/api/'+path,{
    method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer '+'a'.repeat(40)}:{}),origin,'content-type':'application/json','x-swap-request':'1'},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await request('admin/outlook/status',null,false)).status,403);
  const response=await request('admin/outlook/status');assert.equal(response.status,200);assert.equal((await response.json()).reviews.length,1);
  assert.equal((await request('admin/outlook/reset',{},true,'https://evil.test')).status,403);
  assert.equal((await request('admin/import',{sessions:[]})).status,409);
  assert.equal((await request('admin/outlook/reset',{})).status,200);
  await repository.mutate(d=>outlookState(d).lease={id:'held',expires:Date.now()+60000});
  assert.throws(()=>resetOutlookScan(repository.store.value),/Wait/);
});
