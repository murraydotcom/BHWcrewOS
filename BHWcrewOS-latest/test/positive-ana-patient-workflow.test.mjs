import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { sign } = require('../netlify/functions/_lib.js');
const { handler, _test: { normalizeAnalysis, buildLongitudinalComparison, transcript } } = require('../netlify/functions/positive-ana-record.js');
const page = await readFile(new URL('../bhw-positive-ana.html', import.meta.url), 'utf8');
const step5Page = await readFile(new URL('../bhw-positive-ana-step5.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../netlify/functions/positive-ana-record.js', import.meta.url), 'utf8');
process.env.SESSION_SECRET = 'offline-synthetic-session-secret';

function event(body, claims = {}, overrides = {}) {
  const now = Date.now();
  const token = sign({ staffId: 'synthetic-clinician', name: 'Synthetic Clinician', role: 'CRNP', scope: 'clinical', authTime: now - 1000, exp: now + 60_000, ...claims });
  return { httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body), ...overrides };
}
const analysis = () => ({
  anaPatterns: [{ code: 'AC-1', label: 'Nuclear homogeneous', titer: 160 }],
  antibodies: [{ key: 'dsDNA', label: 'dsDNA' }],
  symptoms: [{ group: 'Renal / Vascular', label: 'Blood in urine' }],
  labs: [{ key: 'seleniumLow', label: 'Selenium low' }],
  measurements: [{ key: 'c3Value', label: 'C3 numeric value', value: 64, unit: 'mg/dL', method: 'Nephelometry', referenceRange: '90-180', collectedOn: '2026-10-20' }],
  review: { clinicianReviewRequired: false },
  // Deliberate attack inputs, never real records.
  patientResponseIds: ['other-patient-response'], priorAnalysisIds: ['other-patient-prior'],
  differential: [{ condition: 'SLE', score: 100 }], sharedWorkup: ['CBC'],
});

async function offline(run) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network forbidden during synthetic regression'); };
  try { await run(); assert.equal(calls, 0, 'no Cloud, Registry, storage, or delivery call'); }
  finally { globalThis.fetch = original; }
}

test('patient save/list and delivery actions stay locked for every identifier, role, and client approval claim', async () => {
  await offline(async () => {
    // BHW9999 is exclusively an offline negative fixture here, never a pilot identity.
    for (const bhwPatientId of ['BHW0000', 'BHW9999', 'BHW1111', '', '../BHW0000']) {
      for (const action of ['save', 'list', 'create-assignment', 'send', 'approve', undefined]) {
        const response = await handler(event({ action, bhwPatientId, analysis: analysis(), clinicalApproved: true, persistenceEnabled: true }, { role: 'admin' }));
        assert.equal(response.statusCode, 423);
        const body = JSON.parse(response.body);
        assert.equal(body.saved, false); assert.equal(body.clinicalApproved, false);
        assert.equal(body.persistenceEnabled, false); assert.equal(body.patientDeliveryEnabled, false);
      }
    }
  });
});

test('signed release status reports the hard lock and never queries patient data', async () => {
  await offline(async () => {
    const response = await handler(event({ action: 'status' }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), { ok: true, mode: 'synthetic-only', syntheticPatientId: 'BHW0000', clinicalApproved: false, persistenceEnabled: false, patientDeliveryEnabled: false, clinicianReviewRequired: true });
  });
});

test('missing, tampered, expired, appended, or identity-free signed sessions fail before workflow processing', async () => {
  await offline(async () => {
    const request = event({ action: 'status' });
    const token = request.headers.authorization;
    for (const authorization of ['', 'Bearer invalid', token + '.extra', token.slice(0,-1) + (token.endsWith('A') ? 'B' : 'A')]) {
      assert.equal((await handler({ ...request, headers: { authorization } })).statusCode, 401);
    }
    assert.equal((await handler(event({ action: 'status' }, { exp: Date.now()-1 }))).statusCode, 401);
    assert.equal((await handler(event({ action: 'status' }, { staffId: '' }))).statusCode, 401);
  });
});

test('synthetic preview requires the exact BHW0000 identity; aliases and real-format IDs fail closed', async () => {
  await offline(async () => {
    for (const bhwPatientId of ['BHW9999','BHW1111','bhw0000',' BHW0000','BHW0000suffix',null,{},['BHW0000']]) {
      assert.equal((await handler(event({ action: 'synthetic-preview', bhwPatientId, analysis: analysis(), syntheticReviewAttestation: true }))).statusCode, 403);
    }
  });
});

test('synthetic preview requires a provider role and recent clinical step-up; admin access is not clinical approval', async () => {
  await offline(async () => {
    for (const claims of [{ role: 'admin' },{role:'Care Manager'},{role:'front desk'},{scope:'staff'},{authTime:0},{authTime:Date.now()+60_000},{authTime:Date.now()-16*60_000},{exp:Date.now()+16*60_000}]) {
      assert.equal((await handler(event({ action: 'synthetic-preview', bhwPatientId:'BHW0000', analysis:analysis(), syntheticReviewAttestation:true }, claims))).statusCode, 403);
    }
  });
});

test('synthetic preview requires explicit attestation and a structured analysis', async () => {
  await offline(async () => {
    for (const syntheticReviewAttestation of [false, undefined, 'true']) {
      assert.equal((await handler(event({ action:'synthetic-preview', bhwPatientId:'BHW0000', analysis:analysis(), syntheticReviewAttestation }))).statusCode, 400);
    }
    for (const value of [null, undefined, []]) assert.equal((await handler(event({ action:'synthetic-preview',bhwPatientId:'BHW0000',analysis:value,syntheticReviewAttestation:true }))).statusCode,400);
  });
});

test('attested BHW0000 preview cannot save, issue a link, inherit patient provenance, or become clinical signoff', async () => {
  await offline(async () => {
    const response = await handler(event({ action:'synthetic-preview',bhwPatientId:'BHW0000',analysis:analysis(),syntheticReviewAttestation:true }));
    assert.equal(response.statusCode,200);
    const body = JSON.parse(response.body);
    assert.equal(body.bhwPatientId,'BHW0000'); assert.equal(body.saved,false); assert.equal(body.destination,'none');
    assert.equal(body.syntheticReview.staffId,'synthetic-clinician'); assert.equal(body.syntheticReview.clinicalSignoff,false);
    assert.equal(body.analysis.review.clinicianReviewRequired,true);
    assert.deepEqual(body.analysis.patientResponseIds,[]); assert.deepEqual(body.analysis.priorAnalysisIds,[]);
    assert.equal(body.analysis.longitudinalComparison.priorReviewCount,0);
    for (const key of ['differential','sharedWorkup','diagnosis','prescription','order','carePlan','patientLink','responseId']) assert.equal(Object.hasOwn(body.analysis,key)||Object.hasOwn(body,key),false,key);
  });
});

test('oversized, malformed, non-object, and unsupported-method requests fail without transport', async () => {
  await offline(async () => {
    assert.equal((await handler(event({}, {}, {httpMethod:'GET'}))).statusCode,405);
    assert.equal((await handler(event({}, {}, {body:'{'}))).statusCode,400);
    assert.equal((await handler(event(null))).statusCode,400);
    assert.equal((await handler(event([]))).statusCode,400);
    assert.equal((await handler(event({}, {}, {body:'x'.repeat(160001)}))).statusCode,413);
  });
});

test('source context and numerical findings remain reviewable without ranking or automatic treatment', () => {
  const normalized = normalizeAnalysis(analysis());
  assert.equal(normalized.analysisMode,'non-ranking-clinician-review');
  assert.equal(normalized.measurements[0].value,64);
  assert.equal(normalized.review.clinicianReviewRequired,true);
  assert.match(normalized.review.sourceReferences[0].title,/Insider’s Guide/);
  const summary = transcript(normalized);
  assert.match(summary,/Clinician review is required/);
  assert.doesNotMatch(summary,/ranked differential/i);
});

test('offline longitudinal comparison retains factual changes and assay boundaries', () => {
  const current = normalizeAnalysis(analysis());
  const prior = [{responseId:'synthetic-prior',submittedAt:'2026-09-01T12:00:00Z',analysis:normalizeAnalysis({
    anaPatterns:[{code:'AC-1',label:'Nuclear homogeneous',titer:80}],
    measurements:[{key:'c3Value',label:'C3 numeric value',value:80,unit:'mg/dL',method:'Nephelometry',referenceRange:'90-180',collectedOn:'2026-08-28'}],
    symptoms:[{group:'Joints / Muscle',label:'Joint swelling'}],
  })}];
  const comparison = buildLongitudinalComparison(current,prior);
  assert.equal(comparison.priorReviewCount,1);
  assert.equal(comparison.measurements[0].delta,-16);
  assert.equal(comparison.measurements[0].comparability,'comparable');
  assert.deepEqual(comparison.symptoms.currentOnly,['Blood in urine']);
  assert.deepEqual(comparison.symptoms.previousOnly,['Joint swelling']);
  prior[0].analysis.measurements[0].unit='other';
  assert.equal(buildLongitudinalComparison(current,prior).measurements[0].comparability,'not-comparable');
});

test('browser uses an isolated fixture, never contacts Cloud, and cannot enable save/delivery after analysis', () => {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id,{value:id==='patient-id'?'BHW0000':'',disabled:false,addEventListener(){}});return elements.get(id); };
  let calls=0;
  const context=vm.createContext({window:{}, $:element, fetch(){calls++;throw new Error('network forbidden');}});
  const block=page.slice(page.indexOf('/* ================= VERIFIED PATIENT SAVE'),page.indexOf('/* ================= ATLAS + MANAGEMENT'));
  vm.runInContext(block,context);
  assert.equal(vm.runInContext('selectedPositiveAnaPatient().bhwPatientId',context),'BHW0000');
  context.window._analysisRecord=analysis();
  vm.runInContext('updatePatientWorkflowButtons()',context);
  assert.equal(element('save-analysis').disabled,true);assert.equal(element('create-step5').disabled,true);
  element('patient-id').value='BHW9999';
  assert.equal(vm.runInContext('selectedPositiveAnaPatient()',context),null);
  assert.equal(calls,0);
});

test('the public Step 5 page cannot use an old capability or transmit answers', () => {
  assert.match(step5Page,/noindex,nofollow,noarchive/);
  assert.match(step5Page,/Patient form is not active/);
  assert.doesNotMatch(step5Page,/<script|<form|fetch\(|content-assignments|content-submissions|URLSearchParams/);
});

test('record endpoint imports no Cloud adapter and offers no environmental live-enable switch', () => {
  assert.doesNotMatch(source,/cloudRequest|findCloudPatient|process\.env|\/v1\/|require\(.+cloud/);
});
