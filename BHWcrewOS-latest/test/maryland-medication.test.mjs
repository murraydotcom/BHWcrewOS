import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import {ageOn,blankDraft,dateOnly,guidance,peakFlow,validateDraft,FORM_TYPES,chartOrders,prefilledDraft} from '../assets/maryland-medication-core.mjs';
import {fillMarylandPdf,mappedValues} from '../assets/maryland-medication-pdf.mjs';
const patient={name:'SYNTHETIC TEST CHILD',dob:'2018-09-15',bhwId:'BHW0000',selectable:true};
const draft=()=>({...blankDraft(),start:'2026-09-15',end:'2027-06-15',provider:'TEST PRESCRIBER MD',phone:'410-555-0100',address:'123 Test Street',allergies:'No known allergies - synthetic',allergyStatus:'no',selfCarry:'no',selfAdmin:'no',reviewed:true,clinicalReview:true,school:'Synthetic School',schoolYear:'2026-2027',grade:'3',rows:[{id:'albuterol',zone:'medication',...guidance('albuterol',{dob:patient.dob,on:'2026-09-15'}).options[0],reason:'Documented bronchospasm',prn:'For wheeze; at least 4 hours apart; max 6 doses/24h including home. Seek care for poor response.'}]});
test('date and age boundaries reject invalid and future DOBs',()=>{
 assert.equal(dateOnly('2026-02-30'),null);assert.equal(ageOn('2022-09-16','2026-09-15'),3);assert.equal(ageOn('2022-09-15','2026-09-15'),4);assert.equal(ageOn('2027-01-01','2026-09-15'),null);
 assert.equal(guidance('albuterol',{dob:'2022-09-16',on:'2026-09-15'}).options.length,0);
 assert.equal(guidance('albuterol',{dob:'2022-09-15',on:'2026-09-15'}).options.length,1);
});
test('chart prefill preserves evidence and does not infer missing doses or resolve conflicting severity',()=>{
 assert.equal(chartOrders('Albuterol HFA')[0].dose,'');
 assert.equal(chartOrders([{name:'Synthetic medicine',dose:'2 mL'}])[0].dose,'2 mL');
 assert.equal(prefilledDraft({icds:[{code:'J45.30'}]}).severity,'Mild Persistent');
 assert.equal(prefilledDraft({icds:[{code:'J45.30'},{code:'J45.50'}]}).severity,'');
 assert.equal(prefilledDraft({}).allergies,'');assert.equal(prefilledDraft({}).reviewed,false);
});
test('nebulizer requires supported age and fresh kg weight',()=>{
 const c={dob:'2020-01-01',on:'2026-09-15',weightKg:15,weightDate:'2026-09-01'};
 assert.equal(guidance('neb',c).options[0].dose,'2.5 mg (3 mL)');
 for(const change of [{weightKg:14.9},{weightKg:''},{weightKg:NaN},{weightDate:'2026-01-01'},{weightDate:'2026-09-16'},{dob:'2025-01-01'}])assert.equal(guidance('neb',{...c,...change}).options.length,0);
});
test('controller rules use age, prior therapy and zone',()=>{
 const c={dob:'2018-09-15',on:'2026-09-15',zone:'green',priorTherapy:'bronchodilator'};
 assert.equal(guidance('budesonide',c).options.length,1);
 assert.equal(guidance('budesonide',{...c,priorTherapy:'ics'}).options.length,2);
 for(const change of [{dob:'2017-09-15'},{priorTherapy:''},{zone:'yellow'},{zone:'red'}])assert.equal(guidance('budesonide',{...c,...change}).options.length,0);
 assert.equal(guidance('albuterol',{...c,zone:'green'}).options.length,0);
});
test('cetirizine solution supports age-specific volumes only',()=>{
 assert.deepEqual(guidance('cetirizine',{dob:'2021-09-15',on:'2026-09-15'}).options.map(o=>o.dose),['2.5 mg (2.5 mL)','5 mg (5 mL)']);
 assert.deepEqual(guidance('cetirizine',{dob:'2020-09-15',on:'2026-09-15'}).options.map(o=>o.dose),['5 mg (5 mL)','10 mg (10 mL)']);
 assert.equal(guidance('cetirizine',{dob:patient.dob,on:'2026-09-15',zone:'yellow'}).options.length,0);
});
test('peak-flow thresholds have no integer gaps and missing best stays unknown',()=>{
 assert.deepEqual(peakFlow(301),{best:301,green:241,yellow:151,upper:240,red:151});
 for(const n of ['',0,-5,Infinity,'abc',40,2000])assert.equal(peakFlow(n),null);
});
test('export rejects missing context, changed formulation, overlong dates and unsafe custom orders',()=>{
 assert.deepEqual(validateDraft(draft(),patient,'medication'),[]);
 for(const patch of [{reviewed:false},{clinicalReview:false},{allergies:''},{start:'2026-02-30'},{end:'2027-09-16'},{end:'2026-09-14'}])assert.ok(validateDraft({...draft(),...patch},patient,'medication').length);
 assert.ok(validateDraft(draft(),{...patient,selectable:false},'medication').length);
 for(const patch of [{dose:'20 puffs'},{route:'Oral'},{name:'Albuterol 5 mg/mL'},{frequency:'Every hour'},{prn:''}]){const d=draft();Object.assign(d.rows[0],patch);assert.ok(validateDraft(d,patient,'medication').length);}
 const d=draft();d.rows[0].id='custom';assert.ok(validateDraft(d,patient,'medication').length);d.rows[0].confirmed=true;d.rows[0].reference='Synthetic physician order checked against product label';assert.deepEqual(validateDraft(d,patient,'medication'),[]);
});
test('asthma requires severity, controller review and a complete escalation plan',()=>{
 const d=draft();d.rows[0].zone='yellow';assert.ok(validateDraft(d,patient,'asthma').length);
 Object.assign(d,{severity:'Mild Persistent',triggerReview:true,controllerReview:true,greenPlan:'Continue documented controller at home.',yellowPlan:'Notify guardian and seek care if reliever fails.',redPlan:'Call 911 for severe symptoms; follow emergency order.'});
 assert.deepEqual(validateDraft(d,patient,'asthma'),[]);
});
test('official drafts preserve pages, use distinct medication rows and never sign',async()=>{
 const maps=JSON.parse(await readFile(new URL('../assets/maryland-form-widgets.json',import.meta.url)));
 await mkdir(new URL('../tmp/md-forms/',import.meta.url),{recursive:true});
 for(const type of Object.keys(FORM_TYPES)){
  const d=draft();if(type==='asthma'){
   Object.assign(d,{severity:'Mild Persistent',triggerReview:true,controllerReview:true,best:'301',triggers:['Exercise'],greenPlan:'Continue documented controller at home.',yellowPlan:'Notify guardian; seek medical care for persistent or worsening symptoms.',redPlan:'Call 911 immediately for severe breathing difficulty or blue lips. Notify guardian. Do not delay EMS.'});
   d.rows[0].zone='yellow';d.rows.unshift({id:'budesonide',zone:'green',...guidance('budesonide',{dob:patient.dob,on:d.start,zone:'green',priorTherapy:'ics'}).options[0],reason:'Asthma maintenance',prn:''});d.priorTherapy='ics';
  }
  const stem=FORM_TYPES[type].stem,widgets=maps[stem],values=mappedValues(type,d,patient,widgets);
  const result=await fillMarylandPdf(PDFLib,await readFile(new URL(`../assets/forms/${stem}-template.pdf`,import.meta.url)),widgets,type,d,patient);
  const reopened=await PDFLib.PDFDocument.load(result.bytes),fields=reopened.getForm().getFields();
  assert.ok(reopened.getPageCount()>({asthma:3,medication:2,school:1}[type]));
  assert.equal(new Set(fields.map(f=>f.getName())).size,fields.length);
  const annotationRefs=reopened.getPages().flatMap(p=>(p.node.Annots()?.asArray()||[]).map(String));
  assert.equal(new Set(annotationRefs).size,annotationRefs.length,'a widget must not appear on multiple pages');
  for(const f of fields){const w=widgets.find(w=>w.id===f.getName());assert.ok(w);assert.doesNotMatch(w.name,/SIGNATURE|Signature|signature/);if(f instanceof PDFLib.PDFTextField)assert.ok(f.getText());}
  if(type==='asthma'){assert.equal(values.f37,'Budesonide 0.5 mg/2 mL suspension');assert.equal(values.f71,'Albuterol HFA 90 mcg/actuation');assert.notEqual(values.f37,values.f71);}
  await writeFile(new URL(`../tmp/md-forms/${type}-synthetic.pdf`,import.meta.url),result.bytes);
 }
});
