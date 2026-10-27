import test from 'node:test';
import assert from 'node:assert/strict';
import { relayEvent, prepareMessage, ENDPOINT } from '../../scripts/relay-outlook-event.mjs';
import { Repository } from '../../netlify/lib/repository.mjs';
import { emptyDocument } from '../../netlify/lib/model.mjs';
import { createHandler } from '../../netlify/lib/handler.mjs';

const TOKEN='private-relay-token-123456789012345678901234567890';
const BODY='Company Name : Nagarro\nEvent Type : Pre Placement Talk\nEvent Date : 27 October, 2026\nEvent Time : 21:30 - 22:30\nVenue : LT 3';
const event=(extra={})=>({action:'session-invite',client_payload:{message:{id:'real-message-1',internetMessageId:'<id1@example.test>',
  subject:'Upcoming Event  | PGP Co 2027 | Pre Placement Talk : Session Scheduled',from:'casevents@isb.edu',
  receivedDateTime:'2026-10-26T10:00:00Z',body:BODY,...extra}}});
const counts={ok:true,updated:1,review:0,duplicate:0,older:0,ignored:0};
const send=options=>relayEvent({mode:'repository_dispatch',event:event(),token:TOKEN,pause:async()=>{},...options});

test('dispatch normalization removes recipients and attachments and preserves literal email text',async()=>{
  const malicious='PRIVATE MAIL `touch /tmp/x` $(echo x) "quoted"\n${{ secrets.OTHER_TOKEN }}';
  let calls=0;
  const result=await send({event:event({body:malicious,toRecipients:'PRIVATE ADDRESS',attachments:[{contentBytes:'PRIVATE FILE'}]}),fetcher:async(url,options)=>{
    calls++;assert.equal(url,ENDPOINT);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+TOKEN);assert.equal(options.headers['X-Swap-Request'],'1');
    const data=JSON.parse(options.body);assert.equal(data.body.content,malicious);assert.equal(Object.hasOwn(data,'toRecipients'),false);assert.equal(Object.hasOwn(data,'attachments'),false);
    return Response.json({...counts,private:'DO NOT LOG'});
  }});
  assert.equal(calls,1);assert.deepEqual(result,counts);assert.equal(JSON.stringify(result).includes('DO NOT LOG'),false);
});

test('wrong sender and subjects are rejected before any outgoing request',async()=>{
  for(const extra of [{from:'other@school.test'},{subject:'Upcoming Event | PGP Co 2028 | Pre Placement Talk :'}]){
    const result=await send({event:event(extra),fetcher:async()=>{throw new Error('Must not fetch');}});
    assert.equal(result.ignored,1);
  }
  assert.throws(()=>prepareMessage({action:'wrong',client_payload:{message:event().client_payload.message}}));
  assert.throws(()=>prepareMessage({action:'session-invite',client_payload:event().client_payload.message}));
});

test('missing or unsafe secrets and unsupported event types fail before contacting Netlify',async()=>{
  const fetcher=async()=>{throw new Error('Must not fetch');};
  for(const token of ['', 'short', TOKEN+'\n'])await assert.rejects(send({token,fetcher}),/repository secret/);
  await assert.rejects(send({mode:'pull_request',fetcher}),/repository dispatch/);
});

test('temporary network or server failures retry, while authentication failures do not expose response bodies',async()=>{
  let calls=0;
  await send({fetcher:async()=>{calls++;if(calls===1)throw new Error('PRIVATE ERROR');if(calls===2)return new Response('PRIVATE ERROR',{status:503});return Response.json(counts);}});
  assert.equal(calls,3);calls=0;
  await assert.rejects(send({fetcher:async()=>{calls++;return new Response(TOKEN+' PRIVATE EMAIL',{status:403});}}),error=>/HTTP 403/.test(error.message)&&!error.message.includes(TOKEN)&&!error.message.includes('PRIVATE EMAIL'));
  assert.equal(calls,1);
});

test('invalid success responses cannot leak raw data in logs or claim successful delivery',async()=>{
  await assert.rejects(send({fetcher:async()=>new Response('<html>PRIVATE EMAIL</html>')}),/did not return JSON/);
  await assert.rejects(send({fetcher:async()=>Response.json({ok:true,updated:'PRIVATE EMAIL'})}),/unexpected delivery counters/);
});

class Store{
  value=null;version=0;
  async getWithMetadata(){return this.value?{data:structuredClone(this.value),etag:String(this.version)}:null;}
  async setJSON(key,value,o){if((o.onlyIfNew&&this.value)||(o.onlyIfMatch&&o.onlyIfMatch!==String(this.version)))return{modified:false};this.value=structuredClone(value);this.version++;return{modified:true};}
}
function integration(){
  const store=new Store(),repository=new Repository(store,emptyDocument);
  const handler=createHandler(repository,{powerAutomate:{enabled:true,token:TOKEN,production:true}});
  return{store,fetcher:(url,options)=>handler(new Request(url,options))};
}

test('manual GitHub connection check authenticates without creating sessions or delivery history',async()=>{
  const {store,fetcher}=integration();
  const result=await relayEvent({mode:'workflow_dispatch',token:TOKEN,fetcher});
  assert.deepEqual(result,{ok:true,ready:true});assert.equal(store.value.sessions.length,0);assert.equal(store.value.outlook,undefined);
  await assert.rejects(relayEvent({mode:'workflow_dispatch',token:'different-token-123456789012345678901234567890',fetcher}),/HTTP 403/);
});

test('a lost acknowledgment is safely retried against the actual receiver without duplicate sessions',async()=>{
  const {store,fetcher}=integration();let first=true;
  const result=await send({fetcher:async(url,options)=>{const response=await fetcher(url,options);if(first){first=false;throw new Error('Connection dropped after save');}return response;}});
  assert.equal(result.duplicate,1);assert.equal(store.value.sessions.length,1);assert.equal(store.value.sessions[0].title,'Nagarro · Pre Placement Talk');
});
