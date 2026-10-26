'use strict';
const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
const state = { data: null, config: {}, page: 'dashboard', match: false, search: '', course: '', date: '', personal: 'all', status: 'all', preference: 'specific' };
const paths = {
  swap: '<path d="M4 8h16l-4-4M20 16H4l4 4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M8 12h8m-8 4h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  logout: '<path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>', leaf: '<path d="M19 3C9 2 2 9 7 15c6 5 13-1 12-12ZM5 20 15 9"/>',
  location: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  book: '<path d="M3 5c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2zM12 7v14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.swap}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = name => name.split(' ').slice(0,2).map(n => n[0]).join('');
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {day:'numeric',month:'short'});
const fullDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {weekday:'short',day:'numeric',month:'long',year:'numeric'});
const timeLabel = value => { const [h,m] = value.split(':'); return `${Number(h)%12 || 12}:${m} ${Number(h)<12?'AM':'PM'}`; };
const relative = value => { const mins = Math.max(0,Math.floor((Date.now()-new Date(value))/60000)); return mins<1?'Just now':mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:`${Math.floor(mins/1440)}d ago`; };
const brand = () => `<div class="brand"><div class="brand-icon">${icon('swap')}</div><span>session<span>swap</span></span></div>`;
const art = () => `<div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="mini-ticket"><div class="tag">YOUR SESSION</div><strong>Section A</strong><small>09:00 AM — 10:30 AM</small></div><div class="art-swap">${icon('swap')}</div><div class="mini-ticket second"><div class="tag">YOUR NEXT SESSION</div><strong>Section B</strong><small>11:00 AM — 12:30 PM</small></div><span class="spark">✳</span></div>`;

async function api(path, data) {
  const response = await fetch('/api/' + path, {method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json','X-Swap-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  let result;
  try { result = await response.json(); }
  catch { throw new Error('The swap API is unavailable. Deploy the Netlify function together with the page; check the repository base directory and build settings.'); }
  if (!response.ok) { const error = new Error(result.error || 'Unable to complete this request.'); error.status=response.status; throw error; }
  return result;
}
let toastTimer;
function toast(message) { const el=document.querySelector('#toast'); el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500); }
function showError(error, selector='#form-error') { const target=document.querySelector(selector); if(target) target.textContent=error.message;else toast(error.message); }
function closeModal() { modal.close(); modal.innerHTML=''; }
function openModal(html) { modal.innerHTML=html; if(!modal.open) modal.showModal(); }
function dialogHead(title, subtitle='SESSION SWAP') { return `<div class="dialog-head"><div><div class="eyebrow">${subtitle}</div><h2 id="dialog-title">${esc(title)}</h2></div><button class="dialog-close" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>`; }

function renderLogin() {
  root.innerHTML=`<main class="login-page"><section class="login-story">${brand()}<div><div class="hero-art-wrap">${art()}</div><h1>Your schedule,<br>a little more flexible.</h1><p>Find a section that fits. Connect with a classmate and make the swap work for both of you.</p></div><footer>THE STUDENT SESSION EXCHANGE</footer></section><section class="login-content"><form class="login-form" id="login-form"><div class="eyebrow">A BETTER FIT FOR YOUR DAY</div><h2>Welcome to Session Swap</h2><p>Your assigned session is just the starting point.<br>Enter your PGID to find your next swap.</p>${state.config.demo?'<div class="notice"><strong>Prototype · sample data</strong><br>Try PGID <strong>26001</strong>. You can also use 26002–26006 to explore another student’s view.</div>':''}${state.config.pgid_only?'<div class="field"><label for="student-name">Your name</label><input id="student-name" name="name" autocomplete="name" placeholder="Your full name" maxlength="100" minlength="2" required></div>':''}<div class="error" id="form-error" role="alert"></div><div class="field"><label for="pgid">Your PGID</label><input id="pgid" name="pgid" placeholder="e.g. 26001" autocomplete="username" pattern="[A-Za-z0-9_-]{1,40}" maxlength="40" required><div class="help">Use your student PGID. New PGIDs are registered with the name you enter.</div></div>${state.config.pgid_only?'':'<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>'}<button type="submit" name="intent" value="post" class="btn">${icon('plus')} Post a swap request</button><button type="submit" name="intent" value="browse" class="btn secondary">Browse available swaps ${icon('arrow')}</button><div class="login-note">${state.config.pgid_only?'PGID-only entry is enabled for this prototype.':'Need access? Ask your session coordinator.'}<br>Swap between company events or sections.</div></form></section></main>`;
}

function shell() {
  const d=state.data, u=d.user;
  const open=d.personal.filter(r=>r.poster_pgid===u.pgid&&r.status==='OPEN').length;
  const labels={dashboard:'Swap dashboard',requests:'My requests',sessions:'My sessions',help:'How it works'};
  root.innerHTML=`<div class="shell"><aside class="sidebar">${brand()}<div class="nav-label">YOUR WORKSPACE</div><nav class="nav" aria-label="Main navigation">${[['dashboard','grid','Swap dashboard'],['requests','folder','My requests'],['sessions','calendar','My sessions'],['help','info','How it works']].map(([key,ic,label])=>`<button data-page="${key}" class="${state.page===key?'active':''}" ${state.page===key?'aria-current="page"':''}>${icon(ic)}${label}${key==='requests'&&open?`<span class="count">${open}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="tip">${icon('leaf')}<div><strong>A little flexibility goes a long way.</strong><p>Open requests give you more chances to find a section that works.</p></div></div><div class="profile"><span class="avatar">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong><small>PGID ${esc(u.pgid)}</small></div><button class="signout" data-action="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div></div></aside><main class="main"><header class="topbar"><div class="crumb">Workspace <span>/</span><strong>${labels[state.page]}</strong></div><div class="right">${state.config.demo?'<span class="demo-tag">Prototype · sample data</span>':''}<span>${esc(u.name.split(' ')[0])} · ${esc(u.pgid)}</span><span class="avatar">${esc(initials(u.name))}</span><button class="signout mobile-signout" data-action="logout" aria-label="Sign out">${icon('logout')}</button></div></header><div id="page-content"></div><footer class="footer"><span>${icon('swap')} A better schedule starts with a simple swap.</span><span>Times shown in ${esc(state.config.timezone)} · Student session exchange</span></footer></main></div>`;
  renderPage();
}
function empty(title, message, action=false) { return `<div class="empty">${icon('swap')}<h3>${esc(title)}</h3><p>${esc(message)}</p>${action?`<button class="btn small" data-action="post">${icon('plus')} Post a swap request</button>`:''}</div>`; }
function sessionBox(s, label, want=false) {
  if(!s) return `<div class="session-box want"><div class="eyebrow">${label}</div><strong>Any other event</strong><div class="session-line">${icon('swap')} Open to alternatives</div><div class="session-line">Choose an assigned event</div></div>`;
  return `<div class="session-box ${want?'want':''}"><div class="eyebrow">${label}</div><strong>${esc(s.title)}</strong><div class="session-line">${esc(s.section)} · ${icon('calendar')}${esc(dateLabel(s.date))}</div><div class="session-line">${icon('clock')}${timeLabel(s.start_time)} – ${timeLabel(s.end_time)}</div><div class="session-line">${icon('location')}${esc(s.room||'Venue TBD')}</div></div>`;
}
function card(r, personal=false) {
  const accepted=r.status==='ACCEPTED';
  const isOwner=r.poster_pgid===state.data.user.pgid;
  const status=personal?`<span class="pill ${accepted?'green':r.status==='OPEN'?'':'gray'}"><span class="dot"></span>${r.status[0]+r.status.slice(1).toLowerCase()}</span>`:`<span class="pill ${r.desired?'':'orange'}">${r.desired?'Specific event':'Open to any event'}</span>`;
  const target=accepted?r.accepted_session:r.desired;
  const partner=accepted?(isOwner?r.partner:r.poster):null;
  return `<button class="swap-card" data-request="${r.id}" aria-label="View ${esc(r.offered.title)} swap, section ${esc(r.offered.section)}"><div class="card-top"><span class="course-mark">${esc(r.course_id)} ${personal?`· ${isOwner?'YOU POSTED':'YOU ACCEPTED'}`:''}</span>${status}</div><h3>${esc(r.offered.title)}</h3><div class="exchange">${sessionBox(r.offered,accepted?'ORIGINALLY OFFERED':'OFFERING')}<span class="exchange-arrow">${icon('swap')}</span>${sessionBox(target,accepted?'EXCHANGED WITH':'LOOKING FOR',true)}</div>${partner?`<div class="partner-line">Swapped with <strong>${esc(partner.name)}</strong> · PGID ${esc(partner.pgid)}</div>`:''}${personal&&r.close_reason?`<div class="partner-line">${esc(r.close_reason)}</div>`:''}<div class="card-footer"><span class="avatar">${esc(initials(r.poster.name))}</span><span class="name">${esc(r.poster.name)}${isOwner?' (you)':''}</span><span class="time-ago">${relative(r.created_at)}</span>${icon('chevron')}</div></button>`;
}
function renderPage() {
  const container=document.querySelector('#page-content');
  if(!container)return;
  if(state.page==='dashboard')renderDashboard(container);
  if(state.page==='requests')renderPersonal(container);
  if(state.page==='sessions')renderSessions(container);
  if(state.page==='help')renderHelp(container);
}
function heading(title, subtitle, button=true) { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${button?`<button class="btn" data-action="post">${icon('plus')} Post a swap</button>`:''}</div>`; }
function renderDashboard(container) {
  const d=state.data, matches=d.requests.filter(r=>r.can_accept).length;
  const personal=d.personal.filter(r=>r.status==='ACCEPTED').length;
  const courses=[...new Map(d.sessions.map(s=>[s.course_id,s.title])).entries()];
  const sync=d.metadata.sync;
  container.innerHTML=`${heading('Find your next swap.', 'A different event. A better fit for your day.')}<section class="hero"><div class="hero-copy"><div class="eyebrow">A LITTLE GIVE. A LITTLE TAKE.</div><h2>Your next event.<br>A schedule that works for you.</h2><p>Offer your assigned event, find a classmate’s request,<br>and make room for what matters.</p></div>${art()}</section><section class="stats" aria-label="Swap statistics"><div class="stat"><div class="stat-icon">${icon('swap')}</div><div><strong>${d.requests.length}</strong><small>Open swap requests</small></div></div><div class="divider"></div><div class="stat"><div class="stat-icon orange">${icon('check')}</div><div><strong>${matches}</strong><small>Swaps you can explore</small></div></div><div class="divider"></div><div class="stat"><div class="stat-icon">${icon('folder')}</div><div><strong>${personal}</strong><small>Your accepted swaps</small></div></div></section><section aria-labelledby="board-title"><div class="board-header"><h2 id="board-title">The swap board</h2><small><span class="dot"></span>${sync?`Schedule synced ${esc(relative(sync.synced_at))}`:'Awaiting first Excel sync'}</small></div><div class="filters"><label class="search">${icon('search')}<input type="search" id="search" placeholder="Search sessions, sections, or students…" aria-label="Search swaps" value="${esc(state.search)}"></label><select id="course-filter" aria-label="Filter by session topic"><option value="">All sessions</option>${courses.map(([id,title])=>`<option value="${esc(id)}" ${state.course===id?'selected':''}>${esc(title)}</option>`).join('')}</select><input type="date" id="date-filter" aria-label="Filter by offered session date" value="${esc(state.date)}"><div class="tabs" aria-label="Swap matching filter"><button data-match="all" class="${!state.match?'active':''}" aria-pressed="${!state.match}">All swaps</button><button data-match="mine" class="${state.match?'active':''}" aria-pressed="${state.match}">Open to any</button></div></div><div id="board-results"></div></section>`;
  renderBoardResults();
}
function filteredRequests() {
  const query=state.search.trim().toLowerCase();
  return state.data.requests.filter(r=>(!state.match||!r.desired)&&(!state.course||r.course_id===state.course)&&(!state.date||r.offered.date===state.date)&&(!query||[r.offered.title,r.course_id,r.offered.section,r.desired?.section,r.desired?.title,r.poster.name,r.poster.pgid].filter(Boolean).join(' ').toLowerCase().includes(query)));
}
function renderBoardResults() {
  const rows=filteredRequests();
  const target=document.querySelector('#board-results');if(!target)return;
  target.innerHTML=`<div class="results-label"><span>${rows.length} ${rows.length===1?'request':'requests'} available${state.match?' open to any event':''}</span>${state.search||state.course||state.date||state.match?'<button class="clear" data-action="clear">Clear filters</button>':'<span>Newest first</span>'}</div><div class="grid">${rows.length?rows.map(r=>card(r)).join(''):empty('No swaps here just yet.',state.match?'No flexible requests are open right now. You can post a request of your own.':'Try another filter or be the first to post a swap.',true)}</div>`;
}
function renderPersonal(container) {
  const pgid=state.data.user.pgid;
  const rows=state.data.personal.filter(r=>(state.personal==='all'||(state.personal==='posted'?r.poster_pgid===pgid:r.accepted_by===pgid))&&(state.status==='all'||r.status===state.status));
  container.innerHTML=`${heading('Your swaps, in one place.', 'Keep track of the requests you posted and the swaps you accepted.')}<div class="personal-controls"><div class="tabs" aria-label="Request role filter">${[['all','All requests'],['posted','I posted'],['accepted','I accepted']].map(([v,l])=>`<button data-personal="${v}" class="${state.personal===v?'active':''}">${l}</button>`).join('')}</div><label class="filters"><select id="status-filter" aria-label="Filter request status">${[['all','All statuses'],['OPEN','Open'],['ACCEPTED','Accepted'],['CANCELLED','Cancelled'],['EXPIRED','Expired']].map(([v,l])=>`<option value="${v}" ${state.status===v?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="grid">${rows.length?rows.map(r=>card(r,true)).join(''):empty('Your next swap starts here.', 'Post a request or accept a matching request from the swap board. Both will appear here.',true)}</div>`;
}
function renderSessions(container) {
  const sessions=state.data.assignments;
  
  const futureIds=new Set(state.data.sessions.map(s=>s.id));
  container.innerHTML=`${heading('Your declared sessions.', 'Sessions you selected when posting or accepting a swap. Assignments are self-reported in this prototype.')}<div class="session-list">${sessions.length?sessions.map(s=>`<article class="assigned"><div><span class="course-mark">${esc(s.course_id)} · SECTION ${esc(s.section)}</span><h3>${esc(s.title)}</h3><p>${esc(fullDate(s.date))} · ${timeLabel(s.start_time)}–${timeLabel(s.end_time)}<br>${esc(s.room)}${s.instructor?' · '+esc(s.instructor):''}</p></div><button class="btn secondary small" data-offer="${esc(s.id)}" ${futureIds.has(s.id)?'':'disabled'}>${icon('swap')} ${futureIds.has(s.id)?'Swap session':'Session started'}</button></article>`).join(''):empty('No assigned sessions yet.', 'Select an assigned event when you post or accept a swap. It will appear here.')}</div>`;
}
function renderHelp(container) {
  container.innerHTML=`${heading('Make a little room.', 'A simple exchange between classmates.',false)}<div class="steps">${[['01','Start with your assigned session','Enter your name and PGID, then select the event you have been assigned. The prototype records your declaration without verifying it against an institution roster.'],['02','Choose a specific section, or stay flexible','Request another section of the same session topic, or select “Any other event” to let classmates offer their assigned sections. Post the request and it appears on the swap board.'],['03','Find your match','Filter the swap board by event, date or flexible requests. Open a card to see both event dates and times, the poster’s name and PGID, and any notes.'],['04','Accept and keep the details','Confirm the exchange to accept it immediately. The request leaves the public board and appears in My requests for both students, with each other’s name and PGID. Your current sections update in My sessions.']].map(([n,t,p])=>`<article class="step"><span class="number">${n}</span><div><h3>${t}</h3><p>${p}</p></div></article>`).join('')}</div><div class="notice spaced">This prototype records an agreement between students. It does not update your institution’s official registration system. Follow your coordinator’s approval process where required.</div>`;
}

function postModal(offeredId) {
  state.preference='specific';
  const upcoming=new Set(state.data.sessions.map(s=>s.id));
  const assigned=state.data.sessions;
  if(!assigned.length) {toast('There are no upcoming events in the catalogue. Import your Excel schedule first.');return;}
  openModal(`${dialogHead('Post a swap request')}<p class="dialog-subtitle">Select the event you are assigned to and tell classmates what works for you. This is a self-reported assignment.</p><form id="post-form"><div class="error" id="form-error" role="alert"></div><div class="field"><label for="offered">Your assigned session</label><select id="offered" name="offered_id">${assigned.map(s=>`<option value="${esc(s.id)}" ${s.id===offeredId?'selected':''}>${esc(s.title)} · Section ${esc(s.section)} · ${esc(dateLabel(s.date))} ${timeLabel(s.start_time)}</option>`).join('')}</select></div><div id="offer-summary"></div><div class="field"><label>What would you like instead?</label><div class="choice"><button type="button" data-preference="specific" class="active" aria-pressed="true">A specific event</button><button type="button" data-preference="any" aria-pressed="false">Any other event</button></div><div id="desired-field"></div></div><div class="field"><label for="notes">A note for your classmate <span class="muted">(optional)</span></label><textarea name="notes" id="notes" maxlength="300" rows="3" placeholder="e.g. An earlier section works better for me."></textarea><p class="help">Up to 300 characters. Your name and PGID are shown with your request.</p></div><div class="modal-actions"><button type="button" class="btn secondary" data-action="close">Cancel</button><button type="submit" class="btn">Post request ${icon('arrow')}</button></div></form>`);
  renderDesired();
}
function renderDesired() {
  const offer=state.data.sessions.find(s=>s.id===document.querySelector('#offered')?.value);
  if(!offer)return;
  const alternatives=state.data.sessions.filter(s=>s.id!==offer.id);
  const summary=document.querySelector('#offer-summary');
  summary.innerHTML=`<p class="help offer-summary">${esc(fullDate(offer.date))} · ${timeLabel(offer.start_time)}–${timeLabel(offer.end_time)} · ${esc(offer.room)}</p>`;
  document.querySelector('#desired-field').innerHTML=state.preference==='any'?`<div class="success-box">You’re open to any other event or section. The student accepting will select the event they are assigned to give you.</div>`:`<label for="desired" class="help">Preferred event or section</label><select name="desired_id" id="desired" required ${alternatives.length?'':'disabled'}>${alternatives.length?alternatives.map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · ${esc(s.section)} · ${esc(dateLabel(s.date))} · ${timeLabel(s.start_time)}–${timeLabel(s.end_time)}</option>`).join(''):'<option>No other upcoming events</option>'}</select>`;
  document.querySelector('#post-form button[type=submit]').disabled=!alternatives.length;
}
function details(rid, confirm=false) {
  const r=[...state.data.requests,...state.data.personal].find(r=>r.id===rid);
  if(!r){toast('This request is no longer available.');return;}
  const owner=r.poster_pgid===state.data.user.pgid;
  const accepted=r.status==='ACCEPTED';
  const selected=state.data.sessions.find(s=>s.id===state.acceptSession);
  const target=accepted?r.accepted_session:confirm?(r.desired||selected):r.desired;
  const partner=accepted?(owner?r.partner:r.poster):r.poster;
  const extra=s=>s?`<p class="help">Section ${esc(s.section)} · ${esc(fullDate(s.date))}<br>${esc(s.room)}${s.instructor?' · '+esc(s.instructor):''}</p>`:'';
  openModal(`${dialogHead(confirm?'Confirm your swap':accepted?'Swap accepted':'Swap details',esc(r.course_id)+' · '+r.status)}<div class="error" id="form-error" role="alert"></div><div class="detail-exchange"><h3>${esc(r.offered.title)}</h3><div class="exchange">${sessionBox(r.offered,confirm?'YOU WILL RECEIVE':accepted?'ORIGINALLY OFFERED':'OFFERING')}<span class="exchange-arrow">${icon('swap')}</span>${sessionBox(target,confirm?'YOU WILL GIVE':accepted?'EXCHANGED WITH':'LOOKING FOR',true)}</div>${extra(r.offered)}${extra(target)}</div><div class="detail-person"><span class="avatar">${esc(initials(partner.name))}</span><div><strong>${accepted?'Your swap partner':'Posted by'} ${esc(partner.name)}${partner.pgid===state.data.user.pgid?' (you)':''}</strong><p>PGID ${esc(partner.pgid)} · ${accepted?'Accepted '+new Date(r.closed_at).toLocaleDateString('en-GB'):'Posted '+relative(r.created_at)}</p></div></div>${r.notes?`<div class="detail-notes">${esc(r.notes)}</div>`:''}${r.status==='OPEN'&&!owner&&!confirm&&!r.desired?`<div class="field spaced"><label for="accept-offer">The assigned event you will give in exchange</label><select id="accept-offer">${state.data.sessions.filter(s=>s.id!==r.offered_id).map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · ${esc(s.section)} · ${esc(dateLabel(s.date))} · ${timeLabel(s.start_time)}</option>`).join('')}</select><p class="help">Choose the event you are assigned to. This is a self-reported assignment.</p></div>`:''}${confirm?'<div class="notice spaced">By confirming, you declare that you are assigned to the event shown under “You will give”. This records the exchange in this app and closes the request for everyone else.</div>':''}${accepted?'<div class="success-box spaced">This swap is saved in My requests for both students. You can find your current section in My sessions.</div>':''}${r.close_reason?`<p class="help">${esc(r.close_reason)}</p>`:''}${r.status==='OPEN'&&!owner&&!r.can_accept?`<p class="help">${esc(r.accept_reason)}</p>`:''}<div class="modal-actions">${owner&&r.status==='OPEN'?`<button class="btn secondary" data-cancel="${r.id}">Cancel request</button>`:''}<button class="btn secondary" data-action="close">${confirm?'Go back':'Close'}</button>${r.status==='OPEN'&&!owner&&r.can_accept?`<button class="btn" ${confirm?'data-accept':'data-confirm'}="${r.id}">${icon('swap')}${confirm?'Confirm swap':'Accept this swap'}</button>`:''}</div>`);
}
async function refresh(render=true) {
  try {state.data=await api('state');if(render)shell();}
  catch(error){if(error.status===401){state.data=null;closeModal();renderLogin();}else throw error;}
}
async function runMutation(button, task) {if(button.disabled)return;button.disabled=true;try{await task();}catch(error){showError(error);button.disabled=false;}}

document.addEventListener('click', async event=>{
  const el=event.target.closest('button');if(!el)return;
  if(el.dataset.page){state.page=el.dataset.page;shell();return;}
  if(el.dataset.request){details(el.dataset.request);return;}
  if(el.dataset.offer){postModal(el.dataset.offer);return;}
  if(el.dataset.match){state.match=el.dataset.match==='mine';renderDashboard(document.querySelector('#page-content'));return;}
  if(el.dataset.personal){state.personal=el.dataset.personal;renderPersonal(document.querySelector('#page-content'));return;}
  if(el.dataset.preference){state.preference=el.dataset.preference;modal.querySelectorAll('[data-preference]').forEach(b=>{b.classList.toggle('active',b.dataset.preference===state.preference);b.setAttribute('aria-pressed',String(b.dataset.preference===state.preference));});renderDesired();return;}
  if(el.dataset.confirm){state.acceptSession=document.querySelector('#accept-offer')?.value||null;details(el.dataset.confirm,true);return;}
  if(el.dataset.accept){await runMutation(el,async()=>{const r=state.data.requests.find(r=>r.id===el.dataset.accept);await api(`requests/${el.dataset.accept}/accept`,{accepted_session_id:r.desired_id||state.acceptSession});closeModal();state.page='requests';await refresh();toast('Swap accepted. The details are saved for both of you.');});return;}
  if(el.dataset.cancel){await runMutation(el,async()=>{await api(`requests/${el.dataset.cancel}/cancel`,{});closeModal();await refresh();toast('Your request has been cancelled.');});return;}
  if(el.dataset.action==='close'){closeModal();return;}
  if(el.dataset.action==='post'){postModal();return;}
  if(el.dataset.action==='clear'){state.search='';state.course='';state.date='';state.match=false;renderDashboard(document.querySelector('#page-content'));return;}
  if(el.dataset.action==='logout'){await runMutation(el,async()=>{await api('logout',{});state.data=null;state.page='dashboard';closeModal();renderLogin();});}
});
document.addEventListener('input',event=>{if(event.target.id==='search'){state.search=event.target.value;renderBoardResults();}});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='course-filter'){state.course=el.value;renderBoardResults();}
  if(el.id==='date-filter'){state.date=el.value;renderBoardResults();}
  if(el.id==='status-filter'){state.status=el.value;renderPersonal(document.querySelector('#page-content'));}
  if(el.id==='offered')renderDesired();
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['login-form','post-form'].includes(form.id))return;event.preventDefault();
  const button=event.submitter||form.querySelector('button[type=submit]');const values=Object.fromEntries(new FormData(form));
  if(form.id==='login-form'){
    const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{await api('login',values);state.page='dashboard';await refresh();if(button.value==='post')postModal();}
    catch(error){showError(error);buttons.forEach(b=>b.disabled=false);}
  }else{
    if(state.preference==='any')values.desired_id=null;
    await runMutation(button,async()=>{await api('requests',values);closeModal();state.page='requests';await refresh();toast('Your request is live on the swap board.');});
  }
});
modal.addEventListener('click',event=>{if(event.target===modal){const b=modal.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)closeModal();}});
async function init(){try{state.config=await api('config');await refresh();}catch(error){root.innerHTML=empty('Unable to load Session Swap.',error.message);}}
init();
setInterval(async()=>{
  if(!state.data||document.hidden||modal.open)return;
  const focused=document.activeElement;
  if(focused?.matches('input,select,textarea'))return;
  try{await refresh(false);renderPage();}catch(error){toast('Could not refresh. Your last loaded requests are shown.');}
},15000);
