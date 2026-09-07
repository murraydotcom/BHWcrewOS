const assert = require("node:assert/strict");
const test = require("node:test");
const { handler } = require("../netlify/functions/referral-sync");

test("Front Desk referral bridge sends only patient-linked coordination metadata", async () => {
  const originalFetch = global.fetch;
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.FRONT_DESK_INTAKE_SECRET = "synthetic-front-secret";
  process.env.FRONT_DESK_CLIENT_ID = "front-desk-os";
  process.env.DASH_KEY = "synthetic-dashboard-key";
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      patientRequest: { patientRequestId: "REQ-synthetic-referral-0001", version: 1, status: "referral_received" },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await handler({
      httpMethod: "POST",
      queryStringParameters: { key: "synthetic-dashboard-key" },
      body: JSON.stringify({
        action: "create",
        bhwPatientId: "BHW0000",
        destination: "Endocrinology",
        idempotencyKey: "front-desk-referral:synthetic-0001",
      }),
    });
    assert.equal(result.statusCode, 201);
    const body = JSON.parse(result.body);
    assert.equal(body.requestId, "REQ-synthetic-referral-0001");
    assert.equal(calls[0].url, "https://operations.example.test/v1/intake/front-desk-referrals");
    assert.equal(calls[0].init.headers["X-BHW-Client-Id"], "front-desk-os");
    assert.equal(calls[0].body.bhwPatientId, "BHW0000");
    assert.equal(calls[0].body.sourceMetadata.referralDestination, "Endocrinology");
    assert.doesNotMatch(JSON.stringify(calls[0].body), /patient name|date of birth|diagnosis|brief history/i);
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPERATIONS_CLOUD_API_URL;
    delete process.env.FRONT_DESK_INTAKE_SECRET;
    delete process.env.FRONT_DESK_CLIENT_ID;
    delete process.env.DASH_KEY;
  }
});

test("Front Desk referral bridge fails closed without its server secret", async () => {
  delete process.env.OPERATIONS_CLOUD_API_URL;
  delete process.env.FRONT_DESK_INTAKE_SECRET;
  const result = await handler({ httpMethod: "POST", queryStringParameters: {}, body: JSON.stringify({ action: "create" }) });
  assert.equal(result.statusCode, 503);
});

test("Front Desk keeps scheduled as a milestone before referral completion", async () => {
  const originalFetch = global.fetch;
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.FRONT_DESK_INTAKE_SECRET = "synthetic-front-secret";
  process.env.FRONT_DESK_CLIENT_ID = "front-desk-os";
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ request: { id: "REQ-synthetic-referral-0002", version: calls.length + 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    for (const [status, idempotencyKey] of [
      ["scheduled", "front-desk-referral-scheduled:synthetic-0002"],
      ["referral_completed", "front-desk-referral-completed:synthetic-0002"],
    ]) {
      const result = await handler({
        httpMethod: "POST",
        queryStringParameters: {},
        body: JSON.stringify({ action: "milestone", requestId: "REQ-synthetic-referral-0002", status, idempotencyKey }),
      });
      assert.equal(result.statusCode, 200);
    }
    assert.equal(calls[0].body.action, "milestone");
    assert.equal(calls[0].body.status, "scheduled");
    assert.equal(calls[1].body.action, "resolve");
    assert.equal(calls[1].body.outcome, "referral_completed");
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPERATIONS_CLOUD_API_URL;
    delete process.env.FRONT_DESK_INTAKE_SECRET;
    delete process.env.FRONT_DESK_CLIENT_ID;
  }
});
