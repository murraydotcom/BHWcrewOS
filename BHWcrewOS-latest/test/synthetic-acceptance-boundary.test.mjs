import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticAcceptanceBoundary} from '../cloud/operations-api/synthetic-acceptance-boundary.mjs';
const request=path=>new Request('https://candidate.test'+path);
test('candidate perimeter defaults off and never replaces application auth on allowed routes',()=>{
  assert.equal(syntheticAcceptanceBoundary(request('/v1/patients'),{}),null);
  const env={BHW0000_ACCEPTANCE_ONLY:'true',SYNTHETIC_ONLY:'true'};
  assert.equal(syntheticAcceptanceBoundary(request('/v1/blueprint-tasks'),env),null);
  assert.equal(syntheticAcceptanceBoundary(request('/health'),env),null);
  assert.equal(syntheticAcceptanceBoundary(request('/v1/blueprint-tasks'),{BHW0000_ACCEPTANCE_ONLY:'true'}).status,503);
});
test('candidate perimeter denies real identifiers, global lists and unrelated transmissions',()=>{
  const env={BHW0000_ACCEPTANCE_ONLY:'true',SYNTHETIC_ONLY:'true'};
  for(const path of ['/v1/patients','/v1/patients/BHW9999/blueprint','/v1/claims/submit','/v1/workflows/send','/v1/patients/%42HW9999/blueprint'])
    assert.equal(syntheticAcceptanceBoundary(request(path),env).status,403);
});
