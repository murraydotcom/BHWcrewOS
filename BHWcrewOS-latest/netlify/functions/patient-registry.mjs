import crypto from "node:crypto";

const PATIENT_FIELDS = [
  "bhwPatientId", "legalFirstName", "legalLastName", "nameSuffix", "preferredName", "dateOfBirth",
  "phone", "email", "patientStatus", "primaryPayer", "memberId", "coverageStatus",
  "referralSource", "responsibleStaff", "lastVerifiedAt",
];
const CONSENT_FIELDS = [
  "sourceType", "signedAt", "formVersion", "evidenceReference", "status",
  "verificationAttestation",
];

function response(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function env(name) {
  return String(Netlify.env.get(name) || "");
}

function verifyCrewSession(request) {
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [payload, signature, extra] = token.split(".");
  const secret = env("SESSION_SECRET");
  if (!payload || !signature || extra || !secret) return null;
  try {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || Date.now() > Number(session.exp)) return null;
    return session;
  } catch {
    return null;
  }
}

function safeApiBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function cloudToken(session) {
  const secret = env("CREWHQ_CLOUD_TOKEN_SECRET");
  if (!secret) throw Object.assign(new Error("CrewHQ cloud access is not configured"), { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: `crew:${session.staffId || "server"}`,
    staffId: session.staffId || "server",
    name: session.name || "CrewOS staff",
    role: session.role || "staff",
    access: session.access || "",
    iss: "bhw-crewhq",
    aud: "bhw-rcm-cloud",
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function cloudRequest(path, session, { method = "GET", body } = {}) {
  const base = safeApiBase(env("RCM_CLOUD_API_URL"));
  if (!base) throw Object.assign(new Error("Patient Registry cloud access is not configured"), { status: 503 });
  const cloudResponse = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cloudToken(session)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await cloudResponse.json().catch(() => ({}));
  if (!cloudResponse.ok) {
    throw Object.assign(new Error(result.error || `Patient Registry returned ${cloudResponse.status}`), { status: cloudResponse.status });
  }
  return result;
}

function patientId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^BHW\d{4}$/.test(id) || id === "BHW0000") {
    throw Object.assign(new Error("A verified BHW Patient ID is required"), { status: 400 });
  }
  return id;
}

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source?.[field] !== undefined).map((field) => [field, source[field]]));
}

export default async (request) => {
  if (request.method !== "POST") return response(405, { ok: false, error: "POST only" });
  const session = verifyCrewSession(request);
  if (!session) return response(401, { ok: false, error: "Signed out — sign in to CrewOS again." });

  let body;
  try {
    body = await request.json();
  } catch {
    return response(400, { ok: false, error: "Bad JSON" });
  }

  try {
    switch (body.action) {
      case "list":
        return response(200, await cloudRequest("/v1/patients", session));
      case "save-patient": {
        const patient = pick(body.patient, PATIENT_FIELDS);
        patient.bhwPatientId = patientId(patient.bhwPatientId);
        return response(200, await cloudRequest(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}`, session, { method: "PUT", body: patient }));
      }
      case "recording-consent": {
        const id = patientId(body.bhwPatientId);
        return response(200, await cloudRequest(`/v1/patients/${encodeURIComponent(id)}/recording-consent`, session));
      }
      case "save-recording-consent": {
        const id = patientId(body.bhwPatientId);
        const consent = pick(body.consent, CONSENT_FIELDS);
        return response(200, await cloudRequest(`/v1/patients/${encodeURIComponent(id)}/recording-consent`, session, { method: "PUT", body: consent }));
      }
      default:
        return response(400, { ok: false, error: "Unknown Patient Registry action" });
    }
  } catch (error) {
    return response(error.status || 500, { ok: false, error: error.message || "Patient Registry request failed" });
  }
};
