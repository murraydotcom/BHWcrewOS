import crypto from 'node:crypto';
import { verifyCrewToken } from './auth.mjs';
import { blueprintTaskConfiguration, taskStaff, digest } from './blueprint-tasks.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function projectionActor(request,environment,now) {
  const secret=environment.BLUEPRINT_TASK_PROJECTION_SECRET;
  if(!secret)fail(503,'Patient task projection trust is not configured.');
  const [payload,signature,extra]=(request.headers.get('authorization')||'').replace(/^Bearer /,'').split('.');
  const expected=crypto.createHmac('sha256',secret).update(payload||'').digest('base64url');
  if(extra||!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail(401,'Invalid task projection authorization.');
  let claims;try{claims=JSON.parse(Buffer.from(payload,'base64url'));}catch{fail(401,'Invalid task projection token.');}
  const seconds=Math.floor(now/1000);
  if(claims.iss!=='health-core'||claims.aud!=='bhw-blueprint-tasks'||claims.scope!=='patient-task-read'||claims.bhwPatientId!=='BHW0000'
    ||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat>seconds||claims.exp<=seconds||claims.exp<=claims.iat||claims.exp-claims.iat>60)fail(403,'Task projection access denied.');
  if(!/^[a-f0-9]{64}$/.test(claims.referenceHash||''))fail(403,'An exact Blueprint reference is required.');
  return {id:'health-core-patient-projection',role:'projection',referenceHash:claims.referenceHash};
}
export function createBlueprintTaskHandler({store,readSource,environment,now=()=>new Date()}={}) {
  return async request=>{
    const url=new URL(request.url);
    if(!['/v1/blueprint-tasks','/v1/blueprint-tasks/commands','/v1/blueprint-tasks/patient'].includes(url.pathname))return null;
    try {
      if(!blueprintTaskConfiguration(environment)||!store||!readSource)fail(503,'Synthetic Blueprint tasks are disabled.');
      if(url.search)fail(400,'Task routes cannot select another patient or owner.');
      const stamp=new Date(now()).toISOString(),staff=taskStaff(environment),patient=url.pathname.endsWith('/patient');
      const verified=patient?projectionActor(request,environment,Date.parse(stamp)):verifyCrewToken(request.headers.get('authorization'),environment.CREWOS_OPERATIONS_TOKEN_SECRET,{now:Date.parse(stamp)});
      if(!patient) {
        const claims=JSON.parse(Buffer.from(request.headers.get('authorization').slice(7).split('.')[0],'base64url'));
        if(!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.exp-claims.iat>300||claims.exp<=claims.iat||claims.iat>Math.floor(Date.parse(stamp)/1000))fail(403,'A fresh staff session is required.');
      }
      const actor=patient?verified:staff.find(s=>s.id===verified.id&&s.role===verified.role);
      if(!actor)fail(403,'An active individual task grant is required.');
      const source=await readSource();
      if(patient&&actor.referenceHash!==source.reference.referenceHash)fail(409,'The patient Blueprint changed; reload its current version.');
      if(request.method==='GET'&&url.pathname!=='/v1/blueprint-tasks/commands') {
        const inbox=await store.view(source,actor,{now:stamp,all:patient||['provider','operations-manager'].includes(actor.role)});
        if(patient) {
          const tasks=inbox.tasks.filter(t=>!['cancelled','superseded','completed'].includes(t.status)).map(t=>({id:t.taskId,label:'Care-team follow-up',status:t.status,dueAt:t.dueAt}));
          tasks.push(...inbox.pendingQueue.map(t=>({id:t.actionId,label:'Care-team follow-up',status:'awaiting-queue',dueAt:t.dueAt})));
          tasks.push(...source.decisions.filter(d=>['accepted','modified'].includes(d.decision)&&d.unresolved.length).map(d=>({id:d.actionId,label:'Care-team follow-up',status:'needs-planning',dueAt:d.dueAt||null})));
          return new Response(JSON.stringify({ok:true,sourceReferenceHash:source.reference.referenceHash,tasks}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
        }
        return new Response(JSON.stringify({ok:true,inbox}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }
      if(patient||request.method!=='POST'||url.pathname!=='/v1/blueprint-tasks/commands')fail(405,'Unsupported task method.');
      const raw=await request.text();if(Buffer.byteLength(raw)>4000)fail(413,'Task command is too large.');
      let command;try{command=JSON.parse(raw);}catch{fail(400,'Invalid task command.');}
      const allowed=new Set(['action','commandId','referenceHash','taskId','expectedVersion','reminderId','evidenceReference']);
      if(!command||Array.isArray(command)||Object.keys(command).some(k=>!allowed.has(k))||!/^[A-Za-z0-9._:-]{8,100}$/.test(command.commandId||''))fail(400,'Only task reference metadata is accepted.');
      if(command.referenceHash!==source.reference.referenceHash)fail(409,'Blueprint changed; refresh current work.');
      const result=command.action==='sync'?await store.sync(source,{now:stamp,staff}):await store.change(command,source,actor,{now:stamp});
      const latest=await readSource();if(digest(latest)!==digest(source))fail(409,'Blueprint or provider decisions changed during the operation; reload before continuing.');
      return new Response(JSON.stringify({ok:true,commandId:command.commandId,...result}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    } catch(error) {const status=error.status||500;return new Response(JSON.stringify({ok:false,error:status<500?error.message:'Blueprint work is unavailable.'}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
  };
}
