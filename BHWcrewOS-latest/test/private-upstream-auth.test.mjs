import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateUpstreamHeaders} from '../cloud/operations-api/private-upstream-auth.mjs';
test('private upstream IAM defaults off, fails closed outside synthetic mode, and rejects unsafe audiences',async()=>{
  const authFactory=()=>{throw Error('must not acquire credentials');};
  assert.deepEqual(await createPrivateUpstreamHeaders({}, {authFactory})('https://private.test'),{});
  for(const origin of ['http://private.test','https://user@private.test','https://private.test/path','https://private.test?x=1'])
    await assert.rejects(()=>createPrivateUpstreamHeaders({SYNTHETIC_ONLY:'true',SYNTHETIC_UPSTREAM_IAM_ENABLED:'true'},{authFactory})(origin),e=>e.status===503);
  await assert.rejects(()=>createPrivateUpstreamHeaders({SYNTHETIC_UPSTREAM_IAM_ENABLED:'true'},{authFactory})('https://private.test'),e=>e.status===503);
});
test('private IAM uses the exact audience and separate serverless header, caches clients, and never exposes credentials on failure',async()=>{
  let acquisitions=0;const audiences=[];
  const headers=createPrivateUpstreamHeaders({SYNTHETIC_ONLY:'true',SYNTHETIC_UPSTREAM_IAM_ENABLED:'true'},{authFactory:async()=>({getIdTokenClient:async audience=>{acquisitions++;audiences.push(audience);return {getRequestHeaders:async()=>new Headers({authorization:'Bearer synthetic.identity.token'})};}})});
  for(let i=0;i<2;i++)assert.deepEqual(await headers('https://private.test'),{'X-Serverless-Authorization':'Bearer synthetic.identity.token'});
  assert.equal(acquisitions,1);assert.deepEqual(audiences,['https://private.test']);
  const failed=createPrivateUpstreamHeaders({SYNTHETIC_ONLY:'true',SYNTHETIC_UPSTREAM_IAM_ENABLED:'true'},{authFactory:async()=>{throw Error('PRIVATE-CREDENTIAL');}});
  await assert.rejects(()=>failed('https://private.test'),e=>e.status===503&&!e.message.includes('PRIVATE-CREDENTIAL'));
});
