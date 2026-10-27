import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizePowerAutomateMessage } from '../netlify/lib/power-automate.mjs';
import { matchesSubject } from '../netlify/lib/outlook.mjs';

// The event cannot choose a destination or send the delivery secret to another host.
export const ENDPOINT = 'https://sessionexchange.netlify.app/api/integrations/outlook';
const COUNTERS = ['updated','review','duplicate','older','ignored'];
export class RelayError extends Error {}

export function prepareMessage(event) {
  if (!event || event.action !== 'session-invite') throw new RelayError('Expected a session-invite repository dispatch event.');
  const candidate = event.client_payload?.message;
  try { return normalizePowerAutomateMessage(candidate); }
  catch { throw new RelayError('Invalid Event Payload. Use setProperty(json(\'{}\'), \'message\', triggerBody()) in the GitHub action.'); }
}

async function smallJSON(response) {
  const reader=response.body?.getReader();
  if (!reader) throw new RelayError('Netlify returned an empty response. Check its deployment.');
  const chunks=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
    if(length>100000){await reader.cancel();throw new RelayError('Netlify returned an unexpected response. Check its deployment.');}chunks.push(Buffer.from(value));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new RelayError('Netlify did not return JSON. Confirm that the latest API is deployed.');}
}

export async function relayEvent({ mode, event, token, fetcher=fetch, pause=ms=>new Promise(r=>setTimeout(r,ms)) }) {
  if (typeof token !== 'string' || token.length<32 || /[\r\n]/.test(token)) throw new RelayError('Add a GitHub Actions repository secret named SWAP_FLOW_TOKEN, matching the Netlify value exactly.');
  if (!['repository_dispatch','workflow_dispatch'].includes(mode)) throw new RelayError('This workflow accepts repository dispatch events or manual connection checks only.');
  const check=mode==='workflow_dispatch';
  const message=check?null:prepareMessage(event);
  if (message && (message.from.emailAddress.address.toLowerCase()!=='casevents@isb.edu' || !matchesSubject(message.subject))) {
    return {ok:true,updated:0,review:0,duplicate:0,older:0,ignored:1};
  }
  for(let attempt=0;attempt<3;attempt++) {
    let response;
    try{
      response=await fetcher(ENDPOINT,{method:check?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Swap-Request':'1'},
        ...(check?{}:{body:JSON.stringify(message)})});
    }catch{
      if(attempt<2){await pause(1000*(attempt+1));continue;}
      throw new RelayError('Netlify could not be reached after three attempts. Check the site and re-run this GitHub job.');
    }
    if(!response.ok){
      await response.body?.cancel();
      if([429,500,502,503,504].includes(response.status)&&attempt<2){await pause(1000*(attempt+1));continue;}
      const help=response.status===403?'Check that the GitHub and Netlify SWAP_FLOW_TOKEN values match.':
        response.status===404?'Upload and deploy the latest Netlify code.':
        response.status===503?'Check SWAP_POWER_AUTOMATE_ENABLED=1 and the Netlify API logs.':
        response.status===400?'Check the Event Payload expression and Outlook message fields.':'Check the Netlify deployment and API logs.';
      // Do not print upstream error bodies, email contents, or tokens in public Action logs.
      throw new RelayError(`Netlify returned HTTP ${response.status}. ${help}`);
    }
    const result=await smallJSON(response);
    if(result?.ok!==true)throw new RelayError('Unexpected Netlify response. Check that the latest receiving endpoint is deployed.');
    if(check){if(result.ready!==true)throw new RelayError('Netlify did not confirm that the integration is ready.');return {ok:true,ready:true};}
    const safe={ok:true};
    for(const key of COUNTERS){if(!Number.isInteger(result[key])||result[key]<0||result[key]>25)throw new RelayError('Netlify returned unexpected delivery counters.');safe[key]=result[key];}
    return safe;
  }
}

async function main() {
  try{
    const mode=process.env.GITHUB_EVENT_NAME;
    let event;
    if(mode==='repository_dispatch'){
      const file=process.env.GITHUB_EVENT_PATH;
      if(!file || (await stat(file)).size>400000)throw new RelayError('The dispatch payload is missing or too large. Send one invite per event, below GitHub\'s 65,535-character payload limit.');
      try{event=JSON.parse(await readFile(file,'utf8'));}catch{throw new RelayError('GitHub event payload is not valid JSON.');}
    }
    const result=await relayEvent({mode,event,token:process.env.SWAP_FLOW_TOKEN});
    console.log(mode==='workflow_dispatch'?'Connection check passed. No session or swap was changed.':'Invite delivery complete.');
    console.log(JSON.stringify(result));
  }catch(error){console.error(error instanceof RelayError?error.message:'The relay failed. Check the workflow files, event format and repository secret.');process.exitCode=1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
