import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import handler from "../netlify/functions/hets-preventive-compliance.mjs";

const SESSION_SECRET = "synthetic-compliance-session-secret";
const CLOUD_SECRET = "synthetic-compliance-cloud-secret";

function sessionToken(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({
    staffId: "synthetic-compliance",
    name: "Synthetic Compliance Reviewer",
    role: "Compliance Specialist",
    access: "Staff",
    scope: "clinical",
    authTime: Date.now(),
    exp: Date.now() + 60_000,
    ...overrides,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function post(body, token = sessionToken()) {
  return new Request("https://crewhq.example/api/hets-preventive-compliance", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Compliance bridge requires recent PIN reauthentication and an authorized role", async () => {
  const priorNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => name === "SESSION_SECRET" ? SESSION_SECRET : "" } };
  try {
    const stale = await handler(post({ action: "list", bhwPatientId: "BHW0000" }, sessionToken({ authTime: Date.now() - 16 * 60_000 })));
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).clinicalReauthenticationRequired, true);
    const providerOnly = await handler(post({ action: "list", bhwPatientId: "BHW0000" }, sessionToken({ role: "Medical Assistant", access: "Staff" })));
    assert.equal(providerOnly.status, 403);
  } finally {
    globalThis.Netlify = priorNetlify;
  }
});

test("Compliance bridge forwards only BHW0000 with a compliance-scoped Health Core token", async () => {
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  const environment = new Map([
    ["SESSION_SECRET", SESSION_SECRET],
    ["CREWHQ_CLOUD_TOKEN_SECRET", CLOUD_SECRET],
    ["RCM_CLOUD_API_URL", "https://health-core.example"],
  ]);
  const outbound = [];
  globalThis.Netlify = { env: { get: (name) => environment.get(name) || "" } };
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ ok: true, queue: [], pendingCount: 0, careConnectPublished: false });
  };
  try {
    const result = await handler(post({ action: "list", bhwPatientId: "BHW0000" }));
    assert.equal(result.status, 200);
    assert.equal(outbound[0].url, "https://health-core.example/v1/hets/preventive-services/compliance-review");
    const claims = JSON.parse(Buffer.from(outbound[0].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(claims.healthRole, "compliance");
    assert.equal(claims.scope, "clinical");
    const blocked = await handler(post({ action: "list", bhwPatientId: "BHW1234" }));
    assert.equal(blocked.status, 403);
    assert.equal(outbound.length, 1);
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});
