import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {baselineQuestions,cleanAnalysis,readiness} from '../assets/disability-core.mjs';
import {disabilityDraft} from '../assets/disability-documents.mjs';
import * as PDFLib from 'pdf-lib';
const require=createRequire(import.meta.url),{sign}=require('../netlify/functions/_lib.js'),{handler}=require('../netlify/functions/disability-analyze.js');
test('SSA CE and insurer questions remain separate; missing or unreviewed answers cannot count as ready',()=>{
 assert.ok(baselineQuestions('ssa-ce').some(q=>/DDS-requested/.test(q.question)));
 assert.ok(!baselineQuestions('private').some(q=>/DDS-requested/.test(q.question)));
 assert.ok(baselineQuestions('private').some(q=>/own-occupation/.test(q.question)));
 assert.equal(readiness([{answer:'',status:'not-applicable',reviewed:true}],true).ready,false);
 assert.equal(readiness([{answer:'Reason',status:'not-applicable',reviewed:true}],false).ready,false);
 assert.equal(readiness([{answer:'Reason',status:'not-applicable',reviewed:true}],true).ready,true);
});
test('invented packet quotes and unsupported AI answers are rejected',()=>{
 const input={questions:[{id:'q1',question:'Function?',answer:''}],packetText:'How long can you stand?',guidelines:'Include medical history.',notes:'Observed antalgic gait.',patientReport:'I need breaks.'};
 const r=cleanAnalysis({requirements:[{question:'Stand?',source:'packet',quote:'How long can you stand?'},{question:'Invented?',source:'packet',quote:'Nonexistent text'}],suggestions:[{id:'q1',answer:'Observed antalgic gait.',evidence:[{source:'clinical-note',quote:'Observed antalgic gait.'}]},{id:'q1',answer:'Cannot work.',evidence:[{source:'clinical-note',quote:'Cannot work.'}]},{id:'foreign',answer:'Other',evidence:[{source:'patient-report',quote:'I need breaks.'}]}]},input);
 assert.equal(r.requirements.length,1);assert.equal(r.suggestions.length,1);assert.equal(r.requiresClinicianReview,true);
});
test('disability analysis requires authorization and bounded confirmed input',async()=>{
 const env={...process.env},oldFetch=global.fetch;let calls=0;
 try{process.env.SESSION_SECRET='synthetic';process.env.OPENAI_API_KEY='synthetic';
 const input={patientId:'BHW0000',program:'private',identityConfirmed:true,packetText:'Describe function.',guidelines:'Own occupation.',notes:'Needs breaks.',patientReport:'',questions:[]};
 const event={httpMethod:'POST',headers:{authorization:'Bearer '+sign({staffId:'synthetic',exp:Date.now()+60000})},body:JSON.stringify(input)};
 global.fetch=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.match(body.messages[0].content,/strongest accurate, supportable/);assert.match(body.messages[0].content,/suppressing contrary evidence/);assert.match(body.messages[0].content,/SSA rules are not interchangeable/);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requirements:[],suggestions:[],summary:'Draft'})}}]});};
 assert.equal((await handler({...event,headers:{}})).statusCode,401);
 assert.equal((await handler({...event,body:JSON.stringify({...input,identityConfirmed:false})})).statusCode,400);
 assert.equal((await handler({...event,body:JSON.stringify({...input,notes:'x'.repeat(60001)})})).statusCode,400);
 assert.equal(calls,0);assert.equal((await handler(event)).statusCode,200);assert.equal(calls,1);
 global.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]});assert.equal((await handler(event)).statusCode,422);
 }finally{global.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
async function fixture(){const doc=await PDFLib.PDFDocument.create(),page=doc.addPage();page.drawText('Synthetic disability packet');const field=doc.getForm().createTextField('functional_limit');field.addToPage(page,{x:40,y:620,width:450,height:40});field.enableMultiline();const signature=doc.getForm().createTextField('signature');signature.addToPage(page,{x:40,y:520,width:300,height:20});return {bytes:await doc.save(),name:'synthetic.pdf',textFields:[{name:'functional_limit',label:'Function'}]};}
test('packet draft fills only mapped reviewed answers, retains original pages, and leaves signatures empty',async()=>{
 const packet=await fixture();const result=await disabilityDraft(PDFLib,{packet,patient:{name:'Synthetic Patient',bhwId:'BHW0000'},program:'private',coverage:false,rows:[{question:'Function?',answer:'Requires positional changes.',status:'answered',reviewed:true,fieldName:'functional_limit'}]});
 const doc=await PDFLib.PDFDocument.load(result.bytes);assert.ok(doc.getPageCount()>1);assert.equal(doc.getForm().getTextField('functional_limit').getText(),'Requires positional changes.');assert.equal(doc.getForm().getTextField('signature').getText(),undefined);assert.equal(result.filled,1);
});
test('overflow is reported instead of clipping; duplicate mappings and signature mappings are rejected',async()=>{
 const packet=await fixture();const input={packet,patient:{name:'Synthetic',bhwId:'BHW0000'},program:'private',coverage:true,rows:[{question:'Function?',answer:'Long functional explanation '.repeat(100),status:'answered',reviewed:true,fieldName:'functional_limit'}]};
 const result=await disabilityDraft(PDFLib,input);assert.equal(result.filled,0);assert.equal(result.unfilled.length,1);const doc=await PDFLib.PDFDocument.load(result.bytes);assert.equal(doc.getForm().getTextField('functional_limit').getText(),undefined);
 await assert.rejects(()=>disabilityDraft(PDFLib,{...input,rows:[input.rows[0],input.rows[0]]}),/same PDF field/);
 await assert.rejects(()=>disabilityDraft(PDFLib,{...input,rows:[{...input.rows[0],fieldName:'signature'}]}),/Invalid text field/);
});
