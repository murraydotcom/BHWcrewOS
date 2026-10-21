import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBlueprintTasksBridge}=require('../netlify/functions/blueprint-tasks.js')._test;
const environment={SYNTHETIC_BLUEPRINT_TASKS_ENABLED:'true',OPERATIONS_CLOUD_API_URL:'https://ops.synthetic.test',CREWOS_OPERATIONS_TOKEN_SECRET:'synthetic-staff-secret'};
const sessionImpl=()=>({staffId:'care',role:'care-manager'});

test('staff bridge strips nested clinical additions, uses server-only short trust and never follows redirects',async()=>{
  const hidden={clinicalText:'PRIVATE-CLINICAL-COPY'},ref={bhwPatientId:'BHW0000',version:1,...hidden};let request;
  const bridge=createBlueprintTasksBridge({environment,sessionImpl,fetchImpl:async(url,init)=>{request={url,init};return Response.json({ok:true,inbox:{reference:ref,tasks:[{taskId:'TSK-BP-'+'a'.repeat(40),reference:ref,reminders:[{id:'due',kind:'due',...hidden}],completionReview:{resultId:'result-123',...hidden},...hidden}],pendingQueue:[{actionId:'action-123',...hidden}],unresolved:[{actionId:'action-123',fields:['timing'],...hidden}]}});}});
  const result=await bridge({httpMethod:'GET'});assert.equal(result.statusCode,200);assert.doesNotMatch(result.body,/PRIVATE-CLINICAL|synthetic-staff-secret/);
  assert.equal(request.init.redirect,'error');assert.equal(request.init.cache,'no-store');assert.equal(request.url,'https://ops.synthetic.test/v1/blueprint-tasks');
  const claims=JSON.parse(Buffer.from(request.init.headers.Authorization.slice(7).split('.')[0],'base64url'));assert.equal(claims.exp-claims.iat,60);assert.equal(claims.sub,'crew:care');
});

test('bridge denies patient selectors/copied payload, expired login and flags ambiguous writes as unconfirmed',async()=>{
  let calls=0;const bridge=createBlueprintTasksBridge({environment,sessionImpl,fetchImpl:async()=>{calls++;throw Error('connection lost after write');}});
  assert.equal((await bridge({httpMethod:'GET',queryStringParameters:{patient:'BHW9999'}})).statusCode,400);
  assert.equal((await bridge({httpMethod:'POST',body:JSON.stringify({action:'sync',clinicalText:'denied'})})).statusCode,400);assert.equal(calls,0);
  const response=await bridge({httpMethod:'POST',body:JSON.stringify({action:'complete',commandId:'stable-command',referenceHash:'a'.repeat(64),taskId:'TSK-BP-'+'b'.repeat(40),expectedVersion:2})});
  assert.equal(response.statusCode,502);assert.equal(JSON.parse(response.body).saveUnconfirmed,true);
  const anonymous=createBlueprintTasksBridge({environment,sessionImpl:()=>null});assert.equal((await anonymous({httpMethod:'GET'})).statusCode,401);
  const disabled=createBlueprintTasksBridge({environment:{},sessionImpl});assert.equal((await disabled({httpMethod:'GET'})).statusCode,503);
});
