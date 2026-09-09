export async function readDisabilityDocument(file){
 if(file.size>10*1024*1024)throw Error('Use a file under 10 MB.');
 if(/\.txt$/i.test(file.name))return {name:file.name,text:await file.text(),bytes:null,pages:0,unreadable:[]};
 if(!/\.pdf$/i.test(file.name))throw Error('Use a PDF or text file. Export Word documents to PDF first.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const pdfjs=await import('./vendor/pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/assets/vendor/pdfjs/pdf.worker.mjs';
 const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false});
 const doc=await task.promise;const pages=[],unreadable=[],textFields=[];
 try{
  if(doc.numPages>100)throw Error('Use a packet of at most 100 pages.');
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n),content=await page.getTextContent(),annotations=await page.getAnnotations();
   const text=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('');
   const fields=annotations.filter(a=>a.fieldType).map(a=>`Form field: ${a.alternativeText||a.fieldName||'unnamed'}${a.fieldValue?`; current value: ${a.fieldValue}`:''}`).join('\n');
   for(const a of annotations)if(a.fieldType==='Tx'&&a.fieldName&&!/sign|initial/i.test(a.fieldName+' '+(a.alternativeText||''))&&!textFields.some(f=>f.name===a.fieldName))textFields.push({name:a.fieldName,label:a.alternativeText||a.fieldName,page:n});
   if(!text.trim()&&!fields.trim())unreadable.push(n);
   pages.push(`[Page ${n}]\n${text}\n${fields}`);
  }
  return {name:file.name,bytes,text:pages.join('\n\n'),pages:doc.numPages,unreadable,textFields};
 }finally{await task.destroy();}
}
export async function disabilityDraft(PDFLib,{packet,patient,program,rows,coverage}){
 const {readiness}=await import('./disability-core.mjs');
 const doc=packet?.bytes?await PDFLib.PDFDocument.load(packet.bytes):await PDFLib.PDFDocument.create();
 const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
 const filled=[],unfilled=[];const used=new Set();
 for(const r of rows.filter(r=>r.fieldName)){
  if(used.has(r.fieldName))throw Error('More than one answer maps to the same PDF field. Choose a separate field or combine the answers.');used.add(r.fieldName);
  if(!r.reviewed||!r.answer?.trim()||!['answered','not-applicable'].includes(r.status)){unfilled.push(r.fieldName+' (answer not reviewed)');continue;}
  if(!packet?.textFields?.some(f=>f.name===r.fieldName)||/sign|initial/i.test(r.fieldName))throw Error('Invalid text field mapping.');
  const field=doc.getForm().getTextField(r.fieldName),value=r.answer.replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-');
  let fits=true;try{if(field.getMaxLength()&&value.length>field.getMaxLength())fits=false;for(const widget of field.acroField.getWidgets()){
   const rect=widget.getRectangle(),width=rect.width-6,height=rect.height-6;
   if(!field.isMultiline()){if(/[\r\n]/.test(value)||height<9||font.widthOfTextAtSize(value,9)>width)fits=false;}
   else {let lines=0;for(const paragraph of value.split('\n')){let line='';lines++;for(const word of paragraph.split(/\s+/)){if(font.widthOfTextAtSize(word,9)>width)fits=false;if(font.widthOfTextAtSize(line+' '+word,9)>width){lines++;line='';}line+=(line?' ':'')+word;}}if(lines*12>height)fits=false;}
  }}catch{fits=false;}
  if(!fits){unfilled.push(r.fieldName+' (answer does not fit; see addendum)');continue;}
  field.setText(value);field.setFontSize(9);field.updateAppearances(font);filled.push(r.fieldName);
 }
 const originalPages=doc.getPageCount();
 const report=readiness(rows,coverage);let page,y;
 const plain=s=>String(s??'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\u2022/g,'-');
 function newPage(){page=doc.addPage([612,792]);y=750;page.drawText('BHW - DISABILITY DRAFT - clinician review and signatures required',{x:36,y,font,size:10});y-=24;}
 function line(text,size=10){if(y<45)newPage();page.drawText(text,{x:36,y,font,size});y-=size+5;}
 function paragraph(value){for(const raw of plain(value).split('\n')){let text='';for(const word of raw.split(/\s+/)){if(font.widthOfTextAtSize(word,10)>535){throw Error('An answer contains an unbroken string too wide for PDF. Add spaces or line breaks.');}if(font.widthOfTextAtSize(text+' '+word,10)>535){line(text);text='';}text+=(text?' ':'')+word;}line(text);}y-=5;}
 newPage();
 paragraph(`Patient: ${patient.name} (${patient.bhwPatientId||patient.bhwId})\nProgram: ${program}\nSource packet: ${packet?.name||'Pasted packet'}\nOriginal pages: ${originalPages}. Only explicitly mapped, reviewed text fields are filled. Unmapped fields and checkbox/signature fields require manual completion. Transfer answers into required fields if the recipient does not accept an addendum.\nFilled text fields: ${filled.join(', ')||'none'}\nMapped fields NOT filled: ${unfilled.join(', ')||'none'}\n${report.pending} checklist item(s) still need an answer or review. Original-page coverage: ${coverage?'clinician confirmed':'NOT confirmed'}. This is not a signed certification or eligibility decision.`);
 for(const [i,r] of rows.entries())paragraph(`${i+1}. ${r.question}\nResponse category: ${r.audience==='patient'?'patient-reported history':r.audience==='staff'?'administrative verification':'clinician assessment'}\nSource/location: ${r.origin||'Visit checklist'} ${r.location||''}\n${r.quote?'Packet requirement: '+r.quote+'\n':''}Status: ${r.status}; clinician reviewed: ${r.reviewed?'yes':'no'}\n${r.answer||'[UNANSWERED]'}${r.evidence?'\nSupporting evidence: '+r.evidence:''}`);
 paragraph('Final review: verify identity, all original questions and attachments, factual support, required signatures/dates, and disclosure authorization. Do not submit an unsigned draft.');
 return {bytes:await doc.save(),name:`Disability-draft-${patient.bhwPatientId||patient.bhwId}.pdf`,filled:filled.length,unfilled};
}
