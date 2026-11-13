import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallReviewService,normalizeCallReviewEvent,applyCallSource,applyStaffCallReview} from '../cloud/operations-api/call-review.mjs';
import {CallReviewRepository} from '../cloud/operations-api/call-review-repository.mjs';
const NOW=new Date('2026-11-12T18:00:00Z');
const staff={id:'crew:synthetic-ops',name:'Synthetic Operator',role:'operations-manager'};
const base={call_id:'bhw-synthetic-call-0001',state:'hangup',direction:'inbound',external_number:'+15555550199',date_connected:1794502800000,event_timestamp:1794502860000,custom_data:JSON.stringify({synthetic:true,bhwPatientId:'BHW0000'})};
const review={commandId:'synthetic-review-command-0001',expectedRevision:1,bhwPatientId:'BHW0000',identityVerified:true,callerRelationship:'Synthetic patient',reason:'Synthetic lab review request',actionTaken:'Offered follow-up options',outcome:'Awaiting appointment',owner:'Synthetic Front Desk',nextAction:'Arrange lab-review appointment',dueAt:'2026-11-13T18:00:00Z'};
// A transactional test double checks read-before-write and create-only revisions.
class FakeDb {
 constructor(){this.data=new Map();this.chain=Promise.resolve();}
 collection(path){const db=this;return {doc(id){const key=path+'/'+id;return {key,collection(child){return db.collection(key+'/'+child);}};},where(field,op,value){return {limit(){return {async get(){return {docs:[...db.data].filter(([k,v])=>k.startsWith(path+'/')&&k.split('/').length===2&&v[field]===value).map(([k,v])=>({data:()=>structuredClone(v)}))};}};}};},orderBy(){return {limit(){return {async get(){return {docs:[...db.data].filter(([k])=>k.startsWith(path+'/')&&k.split('/').length===2).map(([k,v])=>({data:()=>structuredClone(v)}))};}};}};}};}
 async runTransaction(fn){const run=this.chain.then(async()=>{const writes=[];const tx={get:async ref=>{assert.equal(writes.length,0,'reads must precede writes');const v=this.data.get(ref.key);return {exists:!!v,data:()=>structuredClone(v)};},set:(ref,value,options)=>writes.push([ref.key,structuredClone(value),false,options]),create:(ref,value)=>writes.push([ref.key,structuredClone(value),true])};const result=await fn(tx);for(const[k,v,create]of writes)if(create&&this.data.has(k))throw Error('duplicate immutable revision');for(const[k,v,create,options]of writes)this.data.set(k,options?.merge?{...this.data.get(k),...v}:v);return result;});this.chain=run.catch(()=>{});return run;}
}
function setup(env={DIALPAD_CALL_REVIEW_ENABLED:'true'}){const db=new FakeDb();const store=new CallReviewRepository(db);return {db,store,service:createCallReviewService(store,{environment:env,clock:()=>NOW})};}
test('connected calls without AI and outbound recaps are voice events',()=>{
 for(const direction of ['inbound','outbound']){const e=normalizeCallReviewEvent({...base,direction},NOW);assert.equal(e.direction,direction);assert.equal(e.synthetic,true);assert.equal(e.externalNumber,base.external_number);assert.equal(e.connected,true);}
 assert.equal(normalizeCallReviewEvent({...base,call_id:undefined,text:'not a call'},NOW),null);
});
test('disabled gate and real call payloads fail closed without writing',async()=>{
 let {service,db}=setup({});await assert.rejects(service.ingest(base),{status:503});assert.equal(db.data.size,0);
 ({service,db}=setup());for(const change of [{custom_data:''},{external_number:'+14105550123'},{call_id:123456}])await assert.rejects(service.ingest({...base,...change}),{status:403});assert.equal(db.data.size,0);
});
test('call lifecycle creates one linked request/task/voice record and preserves later recap',async()=>{
 const {service,db}=setup();const first=await service.ingest(base);const id=first.record.id;
 assert.equal(first.record.identityStatus,'unverified');assert.equal(first.record.bhwPatientId,'');
 let request=db.data.get('patientRequests/'+first.record.requestId);assert.equal(request.notificationMode,'none');assert.equal(request.bhwPatientId,'');assert.equal(request.patientMatchStatus,'unmatched');
 const duplicate=await service.ingest(base);assert.equal(duplicate.replayed,true);
 await Promise.all([service.ingest({...base,state:'recap_summary',recap_summary:'Synthetic source summary',event_timestamp:1794502960000}),service.ingest({...base,state:'recap_action_items',recap_action_items:['Synthetic appointment follow-up'],event_timestamp:1794503000000})]);
 const [call]=await service.list(staff);assert.equal(call.revision,3);assert.equal(call.sourceSummary,'Synthetic source summary');assert.deepEqual(call.sourceActionItems,['Synthetic appointment follow-up']);
 assert.equal([...db.data.keys()].filter(k=>k.startsWith('patientRequests/')).length,1);assert.equal([...db.data.keys()].filter(k=>k.startsWith('tasks/')).length,1);
 assert.equal(db.data.get('communications/'+id).channel,'voice');assert.equal(call.reviews.length,0);
});
test('identity attestation and current revision are required; review links BHW0000 and is replay safe',async()=>{
 const {service,db}=setup();const {record}=await service.ingest(base);
 await assert.rejects(service.review(record.id,{...review,identityVerified:false},staff),{status:400});
 await assert.rejects(service.review(record.id,{...review,bhwPatientId:'BHW1234'},staff),{status:400});
 await assert.rejects(service.review(record.id,{...review,expectedRevision:8},staff),{status:409});
 const saved=await service.review(record.id,review,staff);assert.equal(saved.record.identityStatus,'staff-verified');assert.equal(saved.record.reviews[0].clinicalRecordStatus,'not-entered');
 assert.equal((await service.list(staff,'BHW0000')).length,1);
 const request=db.data.get('patientRequests/'+record.requestId);assert.equal(request.bhwPatientId,'BHW0000');assert.equal(request.summary,review.reason);assert.equal(request.callNextAction,review.nextAction);assert.equal(request.dueAt,new Date(review.dueAt).toISOString());
 assert.equal((await service.review(record.id,review,staff)).replayed,true);
 await assert.rejects(service.review(record.id,{...review,reason:'Changed'},staff),{status:409});
 const list=await service.list(staff);assert.equal(list[0].revision,2);
});
test('late source does not overwrite staff review or change completed workflow ownership',async()=>{
 const {service,db}=setup();const {record}=await service.ingest(base);const saved=await service.review(record.id,review,staff);
 const requestKey='patientRequests/'+record.requestId;db.data.get(requestKey).assignedToName='Different assigned teammate';db.data.get(requestKey).statusCategory='completed';
 const taskKey=[...db.data.keys()].find(k=>k.startsWith('tasks/'));db.data.get(taskKey).taskStatus='done';
 const next=await service.ingest({...base,state:'recap_summary',event_timestamp:1794503000000,recap_summary:'Late synthetic recap'});
 assert.equal(next.record.sourceChangedSinceReview,true);assert.deepEqual(next.record.reviews,saved.record.reviews);
 assert.equal(db.data.get(taskKey).taskStatus,'done');assert.equal(db.data.get(requestKey).assignedToName,'Different assigned teammate');
 await assert.rejects(service.review(record.id,{...review,commandId:'synthetic-second-review-0001',expectedRevision:3},staff),{status:409});
});
test('permissions, malformed times and absent patient identity never bypass review',async()=>{
 const {service,db}=setup();const {record}=await service.ingest(base);
 for(const role of ['rcm','patient','unknown']){await assert.rejects(service.list({id:'blocked',role}),{status:403});await assert.rejects(service.review(record.id,review,{id:'blocked',role}),{status:403});}
 await assert.rejects(service.list(staff,'BHW1234'),{status:403});
 await assert.rejects(service.review(record.id,{...review,dueAt:'bad-date'},staff),{status:400});
 await assert.rejects(service.review(record.id,{...review,dueAt:'2026-01-01'},staff),{status:400});
 assert.equal(db.data.get('patientCallReviews/'+record.id).reviews.length,0);
});
test('out-of-order summary events retain the latest event source',()=>{
 let e=normalizeCallReviewEvent({...base,state:'recap_summary',recap_summary:'Newer',event_timestamp:1794503000000},NOW);
 let r=applyCallSource(null,e,NOW.toISOString()).record;
 e=normalizeCallReviewEvent({...base,state:'recap_summary',recap_summary:'Older',event_timestamp:1794502900000},NOW);
 r=applyCallSource(r,e,NOW.toISOString()).record;assert.equal(r.sourceSummary,'Newer');
 assert.equal(r.events.length,2);
});
test('a non-synthetic stored record cannot be reviewed even with the pilot identity',()=>{
 const e=normalizeCallReviewEvent(base,NOW);const r=applyCallSource(null,e,NOW.toISOString()).record;r.synthetic=false;
 assert.throws(()=>applyStaffCallReview(r,review,staff,NOW.toISOString()),{status:403});
});

test('signed webhook to staff review has an atomic request and protected read-back',async()=>{
 const crypto=await import('node:crypto');const {createOperationsApp}=await import('../cloud/operations-api/app.mjs');
 const {createDialpadService}=await import('../cloud/operations-api/dialpad-service.mjs');const {createWorkflowService}=await import('../cloud/operations-api/workflow-service.mjs');
 const {service,db}=setup();const secret='synthetic-webhook-secret';const staffSecret='synthetic-staff-secret';
 const dialpad=createDialpadService({DIALPAD_WEBHOOK_SECRET:secret});const workflow=createWorkflowService({}, {dialpad,callReviews:service,environment:{},clock:()=>NOW});
 const app=createOperationsApp({repository:{},workflow,callReviews:service,environment:{CREWOS_OPERATIONS_TOKEN_SECRET:staffSecret},now:()=>NOW});
 const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify(base)).toString('base64url');const signed=h+'.'+p+'.'+crypto.createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
 let response=await app(new Request('https://synthetic.example/v1/webhooks/dialpad',{method:'POST',body:signed}));assert.equal(response.status,200);const receipt=await response.json();assert.ok(receipt.callReviewId);
 response=await app(new Request('https://synthetic.example/v1/webhooks/dialpad',{method:'POST',body:signed+'bad'}));assert.equal(response.status,401);
 const seconds=Math.floor(NOW.getTime()/1000);const claims=Buffer.from(JSON.stringify({sub:staff.id,staffId:'synthetic-ops',role:staff.role,name:staff.name,iss:'bhw-crewhq',aud:'bhw-operations-cloud',iat:seconds-5,exp:seconds+300})).toString('base64url');const authorization='Bearer '+claims+'.'+crypto.createHmac('sha256',staffSecret).update(claims).digest('base64url');
 response=await app(new Request('https://synthetic.example/v1/call-reviews'));assert.equal(response.status,401);
 response=await app(new Request('https://synthetic.example/v1/call-reviews/'+receipt.callReviewId+'/review',{method:'POST',headers:{authorization,'Content-Type':'application/json'},body:JSON.stringify(review)}));assert.equal(response.status,200);
 response=await app(new Request('https://synthetic.example/v1/call-reviews?bhwPatientId=BHW0000',{headers:{authorization}}));assert.equal(response.status,200);const readback=await response.json();assert.equal(readback.calls.length,1);assert.equal(readback.calls[0].reviews[0].nextAction,review.nextAction);
 assert.equal(db.data.get('patientRequests/'+readback.calls[0].requestId).notificationMode,'none');
});
