const crypto = require("crypto");
const assert = require("node:assert/strict");
const test = require("node:test");
const { sign } = require("../netlify/functions/_lib");
const tokenHandler = require("../netlify/functions/operations-cloud-token").handler;
const configHandler = require("../netlify/functions/operations-cloud-config").handler;

function sessionToken(overrides = {}) {
  return sign({
    staffId: "synthetic-staff-id",
    name: "Synthetic Front Desk",
    role: "front-desk",
    exp: Date.now() + 60_000,
    ...overrides,
  });
}

test("CrewOS exchanges a signed session for a five-minute operations token", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = "synthetic-operations-secret";
  const response = await tokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${sessionToken()}` },
  });
  assert.equal(response.statusCode, 200);
  const token = JSON.parse(response.body).token;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", process.env.CREWOS_OPERATIONS_TOKEN_SECRET).update(payload).digest("base64url");
  assert.equal(signature, expected);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.iss, "bhw-crewhq");
  assert.equal(claims.aud, "bhw-operations-cloud");
  assert.equal(claims.sub, "crew:synthetic-staff-id");
  assert.equal(claims.role, "front-desk");
  assert.ok(claims.exp - claims.iat <= 300);
});

test("CrewOS Admin access receives operations-manager queue visibility", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = "synthetic-operations-secret";
  const response = await tokenHandler({
    httpMethod: "POST",
    headers: {
      authorization: `Bearer ${sessionToken({
        name: "Synthetic Clinical Admin",
        role: "CRNP/FNP",
        access: "Admin",
      })}`,
    },
  });
  assert.equal(response.statusCode, 200);
  const [payload] = JSON.parse(response.body).token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.role, "operations-manager");
});

test("operations token exchange fails closed", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWOS_OPERATIONS_TOKEN_SECRET = "synthetic-operations-secret";
  let response = await tokenHandler({ httpMethod: "POST", headers: {} });
  assert.equal(response.statusCode, 401);

  delete process.env.CREWOS_OPERATIONS_TOKEN_SECRET;
  response = await tokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${sessionToken()}` },
  });
  assert.equal(response.statusCode, 503);
});

test("operations config exposes only HTTPS Cloud Run URLs", async () => {
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test/base/";
  let response = await configHandler({ httpMethod: "GET" });
  assert.deepEqual(JSON.parse(response.body), { ok: true, enabled: true, apiBase: "https://operations.example.test/base" });

  process.env.OPERATIONS_CLOUD_API_URL = "http://operations.example.test";
  response = await configHandler({ httpMethod: "GET" });
  assert.equal(JSON.parse(response.body).enabled, false);
});
