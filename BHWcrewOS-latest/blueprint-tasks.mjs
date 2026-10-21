const $=id=>document.getElementById(id),node=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
let inbox,pending=null,busy=false,generation=0;
const status=text=>{$('status').textContent=text;};
const clear=()=>{generation++;inbox=null;pending=null;$('tasks').replaceChildren();$('retry').hidden=true;};
async function api(command){const token=sessionStorage.getItem('crewos_token');if(!token)throw Object.assign(new Error('Sign in to CrewHQ.'),{status:401});
  let response;try{response=await fetch('/.netlify/functions/blueprint-tasks',{method:command?'POST':'GET',headers:{Authorization:'Bearer '+token,...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{throw Object.assign(new Error(command?'Save could not be confirmed. Retry the same submission.':'Blueprint work could not be loaded.'),{saveUnconfirmed:!!command});}
  const body=await response.json().catch(()=>null);if(!response.ok||body?.ok!==true)throw Object.assign(new Error(body?.error||'Blueprint work is unavailable.'),{status:response.status,saveUnconfirmed:!!command&&(!body||body.saveUnconfirmed||response.status>=500)});return body;}
function fail(error){if([401,403].includes(error.status)){clear();status('Staff access expired or was revoked. Sign in again.');}else{inbox=null;$('tasks').replaceChildren();status(error.message);}}
async function refresh(sync=true){if(busy)return;const epoch=generation;let body=await api();if(epoch!==generation)return;inbox=body.inbox;
  if(sync){await api({action:'sync',commandId:crypto.randomUUID(),referenceHash:inbox.reference.referenceHash});body=await api();if(epoch!==generation)return;inbox=body.inbox;}
  render();status('Saved work and reminder state read back from BHW Cloud.');}
async function save(action,fields,retry=false){if(busy||(!inbox&&!pending))return;if(pending&&!retry){status('Retry the pending submission first.');return;}pending=pending||{action,...fields,commandId:crypto.randomUUID(),referenceHash:inbox.reference.referenceHash};busy=true;const epoch=generation;
  try{const body=await api(pending);if(epoch!==generation)return;if(body.commandId!==pending.commandId)throw new Error('Save could not be confirmed.');pending=null;busy=false;await refresh(false);}
  catch(error){if(!error.saveUnconfirmed)pending=null;fail(error);}finally{busy=false;$('retry').hidden=!pending;}}
const day=(date,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
export function dueCategory(task,now=Date.now()){if(task.status==='completed')return 'completed';if(Date.parse(task.dueAt)<now)return 'overdue';if(day(task.dueAt,task.timeZone)===day(now,task.timeZone))return 'today';return Date.parse(task.dueAt)<=now+86400000?'soon':'future';}
function render(){$('tasks').replaceChildren();for(const t of inbox.tasks){const category=dueCategory(t),filter=$('filter').value;if(filter!=='all'&&category!==filter)continue;
    const card=node('article');card.className='message';card.append(node('h2','Blueprint follow-up'),node('p',`Owner ${t.owner} · ${t.status} · ${category}`),node('p',`Due ${new Date(t.dueAt).toLocaleString('en-US',{timeZone:t.timeZone})} · ${t.timeZone}`),node('p',`Blueprint v${t.reference.version} · action ${t.actionId.slice(-8)}`));
    if(t.blockedReason)card.append(node('p',t.blockedReason));
    for(const r of t.reminders||[]){card.append(node('p',`${r.kind==='escalation'?'Escalation':'Due reminder'} · ${r.acknowledgedAt?'acknowledged':'unread'}`));if(!r.acknowledgedAt){const b=node('button','Acknowledge reminder');b.addEventListener('click',()=>void save('acknowledge',{taskId:t.taskId,expectedVersion:t.version,reminderId:r.id}));card.append(b);}}
    if(['open','awaiting-provider-review'].includes(t.status)){const f=node('form'),ref=node('input');ref.required=true;ref.placeholder='Returned-result reference from Health Core';ref.setAttribute('aria-label','Returned-result reference');ref.value=t.evidenceReference||'';f.append(ref,node('button','Record follow-up evidence'));f.addEventListener('submit',e=>{e.preventDefault();void save('submit-follow-up',{taskId:t.taskId,expectedVersion:t.version,evidenceReference:ref.value});});card.append(f);
      const complete=node('button','Complete after provider review');complete.addEventListener('click',()=>void save('complete',{taskId:t.taskId,expectedVersion:t.version}));card.append(complete);}
    $('tasks').append(card);}
  for(const unresolved of inbox.unresolved||[])$('tasks').append(node('p','Provider decision needs: '+unresolved.fields.join(', ')));
  if(!$('tasks').childNodes.length)$('tasks').append(node('p','No work matches this view.'));
}
$('refresh').addEventListener('click',()=>void refresh().catch(fail));$('filter').addEventListener('change',()=>inbox&&render());$('retry').addEventListener('click',()=>pending&&void save(pending.action,{},true));
document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else void refresh().catch(fail);});window.addEventListener('pagehide',clear);
setInterval(()=>{if(!document.hidden&&!pending&&!busy)void refresh().catch(fail);},30000);void refresh().catch(fail);
