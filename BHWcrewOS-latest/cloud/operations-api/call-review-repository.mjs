import crypto from 'node:crypto';
import { sanitizePatientRequest } from './workflow-automation.mjs';
const key=v=>crypto.createHash('sha256').update(v).digest('hex');
export class CallReviewRepository {
 constructor(db){this.db=db;this.calls=db.collection('patientCallReviews');this.requests=db.collection('patientRequests');this.communications=db.collection('communications');this.tasks=db.collection('tasks');this.audits=db.collection('auditEvents');}
 async list(bhwPatientId=''){
  const query=bhwPatientId?this.calls.where('bhwPatientId','==',bhwPatientId):this.calls.orderBy('updatedAt','desc');
  const snapshot=await query.limit(100).get();return snapshot.docs.map(d=>d.data()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 }
 async transact(id,update){return this.db.runTransaction(async tx=>{
  const ref=this.calls.doc(id);const snapshot=await tx.get(ref);const current=snapshot.exists?snapshot.data():null;
  const result=update(current);if(result.replayed)return result;const r=result.record;
  const requestRef=this.requests.doc(r.requestId);const existing=await tx.get(requestRef);
  const taskRef=this.tasks.doc(key('patient-request:'+r.requestId));const taskSnapshot=await tx.get(taskRef);
  const oldTask=taskSnapshot.exists?taskSnapshot.data():null;
  if(result.action==='review' && existing.exists && existing.data().statusCategory==='completed')throw Object.assign(new Error('Reopen the linked Patient Request before adding follow-up.'),{status:409});
  // The reserved synthetic identity is the only permitted linkage in this pilot.
  if(r.bhwPatientId){if(r.bhwPatientId!=='BHW0000')throw Object.assign(new Error('Real-patient call review is disabled.'),{status:403});}
  const latest=r.reviews.at(-1);const actor=latest?.reviewedBy||'system:dialpad-call-review';
  let request=existing.exists?existing.data():sanitizePatientRequest({id:r.requestId,bhwPatientId:'BHW0000',source:'dialpad-call-review',sourceReference:r.id,summary:'Phone call awaiting staff identity review',requestType:'general',notificationMode:'none'},{user:{sub:actor},now:new Date(r.updatedAt)});
  if(!existing.exists){request.bhwPatientId='';request.patientMatchStatus='unmatched';}
  if(latest && result.action==='review'){request={...request,bhwPatientId:r.bhwPatientId,patientMatchStatus:'matched',summary:latest.reason,assignedToName:latest.owner,dueAt:latest.dueAt,callNextAction:latest.nextAction};}
  request={...request,callReviewId:r.id,notificationMode:'none',updatedAt:r.updatedAt,updatedBy:result.action==='source'?'system:dialpad-call-review':actor,version:existing.exists?(Number(request.version)||1)+1:1};
  tx.set(ref,r);tx.create(ref.collection('revisions').doc(String(r.revision)),r);
  tx.set(requestRef,request);
  // No provider narrative in compatibility communication records or audit events.
  tx.set(this.communications.doc(r.id),{id:r.id,requestId:r.requestId,patientRequestId:r.requestId,bhwPatientId:r.bhwPatientId,channel:'voice',direction:r.direction,transport:'dialpad',content:latest?'Reviewed phone communication; see protected call review.':'Phone call awaiting staff review.',status:latest?'reviewed':'review-required',providerMessageId:r.callId,callReviewId:r.id,createdAt:r.createdAt,updatedAt:r.updatedAt});
  if(!oldTask || result.action==='review') tx.set(taskRef,{...(oldTask||{}),taskId:'patient-request:'+r.requestId,requestId:r.requestId,patientRequestId:r.requestId,bhwPatientId:r.bhwPatientId,taskStatus:oldTask?.taskStatus||'open',assignedToName:latest?.owner||'',dueAt:latest?.dueAt||'',nextAction:latest?.nextAction||'Verify caller identity and review call',updatedAt:r.updatedAt,createdAt:r.createdAt},{merge:true});
  tx.create(this.audits.doc(key(r.id+':'+r.revision)),{eventType:result.action==='review'?'call-review.revised':'call-review.source-received',resourceId:r.id,bhwPatientId:r.bhwPatientId,revision:r.revision,actor:result.action==='source'?'system:dialpad-call-review':actor,occurredAt:r.updatedAt});
  return result;
 });}
}
