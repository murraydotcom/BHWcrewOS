import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/frontdesk-data.js');

test('Front Desk resolves reserved BHW0000 only by its exact synthetic ID', async () => {
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { q: 'BHW0000' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');

  const body = JSON.parse(response.body);
  assert.equal(body.patient.bhwPatientId, 'BHW0000');
  assert.equal(body.patient.status, 'synthetic-test');
  assert.equal(body.patient.notionPageId, '');
  assert.deepEqual(body.requests, []);
  assert.deepEqual(body.matches.map((patient) => patient.ctl), ['BHW0000']);
  assert.doesNotMatch(response.body, /@|410-\d{3}-\d{4}/);
});

test('Front Desk resolves BHW0000 direct lookup without querying a live patient record', async () => {
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { pid: 'bhw0000' },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.patient.bhwPatientId, 'BHW0000');
  assert.equal(body.patient.name, 'Synthetic QA');
});
