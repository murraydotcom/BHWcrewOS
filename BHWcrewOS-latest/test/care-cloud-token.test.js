const crypto = require("crypto");
const assert = require("node:assert/strict");
const test = require("node:test");
const { sign } = require("../netlify/functions/_lib");
const tokenHandler = require("../netlify/functions/care-cloud-token").handler;

function sessionToken() {
  return sign({
    staffId: "synthetic-staff-id",
    name: "Synthetic Care Staff",
    role: "Care Manager",
    exp: Date.now() + 60_000,
  });
}

test("CrewOS session exchanges for a five-minute care token", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWHQ_CARE_TOKEN_SECRET = "synthetic-care-secret";
  const response = await tokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${sessionToken()}` },
  });
  assert.equal(response.statusCode, 200);
  const token = JSON.parse(response.body).token;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", process.env.CREWHQ_CARE_TOKEN_SECRET).update(payload).digest("base64url");
  assert.equal(signature, expected);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.iss, "bhw-crewhq");
  assert.equal(claims.aud, "bhw-care-cloud");
  assert.equal(claims.sub, "crew:synthetic-staff-id");
  assert.ok(claims.exp - claims.iat <= 300);
});

test("care-token exchange fails closed without a signed CrewOS session", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  process.env.CREWHQ_CARE_TOKEN_SECRET = "synthetic-care-secret";
  const response = await tokenHandler({ httpMethod: "POST", headers: {} });
  assert.equal(response.statusCode, 401);
});

test("care-token exchange fails closed without its dedicated secret", async () => {
  process.env.SESSION_SECRET = "synthetic-session-secret";
  delete process.env.CREWHQ_CARE_TOKEN_SECRET;
  const response = await tokenHandler({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${sessionToken()}` },
  });
  assert.equal(response.statusCode, 503);
});
