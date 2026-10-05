import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import handler from "../netlify/functions/hets-preventive-review.mjs";

const SESSION_SECRET = "synthetic-session-secret";
const CLOUD_SECRET = "synthetic-cloud-secret";

function sessionToken(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({
    staffId: "synthetic-provider",
    name: "Synthetic Provider",
    role: "Family Nurse Practitioner",
    scope: "clinical",
    authTime: Date.now(),
    exp: Date.now() + 60_000,
    ...overrides,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function post(body, token = sessionToken()) {
  return new Request("https://crewhq.example/api/hets-preventive-review", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("HETS review proxy requires a recent provider clinical session", async () => {
  const priorNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => name === "SESSION_SECRET" ? SESSION_SECRET : "" } };
  try {
    const unsigned = await handler(new Request("https://crewhq.example/api/hets-preventive-review", { method: "POST" }));
    assert.equal(unsigned.status, 401);
    const stale = await handler(post({ action: "preview" }, sessionToken({ authTime: Date.now() - 16 * 60_000 })));
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).clinicalReauthenticationRequired, true);
    const staff = await handler(post({ action: "preview" }, sessionToken({ role: "Front Desk" })));
    assert.equal(staff.status, 403);
  } finally {
    globalThis.Netlify = priorNetlify;
  }
});

test("HETS review proxy forwards normalized measures through the protected Health Core bridge", async () => {
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  const environment = new Map([
    ["SESSION_SECRET", SESSION_SECRET],
    ["CREWHQ_CLOUD_TOKEN_SECRET", CLOUD_SECRET],
    ["RCM_CLOUD_API_URL", "https://rcm-cloud.example"],
  ]);
  const outbound = [];
  globalThis.Netlify = { env: { get: (name) => environment.get(name) || "" } };
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({
      ok: true,
      saveState: "not-saved",
      previewToken: "synthetic-preview-token",
      preview: { records: [{ bhwPatientId: "BHW0000", measureId: "hearing-audiology-assessment" }], issues: [] },
    });
  };
  try {
    const result = await handler(post({
      action: "preview",
      bhwPatientId: "BHW0000",
      sourceUpdatedAt: "2026-10-03T10:00:00Z",
      measures: [{
        measureId: "hearing-audiology-assessment",
        sourceCodes: ["92552", "92557"],
        clinicalDisposition: "needs-review",
      }],
    }));
    assert.equal(result.status, 200);
    assert.equal(outbound[0].url, "https://rcm-cloud.example/v1/hets/preventive-services/preview");
    assert.equal(outbound[0].body.bhwPatientId, "BHW0000");
    assert.deepEqual(outbound[0].body.measures[0].sourceCodes, ["92552", "92557"]);
    const claims = JSON.parse(Buffer.from(outbound[0].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(claims.aud, "bhw-rcm-cloud");
    assert.equal(claims.scope, "clinical");
    assert.equal(claims.healthRole, "provider");
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});

test("HETS review proxy blocks real patients before calling Health Core", async () => {
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  let called = false;
  const environment = new Map([
    ["SESSION_SECRET", SESSION_SECRET],
    ["CREWHQ_CLOUD_TOKEN_SECRET", CLOUD_SECRET],
    ["RCM_CLOUD_API_URL", "https://rcm-cloud.example"],
  ]);
  globalThis.Netlify = { env: { get: (name) => environment.get(name) || "" } };
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true }); };
  try {
    const result = await handler(post({ action: "preview", bhwPatientId: "BHW1234", measures: [] }));
    assert.equal(result.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});

test("HETS chart workflow exposes normalized review and keeps release gates visible", async () => {
  const [html, index] = await Promise.all([
    readFile(new URL("../provider/preventive.html", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(index, /Review HETS in Health Core/);
  assert.match(index, /Health Core update gated/);
  assert.match(html, /CMS HETS benefit review/);
  assert.match(html, /eligibility alone can never supply that basis/i);
  assert.match(html, /clinical-login/);
  assert.match(html, /No order, referral, claim, or invoice will be created/i);
  assert.match(index, /source=hets/);
  const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new Function(moduleScript));
});
