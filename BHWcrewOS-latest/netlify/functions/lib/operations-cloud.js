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

module.exports = { apiBase, intakeConfigured, safeSubmissionId, createCloudIntake };
