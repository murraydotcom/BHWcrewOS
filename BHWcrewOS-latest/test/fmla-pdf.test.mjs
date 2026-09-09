import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import {fillFmlaPdf} from '../assets/fmla-pdf.mjs';
import {certificationFields,validateCertification} from '../assets/fmla-certification.mjs';
for(const type of ['WH-380-E','WH-380-F']) test(`${type}: mapped fields survive save and reopen; no signature is manufactured`,async()=>{
 const bytes=await readFile(new URL(`../assets/forms/fmla-wh380${type==='WH-380-E'?'e':'f'}-2029.pdf`,import.meta.url));
 const values={employeeName:'Synthetic Employee',employeeName1:'Synthetic Employee',employeeName2:'Synthetic Employee',employeeName3:'Synthetic Employee',carePatient:'Synthetic Patient',patientName:'Synthetic Patient',onset:'09/01/2026',duration:'6 weeks',episodeFrequency:'2',perMonth:true,episodeDuration:'4',durationHours:true,chronic:true,medicalFacts:'Synthetic condition requires scheduled treatment.'};
 const out=await fillFmlaPdf(PDFLib,bytes,type,values);
 const doc=await PDFLib.PDFDocument.load(out.bytes),form=doc.getForm();
 assert.equal(doc.getPageCount(),4);
 assert.equal(form.getFields().length,certificationFields(type).length);
 for(const [key,,,,,,,,kind] of certificationFields(type)){
  if(kind==='checkbox')assert.equal(form.getCheckBox(key).isChecked(),values[key]===true);
  else assert.equal(form.getTextField(key).getText()||'',values[key]||'');
 }
 assert.equal(form.getFields().some(f=>/signature/i.test(f.getName())),false);
 await assert.rejects(fillFmlaPdf(PDFLib,bytes,type,{employeeName:'long name '.repeat(200)}),/too long/);
});
test('incompatible condition categories and ambiguous frequency units block output',()=>{
 assert.ok(validateCertification({none:true,chronic:true}).length);
 assert.ok(validateCertification({episodeFrequency:'2'}).length);
 assert.ok(validateCertification({perDay:true,perMonth:true}).length);
 assert.deepEqual(validateCertification({episodeFrequency:'2',perMonth:true,episodeDuration:'4',durationHours:true}),[]);
});
