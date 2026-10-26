import test from 'node:test';
import assert from 'node:assert/strict';
import {Repository} from '../../netlify/lib/repository.mjs';
import {emptyDocument} from '../../netlify/lib/model.mjs';
import {createHandler} from '../../netlify/lib/handler.mjs';
import {publicConfiguration} from '../../netlify/lib/outlook-sync.mjs';

class Store {
  value=null;version=0;
  async getWithMetadata(){await new Promise(r=>setImmediate(r));return this.value?{data:structuredClone(this.value),etag:String(this.version)}:null;}
  async setJSON(key,value,o){await new Promise(r=>setImmediate(r));if((o.onlyIfNew&&this.value)||(o.onlyIfMatch&&o.onlyIfMatch!==String(this.version)))return{modified:false};this.value=structuredClone(value);this.version++;return{modified:true};}
}
const TOKEN='flow-secret-123456789012345678901234567890';
const BODY='<p>Company Name : Nagarro</p><p>Event Type : Pre Placement Talk</p><p>Event Date : 27 October, 2026</p><p>Event Time : 21:30 - 22:30</p><p>Venue : LT "3" &amp; Annex</p>';
const payload=(extra={})=>({id:'outlook-id-1',internetMessageId:'<email-1@school.test>',from:'casevents@isb.edu',subject:'Upcoming Event  | PGP Co 2027 | Pre Placement Talk : Session Scheduled',receivedDateTime:'2026-10-26T12:00:00Z',body:BODY,...extra});
function setup(overrides={}){
  const store=new Store(), repository=new Repository(store,emptyDocument);
  const handler=createHandler(repository,{adminToken:'admin-'+TOKEN,outlook:{enabled:true},powerAutomate:{enabled:true,token:TOKEN,production:true,...overrides}});
  return {store,repository,send:async(data,headers={})=>{
    const response=await handler(new Request('https://example.test/api/integrations/outlook',{method:'POST',headers:{'content-type':'application/json','x-swap-request':'1',authorization:'Bearer '+TOKEN,...headers},body:JSON.stringify(data)}));
    return {status:response.status,data:await response.json()};
  }};
}

test('the actual V3 trigger shape imports HTML without losing quotes or copying recipients and attachments',async()=>{
  const {send,store}=setup();
  const r=await send(payload({toRecipients:'PRIVATE-RECIPIENT',attachments:[{contentBytes:'PRIVATE-ATTACHMENT'}]}));
  assert.equal(r.status,200);assert.equal(r.data.updated,1);assert.equal(store.value.sessions[0].room,'LT "3" & Annex');
  assert.equal(store.value.metadata.sync.source,'Outlook via Power Automate');assert.ok(store.value.outlook.last_success);
  assert.equal(JSON.stringify(store.value).includes('PRIVATE-RECIPIENT'),false);assert.equal(JSON.stringify(store.value).includes('PRIVATE-ATTACHMENT'),false);
  assert.equal(JSON.stringify(store.value).includes(BODY),false);
});

test('flow retries and simultaneous deliveries cannot create duplicate sessions or overwrite students',async()=>{
  const {send,store,repository}=setup();
  await repository.mutate(d=>d.students.push({pgid:'00123',name:'Student',active:1}));
  const results=await Promise.all([send(payload()),send(payload())]);
  assert.equal(results.filter(r=>r.data.updated===1).length,1);assert.equal(results.filter(r=>r.data.duplicate===1).length,1);
  assert.equal(store.value.sessions.length,1);assert.equal(store.value.students[0].pgid,'00123');
});

test('the flow token is ingest-only; disabled endpoints, previews, cross-site requests and wrong tokens cannot write',async()=>{
  let s=setup();
  for(const headers of [{authorization:'Bearer wrong'},{authorization:'Bearer admin-'+TOKEN},{origin:'https://other.test'},{'x-swap-request':''}])assert.equal((await s.send(payload(),headers)).status,403);
  assert.equal(s.store.value,null);
  s=setup({enabled:false});assert.equal((await s.send(payload())).status,503);
  s=setup({production:false});assert.equal((await s.send(payload())).status,403);
});

test('exact sender and subject are rechecked on the server, and malformed payloads fail without writes',async()=>{
  const {send,store}=setup();
  assert.equal((await send(payload({from:'other@school.test'}))).data.ignored,1);
  assert.equal((await send(payload({subject:'Upcoming Event | PGP Co 2028 | Pre Placement Talk :'}))).data.ignored,1);
  assert.equal(store.value.sessions.length,0);
  for(const update of [{id:''},{receivedDateTime:'2026-10-26T12:00:00'},{body:''},{from:null}])assert.equal((await send(payload(update))).status,400);
  const original=store.version;
  assert.equal((await send({value:[payload(),payload({id:''})]})).status,400);
  assert.equal(store.version,original);assert.equal(store.value.sessions.length,0);
});

test('unreadable but valid deliveries enter coordinator review, and configuration requires no Microsoft secrets',async()=>{
  const {send,store}=setup();
  assert.equal((await send(payload({body:'Session details unavailable'}))).data.review,1);
  assert.equal(store.value.outlook.reviews.length,1);
  const configured=publicConfiguration({SWAP_POWER_AUTOMATE_ENABLED:'1',SWAP_FLOW_TOKEN:TOKEN});
  assert.equal(configured.configured,true);assert.equal(configured.mode,'power-automate');assert.equal(configured.can_run,false);
  assert.equal(JSON.stringify(configured).includes(TOKEN),false);
});
