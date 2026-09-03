const crypto = require("crypto");

function apiBase() {
  try {
    const url = new URL(String(process.env.OPERATIONS_CLOUD_API_URL || ""));
    if (url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function intakeConfigured() {
  return Boolean(apiBase() && process.env.CARE_CONNECT_INTAKE_SECRET);
}

function operationsToken(actor = {}) {
  const secret = process.env.CREWOS_OPERATIONS_TOKEN_SECRET;
  if (!secret) throw new Error("CREWOS_OPERATIONS_TOKEN_SECRET is not configured");
  const now = Math.floor(Date.now() / 1000);
  const access = String(actor.access || "").toLowerCase();
  const claims = {
    sub: `crew:${actor.staffId || actor.sub || "server"}`,
    staffId: actor.staffId || actor.sub || "server",
    name: actor.name || "CrewOS server",
    role: access === "admin" ? "operations-manager" : (actor.role || "staff"),
    iss: "bhw-crewhq",
    aud: "bhw-operations-cloud",
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function operationsRequest(path, { actor, method = "GET", body, fetchImpl = fetch } = {}) {
  const base = apiBase();
  if (!base) throw new Error("OPERATIONS_CLOUD_API_URL is not configured");
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${operationsToken(actor)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Google Operations request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function safeSubmissionId(value) {
  const supplied = String(value || "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(supplied)) return supplied;
  return `portal:${crypto.randomUUID()}`;
}

async function createCloudIntake(input, { fetchImpl = fetch } = {}) {
  const base = apiBase();
  if (!base || !process.env.CARE_CONNECT_INTAKE_SECRET) return null;
  const idempotencyKey = safeSubmissionId(input.submissionId);
  const response = await fetchImpl(`${base}/v1/intake/patient-requests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CARE_CONNECT_INTAKE_SECRET}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-BHW-Client-Id": process.env.CARE_CONNECT_CLIENT_ID || "care-connect",
    },
    body: JSON.stringify(input.body),
  });
  let data = {};
  try { data = await response.json(); } catch { /* keep a generic downstream error */ }
  if (!response.ok) {
    const error = new Error(data.error || "operations intake failed");
    error.status = response.status;
    throw error;
  }
  return { ...data, idempotencyKey };
}

async function createFrontDeskIntake(input, { fetchImpl = fetch } = {}) {
  const base = apiBase();
  if (!base || !process.env.FRONT_DESK_INTAKE_SECRET) return null;
  const idempotencyKey = safeSubmissionId(input.submissionId);
  const response = await fetchImpl(`${base}/v1/intake/front-desk-patient-requests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FRONT_DESK_INTAKE_SECRET}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-BHW-Client-Id": process.env.FRONT_DESK_CLIENT_ID || "front-desk-os",
    },
    body: JSON.stringify(input.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "front desk intake failed");
    error.status = response.status;
    throw error;
  }
  return { ...data, idempotencyKey };
}

module.exports = { apiBase, intakeConfigured, safeSubmissionId, createCloudIntake, createFrontDeskIntake, operationsRequest };
