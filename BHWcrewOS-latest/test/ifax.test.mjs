import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createIFaxClient, normalizeFaxNumber } = require('../netlify/functions/lib/ifax.js');
const { sign } = require('../netlify/functions/_lib.js');
const { handler } = require('../netlify/functions/frontdesk-data.js');

test('iFax normalizes US fax numbers and rejects ambiguous values', () => {
  assert.equal(normalizeFaxNumber('(833) 258-3941'), '+18332583941');
  assert.equal(normalizeFaxNumber('+1 833 258 3941'), '+18332583941');
  assert.throws(() => normalizeFaxNumber('3941'), /invalid fax number/);
});

test('iFax sends a PDF with the API key only in the request header', async () => {
  const calls = [];
  const ifax = createIFaxClient({
    apiKey: 'synthetic-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { status: 1, data: { jobId: 12345 } }; } };
    },
  });
  const result = await ifax.sendPdf({
    to: '(833) 258-3941',
    pdfBytes: Buffer.from('%PDF-1.7 synthetic'),
    filename: 'BHW0000 referral.pdf',
  });

  assert.deepEqual(result, { jobId: '12345', faxStatus: 'sending' });
  assert.equal(calls[0].url, 'https://api.ifaxapp.com/v1/customer/fax-send');
  assert.doesNotMatch(calls[0].url, /synthetic-secret/);
  assert.equal(calls[0].options.headers.accessToken, 'synthetic-secret');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.faxNumber, '+18332583941');
  assert.equal(body.faxData[0].fileName, 'BHW0000 referral.pdf');
  assert.equal(body.faxData[0].fileData, Buffer.from('%PDF-1.7 synthetic').toString('base64'));
});

test('iFax status reports delivery separately from API acceptance', async () => {
  const ifax = createIFaxClient({
    apiKey: 'synthetic-secret',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { status: 1, data: { jobId: 12345, faxStatus: 'delivered', faxTotalPages: 1, faxTransferredPages: 1, code: 0 } };
      },
    }),
  });
  const status = await ifax.getStatus('12345');
  assert.equal(status.delivered, true);
  assert.equal(status.terminal, true);
  assert.equal(status.faxStatus, 'delivered');
});

test('iFax fails closed without a key or valid PDF', async () => {
  const withoutKey = createIFaxClient({ apiKey: '' });
  await assert.rejects(withoutKey.sendPdf({ to: '(833) 258-3941', pdfBytes: Buffer.from('%PDF-1.7 synthetic') }), /IFAX_API_KEY not set/);

  const withKey = createIFaxClient({ apiKey: 'synthetic-secret' });
  await assert.rejects(withKey.sendPdf({ to: '(833) 258-3941', pdfBytes: Buffer.from('not a PDF') }), /must be a PDF/);
});

test('Front Desk fax endpoint requires a signed CrewOS session', async () => {
  const priorSessionSecret = process.env.SESSION_SECRET;
  const priorDashKey = process.env.DASH_KEY;
  process.env.SESSION_SECRET = 'synthetic-session-secret';
  delete process.env.DASH_KEY;
  try {
    const result = await handler({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({ action: 'fax', to: '(833) 258-3941', pdf: Buffer.from('%PDF-1.7 synthetic').toString('base64') }),
    });
    assert.equal(result.statusCode, 401);
    assert.match(result.body, /Sign in to CrewOS/);
  } finally {
    if (priorSessionSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = priorSessionSecret;
    if (priorDashKey === undefined) delete process.env.DASH_KEY; else process.env.DASH_KEY = priorDashKey;
  }
});

test('signed Front Desk fax returns accepted but never claims delivered', async () => {
  const prior = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    DASH_KEY: process.env.DASH_KEY,
    IFAX_API_KEY: process.env.IFAX_API_KEY,
    fetch: global.fetch,
  };
  process.env.SESSION_SECRET = 'synthetic-session-secret';
  process.env.IFAX_API_KEY = 'synthetic-ifax-key';
  delete process.env.DASH_KEY;
  global.fetch = async () => ({ ok: true, status: 200, async json() { return { status: 1, data: { jobId: 12345 } }; } });
  try {
    const token = sign({ staffId: 'synthetic-staff', name: 'Synthetic Staff', role: 'front-desk', exp: Date.now() + 60_000 });
    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${token}` },
      queryStringParameters: {},
      body: JSON.stringify({ action: 'fax', to: '(833) 258-3941', pdf: Buffer.from('%PDF-1.7 synthetic').toString('base64') }),
    });
    const body = JSON.parse(result.body);
    assert.equal(result.statusCode, 202);
    assert.equal(body.accepted, true);
    assert.equal(body.delivered, false);
    assert.equal(body.jobId, '12345');
  } finally {
    global.fetch = prior.fetch;
    for (const key of ['SESSION_SECRET', 'DASH_KEY', 'IFAX_API_KEY']) {
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
  }
});
