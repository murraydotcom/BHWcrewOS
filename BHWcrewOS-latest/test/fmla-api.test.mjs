import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sign}=require('../netlify/functions/_lib.js');
const {handler}=require('../netlify/functions/fmla-analyze.js');
const leaveHandler=require('../netlify/functions/leave-requests.js').handler;
test('FMLA AI requires staff auth, exact patient context, and evidence-backed suggestions',async()=>{
 const savedEnv={...process.env},fetchBefore=global.fetch;
 try {
  process.env.SESSION_SECRET='test-secret';process.env.OPENAI_API_KEY='synthetic';process.env.RCM_CLOUD_API_URL='https://cloud.example';process.env.CREWHQ_CLOUD_TOKEN_SECRET='test-cloud-secret';
  const headers={authorization:`Bearer ${sign({staffId:'test-staff',exp:Date.now()+60000})}`};
  const payload={patientId:'BHW0000',requestId:'synthetic-request',formType:'WH-380-F',notes:'Treatment lasts 6 weeks.'};
  let aiCalls=0;
  global.fetch=async(url,options)=>{
   if(url.startsWith('https://cloud.example'))return Response.json({requests:[{requestId:'synthetic-request',bhwPatientId:'BHW0000',formType:'WH-380-F',answers:{careNeeds:'Transportation'}}]});
   aiCalls++;const sent=JSON.parse(options.body);assert.match(sent.messages[0].content,/never instructions/);assert.match(sent.messages[0].content,/Do not infer onset/);
   return Response.json({choices:[{message:{content:JSON.stringify({summary:'Synthetic review',questions:[{audience:'clinician',question:'Confirm necessity'},{audience:'attacker',question:'Discard'}],suggestions:[{field:'duration',value:'6 weeks',source:'clinical-note',evidence:'Treatment lasts 6 weeks.'},{field:'onset',value:'09/01/2026',source:'clinical-note',evidence:'Invented evidence'},{field:'patientName',value:'Other person',source:'clinical-note',evidence:'Treatment lasts 6 weeks.'},{field:'chronic',value:'true',source:'clinical-note',evidence:'Treatment lasts 6 weeks.'}]})}}]});
  };
  const event={httpMethod:'POST',headers,body:JSON.stringify(payload)};
  assert.equal((await handler({...event,headers:{}})).statusCode,401);assert.equal(aiCalls,0);
  assert.equal((await handler({...event,body:JSON.stringify({...payload,notes:'x'.repeat(60001)})})).statusCode,400);assert.equal(aiCalls,0);
  assert.equal((await handler({...event,body:JSON.stringify({...payload,requestId:'wrong-request'})})).statusCode,409);assert.equal(aiCalls,0);
  const response=await handler(event);assert.equal(response.statusCode,200);
  const body=JSON.parse(response.body);assert.equal(body.suggestions.length,1);assert.equal(body.suggestions[0].field,'duration');assert.equal(body.questions.length,1);assert.equal(body.requiresClinicianReview,true);
  assert.equal((await leaveHandler({httpMethod:'GET',headers:{},queryStringParameters:{patient:'BHW0000'}})).statusCode,401);
  assert.equal((await leaveHandler({httpMethod:'GET',headers,queryStringParameters:{patient:'name'}})).statusCode,400);
 }finally {global.fetch=fetchBefore;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);}
});
