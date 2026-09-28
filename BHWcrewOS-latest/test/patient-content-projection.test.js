const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { handler, safeSubmission } = require("../netlify/functions/patient-content-sync");
const { sign } = require("../netlify/functions/_lib");

function headers() {
  return { authorization: `Bearer ${sign({ staffId: "synthetic-content-staff", name: "Synthetic Staff", access: "Admin", exp: Date.now() + 60_000 })}` };
}

test("patient content sync drops clinical answers and creates a stable Operations projection", async () => {
  const originalFetch = global.fetch;
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWHQ_CARE_TOKEN_SECRET = "synthetic-care-secret";
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = "synthetic-operations-secret";
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.BHW_MEDICATION_API_URL = "https://medication.example.test";
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://medication.example.test")) {
      return new Response(JSON.stringify({ submissions: [{
        id: "submission-synthetic-0001",
        patientId: "BHW0000",
        contentPath: "/bhw-medication-request.html",
        status: "new",
        priority: "same_day_review",
        submittedAt: "2026-08-26T15:45:00.000Z",
        responses: { medicationName: "Do not copy this", pillsRemaining: "3" },
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = JSON.parse(init.body);
    assert.deepEqual(body, {
      sourceRecordId: "submission-synthetic-0001",
      bhwPatientId: "BHW0000",
      contentPath: "/bhw-medication-request.html",
      sourceStatus: "new",
      priority: "time-sensitive",
      submittedAt: "2026-08-26T15:45:00.000Z",
    });
    assert.doesNotMatch(init.body, /Do not copy this|pillsRemaining|responses/);
    return new Response(JSON.stringify({ request: { id: "content-synthetic-request" }, replayed: false }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await handler({ httpMethod: "POST", headers: headers(), body: "{}" });
    assert.equal(response.statusCode, 200);
    const result = JSON.parse(response.body);
    assert.equal(result.projectedCount, 1);
    assert.equal(result.results[0].requestId, "content-synthetic-request");
    const careClaims = JSON.parse(Buffer.from(calls[0].init.headers.Authorization.slice(7).split(".")[0], "base64url").toString("utf8"));
    assert.equal(careClaims.aud, "bhw-care-cloud");
    assert.equal(calls[1].url, "https://operations.example.test/v1/patient-content-projections");
    assert.match(calls[1].init.headers.Authorization, /^Bearer /);
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPERATIONS_CLOUD_API_URL;
    delete process.env.BHW_MEDICATION_API_URL;
  }
});

test("patient content bridge blocks records without canonical identifiers", () => {
  assert.equal(safeSubmission({ id: "short", patientId: "BHW0000", contentPath: "/form.html" }), null);
  assert.equal(safeSubmission({ id: "submission-valid-0001", patientId: "Patient Name", contentPath: "/form.html" }), null);
});

test("Care Management shows source-linked patient activity without adding minutes", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "bhw-care-management.html"), "utf8");
  const readSide = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "care-log-data.js"), "utf8");
  assert.match(page, /Patient tracking & communications/);
  assert.match(page, /these rows do not add billable minutes/);
  assert.match(page, /Open request & log/);
  assert.match(readSide, /source=patient-medication-html/);
  assert.match(readSide, /source=patient-content-html/);
  assert.match(readSide, /source=care-connect/);
  assert.doesNotMatch(readSide, /medicationName|pillsRemaining/);
});

test("medication intake links directly to its projected request and communication history", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "bhw-medication-request-links.html"), "utf8");
  assert.match(page, /patient-content-sync/);
  assert.match(page, /Request & communication log/);
  assert.match(page, /bhw-requests\.html\?request=/);
});
