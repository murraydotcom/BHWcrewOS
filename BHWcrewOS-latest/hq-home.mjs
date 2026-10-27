const $ = id => document.getElementById(id);
const GROUPS = [
  ['Patients & Follow-up', [
    ['Patient Registry','Find a patient and open their record.','/provider/patient-registry.html'],
    ['Patient Requests','Open the existing shared patient-request workflow.','/bhw-requests.html'],
    ['Patient Monitor','Review check-ins and follow-up activity.','/bhw-patient-monitor-list.html'],
    ['CRISP Flow','Follow hospital and ambulatory transitions.','/provider/tcm.html'],
    ['myBHW messages','Open your authorized messaging inbox; pilot limits apply.','/bhw-portal-messages.html'],
  ]],
  ['Visits & Care Plans', [
    ['Health Core','Open the protected clinical access workspace.','https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/clinical-access.html'],
    ['Provider 360 resources','Provider reference library, atlas, and clinical sources.','https://bhw-health-core-ehr-awknhudemq-uk.a.run.app/provider-360.html'],
    ['Visit Documentation Assistance','Capture, review, and approve visit documentation.','/provider/workflow.html'],
    ['Health 360 Care Plans','Create and review patient care plans.','https://rcm.bhwmedical.org/provider/health-blueprint.html'],
  ]],
  ['Documents & Communication', [
    ['Paperwork Studio','Prepare forms, prior authorizations, and letters.','/bhw-paperwork.html'],
    ['Patient Education & Documents','Create reviewed handouts and patient documents.','/bhw-documents.html'],
    ['Patient Materials & Feedback','Share materials and review patient responses.','/bhw-patient-materials.html'],
    ['Medication Request Links','Create a private medication-intake link; shadow workflow.','/bhw-medication-request-links.html'],
    ['Send a Fax','Send a reviewed PDF through the practice line.','/bhw-fax.html'],
  ]],
  ['Training & Resources', [
    ['welcometoBHW','Onboarding and new-teammate checklists.','https://welcometobhw.netlify.app/'],
    ['Care Program SOP','Enrollment, program guidance, and staff training.','/bhw-care-program-sop.html'],
  ]],
  ['Practice Administration', [
    ['Website Content','Review and manage practice announcements.','/bhw-website-content.html'],
    ['Practice Connections & Resources','Employees, referrals, rooms, and resources.','/bhw-intel-connections.html'],
    ['Medicare DPC Setup','Review the Medicare data connection.','/bhw-dpc.html'],
  ]],
];
const TOTAL = GROUPS.reduce((n,g)=>n+g[1].length,0);
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function link(text,href,className){const a=element('a',text,className);a.href=href;if(href.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}return a;}
const fmt = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(v+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'})
  : v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
let category=0, generation=0, loading=false, actorToken='', timer, expiryTimer;
const token=()=>{try{return sessionStorage.getItem('crewos_token')||'';}catch{return '';}};
function renderTools(){const q=$('toolSearch').value.trim().toLowerCase();const tools=(q?GROUPS.flatMap(g=>g[1]):GROUPS[category][1]).filter(t=>!q||(t[0]+' '+t[1]).toLowerCase().includes(q));
  $('toolList').replaceChildren(...tools.map(t=>{const a=link('',t[2],'directory-row');const copy=element('span');copy.append(element('strong',t[0]),element('small',t[1]));a.append(copy,element('span','↗'));return a;}));
  if(!tools.length)$('toolList').append(element('p','No matching tools. Try another search.','empty'));
  $('toolCount').textContent=q?`${tools.length} matches`:`${TOTAL} tools · ${GROUPS.length} groups`;
  [...$('toolGroups').children].forEach((b,i)=>b.setAttribute('aria-pressed',String(!q&&category===i)));
}
GROUPS.forEach((group,i)=>{const b=element('button',group[0]);b.type='button';b.onclick=()=>{category=i;$('toolSearch').value='';renderTools();};$('toolGroups').append(b);});
$('toolSearch').addEventListener('input',renderTools);renderTools();
$('themeBtn').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;
  try{localStorage.setItem('bhw-theme',next);}catch{}document.querySelector('meta[name=theme-color]').content=next==='light'?'#f4eede':'#0e2233';});
function clearPersonal(message='Sign in to see your personal work.'){
  generation++;clearTimeout(expiryTimer);$('personScope').textContent='Your updates, your handoffs, and the tools for your day.';
  $('homeStatus').textContent=message;$('signIn').textContent='Sign in →';$('refreshHome').hidden=true;
  for(const id of ['care','portal']){$(id+'Count').textContent='—';$(id+'Status').textContent='Sign in to see your updates.';$(id+'Items').replaceChildren();$(id+'Details').hidden=true;}
  for(const id of ['handoffItems','closedItems','measureItems','goalItems'])$(id).replaceChildren();
  $('closedDetails').hidden=true;$('handoffStatus').textContent='Sign in to see your handoffs and referrals.';$('metricStatus').textContent='Sign in to see measures for your role.';
}
function notification(name,data){$(name+'Count').textContent=data.available?String(data.count):'—';
  $(name+'Status').textContent=data.message+(data.limited?' · Recent records only.':'');
  $(name+'Items').replaceChildren(...(data.items||[]).map(item=>{const li=element('li');li.append(link(item.label,item.href),element('small',[item.scope,fmt(item.at)].filter(Boolean).join(' · ')));return li;}));
  $(name+'Details').hidden=!data.items?.length;
}
function workflowRow(item){const a=link('',item.href,'workflow-row');const copy=element('div',undefined,'workflow-copy');
  copy.append(element('strong',item.title+(item.to?' · '+item.to:'')),element('small',[item.from&&`From ${item.from}`,item.relationship,`Owner: ${item.owner}`].filter(Boolean).join(' · ')),element('small',item.nextAction || 'Open the original '+(item.kind==='referral'?'referral':'handoff')+' for its next action.'));
  const end=element('div',undefined,'workflow-end');end.append(element('span',item.status,'status-pill'+(item.dueAt&&Date.parse(item.dueAt)<Date.now()&&!item.completed?' late':'')),element('small',item.dueAt?'Due '+fmt(item.dueAt):'Due date not recorded'));a.append(copy,end);return a;}
function renderHome(data){$('personScope').textContent=`${data.user.name} · ${data.user.role || 'Staff'}${data.user.divisions.length?' · '+data.user.divisions.join(', '):''}`;
  $('homeStatus').textContent='Updated '+fmt(data.checkedAt)+'. Your assignments and role queue.';$('signIn').textContent='Open crewOS →';$('refreshHome').hidden=false;
  notification('care',data.notifications.care);notification('portal',data.notifications.portal);
  const h=data.handoffs;$('handoffStatus').textContent=h.available?(h.limited?'Recent recorded work; the source window reached its limit. Open crewOS for full history.':'Your assignments, incoming work for your area, and handoffs you sent.'):(h.partial?'Some handoffs could not be loaded. Available items are shown below.':'Handoffs are unavailable. Open crewOS or refresh.');
  $('handoffItems').replaceChildren(...h.items.map(workflowRow));if(h.available&&!h.items.length)$('handoffItems').append(element('p','No open handoffs or referrals in your current home view.','empty'));
  $('closedItems').replaceChildren(...h.recentClosed.map(workflowRow));$('closedDetails').hidden=!h.recentClosed.length;
  $('metricStatus').textContent=data.metrics.available?`${data.metrics.period} · Completions attributed to your staff identity${data.metrics.limited?' · Recent source window only':''}`:'Your personal measures could not be loaded.';
  $('measureItems').replaceChildren(...data.metrics.items.map(m=>{const block=element('article',undefined,'measure');block.append(element('div',m.value===null?'—':String(m.value),'measure-value'),element('h3',m.label),element('p',m.detail),element('p',m.target===null?'Individual target not set':String(m.target),'target'));return block;}));
  $('goalItems').replaceChildren(element('h3','My assigned goals & projects'));
  if(!data.goals.available)$('goalItems').append(element('p','Assigned goals could not be loaded. Open My Space in crewOS.','state-note'));
  else if(!data.goals.items.length)$('goalItems').append(element('p','No individual goals or projects assigned in crewOS.','state-note'));
  else data.goals.items.forEach(g=>{const a=link('',g.href);a.append(element('span',g.title),element('small',[g.status,g.dueAt?'Due '+fmt(g.dueAt):'No due date'].filter(Boolean).join(' · ')));$('goalItems').append(a);});
}
async function refresh(){const currentToken=token();if(currentToken!==actorToken){actorToken=currentToken;clearPersonal();}
  if(!currentToken||loading)return;loading=true;const version=generation;$('refreshHome').disabled=true;
  try{const response=await fetch('/.netlify/functions/hq-home',{cache:'no-store',credentials:'same-origin',headers:{Authorization:`Bearer ${currentToken}`},signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);if(version!==generation||currentToken!==token())return;
    if(response.status===401){clearPersonal('Your staff session expired. Sign in again.');return;}
    if(!response.ok||data?.ok!==true)throw Error('Home unavailable');renderHome(data);
    // The decoded expiry schedules clearing only. The server validates all identity and access.
    let expires=Date.now()+120000;try{const p=JSON.parse(atob(currentToken.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));expires=Math.min(Number(p.exp)||expires,expires);}catch{}
    clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{clearPersonal('Refresh or sign in to load your personal work.');void refresh();},Math.max(0,expires-Date.now()));
  }catch{if(version===generation&&currentToken===token()){clearPersonal('Personal work could not be refreshed. Open crewOS or try again.');$('refreshHome').hidden=false;}}
  finally{loading=false;$('refreshHome').disabled=false;}
}
$('refreshHome').addEventListener('click',()=>void refresh());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
window.addEventListener('pageshow',()=>{clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)void refresh();},120000);void refresh();});
window.addEventListener('pagehide',()=>{clearPersonal();clearInterval(timer);});
timer=setInterval(()=>{if(!document.hidden)void refresh();},120000);void refresh();
