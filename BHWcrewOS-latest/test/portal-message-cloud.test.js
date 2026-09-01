const assert = require("node:assert/strict");
const test = require("node:test");
const portalHandler = require("../netlify/functions/portal-message").handler;

test("Care Connect browser bridge forwards synthetic intake through the server-side secret", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.OPERATIONS_CLOUD_API_URL;
    delete process.env.CARE_CONNECT_INTAKE_SECRET;
    delete process.env.CARE_CONNECT_CLIENT_ID;
    delete process.env.NOTION_TOKEN;
    delete process.env.QUEUE_DB_ID;
  });
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.CARE_CONNECT_INTAKE_SECRET = "synthetic-intake-secret";
  process.env.CARE_CONNECT_CLIENT_ID = "care-connect";
  delete process.env.NOTION_TOKEN;
  delete process.env.QUEUE_DB_ID;

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 201,
      async json() {
        return { ok: true, patientRequest: { patientRequestId: "REQ-synthetic-0001" } };
      },
    };
  };

  const response = await portalHandler({
    httpMethod: "POST",
    headers: { origin: "https://careconnect.netlify.app" },
    body: JSON.stringify({
      name: "Synthetic Patient",
      message: "Please call me about a synthetic request.",
      submissionId: "cc:synthetic-0001",
      hp: "",
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).requestId, "REQ-synthetic-0001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://operations.example.test/v1/intake/patient-requests");
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-intake-secret");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "cc:synthetic-0001");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.bhwPatientId, "");
  assert.equal(payload.patientMatchStatus, "unmatched");
  assert.equal(payload.routing.targetSystem, "crewos");
  assert.equal(payload.requester.displayName, "Synthetic Patient");
});

test("Care Connect bridge fails closed instead of writing a legacy Notion queue", async (t) => {
  t.after(() => {
    delete process.env.OPERATIONS_CLOUD_API_URL;
    delete process.env.CARE_CONNECT_INTAKE_SECRET;
    delete process.env.NOTION_TOKEN;
    delete process.env.QUEUE_DB_ID;
  });
  delete process.env.OPERATIONS_CLOUD_API_URL;
  delete process.env.CARE_CONNECT_INTAKE_SECRET;
  process.env.NOTION_TOKEN = "synthetic-legacy-token";
  process.env.QUEUE_DB_ID = "synthetic-legacy-queue";

  const response = await portalHandler({
    httpMethod: "POST",
    headers: { origin: "https://careconnect.netlify.app" },
    body: JSON.stringify({ name: "Synthetic Patient", message: "Synthetic request", hp: "" }),
  });
  assert.equal(response.statusCode, 503);
});
