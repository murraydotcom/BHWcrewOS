import {LEAVE_FIELDS,leaveQuestions,leaveTranscript} from './leave-schema.mjs';
import {certificationFields} from './fmla-certification.mjs';
import {fillFmlaPdf} from './fmla-pdf.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createFmlaStudio({root,session,notes,loadPdfLib}) {
 let patient=null,record=null,records=[],values={},generation=0;
 root.innerHTML=`<h3>FMLA patient intake and certification</h3><p><a href="/bhw-fmla-intake-questionnaire.html" target="_blank" rel="noopener">Open patient HTML intake link</a> <button type="button" id="fmlaCopy" class="btn ghost2 sm">Copy patient link</button></p><p>The patient signs in before answering. For WH-380-F, select the patient receiving care. Intake answers remain patient-reported until you review the evidence.</p><button type="button" id="fmlaLoad" class="btn ghost2 sm">Load selected patient’s submissions</button><select id="fmlaRequests" aria-label="Submitted leave requests"><option value="">No intake selected</option></select><p id="fmlaStatus" role="status">Select an exact Registry patient.</p><label for="fmlaType">Certification type</label><select id="fmlaType"><option>WH-380-E</option><option>WH-380-F</option></select><details><summary>Patient answers and missing details</summary><pre id="fmlaIntake" style="white-space:pre-wrap"></pre><ul id="fmlaMissing"></ul></details><p><label for="fmlaUpload">Add clinical notes (text or text-based PDF)</label><input id="fmlaUpload" type="file" multiple accept=".txt,.pdf,text/plain,application/pdf"></p><p>Uploaded notes are read into the note box for this session. Scanned PDFs need OCR or pasted text. Verify the notes belong to the selected patient before AI review.</p><button type="button" id="fmlaAnalyze" class="btn sm">Summarize notes and identify missing answers</button><div id="fmlaAi" aria-live="polite"></div><details><summary>Review and edit official certification fields</summary><p>Patient/employer details are copied from intake. Clinical fields start blank. Accept evidence-backed AI suggestions individually or enter your assessment. Downloaded PDFs remain drafts; signatures and release permission must be completed separately.</p><div id="fmlaFields" class="grid2"></div></details><p><label><input id="fmlaReviewed" type="checkbox"> I reviewed these draft values against the selected patient’s records.</label></p><p>Draft edits are not saved. Download the reviewed PDF to retain them.</p>`;
 const $=id=>root.querySelector('#'+id), status=text=>{$('fmlaStatus').textContent=text;}, type=()=>$('fmlaType').value;
 function setFields() {
  $('fmlaReviewed').checked=false;
  $('fmlaFields').innerHTML=certificationFields(type()).filter(f=>!/^employeeName[123]$/.test(f[0])).map(([key,label,,,,,, ,kind])=>`<div class="f full"><label for="cert-${key}">${esc(label)}</label>${kind==='checkbox'?`<input id="cert-${key}" type="checkbox" data-cert="${key}" ${values[key]?'checked':''}>`:`<textarea id="cert-${key}" rows="2" maxlength="2000" data-cert="${key}">${esc(values[key]||'')}</textarea>`}</div>`).join('');
  $('fmlaFields').querySelectorAll('[data-cert]').forEach(el=>el.addEventListener('input',()=>{values[el.dataset.cert]=el.type==='checkbox'?el.checked:el.value;$('fmlaReviewed').checked=false;}));
 }
 function clear() {generation++;record=null;records=[];values={};notes.value='';$('fmlaRequests').innerHTML='<option value="">No intake selected</option>';$('fmlaIntake').textContent='';$('fmlaMissing').textContent='';$('fmlaAi').textContent='';$('fmlaUpload').value='';setFields();}
 function chooseRecord(item) {
  record=item;values={};$('fmlaAi').textContent='';generation++;
  if(item){$('fmlaType').value=item.formType;for(const [key,,,,,,,source] of certificationFields(type()))if(source)values[key]=item.answers[source]||'';values.carePatient=item.patientName || patient?.name || '';values.patientName=values.carePatient;}
  $('fmlaIntake').textContent=item?leaveTranscript(item):'No patient intake selected. Manual clinician draft is available.';
  $('fmlaMissing').innerHTML=(item?leaveQuestions(item.answers,item.formType):[]).map(q=>`<li>Ask patient: ${esc(q.question)}</li>`).join('')+'<li>Clinician: verify the serious-condition category, supporting medical facts, dates, medical necessity, and applicable leave estimates. Sign the official form after review.</li>';
  setFields();
 }
 async function load() {
  if(!patient||!session()) {status('Sign in and select an exact Registry patient.');return;}
  const epoch=++generation,id=patient.bhwPatientId || patient.bhwId;
  status('Loading from BHW Cloud…');
  try {
   const response=await fetch(`/.netlify/functions/leave-requests?patient=${encodeURIComponent(id)}`,{cache:'no-store',headers:{Authorization:`Bearer ${session()}`}});
   const body=await response.json();if(!response.ok)throw Error(body.error);
   if(epoch!==generation)return;
   records=(body.requests||[]).filter(item=>item.bhwPatientId===id);
   $('fmlaRequests').innerHTML='<option value="">Choose an intake (or draft manually)</option>'+records.map(item=>`<option value="${esc(item.requestId)}">${esc(item.formType)} · ${esc(new Date(item.submittedAt).toLocaleString())}</option>`).join('');
   status(`${records.length} submission(s) loaded for ${patient.name}.`);
  }catch(error){if(epoch===generation)status(error.message || 'Could not load BHW Cloud.');}
 }
 async function analyze() {
  if(!patient||!session()){status('Sign in and select a Registry patient first.');return;}
  const epoch=generation;const button=$('fmlaAnalyze');button.disabled=true;status('Reading clinical notes and patient answers…');
  try {
   const r=await fetch('/.netlify/functions/fmla-analyze',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session()}`},body:JSON.stringify({patientId:patient.bhwPatientId || patient.bhwId,requestId:record?.requestId,formType:type(),notes:notes.value})});
   const body=await r.json();if(!r.ok)throw Error(body.error);if(epoch!==generation)return;
   $('fmlaAi').innerHTML=`<h4>AI draft summary — review required</h4><p>${esc(body.summary)}</p><ul>${(body.questions||[]).map(q=>`<li>${esc(q.audience)}: ${esc(q.question)}</li>`).join('')}</ul><h4>Suggested values</h4>${body.suggestions.map((s,i)=>`<div class="prefill"><strong>${esc(certificationFields(type()).find(f=>f[0]===s.field)?.[1] || s.field)}</strong><p>${esc(s.value)}</p><small>${esc(s.source)}: ${esc(s.evidence)}</small><p><button type="button" class="btn ghost2 sm" data-suggestion="${i}">Accept after clinical review</button></p></div>`).join('')}`;
   $('fmlaAi').querySelectorAll('[data-suggestion]').forEach(button=>button.addEventListener('click',()=>{const s=body.suggestions[+button.dataset.suggestion];values[s.field]=s.value;setFields();button.disabled=true;button.textContent='Added to draft';}));
   status('AI review ready. No suggested clinical value has been applied automatically.');
  }catch(error){if(epoch===generation)status(error.message);}
  finally {button.disabled=false;}
 }
 $('fmlaLoad').addEventListener('click',load);
 $('fmlaRequests').addEventListener('change',()=>chooseRecord(records.find(r=>r.requestId===$('fmlaRequests').value)||null));
 $('fmlaType').addEventListener('change',()=>{record=null;values={};generation++;$('fmlaRequests').value='';$('fmlaIntake').textContent='';$('fmlaAi').textContent='';$('fmlaMissing').textContent='';setFields();});
 $('fmlaAnalyze').addEventListener('click',analyze);
 $('fmlaCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`${location.origin}/bhw-fmla-intake-questionnaire.html`);status('Patient intake link copied. It contains no patient information.');}catch{status('Open the patient HTML intake link and copy its address.');}});
 $('fmlaUpload').addEventListener('change',async event=>{
  if(!patient||!session()){status('Sign in and select the patient before adding clinical notes.');event.target.value='';return;}
  const epoch=generation;const files=[...event.target.files];
  if(files.length>10||files.some(f=>f.size>10*1024*1024)){status('Use up to 10 files, each under 10 MB.');return;}
  try {
   const texts=[];
   for(const file of files) {
    let text='';
    if(/\.txt$/i.test(file.name))text=await file.text();
    else if(/\.pdf$/i.test(file.name)) {
     const pdfjs=await import('./vendor/pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/assets/vendor/pdfjs/pdf.worker.mjs';
     const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
     if(doc.numPages>100){await doc.loadingTask.destroy();throw Error('Use a PDF with at most 100 pages.');}
     try{for(let p=1;p<=doc.numPages;p++){const page=await doc.getPage(p);const content=await page.getTextContent();text+=content.items.map(i=>i.str).join(' ')+'\n';const annotations=await page.getAnnotations();text+=annotations.filter(a=>a.fieldType==='Tx'&&typeof a.fieldValue==='string'&&a.fieldValue.trim()).map(a=>`${a.fieldName}: ${a.fieldValue}`).join('\n')+'\n';}}finally{await doc.loadingTask.destroy();}
     if(!text.trim())throw Error('A selected PDF contains no extractable text. Use OCR or paste its text.');
    }else throw Error('Use text or PDF notes.');
    texts.push(text);
   }
   if(epoch!==generation)return;
   const combined=[notes.value,...texts].filter(Boolean).join('\n\n--- Uploaded clinical note ---\n\n');
   if(combined.length>60000)throw Error('The combined notes exceed 60,000 characters. Choose the relevant notes or paste an excerpt; nothing was truncated.');
   notes.value=combined;status('Notes loaded into this session. Verify patient identity before AI review.');
  }catch(error){if(epoch===generation)status(error.message);}
 });
 setFields();
 return {
  setPatient(p){clear();patient=p;status(p?`Selected ${p.name}. Load submissions to begin.`:'Select an exact Registry patient.');},
  disconnect(){clear();patient=null;status('Signed out. Select the patient again after signing in.');},
  analyze,
  async fill(){
   if(!$('fmlaReviewed').checked)throw Error('Review the draft values and check the review acknowledgment first.');
   await loadPdfLib();
   const url=`/assets/forms/fmla-wh380${type()==='WH-380-F'?'f':'e'}-2029.pdf`;
   const response=await fetch(url);if(!response.ok)throw Error('Official form unavailable.');
   const final={...values};[1,2,3].forEach(n=>final['employeeName'+n]=final.employeeName || '');
   return fillFmlaPdf(window.PDFLib,await response.arrayBuffer(),type(),final);
  }
 };
}
