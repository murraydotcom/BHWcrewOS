import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/frontdesk-data.js');

const SESSION_SECRET = 'synthetic-frontdesk-session-secret';
function signedHeaders() {
  process.env.SESSION_SECRET = SESSION_SECRET;
  const payload = Buffer.from(JSON.stringify({
    staffId: 'staff-synthetic',
    name: 'Synthetic Staff',
    access: 'Admin',
    divisions: ['Front Desk'],
    exp: Date.now() + 60_000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return { authorization: `Bearer ${payload}.${signature}` };
}

test('Front Desk resolves reserved BHW0000 only by its exact synthetic ID', async () => {
  const response = await handler({
    httpMethod: 'GET',
    headers: signedHeaders(),
    queryStringParameters: { q: 'BHW0000' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');

  const body = JSON.parse(response.body);
  assert.equal(body.patient.bhwPatientId, 'BHW0000');
  assert.equal(body.patient.status, 'synthetic-test');
  assert.equal(Object.hasOwn(body.patient, 'notionPageId'), false);
  assert.deepEqual(body.requests, []);
  assert.deepEqual(body.matches.map((patient) => patient.ctl), ['BHW0000']);
  assert.doesNotMatch(response.body, /@|410-\d{3}-\d{4}/);
});

test('Front Desk resolves BHW0000 direct lookup without querying a live patient record', async () => {
  const response = await handler({
    httpMethod: 'GET',
    headers: signedHeaders(),
    queryStringParameters: { pid: 'bhw0000' },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.patient.bhwPatientId, 'BHW0000');
  assert.equal(body.patient.name, 'Synthetic QA');
});

test('an accepted Front Desk text moves the request to the communication log exactly once', async () => {
  const previousUrl = process.env.OPERATIONS_CLOUD_API_URL;
  const previousSecret = process.env.CREWOS_OPERATIONS_TOKEN_SECRET;
  const previousFetch = global.fetch;
  const calls = [];
  process.env.OPERATIONS_CLOUD_API_URL = 'https://operations.example';
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = 'synthetic-operations-secret';
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).endsWith('/messages')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 'sent', communicationId: 'synthetic-communication-001' }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, request: { status: 'in_progress', statusCategory: 'in_progress' } }) };
  };
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: signedHeaders(),
      queryStringParameters: {},
      body: JSON.stringify({
        action: 'sms',
        pageId: 'synthetic-request-001',
        text: 'Please call us at 443-762-5343.',
        noPhiAttestation: true,
        idempotencyKey: 'frontdesk-reply:synthetic-001',
      }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).movedToCommunicationLog, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.idempotencyKey, 'frontdesk-reply:synthetic-001');
    assert.equal(calls[1].body.action, 'start');
    assert.equal(calls[1].body.responseCommunicationId, 'synthetic-communication-001');
    assert.equal(calls[1].body.idempotencyKey, 'frontdesk-reply:synthetic-001:move-to-communication-log');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.OPERATIONS_CLOUD_API_URL; else process.env.OPERATIONS_CLOUD_API_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CREWOS_OPERATIONS_TOKEN_SECRET; else process.env.CREWOS_OPERATIONS_TOKEN_SECRET = previousSecret;
  }
});

test('a suppressed Front Desk text stays visible for correction', async () => {
  const previousUrl = process.env.OPERATIONS_CLOUD_API_URL;
  const previousSecret = process.env.CREWOS_OPERATIONS_TOKEN_SECRET;
  const previousFetch = global.fetch;
  let calls = 0;
  process.env.OPERATIONS_CLOUD_API_URL = 'https://operations.example';
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = 'synthetic-operations-secret';
  global.fetch = async () => {
    calls += 1;
    return { ok: true, status: 202, json: async () => ({ ok: true, status: 'suppressed', statusReason: 'automation-not-enabled', communicationId: 'synthetic-suppressed-001' }) };
  };
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: signedHeaders(),
      queryStringParameters: {},
      body: JSON.stringify({
        action: 'sms',
        pageId: 'synthetic-request-002',
        text: 'Please call us at 443-762-5343.',
        noPhiAttestation: true,
        idempotencyKey: 'frontdesk-reply:synthetic-002',
      }),
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 202);
    assert.equal(body.movedToCommunicationLog, false);
    assert.equal(calls, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.OPERATIONS_CLOUD_API_URL; else process.env.OPERATIONS_CLOUD_API_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CREWOS_OPERATIONS_TOKEN_SECRET; else process.env.CREWOS_OPERATIONS_TOKEN_SECRET = previousSecret;
  }
});
