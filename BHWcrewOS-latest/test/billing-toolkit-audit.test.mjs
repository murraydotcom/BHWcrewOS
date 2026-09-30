import crypto from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createOperationsApp } from "../cloud/operations-api/app.mjs";
import { buildBillingToolkitAuditEvent } from "../cloud/operations-api/billing-toolkit-audit.mjs";

const require = createRequire(import.meta.url);
const { handler, safeBillingToolkitActivity } = require("../netlify/functions/billing-toolkit-audit");
const { sign } = require("../netlify/functions/_lib");

const NOW = new Date("2026-09-30T14:15:00.000Z");
const SECRET = "synthetic-billing-toolkit-secret";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function operationsToken() {
  const seconds = Math.floor(NOW.getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: "crew:synthetic-billing-staff",
    staffId: "synthetic-billing-staff",
    name: "Synthetic Billing Staff",
    role: "billing-specialist",
    iss: "bhw-crewhq",
    aud: "bhw-operations-cloud",
    iat: seconds - 10,
    exp: seconds + 300,
  })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

const calculated = {
  eventId: EVENT_ID,
  eventType: "billing-toolkit.audit-calculated",
  sessionId: SESSION_ID,
  section: "dashboard",
  summary: { audited: 8, pass: 5, review: 2, error: 1 },
};

test("Billing Toolkit audit builder stores staff-attributed metadata only", () => {
  const event = buildBillingToolkitAuditEvent(calculated, {
    id: "crew:synthetic-billing-staff",
    role: "billing-specialist",
  }, { now: NOW });

  assert.deepEqual(event.auditSummary, { audited: 8, pass: 5, review: 2, error: 1 });
  assert.equal(event.actorId, "crew:synthetic-billing-staff");
  assert.equal(event.eventType, "billing-toolkit.audit-calculated");
  assert.equal(event.occurredAt, NOW.toISOString());
  assert.equal(event.surface, "billing-toolkit");
  assert.equal(event.patientReference, undefined);
  assert.equal(event.bhwPatientId, undefined);
});

test("Billing Toolkit audit builder rejects extra fields and invalid duration semantics", () => {
  assert.throws(() => buildBillingToolkitAuditEvent({ ...calculated, patientName: "Must not cross this boundary" }, {
    id: "crew:synthetic-billing-staff", role: "staff",
  }, { now: NOW }), /unsupported fields/);
  assert.throws(() => buildBillingToolkitAuditEvent({
    eventId: EVENT_ID,
    eventType: "billing-toolkit.session-heartbeat",
    sessionId: SESSION_ID,
    section: "template",
    activeSeconds: 61,
    visibleSeconds: 60,
    reason: "interval",
  }, { id: "crew:synthetic-billing-staff", role: "staff" }, { now: NOW }), /cannot exceed/);
});

test("Operations API authenticates and idempotently routes Billing Toolkit activity", async () => {
  const captured = [];
  const repository = {
    async recordStaffActivity(event) {
      captured.push(event);
      return { event, replayed: false };
    },
  };
  const app = createOperationsApp({
    repository,
    environment: { CREWOS_OPERATIONS_TOKEN_SECRET: SECRET },
    now: () => NOW,
  });
  const response = await app(new Request("https://operations.example.test/v1/staff-activity/billing-toolkit", {
    method: "POST",
    headers: { Authorization: `Bearer ${operationsToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(calculated),
  }));

  assert.equal(response.status, 201);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].actorId, "crew:synthetic-billing-staff");
  assert.equal(captured[0].auditEventId, `AUD-BILLING-${EVENT_ID}`);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["auditEventId", "occurredAt", "ok", "replayed"]);

  const unauthorized = await app(new Request("https://operations.example.test/v1/staff-activity/billing-toolkit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(calculated),
  }));
  assert.equal(unauthorized.status, 401);
});

test("CrewHQ proxy independently rejects content fields and forwards only the allowlisted event", async () => {
  assert.throws(() => safeBillingToolkitActivity({ ...calculated, note: "Do not forward" }), /unsupported fields/);
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = SECRET;
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  const originalFetch = global.fetch;
  let forwarded;
  global.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, replayed: false, auditEventId: `AUD-BILLING-${EVENT_ID}`, occurredAt: NOW.toISOString() }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const session = sign({ staffId: "synthetic-billing-staff", name: "Synthetic Billing Staff", role: "billing-specialist", exp: Date.now() + 60_000 });
    const response = await handler({
      httpMethod: "POST",
      headers: { authorization: `Bearer ${session}` },
      body: JSON.stringify(calculated),
    });
    assert.equal(response.statusCode, 201);
    assert.equal(forwarded.url, "https://operations.example.test/v1/staff-activity/billing-toolkit");
    assert.deepEqual(JSON.parse(forwarded.init.body), calculated);
    assert.doesNotMatch(forwarded.init.body, /name|mrn|dob|note|code/i);
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPERATIONS_CLOUD_API_URL;
  }
});

test("Billing Toolkit page is protected and its browser audit never reads form contents", async () => {
  const [page, client] = await Promise.all([
    readFile(new URL("../BHW_Care_Management_Toolkit.html", import.meta.url), "utf8"),
    readFile(new URL("../billing-toolkit-audit.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<script src="\/crew-provider-gate\.js"><\/script>/);
  assert.match(page, /<script src="\/staff-chat-launcher\.js" defer><\/script>/);
  assert.match(page, /<script src="\/billing-toolkit-audit\.js" defer><\/script>/);
  assert.match(page, /BhwBillingToolkitAudit\?\.sectionViewed/);
  assert.match(page, /BhwBillingToolkitAudit\?\.auditCalculated/);
  assert.match(client, /billing-toolkit\.opened/);
  assert.match(client, /billing-toolkit\.session-heartbeat/);
  assert.match(client, /billing-toolkit\.session-ended/);
  assert.doesNotMatch(client, /FormData|\.value|innerText|textContent|input\[|textarea/i);
});
