import {CATALOG,FORM_TYPES,SOURCES,REVIEWED_ON,blankDraft,prefilledDraft,chartOrders,ageOn,today,guidance,peakFlow,validateDraft} from './maryland-medication-core.mjs';
import {fillMarylandPdf} from './maryland-medication-pdf.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const asText=v=>typeof v==='string'?v:JSON.stringify(v||'');
const TRIGGERS=['Colds','URI','Seasonal Allergies','Pollen','Exercise','Animals','Dust','Smoke','Food','Weather'];
export function createMarylandStudio({root,session,loadPdfLib}){
 let patient=null,type='asthma',d=blankDraft(),epoch=0,dirty=false;
 let savedDrafts={};
 const $=id=>root.querySelector('#md'+id);
 const field=(key,label,kind='text')=>`<label>${esc(label)}<input data-field="${key}" type="${kind}" value="${esc(d[key])}" ${kind==='number'?'step="any" min="0"':''}></label>`;
 const area=(key,label)=>`<label>${esc(label)}<textarea data-field="${key}">${esc(d[key])}</textarea></label>`;
 const select=(key,label,options)=>`<label>${label}<select data-field="${key}"><option value="">Choose</option>${options.map(([v,t])=>`<option value="${v}" ${d[key]===v?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
 const changed=()=>{d.reviewed=false;d.clinicalReview=false;epoch++;dirty=true;if($('Reviewed'))$('Reviewed').checked=false;if($('Clinical'))$('Clinical').checked=false;};
 function status(message){$('Status').textContent=message;}
 function render(){
  root.innerHTML=`<h3>Maryland asthma &amp; medication authorization</h3><p class="hint">${esc(FORM_TYPES[type].label)}. Unsigned draft in this browser session; not saved to BHW Cloud. Complete parent and staff sections on the official PDF.</p>
  <p><a href="/assets/forms/${FORM_TYPES[type].stem}.pdf" target="_blank" rel="noopener">View original state form</a> · <a href="${SOURCES.asthma}" target="_blank" rel="noopener">Maryland form directory</a></p>
  <p id="mdIdentity">${patient?`${esc(patient.name)} · DOB ${esc(patient.dob||'missing')} · ${esc(patient.bhwPatientId||patient.bhwId)}`:'Connect and select an exact Registry patient above.'}</p>
  <fieldset ${!patient?'disabled':''} style="border:0;padding:0;min-width:0">
  ${type!=='asthma'?`<label>Setting<select id="mdSetting"><option value="medication" ${type==='medication'?'selected':''}>Child care - OCC 1216</option><option value="school" ${type==='school'?'selected':''}>School - Maryland state form</option></select></label>`:''}
  <details><summary>Registry medication history and allergies</summary><p>Snapshot: ${esc(patient?.snapshot||'date unavailable; verify against current chart')}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(asText(patient?.meds)||'Medication list unavailable')}</pre><p>${esc(asText(patient?.allergies)||'Allergies unavailable - reconcile before export')}</p></details>
  <div class="grid2">${field('start','Authorization starts','date')}${field('end','Authorization ends (maximum one year)','date')}${field('weightKg','Confirmed weight (kg)','number')}${field('weightDate','Weight measured on','date')}</div>
  <p id="mdAge" class="hint"></p>
  ${area('allergies','Reconciled food/drug allergies (explicitly document none when confirmed)')}
  ${select('allergyStatus','Food or drug allergies present?',[['yes','Yes - details reviewed above'],['no','No - absence verified']])}
  ${type==='school'?`<div class="grid2">${field('school','School')}${field('schoolYear','School year')}${field('grade','Grade')}</div>`:''}
  <div class="grid2">${select('selfCarry','Prescriber self-carry decision',[['yes','Yes - competency verified'],['no','No'],['na','Not applicable']])}${select('selfAdmin','Prescriber self-administration decision',[['yes','Yes - competency verified'],['no','No'],['na','Not applicable']])}</div>
  <p class="hint">School/child-care approval and guardian authorization must still be completed. A selection here is not a signature.</p>
  ${type==='asthma'?`<div class="grid2">${select('severity','Documented asthma severity',['Mild Intermittent','Mild Persistent','Moderate Persistent','Severe Persistent','Exercise Induced'].map(s=>[s,s]))}${field('best','Documented personal-best peak flow (L/min), if known','number')}</div>
  <p id="mdPeak" class="hint"></p><fieldset><legend>Documented triggers</legend>${TRIGGERS.map(t=>`<label style="display:inline-block;margin-right:12px"><input type="checkbox" data-trigger="${t}" ${d.triggers.includes(t)?'checked':''}> ${t}</label>`).join('')}</fieldset>
  <label><input id="mdTriggersReviewed" type="checkbox" ${d.triggerReview?'checked':''}> Triggers reviewed, including whether none are identified.</label>
  ${area('greenPlan','Green zone: documented controller strategy and daily instructions')}
  <p class="hint">Choose treatment from the documented clinical assessment. Age alone does not establish severity or an asthma treatment step. Review inhaled corticosteroid coverage; albuterol does not replace a controller. SMART/MART needs a specific ICS-formoterol prescription, device, maintenance dose and total daily limit including home doses.</p>
  <label><input id="mdControllerReviewed" type="checkbox" ${d.controllerReview?'checked':''}> Controller strategy and the patient’s current regimen reviewed.</label>
  ${area('yellowPlan','Yellow zone: symptoms, response check, repeat limits and when to obtain care')}${area('redPlan','Red zone: emergency response and individualized medication/repeat instructions')}
  <button id="mdPlan" type="button" class="btn ghost2 sm">Add standard escalation draft to empty fields</button>`:''}
  ${select('priorTherapy','Prior therapy (required for budesonide suspension)',[['bronchodilator','Bronchodilator alone'],['ics','Inhaled corticosteroid'],['oral-steroid','Oral corticosteroid']])}
  <h4>Medication orders</h4><p class="hint">Select the exact formulation, then select a dose option that matches the current prescription. Other drugs and individualized regimens require a documented dose reference. All home and school doses count toward daily limits.</p>
  <label>Prefill a documented chart medication<select id="mdChart"><option value="">Choose a chart entry (review required)</option>${chartOrders(patient?.meds).map((m,i)=>`<option value="${i}">${esc(m.name)}</option>`).join('')}</select></label>
  <p class="hint">Chart entries retain their documented text. Choose a supported product and dose option to run the automatic checks, or independently verify the chart prescription. Severity, when prefilled, comes from a specific chart ICD-10 code and must be reassessed for this plan.</p>
  <div id="mdRows"></div><button id="mdAdd" type="button" class="btn ghost2 sm">Add medication</button>
  <h4>Prescriber details</h4><div class="grid2">${field('provider','Prescriber name / title')}${field('phone','Prescriber phone')}${field('fax','Prescriber fax')}${field('address','Address')}${field('city','City')}${field('region','State')}${field('zip','ZIP')}</div>
  <label><input id="mdClinical" type="checkbox" ${d.clinicalReview?'checked':''}> I reconciled prescriptions, allergies, interactions, duplicate therapy, kidney/liver considerations, and total home/school doses.</label>
  <label><input id="mdReviewed" type="checkbox" ${d.reviewed?'checked':''}> I reviewed all form values, medication orders, dates and applicable asthma instructions for this patient. Export an unsigned draft for signatures.</label>
  <button id="mdDownload" type="button" class="btn">Download reviewed official draft</button>
  </fieldset><p id="mdStatus" role="status" aria-live="polite"></p>
  <details><summary>Clinical references and dose-rule coverage (checked ${REVIEWED_ON})</summary><p>Automatic options cover the listed albuterol formulations, budesonide suspension and cetirizine solution within their supported age/weight conditions. These checks support clinician review; they do not validate every drug or replace a current prescription. Weight freshness of 90 days is a conservative workflow limit.</p>${Object.entries(SOURCES).map(([k,url])=>`<p><a href="${url}" target="_blank" rel="noopener">${esc(k)}</a></p>`).join('')}</details>`;
  root.querySelectorAll('[data-field]').forEach(el=>el.addEventListener('input',()=>{d[el.dataset.field]=el.value;changed();if(['start','weightKg','weightDate','priorTherapy'].includes(el.dataset.field)){d.rows.forEach(r=>r.confirmed=false);renderRows();}metrics();}));
  root.querySelectorAll('[data-trigger]').forEach(el=>el.addEventListener('change',()=>{d.triggers=[...root.querySelectorAll('[data-trigger]:checked')].map(x=>x.dataset.trigger);d.triggerReview=false;$('TriggersReviewed').checked=false;changed();}));
  for(const [id,key] of [['TriggersReviewed','triggerReview'],['ControllerReviewed','controllerReview']])$(id)?.addEventListener('change',()=>{d[key]=$(id).checked;changed();});
  $('Clinical').addEventListener('change',()=>{d.clinicalReview=$('Clinical').checked;d.reviewed=false;$('Reviewed').checked=false;epoch++;});
  $('Reviewed').addEventListener('change',()=>{d.reviewed=$('Reviewed').checked;epoch++;});
  $('Setting')?.addEventListener('change',()=>{type=$('Setting').value;changed();render();});
  $('Plan')?.addEventListener('click',()=>{if(!d.yellowPlan)d.yellowPlan='Use the ordered reliever for cough, wheeze, chest tightness or shortness of breath. Notify parent/guardian. Seek medical care if symptoms worsen, response is incomplete, or relief does not last until the next permitted dose.';if(!d.redPlan)d.redPlan='Call 911 immediately for severe breathing difficulty, blue lips, trouble speaking/walking, or failure of the reliever. Notify parent/guardian. Give only the separately specified emergency medication order while awaiting EMS; do not delay the emergency call.';changed();render();});
  $('Add').addEventListener('click',()=>{if(type!=='asthma'&&d.rows.length){status('Use a separate general authorization for each medication.');return;}d.rows.push({zone:type==='asthma'?'yellow':'medication',id:'',name:'',dose:'',route:'',frequency:'',reason:'',prn:'',instructions:'',reference:'',confirmed:false});changed();renderRows();});
  $('Chart').addEventListener('change',()=>{if($('Chart').value==='')return;if(type!=='asthma'&&d.rows.length){status('Remove the current draft medication before selecting a different chart entry.');return;}const m=chartOrders(patient?.meds)[+$('Chart').value];if(!m)return;d.rows.push({...m,zone:type==='asthma'?'yellow':'medication',id:'custom',prn:'',instructions:'',reference:`Registry medication snapshot ${patient?.snapshot||'(date unavailable)'} - verify against current prescription.`,confirmed:false});changed();renderRows();});
  $('Download').addEventListener('click',download);renderRows();metrics();
 }
 function metrics(){const age=ageOn(patient?.dob,d.start||today());$('Age').textContent=age===null?'Age unavailable: verify DOB in the Registry.':`Age on ${d.start?'treatment start':'today'}: ${age} years. Dose eligibility is rechecked using the authorization start date.`;if($('Peak')){const v=peakFlow(d.best);$('Peak').textContent=v?`Calculated from documented best: green >= ${v.green}; yellow ${v.yellow}-${v.upper}; red < ${v.red} L/min. Symptoms take priority.`:'No peak-flow thresholds generated without a documented personal best.';}}
 function renderRows(){
  $('Rows').innerHTML=d.rows.map((r,i)=>{const g=guidance(r.id,{dob:patient?.dob,on:d.start,weightKg:d.weightKg,weightDate:d.weightDate,priorTherapy:d.priorTherapy,zone:r.zone});return `<fieldset data-row="${i}" style="margin:12px 0;min-width:0"><legend>Medication ${i+1}</legend>
   ${type==='asthma'?`<label>Zone<select data-rowkey="zone">${['green','exercise','yellow','red'].map(z=>`<option ${r.zone===z?'selected':''}>${z}</option>`).join('')}</select></label>`:''}
   <label>Exact product<select data-rowkey="id"><option value="">Choose medication</option>${CATALOG.map(m=>`<option value="${m.id}" ${r.id===m.id?'selected':''}>${m.label}</option>`).join('')}</select></label>
   ${g.options.length?`<label>Eligible label-supported dose options<select data-dose><option value="">Select the option matching the prescription</option>${g.options.map((o,n)=>`<option value="${n}">${esc(o.dose+'; '+o.frequency)}</option>`).join('')}</select></label>`:''}
   <p class="hint">${esc(g.issues.join(' '))}${g.source?` <a href="${g.source}" target="_blank" rel="noopener">Dose source</a>`:''}</p>
   <div class="grid2">${[['name','Medication and strength'],['dose','Dose (include units and liquid volume)'],['route','Route'],['frequency','Time / frequency'],['reason','Indication'],['prn','PRN symptoms, interval, maximum use and duration / escalation']].map(([key,label])=>`<label>${label}<input type="text" data-rowkey="${key}" value="${esc(r[key])}" ${r.id&&r.id!=='custom'&&['name','dose','route','frequency'].includes(key)?'readonly':''}></label>`).join('')}</div>
   <label>Side effects / special instructions<textarea data-rowkey="instructions">${esc(r.instructions)}</textarea></label>
   ${r.id==='custom'?`<label>Documented prescription / dose reference and individualized rationale<textarea data-rowkey="reference">${esc(r.reference)}</textarea></label><label><input type="checkbox" data-confirm ${r.confirmed?'checked':''}> Prescriber independently verified formulation, dose, age/weight, route, frequency and daily maximum.</label>`:''}
   <button type="button" class="btn ghost2 sm" data-remove>Remove medication</button></fieldset>`;}).join('');
  root.querySelectorAll('[data-row]').forEach(el=>{const i=+el.dataset.row;
   el.querySelectorAll('[data-rowkey]').forEach(input=>input.addEventListener('input',()=>{const r=d.rows[i],key=input.dataset.rowkey;r[key]=input.value;r.confirmed=false;changed();if(['id','zone'].includes(key)){for(const k of ['name','dose','route','frequency','instructions','reference','prn'])r[k]='';renderRows();}}));
   el.querySelector('[data-dose]')?.addEventListener('change',event=>{if(event.target.value==='')return;const r=d.rows[i],g=guidance(r.id,{dob:patient?.dob,on:d.start,weightKg:d.weightKg,weightDate:d.weightDate,priorTherapy:d.priorTherapy,zone:r.zone});const option=g.options[+event.target.value];if(option){Object.assign(r,option);if(!r.reason&&['albuterol','neb','budesonide'].includes(r.id)&&type==='asthma')r.reason='Asthma';changed();renderRows();}});
   el.querySelector('[data-confirm]')?.addEventListener('change',e=>{d.rows[i].confirmed=e.target.checked;changed();});
   el.querySelector('[data-remove]').addEventListener('click',()=>{d.rows.splice(i,1);changed();renderRows();});
  });
 }
 async function download(){
  if(!session()||!patient){status('Connect and select a Registry patient.');return;}
  const errors=validateDraft(d,patient,type);if(errors.length){status(errors.join(' '));return;}
  const current=epoch,token=session(),selected=structuredClone(patient),draft=structuredClone(d),selectedType=type;
  $('Download').disabled=true;status('Verifying session and preparing the reviewed draft...');
  try{
   const check=await fetch('/.netlify/functions/patients',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'list'}),cache:'no-store'});
   if(current!==epoch||session()!==token)throw Error('Draft or patient changed during verification. Review again before downloading.');
   if(check.status===401||check.status===403){patient=null;d=blankDraft();epoch++;render();throw Error('Session expired. Reconnect and select the patient again.');}
   const body=await check.json();if(!check.ok)throw Error('Could not verify the Registry. Reconnect and retry.');
   const fresh=body.patients?.find(p=>(p.bhwPatientId||p.bhwId)===(selected.bhwPatientId||selected.bhwId));
   if(!fresh||fresh.selectable===false||fresh.dob!==selected.dob||fresh.name!==selected.name||fresh.snapshot!==selected.snapshot||asText(fresh.icds)!==asText(selected.icds)||asText(fresh.meds)!==asText(selected.meds)||asText(fresh.allergies)!==asText(selected.allergies))throw Error('Registry identity or clinical snapshot changed. Reselect the patient and review a fresh draft.');
   await loadPdfLib();
   const [template,map]=await Promise.all([fetch(`/assets/forms/${FORM_TYPES[selectedType].stem}-template.pdf`),fetch('/assets/maryland-form-widgets.json')]);
   if(!template.ok||!map.ok)throw Error('Official form assets unavailable.');
   const result=await fillMarylandPdf(window.PDFLib,await template.arrayBuffer(),(await map.json())[FORM_TYPES[selectedType].stem],selectedType,draft,selected);
   if(current!==epoch||session()!==token)throw Error('Draft or patient changed during export. Review again before downloading.');
   const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=result.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);dirty=false;status('Reviewed draft downloaded with its required attachment. Complete prescriber, guardian and staff signatures/approvals. Not saved to BHW Cloud.');
  }catch(e){status(e.message||'Could not prepare form.');}finally{$('Download').disabled=false;}
 }
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 render();
 return {setPatient(p){patient=p;d=prefilledDraft(p);savedDrafts={};epoch++;dirty=false;render();},disconnect(){patient=null;d=blankDraft();savedDrafts={};epoch++;dirty=false;render();},setType(next){if((next==='asthma')===(type==='asthma'))return;savedDrafts[type==='asthma'?'asthma':'medication']=d;type=next;d=savedDrafts[next]||prefilledDraft(patient);d.reviewed=false;d.clinicalReview=false;epoch++;render();},review(){status('Use the documented chart history and medication dose options below. Clinical fields require review.');root.scrollIntoView({behavior:'smooth'});}};
}
