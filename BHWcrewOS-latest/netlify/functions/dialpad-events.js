// netlify/functions/dialpad-events.js
// Receives signed Dialpad Event Subscription webhooks, verifies them, and
// forwards the original signed payload to the Google workflow API. Cloud Run
// owns event filtering, idempotency, patient matching, communications, and
// Patient Requests. This remains a direct webhook path with no middleware.
//
// Required env: DIALPAD_WEBHOOK_SECRET, RCM_CLOUD_API_URL

const { parseDialpadBody } = require("./lib/triage");

function safeCloudBase(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.origin + url.pathname.replace(/\/$/, "") : "";
  } catch { return ""; }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "method not allowed" };

    // Fail closed: require the signing secret so this is never an open write.
    if (!process.env.DIALPAD_WEBHOOK_SECRET) return { statusCode: 503, body: "DIALPAD_WEBHOOK_SECRET not set" };

    // Netlify may base64-encode the request body (depends on content-type);
    // decode so the raw JWT reaches the verifier intact.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    let payload;
    try { payload = parseDialpadBody(rawBody, process.env.DIALPAD_WEBHOOK_SECRET); }
    catch { return { statusCode: 400, body: "bad payload" }; }
    if (payload === null) return { statusCode: 401, body: "bad signature or unrecognized payload" };

    // Google Cloud is the workflow source of truth. Preserve the already-signed
    // JWT body so Cloud Run independently verifies it and performs idempotent
    // patient matching, suppression handling, communication logging and queueing.
    const cloudBase = safeCloudBase(process.env.RCM_CLOUD_API_URL);
    if (!cloudBase) return { statusCode: 503, body: "Google workflow API is not configured" };
    const response = await fetch(`${cloudBase}/v1/webhooks/dialpad`, {
      method: "POST",
      headers: { "Content-Type": "application/jwt" },
      body: rawBody,
    });
    const body = await response.text();
    return {
      statusCode: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
      body,
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
