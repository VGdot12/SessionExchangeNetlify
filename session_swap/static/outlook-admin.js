let token = '', configured = false;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Date(value).toLocaleString() : 'Not yet';
function message(value) { $('#message').textContent = value; }
async function api(path, body) {
  const response = await fetch('/api/admin/outlook/' + path, { method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : {'Content-Type':'application/json','X-Swap-Request':'1'}) },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The updated Netlify API is not deployed. Check the deploy log.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
async function refresh() {
  const data = await api('status');
  configured = data.configured;
  $('#login').hidden = true; $('#dashboard').hidden = false;
  const rows = [['Connection', data.enabled ? data.configured ? 'Configured' : 'Needs setup' : 'Disabled'],
    ['Mailbox',data.mailbox || 'Not configured'],['Folder',data.folder || 'inbox'],['Sender',data.sender || 'casevents@isb.edu'],['Subject contains',data.subject_rule || 'Upcoming Event | PGP Co 2027 | Pre Placement Talk :'],
    ['Last successful page',date(data.last_success)],['Checked emails through',date(data.checked_through)],
    ['Scan',data.catching_up ? 'Catching up; next run resumes automatically' : 'No unfinished scan'],
    ['Last page results',data.last_counts ? Object.entries(data.last_counts).map(([k,v])=>`${k}: ${v}`).join(' · ') : 'None yet'],
    ['Attention',data.configuration_error || data.last_error || 'No connection errors recorded']];
  $('#summary').innerHTML = '<dl>'+rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')+'</dl>';
  $('#run').disabled = !data.configured;
  const sessions = data.sessions.slice().sort((a,b)=>(a.date+a.start_time).localeCompare(b.date+b.start_time));
  $('#catalogue-session').innerHTML = '<option value="">Choose an active session…</option>'+sessions.filter(s=>s.active).map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · ${esc(s.date)} ${esc(s.start_time)}</option>`).join('');
  $('#reviews').innerHTML = data.reviews.length ? data.reviews.map(item => {
    const s = item.candidate;
    return `<form class="review" data-id="${esc(item.id)}"><h3>${esc(item.subject)}</h3><small>Received ${esc(date(item.received_at))}</small><p>${esc(item.reason)}</p>${s ? `<p class="candidate"><strong>${esc(s.title)}</strong><br>${esc(s.date)} · ${esc(s.start_time)}–${esc(s.end_time)} · ${esc(s.room)}</p>` : '<p>The session details could not be read. Ask for a corrected invite, or select an existing session to cancel.</p>'}<label for="target-${esc(item.id)}">Affected session</label><select name="session_id" id="target-${esc(item.id)}"><option value="">Choose a session…</option>${s?'<option value="__new__">Add as a new event</option>':''}${sessions.map(event=>`<option value="${esc(event.id)}">${esc(event.title)} · ${esc(event.date)} ${esc(event.start_time)}${event.active?'':' · inactive'}</option>`).join('')}</select><div class="actions">${s?'<button value="apply">Apply session details</button>':''}<button value="cancel" class="secondary">Cancel selected session</button><button value="dismiss" class="secondary">Dismiss email</button></div></form>`;
  }).join('') : '<p>No emails need review.</p>';
}
async function perform(operation) {
  message('Working…');
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true);
  try { await operation(); message('Done.'); }
  catch(error) { message(error.message); }
  finally { buttons.filter(b=>b.isConnected).forEach(b=>b.disabled=false); $('#run').disabled=!configured; }
}
$('#login').addEventListener('submit',event=>{
  event.preventDefault(); token=$('#token').value.trim(); $('#token').value='';
  perform(refresh);
});
$('#refresh').addEventListener('click',()=>perform(refresh));
$('#run').addEventListener('click',()=>perform(async()=>{await api('run',{});await refresh();}));
$('#reset').addEventListener('click',()=>{
  if (confirm('Rescan the configured recent-email window? Duplicate emails stay ignored. This does not delete sessions or swap records.')) perform(async()=>{await api('reset',{});await refresh();});
});
$('#logout').addEventListener('click',()=>{
  token='';$('#login').hidden=false;$('#dashboard').hidden=true;$('#reviews').replaceChildren();$('#summary').replaceChildren();message('Dashboard locked.');
});
$('#reviews').addEventListener('submit',event=>{
  event.preventDefault(); const form=event.target, action=event.submitter?.value;
  const selected=new FormData(form).get('session_id');
  if (action!=='dismiss' && !selected) return message('Choose the affected session first.');
  if (action==='cancel' && selected==='__new__') return message('Choose an existing session to cancel.');
  const text=action==='cancel'?'Cancel this session and close its open swap requests? Accepted history will remain.':action==='apply'?'Apply these details? A date or time change closes affected open requests.':'Dismiss this email without changing sessions?';
  if (confirm(text)) perform(async()=>{await api('review',{id:form.dataset.id,action,session_id:selected==='__new__'?null:selected,confirm_new:selected==='__new__'});await refresh();});
});
$('#deactivate').addEventListener('submit',event=>{
  event.preventDefault();const id=$('#catalogue-session').value;
  if (id && confirm('Deactivate this session and close its open swap requests? Accepted history will remain.')) perform(async()=>{await api('session',{session_id:id});await refresh();});
});
