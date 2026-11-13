import {createOperationsCloudClient} from './provider/operations-queue.mjs';
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let client,calls=[],selected=new URL(location.href).searchParams.get('call')||'',dirty=false,busy=false,submission=null;
const patient=new URL(location.href).searchParams.get('patient')||'';
$('scope').textContent=patient?'Verified patient history: '+patient:'All calls in the synthetic pilot';
function status(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
function changed(){return !dirty||confirm('Discard the review you have not saved?');}
function date(v){return new Date(v).toLocaleString();}
function render(){
 $('calls').innerHTML=calls.map(c=>`<button class="call" data-call="${esc(c.id)}" aria-current="${selected===c.id}"><strong>${c.identityStatus==='staff-verified'?'BHW0000':'Identity review needed'}</strong><small>${esc(c.direction)} · ${esc(date(c.createdAt))}</small><small>${c.sourceChangedSinceReview?'New source update to review':c.reviews.length?'Staff reviewed':'Awaiting staff review'}</small></button>`).join('')||'<p class="empty">No calls in this view.</p>';
 const call=calls.find(c=>c.id===selected);if(!call){$('workspace').innerHTML='<p>Select a call. The synthetic test button can add a BHW0000 fixture.</p>';return;}
 const last=call.reviews.at(-1)||{};
 const input=(name,label,value=last[name]||'',type='text')=>`<label>${label}<input name="${name}" type="${type}" maxlength="${name==='owner'?120:2000}" value="${esc(value)}" required></label>`;
 const area=(name,label)=>`<label class="full">${label}<textarea name="${name}" maxlength="2000" required>${esc(last[name]||'')}</textarea></label>`;
 $('workspace').innerHTML=`<h2>Review this call</h2><p class="meta">${esc(call.callId)} · Revision ${call.revision} · ${esc(call.direction)}</p><h3>Dialpad source summary</h3><div class="source">${esc(call.sourceSummary||'No AI summary is available yet. Record the actual communication below.')}</div>${call.sourceActionItems.length?'<h3>Source action items</h3><div class="source">'+esc(call.sourceActionItems.join('\n'))+'</div>':''}${call.events.some(e=>e.transcript)?'<h3>Voicemail source</h3><div class="source">'+esc(call.events.filter(e=>e.transcript).map(e=>e.transcript).join('\n'))+'</div>':''}<p class="meta">The source is retained separately from your review. Later updates do not replace a reviewed note.</p><form id="review"><div class="grid">${input('bhwPatientId','Patient ID','BHW0000')}${input('callerRelationship','Caller and relationship')}${area('reason','Reason and relevant facts')}${area('actionTaken','Action taken or information communicated')}${area('outcome','Outcome or unresolved need')}${input('owner','Next action owner')}${input('dueAt','Next action due','','datetime-local')}${area('nextAction','Next action or commitment')}</div><label class="check"><input name="identityVerified" type="checkbox" required>I confirm this is the BHW0000 synthetic patient and I reviewed the communication.</label><div class="actions"><button class="primary" type="submit">Save reviewed communication</button><a href="/bhw-requests.html?request=${encodeURIComponent(call.requestId)}">Open linked Patient Request</a></div><p id="saveStatus" role="status"></p></form><div class="history"><h3>Prior staff reviews</h3>${call.reviews.map(r=>`<p><b>${esc(r.reviewerName||r.reviewedBy)}</b> · ${esc(date(r.reviewedAt))}<br>${esc(r.reason)}<br>Next: ${esc(r.nextAction)} · ${esc(r.owner)} · ${esc(date(r.dueAt))}<br><small>Clinical record: ${esc(r.clinicalRecordStatus)}</small></p>`).join('')||'<p class="empty">No staff review saved.</p>'}</div>`;
 $('review').addEventListener('input',()=>{dirty=true;submission=null;});
 $('review').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const button=e.submitter;button.disabled=true;
  try{const data=Object.fromEntries(new FormData(e.currentTarget));data.identityVerified=data.identityVerified==='on';data.dueAt=new Date(data.dueAt).toISOString();
   if(!submission)submission={...data,expectedRevision:call.revision,commandId:crypto.randomUUID()};
   const saved=await client.reviewCall(call.id,submission);
   // Verify the committed revision through a separate protected read before claiming success.
   const rows=await client.listCallReviews(patient);const readback=rows.find(r=>r.id===call.id);
   if(!readback||readback.revision<saved.record.revision||!readback.commands.some(c=>c.id===submission.commandId))throw Error('Save response received, but read-back is unconfirmed. Refresh to verify; retry uses the same submission reference.');
   calls=rows;dirty=false;submission=null;render();status('Saved and verified. The linked request and patient communication history use this same record.');
  }catch(error){const target=$('saveStatus');target.textContent=error.message;target.className='error';}finally{busy=false;button.disabled=false;}
 };
}
async function load(){if(busy||!changed())return;try{status('Loading protected call reviews…');calls=await client.listCallReviews(patient);selected=calls.some(c=>c.id===selected)?selected:(calls[0]?.id||'');dirty=false;submission=null;render();status('Connected to BHW Cloud. Synthetic call-review pilot.');}catch(e){status(e.message,true);}}
$('calls').onclick=e=>{const b=e.target.closest('[data-call]');if(b&&!busy&&changed()){selected=b.dataset.call;dirty=false;submission=null;render();}};
$('refresh').onclick=load;
$('fixture').onclick=async()=>{if(busy||!changed())return;busy=true;$('fixture').disabled=true;try{await client.createSyntheticCallReview();dirty=false;}catch(e){status(e.message,true);return;}finally{busy=false;$('fixture').disabled=false;}await load();};
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
try{client=await createOperationsCloudClient();if(!client)throw Error('The BHW Cloud connection is not configured. Sign in through CrewHQ and confirm the pilot configuration.');await load();}catch(e){status(e.message,true);$('fixture').disabled=true;}
