const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../netlify/functions/dialpad-events").handler;

function signedDialpadEvent(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

test("verified Dialpad events forward unchanged to the Google workflow endpoint", async () => {
  const priorFetch = global.fetch;
  const priorSecret = process.env.DIALPAD_WEBHOOK_SECRET;
  const priorUrl = process.env.RCM_CLOUD_API_URL;
  process.env.DIALPAD_WEBHOOK_SECRET = "synthetic-dialpad-secret";
  process.env.RCM_CLOUD_API_URL = "https://api.example.test/";
  const jwt = signedDialpadEvent({ id: "synthetic-event-1", direction: "inbound", text: "Synthetic message" }, process.env.DIALPAD_WEBHOOK_SECRET);
  let forwarded;
  global.fetch = async (url, options) => {
    forwarded = { url, options };
    return new Response(JSON.stringify({ ok: true, matched: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await handler({ httpMethod: "POST", body: jwt });
    assert.equal(response.statusCode, 200);
    assert.equal(forwarded.url, "https://api.example.test/v1/webhooks/dialpad");
    assert.equal(forwarded.options.body, jwt);
    assert.equal(forwarded.options.headers["Content-Type"], "application/jwt");
  } finally {
    global.fetch = priorFetch;
    if (priorSecret === undefined) delete process.env.DIALPAD_WEBHOOK_SECRET; else process.env.DIALPAD_WEBHOOK_SECRET = priorSecret;
    if (priorUrl === undefined) delete process.env.RCM_CLOUD_API_URL; else process.env.RCM_CLOUD_API_URL = priorUrl;
  }
});

test("Dialpad forwarding fails closed without signing or Google Cloud configuration", async () => {
  const priorSecret = process.env.DIALPAD_WEBHOOK_SECRET;
  const priorUrl = process.env.RCM_CLOUD_API_URL;
  try {
    delete process.env.DIALPAD_WEBHOOK_SECRET;
    let response = await handler({ httpMethod: "POST", body: "unsigned" });
    assert.equal(response.statusCode, 503);
    process.env.DIALPAD_WEBHOOK_SECRET = "synthetic-dialpad-secret";
    delete process.env.RCM_CLOUD_API_URL;
    const jwt = signedDialpadEvent({ id: "synthetic-event-2", direction: "inbound", text: "Synthetic message" }, process.env.DIALPAD_WEBHOOK_SECRET);
    response = await handler({ httpMethod: "POST", body: jwt });
    assert.equal(response.statusCode, 503);
  } finally {
    if (priorSecret === undefined) delete process.env.DIALPAD_WEBHOOK_SECRET; else process.env.DIALPAD_WEBHOOK_SECRET = priorSecret;
    if (priorUrl === undefined) delete process.env.RCM_CLOUD_API_URL; else process.env.RCM_CLOUD_API_URL = priorUrl;
  }
});
