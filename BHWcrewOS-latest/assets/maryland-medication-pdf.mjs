import {FORM_TYPES,displayDate,peakFlow,validateDraft,SOURCES,REVIEWED_ON} from './maryland-medication-core.mjs';
const plain=s=>String(s??'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\u2265/g,'>=').replace(/\u2264/g,'<=');
export function mappedValues(type,d,p,widgets){
 const v={};
 const set=(name,value,page)=>widgets.filter(w=>w.name===name&&(page===undefined||w.page===page)).forEach(w=>v[w.id]=value);
 const id=(n,value)=>v['f'+n]=value;
 const date=(value,names)=>{const parts=displayDate(value).split('/');names.forEach((n,i)=>set(n,parts[i]||''));};
 const med=d.rows[0]||{};
 if(type==='asthma'){
  set('1 CHILDS NAME First Middle Last',p.name);set('CHILDS NAME First Middle Last',p.name);
  date(p.dob,['DATE OF BIRTH (mm)','DATE OF BIRTH (dd)','DATE OF BIRTH (yyyy)']);
  date(d.start,['6 This authorization is NOT TO EXCEED 1 YEAR FROM','This authorization is NOT TO EXCEED 1 YEAR FROM (dd)','This authorization is NOT TO EXCEED 1 YEAR FROM (yyyy)']);
  date(d.end,['TO','This authorization is NOT TO EXCEED 1 YEAR to (dd)','This authorization is NOT TO EXCEED 1 YEAR to (yyyy)']);
  set(d.severity,true,0);d.triggers.forEach(t=>set(t,true,0));
  if(d.selfCarry===d.selfAdmin&&['yes','no'].includes(d.selfCarry))set(d.selfCarry==='yes'?'Yes':'No',true,0);
  const peak=peakFlow(d.best);if(peak){set('If known peak flow greater than',String(peak.green));set('andgffg',String(peak.yellow));set('and',String(peak.upper));set('If known peak flow below',String(peak.red));}
  // IDs follow physical widgets, not the source's duplicated/misleading names.
  const slots={green:[[37,38,39,40,41],[42,43,44,45,46]],exercise:[[53,54,55,56,57]],yellow:[[71,72,73,74,75],[76,77,78,79,80],[81,82,83,84,85]],red:[[97,98,99,100,101],[102,103,104,105,106]]};
  for(const [zone,rows] of Object.entries(slots))d.rows.filter(r=>r.zone===zone).forEach((r,i)=>rows[i]?.forEach((n,j)=>id(n,r[['name','dose','route','frequency','instructions'][j]])));
  // The full clinician-reviewed escalation text is always included in the attachment.
  id(60,true);id(61,'See attached plan');id(88,true);set('undefined_152156','See attached plan');
  // These are the printed action-plan zone definitions, not current symptoms.
  for(const n of [32,33,34,35,62,63,64,65,66,90,91,92,93,59,86,87])id(n,true);
  set('8 PRESCRIBERS NAMETITLE',d.provider);set('TELEPHONE',d.phone);set('FAX',d.fax);set('ADDRESS',d.address);set('CITY',d.city);set('STATE',d.region);set('ZIP CODE',d.zip);
  const log=widgets.filter(w=>w.page===2&&w.type==='Text');
  const name=log.find(w=>/name/i.test(w.name));if(name)v[name.id]=p.name;
  const dob=log.find(w=>/birth/i.test(w.name));if(dob)v[dob.id]=displayDate(p.dob);
 }else if(type==='medication'){
  set("Child's Name:",p.name);set('hilds Name_2',p.name);set('Date of Birth_2',displayDate(p.dob));
  date(p.dob,['Date of Birth','Date of Birth: (dd)','Date of Birth: (yyyy)']);
  date(d.start,['Medications shall be administered from','Medications shall be administered from: (dd)','Medications shall be administered from: (yyyy)']);
  date(d.end,['to','Medications shall be administered to: (dd)','Medications shall be administered to: (yyyy)']);
  for(const [name,key] of [['Medication and StrengthRow1','name'],['DosageRow1','dose'],['RouteMethodRow1','route'],['Time  FrequencyRow1','frequency'],['Reason for MedicationRow1','reason'],['Medication Name','name'],['Dosage','dose'],['Route','route'],['Time to Administer','frequency']])set(name,med[key]);
  set('If PRN for what symptoms how often and how long',med.prn||'Not PRN');set('Possible side effects and special instructions',med.instructions);
  set('No If yes please explain',d.allergies);
  set(d.allergyStatus==='yes'?'Yes':'For School Age children only The child may selfcarry this medication',true);
  // Never infer "no allergies" from absent chart data.
  if(d.selfCarry==='yes')set('Check Box1',true);if(d.selfCarry==='no')set('Check Box2',true);
  if(d.selfAdmin==='yes')set('Check Box4',true);if(d.selfAdmin==='no')set('Check Box5',true);
  set('PRESCRIBERS NAMETITLE',d.provider);set('TELEPHONE',d.phone);set('FAX',d.fax);set('ADDRESS',[d.address,d.city,d.region,d.zip].filter(Boolean).join(', '));
 }else{
  for(const [name,value] of Object.entries({'Name of Student':p.name,'Date of Birth':displayDate(p.dob),'School':d.school,'current school year':d.schoolYear,'Grade':d.grade,'Condition for which medication is being administered':med.reason,'Medication Name':med.name,'Dose':med.dose,'Route':med.route,'Timefrequency of administration':med.frequency,'If PRN frequency':med.prn?'See attached instructions':'Not PRN','If PRN for what symptoms':med.prn||'Not PRN','Specify':med.instructions,'Medication shall be administered from':displayDate(d.start),'Month/Day/Year':displayDate(d.end),'Prescribers NameTitle':d.provider,'Telephone 1':d.phone,'FAX':d.fax,'Address':d.address,'City, State, Zip':[d.city,d.region,d.zip].filter(Boolean).join(', ')}))set(name,value);
 }
 return v;
}
export async function fillMarylandPdf(PDFLib,templateBytes,widgets,type,d,p){
 const errors=validateDraft(d,p,type);if(errors.length)throw Error(errors.join(' '));
 const doc=await PDFLib.PDFDocument.load(templateBytes),form=doc.getForm(),font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
 const values=mappedValues(type,d,p,widgets);let filled=0;
 for(const w of widgets){
  // Signatures, consents and administration logs are completed by their owners.
  if(!(w.id in values))continue;
  const [x,top,right,bottom]=w.rect,width=right-x,height=bottom-top,page=doc.getPage(w.page);
  const rect={x,y:page.getHeight()-bottom,width,height,borderWidth:0,backgroundColor:undefined,borderColor:undefined,font};
  if(w.type==='CheckBox'){const f=form.createCheckBox(w.id);f.addToPage(page,rect);if(values[w.id])f.check();filled++;continue;}
  if(w.type!=='Text')throw Error('Unexpected official field type.');
  let value=plain(values[w.id]);if(!value)continue;
  let size=9;const multiline=height>=16;
  const fits=s=>{try{return multiline?wrap(value,font,s,width-4).length*s*1.15<=height-3:font.widthOfTextAtSize(value,s)<=width-4&&s<=height-2;}catch{throw Error('A value contains characters unsupported by this PDF font. Use plain text.');}};
  while(size>7&&!fits(size))size-=.5;
  if(!fits(size)){value='See attachment';size=7;if(!fits(size))value='See att.';}
  const f=form.createTextField(w.id);if(multiline)f.enableMultiline();f.addToPage(page,rect);f.setFontSize(size);f.setText(value);filled++;
 }
 for(const page of doc.getPages())page.drawText('DRAFT - Review all pages and attached instructions. Prescriber and guardian signatures required.',{x:40,y:page.getHeight()-9,size:6.5,font,color:PDFLib.rgb(.55,.12,.08)});
 let page,y;const newPage=()=>{page=doc.addPage([612,792]);y=755;page.drawText('Maryland authorization - required draft attachment',{x:36,y,size:13,font});y-=23;};newPage();
 const line=text=>{for(const chunk of wrap(plain(text),font,10,540)){if(y<48)newPage();page.drawText(chunk,{x:36,y,size:10,font});y-=14;}y-=5;};
 line(`${p.name} | DOB ${displayDate(p.dob)} | ${p.bhwPatientId||p.bhwId}`);
 line(`${FORM_TYPES[type].label} | ${displayDate(d.start)} to ${displayDate(d.end)}`);
 line(`Prescriber: ${d.provider}; phone ${d.phone}; fax ${d.fax||'not supplied'}`);
 line(`Address: ${[d.address,d.city,d.region,d.zip].filter(Boolean).join(', ')}`);
 line(`Allergies (clinician reconciled): ${d.allergies}`);
 line(`Self-carry: ${d.selfCarry}; self-administration: ${d.selfAdmin}. Separate prescriber, parent and school/child-care approvals remain required.`);
 if(type==='school')line(`School: ${d.school}; school year: ${d.schoolYear}; grade: ${d.grade}`);
 if(d.weightKg)line(`Reviewed weight: ${d.weightKg} kg, measured ${displayDate(d.weightDate)}`);
 if(type==='asthma'){
  line(`Documented severity: ${d.severity}; reviewed triggers: ${d.triggers.join(', ')||'None identified'}`);
  line(`Green zone / controller strategy: ${d.greenPlan}`);
  line(`Yellow zone / escalation: ${d.yellowPlan}`);
  line(`Red zone / emergency: ${d.redPlan}`);
  const peak=peakFlow(d.best);line(peak?`Personal best ${peak.best} L/min. Green >= ${peak.green}; yellow ${peak.yellow}-${peak.upper}; red < ${peak.red} L/min. Symptoms override reassuring peak flow.`:'Peak flow not supplied; use the symptom-based plan.');
 }
 d.rows.forEach((r,i)=>{line(`Medication ${i+1} (${r.zone}): ${r.name}`);line(`Dose: ${r.dose}; route: ${r.route}; time/frequency: ${r.frequency}`);line(`Indication: ${r.reason}; PRN instructions: ${r.prn||'Not PRN'}`);line(`Side effects / special instructions: ${r.instructions}`);line(`Dose review: ${r.id==='custom'?'Individualized prescriber verification - '+r.reference:'Label-supported option reviewed against the current prescription'}`);});
 line(`Chart snapshot: ${p.snapshot||'date unavailable - reconciled by clinician'}. Identity source: protected BHW Registry. Other fields: clinician-entered/reviewed.`);
 line(`Clinical reference check: ${REVIEWED_ON}. This draft does not establish a new prescription or record medication administration.`);
 line('Complete signatures, consent, self-administration competency approval and staff sections on the official pages. Keep this attachment with the form.');
 line(`Asthma reference: ${SOURCES.nhlbi}`);
 form.updateFieldAppearances(font);
 return {bytes:await doc.save(),filled,name:`${FORM_TYPES[type].stem}-review-draft.pdf`};
}
function wrap(text,font,size,width){
 const lines=[];for(const para of text.split('\n')){let line='';for(const word of para.split(/\s+/)){if(font.widthOfTextAtSize(word,size)>width){if(line){lines.push(line);line='';}let part='';for(const c of word){if(font.widthOfTextAtSize(part+c,size)>width){lines.push(part);part='';}part+=c;}line=part;}else if(font.widthOfTextAtSize((line?line+' ':'')+word,size)>width){lines.push(line);line=word;}else line+=(line?' ':'')+word;}lines.push(line);}return lines;
}
