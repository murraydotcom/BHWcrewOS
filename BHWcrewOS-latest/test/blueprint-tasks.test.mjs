import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createBlueprintTaskStore, blueprintTaskConfiguration, digest, validateWork } from '../cloud/operations-api/blueprint-tasks.mjs';
import { createOperationsApp } from '../cloud/operations-api/app.mjs';
import { BlueprintFirestoreDouble } from './helpers/blueprint-firestore.mjs';
const actor={id:'crew:care',role:'care-manager'},provider={id:'crew:provider',role:'provider'},staff=[actor,provider];
const start='2026-10-21T14:00:00.000Z',due='2026-12-02T14:00:00.000Z',later='2026-12-03T14:00:00.000Z';
const reference=version=>{const r={schemaVersion:'bhw.blueprint-reference.v1',authority:'health-core',bhwPatientId:'BHW0000',blueprintId:'SYN-BLUEPRINT',version,state:'patient-shared'};return {...r,referenceHash:digest(r)};};
function fixture(){const db=new BlueprintFirestoreDouble(),store=createBlueprintTaskStore(db);const source={reference:reference(1),decisions:[{actionId:'action-'+'a'.repeat(40),decision:'accepted',intentHash:'b'.repeat(64),owner:actor.id,dueAt:due,timeZone:'America/New_York',priority:'routine',prerequisites:[],unresolved:[],escalationAt:later,escalationOwner:provider.id}]};return {db,store,source};}

test('source client rejects extra clinical reference fields and preserves only completion evidence metadata',()=>{
  const {source}=fixture(),r={...source.reference};delete r.referenceHash;
  for(const key of ['signedContentHash','approvedContentHash','releaseContentHash','projectionContentHash'])r[key]='b'.repeat(64);
  source.reference={...r,referenceHash:digest(r)};
  const d=source.decisions[0];d.decisionRevision=1;d.completionConditionReference=d.actionId;d.completionReview={intentHash:d.intentHash,resultId:'result-'+'c'.repeat(40),resultHash:'d'.repeat(64),reviewedAt:later,clinicalReport:'PRIVATE-CLINICAL'};
  const validated=validateWork({ok:true,...source});assert.doesNotMatch(JSON.stringify(validated),/PRIVATE-CLINICAL/);
  r.clinicalText='PRIVATE-CLINICAL';source.reference={...r,referenceHash:digest(r)};
  assert.throws(()=>validateWork({ok:true,...source}),e=>e.status===502);
});
test('six-week due reminder, acknowledgment and escalation persist across new repository instances without duplicate alerts or clinical closure',async()=>{
  const {db,store,source}=fixture();await store.sync(source,{now:start,staff});let task=(await store.view(source,actor)).tasks[0];assert.equal(task.reminders.length,0);
  await store.sync(source,{now:due,staff});task=(await store.view(source,actor)).tasks[0];assert.equal(task.reminders.length,1);
  const ack={action:'acknowledge',commandId:crypto.randomUUID(),referenceHash:source.reference.referenceHash,taskId:task.taskId,expectedVersion:task.version,reminderId:task.reminders[0].id};
  await store.change(ack,source,actor,{now:due});assert.equal((await store.change(ack,source,actor,{now:due})).replayed,true);
  const restarted=createBlueprintTaskStore(db);await restarted.sync(source,{now:due,staff});task=(await restarted.view(source,actor)).tasks[0];assert.equal(task.reminders.length,1);assert.ok(task.reminders[0].acknowledgedAt);assert.equal(task.status,'open');
  await restarted.sync(source,{now:later,staff});task=(await restarted.view(source,provider,{all:true})).tasks[0];assert.equal(task.reminders.length,2);assert.equal(task.reminders[1].recipient,provider.id);
});
test('owner/timing unresolved do not create tasks; current provider result review gates completion',async()=>{
  const {db,store,source}=fixture();source.decisions[0].unresolved=['owner'];await store.sync(source,{now:start,staff});assert.equal((await store.view(source,actor)).tasks.length,0);
  source.decisions[0].unresolved=[];await store.sync(source,{now:start,staff});let task=(await store.view(source,actor)).tasks[0];
  const command=()=>({commandId:crypto.randomUUID(),referenceHash:source.reference.referenceHash,taskId:task.taskId,expectedVersion:task.version});
  await assert.rejects(()=>store.change({...command(),action:'complete'},source,actor),e=>e.status===409);
  const resultId='result-'+'c'.repeat(40);await store.change({...command(),action:'submit-follow-up',evidenceReference:resultId},source,actor);task=(await store.view(source,actor)).tasks[0];
  await assert.rejects(()=>store.change({...command(),action:'complete'},source,actor),e=>e.status===409);
  source.decisions[0].completionReview={intentHash:task.intentHash,resultId,resultHash:'d'.repeat(64),reviewedAt:later};
  await store.change({...command(),action:'complete'},source,actor);assert.equal((await createBlueprintTaskStore(db).view(source,actor)).tasks[0].status,'completed');
});

test('dependent work stays blocked until the exact current prerequisite is completed, including later provider revisions',async()=>{
  const {store,source}=fixture();const prerequisite=source.decisions[0];
  const dependent={...structuredClone(prerequisite),actionId:'action-'+'f'.repeat(40),intentHash:'1'.repeat(64),prerequisites:[prerequisite.actionId]};source.decisions.push(dependent);
  await store.sync(source,{now:start,staff});let inbox=await store.view(source,actor),first=inbox.tasks.find(t=>t.actionId===prerequisite.actionId),second=inbox.tasks.find(t=>t.actionId===dependent.actionId);
  assert.equal(second.status,'blocked');assert.equal(second.reminders.length,0);
  const command=(t,action,extra={})=>({action,commandId:crypto.randomUUID(),referenceHash:source.reference.referenceHash,taskId:t.taskId,expectedVersion:t.version,...extra});
  await assert.rejects(()=>store.change(command(second,'submit-follow-up',{evidenceReference:'result-'+'c'.repeat(40)}),source,actor),e=>e.status===409);
  const resultId='result-'+'c'.repeat(40);await store.change(command(first,'submit-follow-up',{evidenceReference:resultId}),source,actor);first=(await store.view(source,actor)).tasks.find(t=>t.taskId===first.taskId);
  prerequisite.completionReview={intentHash:first.intentHash,resultId,resultHash:'d'.repeat(64),reviewedAt:due};
  await store.change(command(first,'complete'),source,actor);await store.sync(source,{now:due,staff});second=(await store.view(source,actor)).tasks.find(t=>t.taskId===second.taskId);
  assert.equal(second.status,'open');assert.equal(second.reminders.length,1);
  prerequisite.intentHash='2'.repeat(64);prerequisite.unresolved=['timing'];prerequisite.completionReview=null;
  await store.sync(source,{now:later,staff});second=(await store.view(source,actor)).tasks.find(t=>t.taskId===second.taskId);
  assert.equal(second.status,'blocked');await assert.rejects(()=>store.change(command(second,'complete'),source,actor),e=>e.status===409);
});

test('staff view scopes pending and unresolved work to its owner; provider all view retains the full reconciliation',async()=>{
  const {store,source}=fixture();source.decisions[0].owner=provider.id;
  assert.equal((await store.view(source,actor)).pendingQueue.length,0);assert.equal((await store.view(source,provider,{all:true})).pendingQueue.length,1);
  source.decisions[0].unresolved=['timing'];assert.equal((await store.view(source,actor)).unresolved.length,0);assert.equal((await store.view(source,provider,{all:true})).unresolved.length,1);
});

test('patient projection is exact-reference read-only access and cannot write or select another patient',async()=>{
  const {store,source}=fixture();const env={SYNTHETIC_ONLY:'true',SYNTHETIC_BLUEPRINT_TASKS_ENABLED:'true',BLUEPRINT_TASK_FIRESTORE_DATABASE:'synthetic-blueprint-tasks',BLUEPRINT_TASK_PROJECTION_SECRET:'projection-only',CREWOS_OPERATIONS_TOKEN_SECRET:'separate-staff-trust'};
  const app=createOperationsApp({repository:{},environment:env,now:()=>new Date(start),blueprintTasks:{store,readSource:async()=>source}});
  const token=extra=>{const iat=Math.floor(Date.parse(start)/1000),payload=Buffer.from(JSON.stringify({iss:'health-core',aud:'bhw-blueprint-tasks',scope:'patient-task-read',bhwPatientId:'BHW0000',referenceHash:source.reference.referenceHash,iat,exp:iat+60,...extra})).toString('base64url');return 'Bearer '+payload+'.'+crypto.createHmac('sha256',env.BLUEPRINT_TASK_PROJECTION_SECRET).update(payload).digest('base64url');};
  const call=(suffix='/patient',method='GET',extra={})=>app(new Request('https://ops.synthetic.test/v1/blueprint-tasks'+suffix,{method,headers:{Authorization:token(extra)}}));
  assert.equal((await call()).status,200);assert.equal((await call('/patient','POST')).status,405);
  assert.equal((await call('/commands','POST')).status,401);assert.equal((await call('/patient','GET',{bhwPatientId:'BHW9999'})).status,403);
  assert.equal((await call('/patient','GET',{referenceHash:'e'.repeat(64)})).status,409);
  assert.equal((await call('/patient?patient=BHW9999')).status,400);assert.equal((await call('/patient','GET',{exp:1})).status,403);
});
test('superseded plans and modified/revoked decisions cannot expose or complete stale work, with immutable task history retained',async()=>{
  const {db,store,source}=fixture();await store.sync(source,{now:start,staff});const task=(await store.view(source,actor)).tasks[0];
  source.reference=reference(2);assert.equal((await store.view(source,actor)).tasks.length,0);
  await assert.rejects(()=>store.change({action:'complete',commandId:crypto.randomUUID(),referenceHash:source.reference.referenceHash,taskId:task.taskId,expectedVersion:task.version},source,actor),e=>e.status===409);
  await store.sync(source,{now:start,staff});assert.equal(db.records.get('tasks/'+task.taskId).status,'superseded');assert.ok([...db.records.keys()].some(p=>p.startsWith('tasks/'+task.taskId+'/versions/')));
  source.decisions[0].intentHash='e'.repeat(64);assert.equal((await store.view(source,actor)).tasks.length,0);
});
test('audit failure rolls back tasks and reminder writes atomically',async()=>{
  const {db,store,source}=fixture();db.failAudit=true;await assert.rejects(()=>store.sync(source,{now:due,staff}));assert.equal(db.records.size,0);
});
test('API rejects anonymous, revoked/role-mismatched/expired sessions, real-patient selectors, copied clinical content and default-off access',async()=>{
  const {store,source}=fixture();const env={SYNTHETIC_ONLY:'true',SYNTHETIC_BLUEPRINT_TASKS_ENABLED:'true',BLUEPRINT_TASK_FIRESTORE_DATABASE:'synthetic-blueprint-tasks',CREWOS_OPERATIONS_TOKEN_SECRET:'synthetic-token',BLUEPRINT_TASK_STAFF_GRANTS:JSON.stringify({'crew:care':{active:true,role:'care-manager'}})};
  const token=extra=>{const iat=Math.floor(Date.parse(start)/1000),payload=Buffer.from(JSON.stringify({iss:'bhw-crewhq',aud:'bhw-operations-cloud',staffId:'care',sub:'crew:care',role:'care-manager',iat,exp:iat+60,...extra})).toString('base64url');return 'Bearer '+payload+'.'+crypto.createHmac('sha256',env.CREWOS_OPERATIONS_TOKEN_SECRET).update(payload).digest('base64url');};
  const app=createOperationsApp({repository:{},environment:env,now:()=>new Date(start),blueprintTasks:{store,readSource:async()=>source}});
  const call=(path='/v1/blueprint-tasks',auth=token({}),body)=>app(new Request('https://ops.synthetic.test'+path,{method:body?'POST':'GET',headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await call(undefined,'')).status,401);assert.equal((await call(undefined,token({role:'provider'}))).status,403);assert.equal((await call(undefined,token({exp:1}))).status,401);
  assert.equal((await call('/v1/blueprint-tasks?patient=BHW9999')).status,400);
  assert.equal((await call('/v1/blueprint-tasks/commands',token({}),{action:'sync',commandId:crypto.randomUUID(),referenceHash:source.reference.referenceHash,clinicalReport:'denied'})).status,400);
  assert.equal(blueprintTaskConfiguration({}),null);assert.throws(()=>blueprintTaskConfiguration({...env,BLUEPRINT_TASK_FIRESTORE_DATABASE:'bhw-rcm-prod'}),e=>e.status===503);
});
