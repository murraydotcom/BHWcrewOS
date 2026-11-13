import crypto from 'node:crypto';
import { normalizePhone } from './dialpad-service.mjs';
import { normalizeStaffRole } from './workflow-automation.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const roles=new Set(['front-desk','operations-manager','executive','care-manager','provider','crnp','physician','pmhnp']);
const states=new Set(['hangup','missed','voicemail','voicemail_uploaded','transcription','recap_summary','recap_action_items']);
const iso=(value,fallback)=>{const n=typeof value==='string'&&/^\d{13}$/.test(value)?Number(value):value;const d=new Date(n??fallback);return Number.isFinite(d.getTime())?d.toISOString():fail(400,'Invalid call event time.');};
export function callReviewEnabled(env){return env.DIALPAD_CALL_REVIEW_ENABLED==='true';}
export function requireCallReviewStaff(actor){if(!actor?.id||!roles.has(normalizeStaffRole(actor.role)))fail(403,'Call review access denied.');}
export function normalizeCallReviewEvent(payload,now=new Date()){
 if(!payload||!payload.call_id||!states.has(payload.state))return null;
 const callId=clean(payload.call_id,160);if(!/^[a-z0-9:_-]+$/i.test(callId))fail(400,'Invalid call reference.');
 if(!['inbound','outbound'].includes(payload.direction))fail(400,'Invalid call direction.');
 const rawItems=payload.recap_action_items??payload.action_items??[];
 const actionItems=(Array.isArray(rawItems)?rawItems:[]).slice(0,20).map(v=>clean(typeof v==='string'?v:v?.text||v?.content,500)).filter(Boolean);
 const summary=clean(typeof payload.recap_summary==='string'?payload.recap_summary:payload.recap_summary?.summary);
 const transcript=payload.state==='transcription'?clean(payload.transcription_text):'';
 const occurredAt=iso(payload.event_timestamp??payload.date_ended??payload.date_started,now);
 const externalNumber=normalizePhone(payload.external_number||payload.contact?.phone||payload.contact?.phone_number);
 const connected=Boolean(payload.date_connected)||Number(payload.duration)>0||payload.was_connected===true;
 let synthetic=false;try{const data=typeof payload.custom_data==='string'?JSON.parse(payload.custom_data):{};synthetic=data.synthetic===true&&data.bhwPatientId==='BHW0000'&&callId.startsWith('bhw-synthetic-')&&externalNumber==='+15555550199';}catch{}
 return {callId,id:'call-'+hash(callId).slice(0,40),eventId:'event-'+hash([callId,payload.state,occurredAt,summary,actionItems,transcript]).slice(0,40),state:payload.state,direction:payload.direction,externalNumber,occurredAt,connected,summary,actionItems,transcript,synthetic};
}
export function applyCallSource(current,event,now=new Date().toISOString()){
 if(current?.events.some(e=>e.eventId===event.eventId))return {record:current,replayed:true};
 if(current&&current.callId!==event.callId)fail(409,'Call reference changed.');
 if(current?.events.length>=100)fail(409,'Call event limit reached; manual review required.');
 const record=current?structuredClone(current):{id:event.id,callId:event.callId,requestId:'dp-'+event.id,channel:'voice',direction:event.direction,bhwPatientId:'',identityStatus:'unverified',revision:0,events:[],reviews:[],commands:[],createdAt:now};
 record.events.push(event);record.events.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.eventId.localeCompare(b.eventId));
 record.sourceSummary=[...record.events].reverse().find(e=>e.summary)?.summary||'';
 record.sourceActionItems=[...new Set(record.events.flatMap(e=>e.actionItems))];
 record.sourceFingerprint=hash(record.events.map(e=>e.eventId));
 record.sourceChangedSinceReview=Boolean(record.reviews.length&&record.reviews.at(-1).sourceFingerprint!==record.sourceFingerprint);
 record.revision++;record.updatedAt=now;record.synthetic=event.synthetic;
 if(Buffer.byteLength(JSON.stringify(record))>500000)fail(409,'Call record limit reached; manual review required.');
 return {record,replayed:false,action:"source"};
}
export function applyStaffCallReview(current,input,actor,now=new Date().toISOString()){
 requireCallReviewStaff(actor);if(!current)fail(404,'Call review not found.');
 if(current.synthetic!==true)fail(403,'Real-patient call review is disabled.');
 const commandId=clean(input.commandId,100);if(!/^[a-z0-9_-]{16,100}$/i.test(commandId))fail(400,'A stable submission reference is required.');
 const fingerprint=hash(input);const prior=current.commands.find(x=>x.id===commandId);
 if(prior){if(prior.fingerprint!==fingerprint)fail(409,'Submission reference was reused with different content.');return {record:current,replayed:true};}
 if(input.expectedRevision!==current.revision)fail(409,'Call changed. Reload before saving.');
 if(input.identityVerified!==true||input.bhwPatientId!=='BHW0000')fail(400,'Confirm the BHW0000 identity for this synthetic pilot.');
 const text={};for(const key of ['callerRelationship','reason','actionTaken','outcome','owner','nextAction']){text[key]=clean(input[key],key==='owner'?120:2000);if(!text[key])fail(400,`${key} is required.`);}
 const dueAt=iso(input.dueAt,null);if(new Date(dueAt)<=new Date(now))fail(400,'Choose a future follow-up due point.');
 if(current.reviews.length>=50)fail(409,'Review limit reached.');
 const record=structuredClone(current);record.bhwPatientId='BHW0000';record.identityStatus='staff-verified';
 record.reviews.push({...text,dueAt,sourceFingerprint:current.sourceFingerprint,reviewedBy:actor.id,reviewerName:clean(actor.name,120),reviewedAt:now,reviewedRevision:current.revision,clinicalRecordStatus:'not-entered',attestation:'staff-reviewed-communication'});
 record.commands.push({id:commandId,fingerprint});record.sourceChangedSinceReview=false;record.revision++;record.updatedAt=now;
 if(Buffer.byteLength(JSON.stringify(record))>500000)fail(409,'Call record limit reached; manual review required.');
 return {record,replayed:false,action:"review"};
}
export function createCallReviewService(store,{environment={},clock=()=>new Date()}={}){
 const requireEnabled=()=>{if(!callReviewEnabled(environment))fail(503,'Call documentation pilot is disabled.');};
 return {
  enabled:callReviewEnabled(environment),
  async ingest(payload){requireEnabled();const event=normalizeCallReviewEvent(payload,clock());if(!event)return null;
   // This first pilot deliberately has no real-patient activation switch.
   if(!event.synthetic)fail(403,'Only explicit BHW0000 synthetic call fixtures are accepted.');
   return store.transact(event.id,current=>applyCallSource(current,event,clock().toISOString()));},
  async list(actor,bhwPatientId=''){requireEnabled();requireCallReviewStaff(actor);if(bhwPatientId&&bhwPatientId!=='BHW0000')fail(403,'Only BHW0000 is available in this pilot.');return store.list(bhwPatientId);},
  async review(id,input,actor){requireEnabled();requireCallReviewStaff(actor);if(!/^call-[a-f0-9]{40}$/.test(id))fail(400,'Invalid call reference.');return store.transact(id,current=>applyStaffCallReview(current,input,actor,clock().toISOString()));},
  async fixture(actor){requireEnabled();requireCallReviewStaff(actor);return this.ingest({call_id:'bhw-synthetic-review-0001',state:'hangup',direction:'inbound',external_number:'+15555550199',date_connected:1794502800000,event_timestamp:1794502860000,custom_data:JSON.stringify({synthetic:true,bhwPatientId:'BHW0000'})});}
 };
}
