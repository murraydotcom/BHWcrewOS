export const REVIEWED_ON='2026-09-15';
export const SOURCES={
 asthma:'https://earlychildhood.marylandpublicschools.org/child-care-providers/licensing/licensing-forms',
 school:'https://www.marylandpublicschools.org/about/Documents/DSFSS/SSSP/SHS/SHSGuidelines/MedicationAdministrationForm_Fillable_a.pdf',
 nhlbi:'https://www.nhlbi.nih.gov/sites/default/files/publications/Asthma%20Clinicians%20Guide%20508_02-03-21.pdf',
 gina:'https://ginasthma.org/2026-gina-strategy-report/',
 albuterol:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=4120061a-dbae-8918-e063-6394a90afbf2',
 neb:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=922bf33b-4d55-4c35-9f68-72efbb17c14f',
 cetirizine:'https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=601c2846-30e7-40f1-96b4-64fbed719c0b',
 budesonide:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a39fbcfc-3ffd-44bd-b882-01f8e1844213'
};
export const FORM_TYPES={asthma:{stem:'md-occ1216a-asthma',label:'OCC 1216A - Asthma action plan (child care)'},medication:{stem:'md-occ1216-medication',label:'OCC 1216 - Medication authorization (child care)'},school:{stem:'md-school-medication',label:'Maryland school medication authorization'}};
export function dateOnly(v){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return null;
 const d=new Date(v+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v?d:null;
}
export function ageOn(dob,on){const b=dateOnly(dob),d=dateOnly(on);if(!b||!d||b>d)return null;let y=d.getUTCFullYear()-b.getUTCFullYear();if(on.slice(5)<dob.slice(5))y--;return y;}
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const displayDate=v=>dateOnly(v)?`${v.slice(5,7)}/${v.slice(8,10)}/${v.slice(0,4)}`:'';
export const CATALOG=[
 {id:'albuterol',label:'Albuterol HFA 90 mcg/actuation',route:'Inhalation',source:'albuterol'},
 {id:'neb',label:'Albuterol 2.5 mg/3 mL (0.083%)',route:'Nebulization',source:'neb'},
 {id:'budesonide',label:'Budesonide 0.5 mg/2 mL suspension',route:'Nebulization',source:'budesonide'},
 {id:'cetirizine',label:'Cetirizine 1 mg/mL oral solution',route:'Oral',source:'cetirizine'},
 {id:'custom',label:'Other medication / individualized prescription',route:'',source:null}
];
export function guidance(id,{dob,on=today(),weightKg,weightDate,priorTherapy,zone='medication'}={}){
 const item=CATALOG.find(x=>x.id===id), age=ageOn(dob,on),out={options:[],issues:[],source:item?.source?SOURCES[item.source]:null};
 if(!item){out.issues.push('Choose the exact medication and formulation.');return out;}
 if(age===null){out.issues.push('A valid Registry DOB and treatment start date are required.');return out;}
 if(id==='custom'){out.issues.push('No automatic dose rule. Enter the exact prescription and document the dose reference and clinical rationale.');return out;}
 if(zone==='red'){out.issues.push('Emergency doses and repeat limits must come from the individualized asthma order. Use the individualized prescription option.');return out;}
 const add=(dose,frequency,instructions)=>out.options.push({name:item.label,dose,route:item.route,frequency,instructions});
 if(id==='albuterol'){
  if(age<4)out.issues.push('This HFA label starts at age 4. An individualized prescriber order is required below age 4.');
  else if(zone==='green')out.issues.push('Albuterol is a reliever. Select the documented controller for the green zone.');
  else if(zone==='exercise')add('2 puffs','15-30 min before exercise','Use prescribed spacer.');
  else add('2 puffs','Every 4-6 hours as needed','Use spacer; may cause tremor or fast pulse.');
 }
 if(id==='neb'){
  const wd=dateOnly(weightDate),od=dateOnly(on),weight=Number(weightKg);
  if(age<2)out.issues.push('This nebulizer rule starts at age 2.');
  if(!(weight>=15&&weight<=300)||!wd||wd>od||(od-wd)/86400000>90)out.issues.push('A confirmed weight of at least 15 kg, measured within 90 days before treatment, is required for this 2.5 mg vial rule.');
  if(['green','exercise'].includes(zone))out.issues.push('Use an individualized order for this zone; this rule covers symptom relief.');
  if(!out.issues.length)add('2.5 mg (3 mL)','Every 6 hours as needed','Max 4 doses/day; tremor or fast pulse.');
 }
 if(id==='budesonide'){
  if(age<1||age>8)out.issues.push('This suspension label covers ages 12 months through 8 years.');
  if(!['bronchodilator','ics','oral-steroid'].includes(priorTherapy))out.issues.push('Confirm prior asthma therapy before selecting a budesonide dose.');
  if(!['green','medication'].includes(zone))out.issues.push('Budesonide alone is a controller, not an acute reliever.');
  if(!out.issues.length){
   if(priorTherapy!=='oral-steroid')add('0.5 mg (2 mL)','Once daily','Rinse mouth; thrush/hoarseness possible.');
   if(priorTherapy!=='bronchodilator')add('0.5 mg (2 mL)','Twice daily','Rinse mouth; thrush/hoarseness possible.');
  }
 }
 if(id==='cetirizine'){
  if(zone!=='medication')out.issues.push('Cetirizine does not treat asthma bronchospasm. Use the medication form for its documented indication.');
  if(age<2)out.issues.push('This OTC rule starts at age 2; younger children need an individualized prescription.');
  if(!out.issues.length){for(const amount of age<6?[2.5,5]:age>=65?[5]:[5,10])add(`${amount} mg (${amount} mL)`,'Once daily','May cause drowsiness.');}
 }
 return out;
}
export function peakFlow(best){const n=Number(best);if(!Number.isInteger(n)||n<50||n>1000)return null;const green=Math.ceil(n*.8),yellow=Math.ceil(n*.5);return {best:n,green,yellow,upper:green-1,red:yellow};}
export function chartOrders(value){
 const list=Array.isArray(value)?value:typeof value==='string'?value.split(/\n+/).filter(s=>s.trim()):[];
 return list.map(m=>typeof m==='string'?{name:m,dose:'',route:'',frequency:'',reason:''}:{name:String(m.name||m.medicationName||m.medication||''),dose:String(m.dose||m.dosage||''),route:String(m.route||''),frequency:String(m.frequency||m.sig||''),reason:String(m.indication||m.reason||'')}).filter(m=>m.name);
}
export function prefilledDraft(patient){
 const d=blankDraft();d.allergies=typeof patient?.allergies==='string'?patient.allergies:patient?.allergies?JSON.stringify(patient.allergies):'';
 const severityNames={'2':'Mild Intermittent','3':'Mild Persistent','4':'Moderate Persistent','5':'Severe Persistent'};
 const found=new Set((patient?.icds||[]).map(x=>String(x.code||'').match(/^J45\.([2345])/i)?.[1]).filter(Boolean));
 if(found.size===1)d.severity=severityNames[[...found][0]];
 d.yellowPlan='Use the ordered reliever for cough, wheeze, chest tightness or shortness of breath. Notify parent/guardian. Seek medical care if symptoms worsen, response is incomplete, or relief does not last until the next permitted dose.';
 d.redPlan='Call 911 immediately for severe breathing difficulty, blue lips, trouble speaking/walking, or failure of the reliever. Notify parent/guardian. Give only the separately specified emergency medication order while awaiting EMS; do not delay the emergency call.';
 return d;
}
export function blankDraft(){return {start:'',end:'',allergies:'',school:'',schoolYear:'',grade:'',provider:'',phone:'',fax:'',address:'',city:'',region:'',zip:'',weightKg:'',weightDate:'',priorTherapy:'',severity:'',triggers:[],best:'',selfCarry:'',selfAdmin:'',rows:[],reviewed:false,clinicalReview:false,controllerReview:false,triggerReview:false,redPlan:'',yellowPlan:'',greenPlan:''};}
export function rowErrors(row,draft,patient){
 const errors=[];
 for(const key of ['name','dose','route','frequency','reason','instructions'])if(!String(row[key]||'').trim())errors.push(`${key} is required.`);
 const g=guidance(row.id,{dob:patient?.dob,on:draft.start,weightKg:draft.weightKg,weightDate:draft.weightDate,priorTherapy:draft.priorTherapy,zone:row.zone});
 if(row.id==='custom'){
  if(!row.reference?.trim()||!row.confirmed)errors.push('Individually verify the dose, route, frequency, age/weight and documented reference.');
 }else{
  errors.push(...g.issues);
  if(!g.options.some(o=>['name','dose','route','frequency'].every(k=>o[k]===row[k])))errors.push('Dose or formulation does not match an eligible rule. Select a reviewed option, or document an individualized prescription.');
 }
 if(/as needed|\bprn\b/i.test(row.frequency)&&!row.prn?.trim())errors.push('Enter PRN symptoms, minimum interval, maximum use and duration/escalation instructions.');
 return errors;
}
export function validateDraft(d,p,type){
 const errors=[];
 if(!p||!/^BHW\d{4}$/.test(p.bhwPatientId||p.bhwId||'')||p.selectable===false)errors.push('Select an active exact Registry patient.');
 if(!p?.name||ageOn(p?.dob,d.start)===null)errors.push('Confirm Registry name, DOB and a valid treatment start date.');
 const start=dateOnly(d.start),end=dateOnly(d.end);
 if(!start||!end||end<start)errors.push('Enter a valid authorization date range.');
 else {const anniversary=new Date(start);anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);if(end>anniversary)errors.push('Authorization cannot exceed one year.');}
 for(const key of ['provider','phone','address','allergies'])if(!d[key]?.trim())errors.push(`Complete ${key}. Unknown allergies must be reconciled, not assumed absent.`);
 if(!['yes','no'].includes(d.allergyStatus))errors.push('Explicitly confirm whether food or drug allergies are present.');
 if(!['yes','no','na'].includes(d.selfCarry)||!['yes','no','na'].includes(d.selfAdmin))errors.push('Review self-carry and self-administration eligibility.');
 if(type==='school'&&(!d.school.trim()||!d.schoolYear.trim()||!d.grade.trim()))errors.push('Complete school, school year and grade.');
 if(!d.rows.length)errors.push('Add the documented medication order.');
 d.rows.forEach((r,i)=>rowErrors(r,d,p).forEach(e=>errors.push(`Medication ${i+1}: ${e}`)));
 if(type!=='asthma'&&d.rows.length!==1)errors.push('Use one medication per general authorization form.');
 if(type==='asthma'){
  if(!d.severity)errors.push('Confirm documented asthma severity.');
  if(!d.triggerReview)errors.push('Review asthma triggers.');
  if(!d.controllerReview||!d.greenPlan.trim())errors.push('Review the controller strategy and green-zone instructions.');
  if(!d.rows.some(r=>r.zone==='yellow'))errors.push('Add the documented yellow-zone reliever.');
  if(!d.yellowPlan.trim()||!d.redPlan.trim())errors.push('Complete yellow-zone escalation and red-zone emergency instructions.');
  if(d.best&&!peakFlow(d.best))errors.push('Personal-best peak flow must be a documented integer from 50 to 1000 L/min, or left blank.');
  for(const [zone,max] of [['green',2],['exercise',1],['yellow',3],['red',2]])if(d.rows.filter(r=>r.zone===zone).length>max)errors.push(`Official form supports at most ${max} ${zone}-zone medication(s).`);
 }
 if(!d.clinicalReview)errors.push('Reconcile current prescriptions, allergies, interactions, duplicate therapy, kidney/liver considerations and all home/school doses.');
 if(!d.reviewed)errors.push('Clinician review acknowledgment is required.');
 return errors;
}
