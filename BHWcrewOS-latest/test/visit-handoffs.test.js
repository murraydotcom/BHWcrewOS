const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVisitHandoffsHandler } = require('../netlify/functions/visit-handoffs')._test;
const env = { SYNTHETIC_VISIT_HANDOFFS_ENABLED: 'true', HEALTH_CORE_API_URL: 'https://health.example.test', CREWHQ_CLOUD_TOKEN_SECRET: 'synthetic-crew-secret' };
const session = { staffId: 'frontdesk', role: 'staff' };
const command = { action: 'assign-follow-up', commandId: crypto.randomUUID(), expectedRevision: 1, resultId: 'result-' + 'a'.repeat(40), assignee: 'crew:frontdesk', dueAt: '2026-10-10T12:00:00Z' };
const event = body => ({ httpMethod: body ? 'POST' : 'GET', headers: {}, ...(body ? { body: JSON.stringify(body) } : {}) });
const inbox = { patientReference: 'BHW0000', revision: 1, results: [{ resultId: command.resultId, receivedAt: '2026-10-09T12:00:00Z', reviewStatus: 'needs-review', followUp: null, value: 'Private clinical value', interpretation: 'Private interpretation' }] };
test('CrewHQ bridge uses a short-lived metadata-only purpose token and strips clinical response fields', async () => {
  let observed;
  const handle = createVisitHandoffsHandler({ environment: env, sessionImpl: () => session, fetchImpl: async (url, options) => { observed = { url, options }; return Response.json({ ok: true, inbox, commandId: command.commandId, clinicalReport: 'Private report' }); } });
  const r = await handle(event(command)); assert.equal(r.statusCode, 200); assert.doesNotMatch(r.body, /Private|interpretation|clinicalReport|token/);
  const token = JSON.parse(Buffer.from(observed.options.headers.Authorization.slice(7).split('.')[0], 'base64url'));
  assert.equal(token.scope, 'visit-handoff-metadata'); assert.equal(token.exp - token.iat, 60); assert.equal(observed.options.redirect, 'error');
  assert.deepEqual(JSON.parse(observed.options.body), command);
});
test('staff metadata bridge rejects clinical commands, clinical fields, anonymous users and real patient requests', async () => {
  let calls = 0;
  const handle = createVisitHandoffsHandler({ environment: env, sessionImpl: () => session, fetchImpl: async () => { calls++; return Response.json({ ok: true, inbox }); } });
  for (const body of [{ ...command, action: 'receive-result' }, { ...command, completionNote: 'Private clinical note' }, { ...command, bhwPatientId: 'BHW1234' }]) assert.equal((await handle(event(body))).statusCode, 400);
  assert.equal((await handle({ ...event(), queryStringParameters: { patient: 'BHW1234' } })).statusCode, 403);
  assert.equal((await createVisitHandoffsHandler({ environment: env, sessionImpl: () => null })(event())).statusCode, 401); assert.equal(calls, 0);
  assert.equal((await createVisitHandoffsHandler({ environment: { ...env, SYNTHETIC_VISIT_HANDOFFS_ENABLED: 'false' }, sessionImpl: () => session })(event())).statusCode, 503);
});
test('uncertain writes require the same command receipt, while permission and stale-revision errors remain explicit', async () => {
  for (const status of [403, 409]) {
    const handle = createVisitHandoffsHandler({ environment: env, sessionImpl: () => session, fetchImpl: async () => Response.json({ ok: false, error: 'Synthetic rejection' }, { status }) });
    assert.equal((await handle(event(command))).statusCode, status);
  }
  const missing = createVisitHandoffsHandler({ environment: env, sessionImpl: () => session, fetchImpl: async () => Response.json({ ok: true, inbox }) });
  assert.equal(JSON.parse((await missing(event(command))).body).saveUnconfirmed, true);
  const unsafe = createVisitHandoffsHandler({ environment: { ...env, HEALTH_CORE_API_URL: 'https://user:secret@health.example.test' }, sessionImpl: () => session }); assert.equal((await unsafe(event())).statusCode, 503);
});
