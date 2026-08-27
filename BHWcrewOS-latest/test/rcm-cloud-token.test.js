const crypto = require("crypto");
const assert = require("node:assert/strict");
const test = require("node:test");
const { sign } = require("../netlify/functions/_lib");
const tokenHandler = require("../netlify/functions/rcm-cloud-token").handler;
const clinicalTokenHandler = require("../netlify/functions/bhw-capture-clinical-token").handler;
const configHandler = require("../netlify/functions/rcm-cloud-config").handler;

function sessionToken() {
  return sign({
    staffId: "synthetic-staff-id",
    name: "Synthetic Provider",
    role: "CRNP",
    exp: Date.now() + 60_000,
  });
}

test("CrewOS session exchanges for a short-lived CrewHQ cloud token", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWHQ_CLOUD_TOKEN_SECRET = "synthetic-crewhq-secret";
  const response = await tokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${sessionToken()}` },
  });
  assert.equal(response.statusCode, 200);
  const token = JSON.parse(response.body).token;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", process.env.CREWHQ_CLOUD_TOKEN_SECRET)
    .update(payload).digest("base64url");
  assert.equal(signature, expected);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.iss, "bhw-crewhq");
  assert.equal(claims.sub, "crew:synthetic-staff-id");
  assert.equal(claims.aud, "bhw-rcm-cloud");
  assert.ok(claims.exp - claims.iat <= 300);
});

test("CrewHQ token exchange fails closed without a valid CrewOS session", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWHQ_CLOUD_TOKEN_SECRET = "synthetic-crewhq-secret";
  const response = await tokenHandler({ httpMethod: "POST", headers: {} });
  assert.equal(response.statusCode, 401);
});

test("Clinical cloud exchange requires recent server-signed step-up authentication", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWHQ_CLOUD_TOKEN_SECRET = "synthetic-crewhq-secret";
  const ordinary = await clinicalTokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${sessionToken()}` },
  });
  assert.equal(ordinary.statusCode, 401);

  const futureSession = sign({
    staffId: "synthetic-staff-id",
    scope: "clinical",
    authTime: Date.now() + 2 * 60_000,
    exp: Date.now() + 15 * 60_000,
  });
  const future = await clinicalTokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${futureSession}` },
  });
  assert.equal(future.statusCode, 401);

  const clinicalSession = sign({
    staffId: "synthetic-staff-id",
    name: "Synthetic Provider",
    role: "CRNP",
    access: "Staff",
    scope: "clinical",
    authTime: Date.now(),
    exp: Date.now() + 15 * 60_000,
  });
  const response = await clinicalTokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${clinicalSession}` },
  });
  assert.equal(response.statusCode, 200);
  const token = JSON.parse(response.body).token;
  const [payload] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.scope, "clinical");
  assert.equal(claims.sub, "crew:synthetic-staff-id");
  assert.ok(claims.exp - claims.iat <= 300);
});

test("CrewHQ exposes only a configured HTTPS Cloud Run base URL", async () => {
  process.env.RCM_CLOUD_API_URL = "https://api.example.test/path/";
  let response = await configHandler({ httpMethod: "GET" });
  assert.deepEqual(JSON.parse(response.body), { ok: true, enabled: true, apiBase: "https://api.example.test/path" });
  process.env.RCM_CLOUD_API_URL = "http://unsafe.example.test";
  response = await configHandler({ httpMethod: "GET" });
  assert.equal(JSON.parse(response.body).enabled, false);
});

