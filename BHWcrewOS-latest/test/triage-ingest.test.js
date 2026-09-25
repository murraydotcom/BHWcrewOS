const test = require("node:test");
const assert = require("node:assert/strict");
const { createQueueEntry } = require("../netlify/functions/lib/triage");

test("inbound retries keep one stable idempotency key and fit the protected intake contract", async () => {
  const prior = {
    url: process.env.OPERATIONS_CLOUD_API_URL,
    secret: process.env.FRONT_DESK_INTAKE_SECRET,
    client: process.env.FRONT_DESK_CLIENT_ID,
    fetch: global.fetch,
  };
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.FRONT_DESK_INTAKE_SECRET = "synthetic-secret";
  process.env.FRONT_DESK_CLIENT_ID = "front-desk-os";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 201, async json() { return { ok: true }; } };
  };
  try {
    const input = {
      patientId: "",
      patientName: "Synthetic ".repeat(30),
      from: "+1 410 555 0100",
      summary: "Synthetic detail ".repeat(500),
      source: "Fax",
      sourceUrl: `https://example.test/${"x".repeat(1400)}`,
      sourceRecordId: "provider-fax-synthetic-0001",
    };
    await createQueueEntry({ ...input, receivedISO: "2026-09-25T12:00:00.000Z" });
    await createQueueEntry({ ...input, receivedISO: "2026-09-25T12:05:00.000Z" });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers["Idempotency-Key"], calls[1].options.headers["Idempotency-Key"]);
    assert.equal(calls[0].body.summary.length, 500);
    assert.equal(calls[0].body.message.length, 4000);
    assert.equal(calls[0].body.requester.displayName.length, 120);
    assert.equal(calls[0].body.sourceMetadata.sourceUrl.length, 1000);
  } finally {
    global.fetch = prior.fetch;
    if (prior.url === undefined) delete process.env.OPERATIONS_CLOUD_API_URL; else process.env.OPERATIONS_CLOUD_API_URL = prior.url;
    if (prior.secret === undefined) delete process.env.FRONT_DESK_INTAKE_SECRET; else process.env.FRONT_DESK_INTAKE_SECRET = prior.secret;
    if (prior.client === undefined) delete process.env.FRONT_DESK_CLIENT_ID; else process.env.FRONT_DESK_CLIENT_ID = prior.client;
  }
});

test("fallback fingerprint does not use local processing time", async () => {
  const prior = {
    url: process.env.OPERATIONS_CLOUD_API_URL,
    secret: process.env.FRONT_DESK_INTAKE_SECRET,
    fetch: global.fetch,
  };
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.FRONT_DESK_INTAKE_SECRET = "synthetic-secret";
  const keys = [];
  global.fetch = async (_url, options) => {
    keys.push(options.headers["Idempotency-Key"]);
    return { ok: true, status: 201, async json() { return { ok: true }; } };
  };
  try {
    const input = { from: "+14105550100", summary: "Synthetic inbound fax", source: "Fax" };
    await createQueueEntry(input);
    await createQueueEntry(input);
    assert.equal(keys[0], keys[1]);
  } finally {
    global.fetch = prior.fetch;
    if (prior.url === undefined) delete process.env.OPERATIONS_CLOUD_API_URL; else process.env.OPERATIONS_CLOUD_API_URL = prior.url;
    if (prior.secret === undefined) delete process.env.FRONT_DESK_INTAKE_SECRET; else process.env.FRONT_DESK_INTAKE_SECRET = prior.secret;
  }
});
