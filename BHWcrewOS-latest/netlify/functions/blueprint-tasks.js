const crypto=require('node:crypto');
const {getSession}=require('./_lib');
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private'},body:JSON.stringify(body)});
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value?.[key]??null]));
const reference=value=>pick(value,['schemaVersion','authority','bhwPatientId','blueprintId','version','signedContentHash','approvedContentHash','releaseId','releaseContentHash','projectionContentHash','reviewCaseId','state','referenceHash']);
const review=value=>value?pick(value,['intentHash','resultId','resultHash','reviewedAt']):null;
function createBlueprintTasksBridge({environment=process.env,fetchImpl=fetch,sessionImpl=getSession,now=Date.now}={}) {
  return async event=>{
    if(!['GET','POST'].includes(event.httpMethod))return json(405,{ok:false,error:'GET or POST only.'});
    const session=sessionImpl(event);if(!session?.staffId)return json(401,{ok:false,error:'Sign in to CrewHQ again.'});
    if(environment.SYNTHETIC_BLUEPRINT_TASKS_ENABLED!=='true')return json(503,{ok:false,error:'Synthetic Blueprint tasks are disabled.'});
    if(Object.keys(event.queryStringParameters||{}).length)return json(400,{ok:false,error:'Alternate patient/owner selectors are not accepted.'});
    let base,command;
    try{base=new URL(environment.OPERATIONS_CLOUD_API_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error();}
    catch{return json(503,{ok:false,error:'Blueprint work is unavailable.'});}
    if(event.httpMethod==='POST'){
      const raw=String(event.body||'');if(event.isBase64Encoded||Buffer.byteLength(raw)>4000)return json(413,{ok:false,error:'Unsupported task request.'});
      try{command=JSON.parse(raw);}catch{return json(400,{ok:false,error:'Invalid task command.'});}
      const keys=new Set(['action','commandId','referenceHash','taskId','expectedVersion','reminderId','evidenceReference']);
      if(!command||Array.isArray(command)||Object.keys(command).some(k=>!keys.has(k))||!['sync','acknowledge','submit-follow-up','complete'].includes(command.action))return json(400,{ok:false,error:'Only task reference metadata is accepted.'});
    }
    try{
      const secret=environment.CREWOS_OPERATIONS_TOKEN_SECRET;if(!secret)return json(503,{ok:false,error:'Blueprint staff trust is unavailable.'});
      const iat=Math.floor(now()/1000),payload=Buffer.from(JSON.stringify({iss:'bhw-crewhq',aud:'bhw-operations-cloud',sub:'crew:'+session.staffId,staffId:session.staffId,role:session.healthRole||session.role||'staff',iat,exp:iat+60})).toString('base64url');
      const token=payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');
      const response=await fetchImpl(base.origin+'/v1/blueprint-tasks'+(command?'/commands':''),{method:event.httpMethod,headers:{Authorization:'Bearer '+token,...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
      const body=await response.json().catch(()=>null);
      if(!response.ok)return json([400,401,403,404,409,413,429,503].includes(response.status)?response.status:502,{ok:false,error:response.status<500?body?.error:'Blueprint work is unavailable.',saveUnconfirmed:!!command&&response.status>=500});
      if(body?.ok!==true||(command&&body.commandId!==command.commandId))throw Error('Unconfirmed task command');
      if(command)return json(200,{ok:true,commandId:body.commandId,replayed:body.replayed===true,changed:body.changed??null});
      if(body.inbox?.reference?.bhwPatientId!=='BHW0000'||!Array.isArray(body.inbox.tasks)||body.inbox.tasks.length>500)throw Error('Invalid task inbox');
      const keys=['taskId','actionId','intentHash','owner','dueAt','timeZone','priority','prerequisites','escalationAt','escalationOwner','status','version','createdAt','updatedAt','evidenceReference','completedAt','blockedReason'];
      return json(200,{ok:true,inbox:{reference:reference(body.inbox.reference),tasks:body.inbox.tasks.map(t=>({...pick(t,keys),reference:reference(t.reference),
        reminders:(t.reminders||[]).map(r=>pick(r,['id','kind','recipient','createdAt','acknowledgedAt','acknowledgedBy'])),completionReview:review(t.completionReview)})),
        pendingQueue:(body.inbox.pendingQueue||[]).map(t=>pick(t,['actionId','owner','dueAt'])),unresolved:(body.inbox.unresolved||[]).map(t=>pick(t,['actionId','fields'])),supersededCount:body.inbox.supersededCount||0}});
    }catch{return json(502,{ok:false,error:command?'Save could not be confirmed. Retry the same submission.':'Blueprint work could not be loaded.',saveUnconfirmed:!!command});}
  };
}
exports.handler=createBlueprintTasksBridge();exports._test={createBlueprintTasksBridge};
