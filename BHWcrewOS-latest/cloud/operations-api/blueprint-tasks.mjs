import crypto from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))??'null').digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const active=d=>['accepted','modified'].includes(d?.decision)&&!d.unresolved?.length;
export function blueprintTaskConfiguration(environment) {
  if(environment.SYNTHETIC_BLUEPRINT_TASKS_ENABLED!=='true')return null;
  const databaseId=environment.BLUEPRINT_TASK_FIRESTORE_DATABASE;
  if(environment.SYNTHETIC_ONLY!=='true'||!/^[a-z][a-z0-9-]{3,62}$/.test(databaseId||'')||/prod/i.test(databaseId)||databaseId===(environment.FIRESTORE_DATABASE||'bhw-rcm-prod'))fail(503,'Blueprint tasks require an isolated synthetic database.');
  return {databaseId};
}
export function taskStaff(environment) {
  let grants;try{grants=JSON.parse(environment.BLUEPRINT_TASK_STAFF_GRANTS||'{}');}catch{fail(503,'Invalid Blueprint task staff grants.');}
  return Object.entries(grants).filter(([,g])=>g?.active===true&&['provider','ma-bha','care-manager','operations-manager'].includes(g.role)).map(([id,g])=>({id,role:g.role,name:String(g.name||id).slice(0,160)}));
}
export function validateWork(body) {
  const r=body?.reference,copy={...r};delete copy.referenceHash;
  const referenceKeys=new Set(['schemaVersion','authority','bhwPatientId','blueprintId','version','signedContentHash','approvedContentHash','releaseId','releaseContentHash','projectionContentHash','reviewCaseId','state','referenceHash']);
  if(body?.ok!==true||r?.schemaVersion!=='bhw.blueprint-reference.v1'||r.authority!=='health-core'||r.bhwPatientId!=='BHW0000'
    ||Object.keys(r).some(key=>!referenceKeys.has(key))||!Number.isSafeInteger(r.version)||r.version<1
    ||!['signedContentHash','approvedContentHash','releaseContentHash','projectionContentHash'].every(key=>/^[a-f0-9]{64}$/.test(r[key]||''))
    ||r.state!=='patient-shared'||digest(copy)!==r.referenceHash||!Array.isArray(body.decisions)||body.decisions.length>60)fail(502,'Invalid Health Core work source.');
  const decisions=body.decisions.map(d=>{
    if(!/^action-[a-f0-9]{40}$/.test(d.actionId||'')||!['accepted','modified','deferred','rejected'].includes(d.decision)||!/^[a-f0-9]{64}$/.test(d.intentHash||'')
      ||!Number.isSafeInteger(d.decisionRevision)||!Array.isArray(d.unresolved)||d.unresolved.some(field=>!['owner','timing','timezone','priority','completion-condition'].includes(field))
      ||!Array.isArray(d.prerequisites)||d.prerequisites.length>20||d.prerequisites.some(id=>!/^action-[a-f0-9]{40}$/.test(id))
      ||d.completionConditionReference!==d.actionId)fail(502,'Invalid approved action metadata.');
    const review=d.completionReview;
    if(review&&(!/^[a-f0-9]{64}$/.test(review.intentHash||'')||!/^result-[a-f0-9]{40}$/.test(review.resultId||'')
      ||!/^[a-f0-9]{64}$/.test(review.resultHash||'')||!Number.isFinite(Date.parse(review.reviewedAt))))fail(502,'Invalid clinical completion review reference.');
    return {...Object.fromEntries(['actionId','decision','intentHash','decisionRevision','owner','dueAt','timeZone','priority','prerequisites','unresolved','escalationAt','escalationOwner','completionConditionReference'].map(k=>[k,d[k]??null])),
      completionReview:review?Object.fromEntries(['intentHash','resultId','resultHash','reviewedAt'].map(key=>[key,review[key]])):null};
  });
  if(new Set(decisions.map(d=>d.actionId)).size!==decisions.length)fail(502,'Duplicate approved actions.');
  return {reference:structuredClone(r),decisions,revision:body.revision};
}
export function createBlueprintWorkClient(environment,{fetchImpl=fetch,now=Date.now}={}) {
  return async()=>{
    let base;try{base=new URL(environment.HEALTH_CORE_BLUEPRINT_AUTHORITY_URL);}catch{fail(503,'Health Core Blueprint source is not configured.');}
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')fail(503,'An exact HTTPS Health Core origin is required.');
    const secret=environment.BLUEPRINT_AUTHORITY_CREWOS_SECRET;if(!secret)fail(503,'Blueprint source trust is not configured.');
    const iat=Math.floor(now()/1000),payload=Buffer.from(JSON.stringify({iss:'crewos',aud:'bhw-blueprint-authority',scope:'blueprint-read',bhwPatientId:'BHW0000',iat,exp:iat+60})).toString('base64url');
    const signature=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
    const response=await fetchImpl(base.origin+'/v1/patients/BHW0000/blueprint-work',{headers:{Authorization:`Bearer ${payload}.${signature}`,'X-BHW-Blueprint-Consumer':'crewos'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)fail([401,403,404,409,503].includes(response.status)?response.status:502,'Current Health Core work is unavailable; cached work cannot be completed.');
    return validateWork(await response.json());
  };
}
const taskId=(reference,actionId)=>'TSK-BP-'+digest([reference.referenceHash,actionId]).slice(0,40);
const metadata=t=>Object.fromEntries(['taskId','actionId','reference','intentHash','owner','dueAt','timeZone','priority','prerequisites','escalationAt','escalationOwner','status','version','createdAt','updatedAt','reminders','evidenceReference','completedAt','completionReview','blockedReason'].map(k=>[k,t[k]??null]));
export function createBlueprintTaskStore(db) {
  const tasks=db.collection('tasks'),indexRef=db.collection('patientRequests').doc('hc-blueprint-BHW0000');
  const audit=indexRef.collection('auditEvents');
  async function load(tx=null) {
    const get=ref=>tx?tx.get(ref):ref.get();const index=(await get(indexRef)).data()||{taskIds:[]};
    if(!Array.isArray(index.taskIds)||index.taskIds.length>500)fail(429,'Synthetic task history needs reviewed archival before expansion.');
    const rows=[];for(const id of index.taskIds){const t=(await get(tasks.doc(id))).data();if(t){if(t.bhwPatientId!=='BHW0000'||t.source!=='health-core-blueprint')fail(503,'Synthetic task integrity failed.');rows.push(t);}}
    return {index,rows};
  }
  const persist=(tx,previous,task)=>{
    tx.set(tasks.doc(task.taskId),task);
    tx.create(tasks.doc(task.taskId).collection('versions').doc(String(task.version).padStart(6,'0')),{task});
    tx.create(audit.doc(crypto.randomUUID()),{taskId:task.taskId,sourceReferenceHash:task.reference.referenceHash,status:task.status,
      version:task.version,occurredAt:task.updatedAt,patientReference:'synthetic',previousStatus:previous?.status||null});
  };
  return {
    async sync(source,{now=new Date().toISOString(),staff=[]}={}) {
      return db.runTransaction(async tx=>{
        const {index,rows}=await load(tx),byId=new Map(rows.map(t=>[t.taskId,t]));
        for(const d of source.decisions.filter(active)) {
          if(!d.owner||!staff.some(s=>s.id===d.owner)||!d.dueAt||!Number.isFinite(Date.parse(d.dueAt))||!d.timeZone||!d.priority)continue;
          const id=taskId(source.reference,d.actionId),previous=byId.get(id);
          if(!previous||previous.intentHash!==d.intentHash)byId.set(id,{taskId:id,source:'health-core-blueprint',bhwPatientId:'BHW0000',reference:source.reference,
            actionId:d.actionId,intentHash:d.intentHash,owner:d.owner,dueAt:d.dueAt,timeZone:d.timeZone,priority:d.priority,prerequisites:d.prerequisites,
            escalationAt:d.escalationAt,escalationOwner:d.escalationOwner,status:'open',version:previous?.version||0,createdAt:previous?.createdAt||now,updatedAt:now,reminders:[],evidenceReference:null,completionReview:null,completedAt:null});
        }
        const changed=[];
        for(const [id,value] of byId) {
          const previous=rows.find(t=>t.taskId===id),t=structuredClone(value);
          const d=source.decisions.find(d=>d.actionId===t.actionId);
          if(t.reference.referenceHash!==source.reference.referenceHash)t.status='superseded';
          else if(!active(d)) {t.status=['accepted','modified'].includes(d?.decision)?'blocked':'cancelled';t.blockedReason='Provider action is deferred, rejected or unresolved.';}
          else if(!staff.some(s=>s.id===t.owner)){t.status='blocked';t.blockedReason='Named owner is no longer active.';}
          else if(!['completed','superseded','cancelled'].includes(t.status)) {
            const blocked=t.prerequisites.some(p=>!Array.from(byId.values()).some(other=>other.reference.referenceHash===source.reference.referenceHash&&other.actionId===p&&other.status==='completed'
              &&source.decisions.some(pd=>pd.actionId===p&&pd.intentHash===other.intentHash&&active(pd))));
            t.blockedReason=blocked?'Prerequisite follow-up is incomplete.':null;
            if(t.status==='blocked'&&!blocked)t.status='open';
            if(blocked)t.status='blocked';
            if(!blocked&&Date.parse(now)>=Date.parse(t.dueAt)&&!t.reminders.some(r=>r.kind==='due'))t.reminders.push({id:id+':due',kind:'due',recipient:t.owner,createdAt:now,acknowledgedAt:null});
            if(!blocked&&t.escalationAt&&staff.some(s=>s.id===t.escalationOwner&&s.role==='provider')&&Date.parse(now)>=Date.parse(t.escalationAt)&&!t.reminders.some(r=>r.kind==='escalation'))t.reminders.push({id:id+':escalation',kind:'escalation',recipient:t.escalationOwner,createdAt:now,acknowledgedAt:null});
          }
          if(!previous||digest(t)!==digest(previous)){t.version=(previous?.version||0)+1;t.updatedAt=now;changed.push([previous,t]);byId.set(id,t);}
        }
        if(byId.size>500)fail(429,'Synthetic task history limit reached.');
        for(const [previous,t] of changed)persist(tx,previous,t);
        tx.set(indexRef,{...index,source:'health-core-blueprint',bhwPatientId:'BHW0000',taskIds:[...byId.keys()],updatedAt:now,manualNotifyOnly:true});
        return {changed:changed.length};
      });
    },
    async view(source,actor,{now=new Date().toISOString(),all=false}={}) {
      const {rows}=await load();const current=rows.filter(t=>t.reference.referenceHash===source.reference.referenceHash
        &&source.decisions.some(d=>d.actionId===t.actionId&&d.intentHash===t.intentHash&&active(d)));
      return {reference:source.reference,tasks:current.filter(t=>all||t.owner===actor.id||t.reminders.some(r=>r.recipient===actor.id)).map(metadata),
        supersededCount:rows.length-current.length,pendingQueue:source.decisions.filter(d=>active(d)&&(all||d.owner===actor.id)&&!current.some(t=>t.actionId===d.actionId)).map(d=>({actionId:d.actionId,owner:d.owner,dueAt:d.dueAt})),
        unresolved:source.decisions.filter(d=>d.unresolved?.length&&(all||d.owner===actor.id)).map(d=>({actionId:d.actionId,fields:d.unresolved})),readAt:now};
    },
    async change(command,source,actor,{now=new Date().toISOString()}={}) {
      if(!/^[A-Za-z0-9._:-]{8,100}$/.test(command.commandId||''))fail(400,'A stable command ID is required.');
      if(!['acknowledge','submit-follow-up','complete'].includes(command.action))fail(400,'Unsupported task action.');
      if(command.referenceHash!==source.reference.referenceHash)fail(409,'The Blueprint changed.');
      return db.runTransaction(async tx=>{
        const {rows}=await load(tx);
        if(!/^TSK-BP-[a-f0-9]{40}$/.test(command.taskId||''))fail(400,'Invalid task reference.');
        const ref=tasks.doc(command.taskId),receiptRef=ref.collection('receipts').doc(digest([actor.id,command.commandId]));
        const t=(await tx.get(ref)).data(),receipt=(await tx.get(receiptRef)).data();
        const d=source.decisions.find(d=>d.actionId===t?.actionId);
        if(!t||t.bhwPatientId!=='BHW0000'||t.source!=='health-core-blueprint')fail(404,'Task not found.');
        if(t.reference.referenceHash!==source.reference.referenceHash||!active(d)||t.intentHash!==d.intentHash)fail(409,'This task no longer matches the current approved action.');
        if(t.owner!==actor.id&&actor.role!=='provider'&&!(command.action==='acknowledge'&&t.reminders.some(r=>r.recipient===actor.id)))fail(403,'Only the task owner or provider may change this work.');
        if(receipt){if(receipt.payloadHash!==digest(command))fail(409,'Command ID was reused.');return {task:metadata(t),replayed:true};}
        if(command.expectedVersion!==t.version)fail(409,'Task changed; refresh.');
        if(d.prerequisites.some(p=>!rows.some(other=>other.reference.referenceHash===source.reference.referenceHash&&other.actionId===p&&other.status==='completed'
          &&source.decisions.some(pd=>pd.actionId===p&&pd.intentHash===other.intentHash&&active(pd)))))fail(409,'Current prerequisite follow-up is incomplete.');
        if(['completed','superseded','cancelled','blocked'].includes(t.status))fail(409,'Task is not open for this transition.');
        const next=structuredClone(t);
        if(command.action==='acknowledge') {
          const reminder=next.reminders.find(r=>r.id===command.reminderId&&r.recipient===actor.id);
          if(!reminder)fail(403,'This reminder is not assigned to you.');
          reminder.acknowledgedAt=reminder.acknowledgedAt||now;reminder.acknowledgedBy=actor.id;
        } else if(command.action==='submit-follow-up') {
          if(!/^result-[a-f0-9]{40}$/.test(command.evidenceReference||''))fail(400,'Reference the returned result reviewed in Health Core.');
          next.evidenceReference=command.evidenceReference;next.status='awaiting-provider-review';
        } else {
          if(t.status!=='awaiting-provider-review'||!d.completionReview||d.completionReview.intentHash!==t.intentHash||d.completionReview.resultId!==t.evidenceReference)fail(409,'The provider must review the exact returned evidence and completion condition first.');
          next.status='completed';next.completedAt=now;next.completionReview=d.completionReview;
        }
        next.version++;next.updatedAt=now;persist(tx,t,next);
        tx.create(receiptRef,{payloadHash:digest(command),taskId:t.taskId,version:next.version});
        return {task:metadata(next),replayed:false};
      });
    },
  };
}
