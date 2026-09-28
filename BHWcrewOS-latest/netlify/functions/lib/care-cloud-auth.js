const crypto = require("crypto");

const AUDIENCE = "bhw-care-cloud";

function careCloudToken(session = {}, { now = Date.now(), secret = process.env.CREWHQ_CARE_TOKEN_SECRET } = {}) {
  if (!secret) throw new Error("CrewHQ care access is not configured");
  const seconds = Math.floor(now / 1000);
  const claims = {
    sub: `crew:${session.staffId}`,
    staffId: session.staffId,
    name: session.name || "CrewOS staff",
    role: session.role || "staff",
    iss: "bhw-crewhq",
    aud: AUDIENCE,
    iat: seconds,
    exp: seconds + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function medicationApiBase() {
  const configured = process.env.BHW_MEDICATION_API_URL
    || "https://bhw-medication-api-343692256275.us-east4.run.app";
  try {
    const url = new URL(configured);
    return url.protocol === "https:" ? `${url.origin}${url.pathname.replace(/\/$/, "")}` : "";
  } catch {
    return "";
  }
}

module.exports = { AUDIENCE, careCloudToken, medicationApiBase };
