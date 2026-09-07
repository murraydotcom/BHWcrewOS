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
