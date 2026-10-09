import {readMessageFiles,downloadMessageFile} from './message-attachments.mjs?v=messaging-2';
const $=id=>document.getElementById(id);
const TOKEN_KEY='crewos_token';
let legalRecordSystem='charmhealth';
let attachmentsEnabled=false;
let actor=null,grants=[],rows=[],current=null,nextBefore=null,pending=null,generation=0,busy=false,active=true,idleTimer=null;
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const status=text=>{$('staff-message-status').textContent=text;};
function clear(){active=false;clearTimeout(idleTimer);generation++;$('staff-conversation-title').textContent='Choose a conversation';$('staff-conversation-state').textContent='';$('correspondence-hash').textContent='';$('staff-message-reason').value='';$('staff-message-record-reference').value='';$('staff-message-record-attested').checked=false;$('staff-message-attachments-reviewed').checked=false;actor=current=pending=null;grants=[];rows=[];$('staff-conversations').replaceChildren();$('staff-conversation-messages').replaceChildren();$('staff-message-file-selection').textContent='';$('correspondence-packet').textContent='';$('staff-message-form').reset();$('staff-message-controls').hidden=true;$('staff-message-form').hidden=true;}
function fail(error){if(error.status===401){clear();sessionStorage.removeItem(TOKEN_KEY);status('Your staff session expired. Sign in again. Unsaved drafts were cleared.');const a=node('a','Sign in to CrewHQ');a.href='/crewos?next=%2Fbhw-portal-messages.html';$('staff-message-status').append(a);}else status(error.message||'Messages are unavailable.');}
async function api({query={},command,download=false}={}){
  const token=sessionStorage.getItem(TOKEN_KEY);if(!token)throw Object.assign(new Error('Sign in to CrewHQ.'),{status:401});
  const params=new URLSearchParams(query);
  const r=await fetch('/.netlify/functions/portal-messaging'+(params.size?'?'+params:''),{method:command?'POST':'GET',cache:'no-store',
    headers:{Authorization:`Bearer ${token}`,...(command?{'Content-Type':'application/json'}:{})},body:command?JSON.stringify(command):undefined,signal:AbortSignal.timeout(10000)});
  if(download&&r.ok){if(r.headers.get('content-type')!=='application/octet-stream')throw Error('File download could not be confirmed.');const blob=await r.blob();if(!blob.size || blob.size>512*1024)throw Error('Invalid file download.');return {blob};}
  const data=await r.json().catch(()=>null);
  if(!r.ok||data?.ok!==true)throw Object.assign(new Error(data?.error||'Save could not be confirmed. Retry the same submission.'),{status:r.status,saveUnconfirmed:command&&(!data||data.saveUnconfirmed||r.status>=500)});
  if(command&&data.commandId!==command.commandId)throw Object.assign(new Error('Save could not be confirmed. Retry the same submission.'),{saveUnconfirmed:true});return data;
}
function renderList(){const filter=$('staff-message-filter').value;
  $('staff-conversations').replaceChildren(...rows.filter(t=>filter==='all'||t.status===filter||(filter==='unassigned'&&!t.assignedTo)||(filter==='review'&&t.reviewRequired)).map(t=>{
    const b=node('button',t.subject+' · '+t.status+(t.unreadCount?' · '+t.unreadCount+' unread':''));b.type='button';b.className='thread';b.onclick=()=>{if(!pending&&!busy)void open(t.id).catch(fail);};return b;}));$('staff-messages-more').hidden=!nextBefore;
}
function renderThread(){
  $('staff-conversation-title').textContent=current?.subject||'New conversation with BHW0000';
  $('staff-conversation-state').textContent=current?current.status+' · '+(current.review?.recordStatus||'Provider review required'):'';
  $('staff-conversation-messages').replaceChildren(...(current?.messages||[]).map(m=>{const a=node('article','');a.className='message '+m.senderKind;a.append(node('strong',m.senderKind==='patient'?'Synthetic patient':m.senderName),node('small',new Date(m.sentAt).toLocaleString()),node('p',m.body));for(const file of m.attachments || []){const b=node('button','Download '+file.name+' ('+Math.ceil(file.size/1024)+' KB)');b.type='button';b.onclick=()=>{const version=generation;b.disabled=true;void downloadMessageFile({api,threadId:current.id,file,isCurrent:()=>active&&version===generation}).catch(fail).finally(()=>{b.disabled=false;});};a.append(b);}return a;}));
  $('staff-message-form').hidden=false;$('staff-new-fields').hidden=Boolean(current);$('staff-message-subject').required=!current;
  $('staff-message-controls').hidden=!current;$('provider-message-controls').hidden=actor?.role!=='provider';
  $('staff-message-assignee').replaceChildren(...grants.map(g=>{const o=node('option',g.name+' · '+g.role);o.value=g.id;return o;}));
  if(current?.assignedTo)$('staff-message-assignee').value=current.assignedTo;
  $('staff-message-files').value='';$('staff-message-file-selection').textContent='';$('staff-message-files').disabled=!attachmentsEnabled;
  $('staff-message-body').value='';$('staff-message-reason').value='';$('staff-message-record-reference').value='';$('staff-message-record-attested').checked=false;$('staff-message-attachments-reviewed').checked=false;
  $('correspondence-packet').textContent=current?JSON.stringify(current.correspondencePacket,null,2):'';
  $('correspondence-hash').textContent=current?'SHA-256: '+current.correspondenceHash:'';
}
async function load(more=false){const version=generation;const data=await api({query:more&&nextBefore?{before:nextBefore}:{}});if(version!==generation)return;
  attachmentsEnabled=data.attachments?.enabled===true;$('staff-message-files').disabled=!attachmentsEnabled||busy||Boolean(pending);$('staff-message-file-help').textContent=attachmentsEnabled?'Up to 3 synthetic files, 512 KB each. PDF, PNG, JPEG, or text.':'File attachments are currently unavailable.';
  actor=data.actor;grants=data.staff;legalRecordSystem=data.legalRecordSystem||'charmhealth';$('staff-message-record-system').value=legalRecordSystem;for(const o of $('staff-message-record-system').options)o.disabled=o.value!==legalRecordSystem;rows=more?[...rows,...data.threads]:data.threads;nextBefore=data.nextBefore;renderList();status('BHW0000 inbox loaded. External notifications are disabled.');}
async function open(id){const version=++generation;let data=await api({query:{threadId:id}});if(version!==generation)return;current=data.thread;
  data=await api({command:{action:'read',commandId:crypto.randomUUID(),threadId:id,expectedRevision:current.revision}});if(version!==generation)return;current=data.thread;renderThread();void load().catch(fail);}
function disable(value){busy=value;for(const e of document.querySelectorAll('button,input,textarea,select'))e.disabled=value;}
async function send(command){
  const version=generation;pending=command;disable(true);
  try{const data=await api({command});if(version!==generation)return;pending=null;current=data.thread;renderThread();await load();status('Saved. Patient replies are visible in Care Connect.');}
  catch(error){if(version!==generation)return;if(!error.saveUnconfirmed)pending=null;fail(error);}
  finally{disable(!active);$('staff-message-files').disabled=!active||!attachmentsEnabled;$('staff-message-send').textContent=pending?'Retry same submission':'Send to patient';
    if(pending)for(const e of document.querySelectorAll('input,textarea,select,button'))e.disabled=e.id!=='staff-message-send';}
}
$('staff-message-form').onsubmit=async event=>{event.preventDefault();if(busy)return;if(pending){void send(pending);return;}if(!$('staff-message-form').reportValidity())return;
  const version=generation;disable(true);
  try{const files=await readMessageFiles($('staff-message-files').files);if(version!==generation)return;disable(false);$('staff-message-files').disabled=!attachmentsEnabled;
    status(files.length?'Checking files and sending your message…':'Sending your message…');
    await send({action:current?'reply':'compose',commandId:crypto.randomUUID(),body:$('staff-message-body').value,...(files.length?{attachments:files}:{}),...(current?{threadId:current.id,expectedRevision:current.revision}:{subject:$('staff-message-subject').value,topic:$('staff-message-topic').value})});
  }catch(error){if(version===generation){disable(!active);$('staff-message-files').disabled=!active||!attachmentsEnabled;fail(error);}}
};
$('staff-message-files').onchange=()=>{$('staff-message-file-selection').textContent=Array.from($('staff-message-files').files).map(f=>f.name+' ('+Math.ceil(f.size/1024)+' KB)').join(', ');};
$('staff-message-clear-files').onclick=()=>{if(busy||pending)return;$('staff-message-files').value='';$('staff-message-file-selection').textContent='';};
for(const b of document.querySelectorAll('[data-command]'))b.onclick=()=>{
  if(busy||pending||!current)return;
  const action=b.dataset.command;const command={action,commandId:crypto.randomUUID(),threadId:current.id,expectedRevision:current.revision};
  if(['assign','escalate'].includes(action))command.assignee=$('staff-message-assignee').value;
  if(['escalate','review'].includes(action))command.reason=$('staff-message-reason').value;
  if(action==='review'){command.disposition=$('staff-message-disposition').value;command.attachmentsReviewed=$('staff-message-attachments-reviewed').checked;}
  if(action==='record-entry')Object.assign(command,{recordSystem:$('staff-message-record-system').value,recordReference:$('staff-message-record-reference').value,contentHash:current.correspondenceHash,attested:$('staff-message-record-attested').checked});
  void send(command);
};
$('staff-message-new').onclick=()=>{if(!busy&&!pending&&actor){generation++;current=null;renderThread();$('staff-message-subject').focus();}};
$('staff-message-refresh').onclick=()=>{if(!pending&&!busy)void load().catch(fail);};
$('staff-messages-more').onclick=()=>void load(true).catch(fail);
$('staff-message-filter').onchange=renderList;
function scheduleExpiry(){clearTimeout(idleTimer);let expires=Date.now()+15*60*1000;
  try{const claims=JSON.parse(atob(sessionStorage.getItem(TOKEN_KEY).split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));expires=Math.min(expires,claims.exp);}catch{}
  idleTimer=setTimeout(()=>{clear();sessionStorage.removeItem(TOKEN_KEY);location.replace('/crewos?next=%2Fbhw-portal-messages.html');},Math.max(0,expires-Date.now()));}
window.addEventListener('pointerdown',()=>{if(active)scheduleExpiry();});window.addEventListener('keydown',()=>{if(active)scheduleExpiry();});scheduleExpiry();
setInterval(async()=>{if(!active||busy||pending||document.hidden||$('staff-message-files').files.length||$('staff-message-body').value||$('staff-message-reason').value||$('staff-message-record-reference').value)return;
  try{await load();if(current){const latest=rows.find(r=>r.id===current.id);if(latest&&latest.revision!==current.revision)await open(current.id);}}catch(error){fail(error);}},30000);
window.addEventListener('pagehide',clear);
void load().catch(fail);
