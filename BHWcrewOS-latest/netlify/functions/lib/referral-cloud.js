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

function configured() {
  return Boolean(apiBase() && process.env.FRONT_DESK_INTAKE_SECRET);
}

function safeKey(value, prefix = "front-desk-referral") {
  const supplied = String(value || "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(supplied)) return supplied;
  return `${prefix}:${crypto.randomUUID()}`;
}

async function request(path, { body, idempotencyKey, fetchImpl = fetch } = {}) {
  if (!configured()) return null;
  const response = await fetchImpl(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FRONT_DESK_INTAKE_SECRET}`,
      "Content-Type": "application/json",
      "Idempotency-Key": safeKey(idempotencyKey),
      "X-BHW-Client-Id": process.env.FRONT_DESK_CLIENT_ID || "front-desk-os",
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "front desk referral sync failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function createReferral(input, options = {}) {
  return request("/v1/intake/front-desk-referrals", {
    ...options,
    idempotencyKey: input.idempotencyKey,
    body: input.body,
  });
}

async function updateReferral(input, options = {}) {
  const requestId = String(input.requestId || "").trim();
  if (!/^REQ-[A-Za-z0-9-]{8,80}$/.test(requestId)) throw new Error("valid referral requestId is required");
  return request(`/v1/intake/front-desk-referrals/${encodeURIComponent(requestId)}/actions`, {
    ...options,
    idempotencyKey: input.idempotencyKey,
    body: input.body,
  });
}

module.exports = { configured, safeKey, createReferral, updateReferral };
