import crypto from "node:crypto";
import {
  insuranceValidationMessage,
  normalizeMedicareMbi,
  sanitizeCoverageRecords,
} from "../../shared/patient-coverage.mjs";

const PATIENT_FIELDS = [
  "bhwPatientId", "legalFirstName", "legalLastName", "nameSuffix", "preferredName", "dateOfBirth",
  "phone", "email", "patientStatus", "primaryPayer", "memberId", "coverageStatus", "medicareMbi", "coverageRecords",
  "referralSource", "responsibleStaff", "lastVerifiedAt",
  "primaryCareProvider", "primaryCareProviderVerificationAttestation",
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

function operationsToken(session) {
  const secret = env("CREWOS_OPERATIONS_TOKEN_SECRET");
  if (!secret) throw Object.assign(new Error("CrewHQ patient portal access is not configured"), { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const role = String(session.role || session.healthRole || session.access || "staff").trim().toLowerCase().replace(/\s+/g, "-");
  const claims = {
    sub: `crew:${session.staffId || "server"}`,
    staffId: session.staffId || "server",
    name: session.name || "CrewOS staff",
    role,
    iss: "bhw-crewhq",
    aud: "bhw-operations-cloud",
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

async function operationsRequest(path, session, { method = "GET", body } = {}) {
  const base = safeApiBase(env("OPERATIONS_CLOUD_API_URL"));
  if (!base) throw Object.assign(new Error("Patient portal pilot access is not configured"), { status: 503 });
  const operationsResponse = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${operationsToken(session)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await operationsResponse.json().catch(() => ({}));
  if (!operationsResponse.ok) {
    throw Object.assign(new Error(result.message || result.error || `Patient portal access returned ${operationsResponse.status}`), { status: operationsResponse.status });
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

function billingToolkitPatientId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^BHW\d{4}$/.test(id)) throw Object.assign(new Error("A BHW Patient ID is required"), { status: 400 });
  return id;
}

export function validateHealthCoreDraftReceipt(value = {}) {
  const receipt = {
    handoffId: String(value.handoffId || "").trim().slice(0, 100),
    bhwPatientId: billingToolkitPatientId(value.bhwPatientId),
    noteId: String(value.noteId || "").trim().slice(0, 100),
    revision: Number(value.revision),
    contentHash: String(value.contentHash || "").trim().toLowerCase(),
    savedAt: String(value.savedAt || "").trim(),
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(receipt.handoffId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(receipt.noteId)
    || !Number.isInteger(receipt.revision) || receipt.revision < 1
    || !/^[a-f0-9]{64}$/.test(receipt.contentHash)
    || !Number.isFinite(Date.parse(receipt.savedAt))) {
    throw Object.assign(new Error("A verified Health Core encounter-note draft receipt is required"), { status: 400 });
  }
  return receipt;
}

export function providerReviewRequestId(receipt) {
  return `billing-note-${crypto.createHash("sha256")
    .update([receipt.bhwPatientId, receipt.noteId, receipt.revision, receipt.contentHash].join("\u001f"))
    .digest("hex")
    .slice(0, 40)}`;
}

function syntheticProviderAssignment() {
  return {
    crewStaffId: env("SYNTHETIC_BILLING_TOOLKIT_PROVIDER_STAFF_ID").trim(),
    name: env("SYNTHETIC_BILLING_TOOLKIT_PROVIDER_NAME").trim(),
    verificationStatus: "verified",
  };
}

async function providerAssignmentFor(receipt, session) {
  if (receipt.bhwPatientId === "BHW0000") {
    const provider = syntheticProviderAssignment();
    if (!provider.crewStaffId || !provider.name) {
      throw Object.assign(new Error("Synthetic Billing Toolkit provider assignment is not configured"), { status: 503 });
    }
    return provider;
  }
  throw Object.assign(new Error("Real-patient Billing Toolkit routing is not activated"), { status: 403 });
}

async function createProviderReviewAlert(receipt, provider, session) {
  const requestId = providerReviewRequestId(receipt);
  const sourceReference = `health-core:${receipt.noteId}:r${receipt.revision}`;
  let requestRecord;
  try {
    const existing = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(requestId)}`, session);
    requestRecord = existing.request || existing.patientRequest;
  } catch (error) {
    if (Number(error.status) !== 404) throw error;
  }
  if (!requestRecord) {
    const created = await operationsRequest("/v1/patient-requests", session, {
      method: "POST",
      body: {
        id: requestId,
        bhwPatientId: receipt.bhwPatientId,
        requestType: "clinical_review",
        source: "billing-toolkit-health-core",
        sourceReference,
        summary: "Health Core encounter-note draft is ready for the assigned PCP to review.",
        priority: "routine",
        notificationMode: "none",
      },
    });
    requestRecord = created.request || created.patientRequest;
  }
  if (!requestRecord?.id || requestRecord.bhwPatientId !== receipt.bhwPatientId
    || requestRecord.sourceReference !== sourceReference) {
    throw Object.assign(new Error("Provider review request could not be verified after creation"), { status: 502 });
  }
  await operationsRequest(`/v1/patient-requests/${encodeURIComponent(requestRecord.id)}/team-notes`, session, {
    method: "POST",
    body: {
      content: `Health Core encounter-note draft revision ${receipt.revision} is ready for PCP review. Open Health Core Clinical Documentation; no clinical content is copied into CrewHQ.`,
      mentions: [{ staffId: provider.crewStaffId, name: provider.name }],
      idempotencyKey: `billing-toolkit-provider-review:${requestId}`,
    },
  });
  return { requestId: requestRecord.id, providerStaffId: provider.crewStaffId, providerName: provider.name };
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
        const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim().slice(0, 40);
        try {
          if (patient.medicareMbi !== undefined) patient.medicareMbi = normalizeMedicareMbi(patient.medicareMbi);
          if (patient.coverageRecords !== undefined) patient.coverageRecords = sanitizeCoverageRecords(patient.coverageRecords);
          const insuranceError = insuranceValidationMessage(patient);
          if (insuranceError) throw new Error(insuranceError);
        } catch (error) {
          error.status = 400;
          throw error;
        }
        return response(200, await cloudRequest(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}`, session, {
          method: "PUT",
          body: { ...patient, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) },
        }));
      }
      case "notify-billing-toolkit-provider": {
        const receipt = validateHealthCoreDraftReceipt(body.receipt);
        const provider = await providerAssignmentFor(receipt, session);
        const notification = await createProviderReviewAlert(receipt, provider, session);
        return response(200, {
          ok: true,
          receipt: { handoffId: receipt.handoffId, noteId: receipt.noteId, revision: receipt.revision, contentHash: receipt.contentHash, savedAt: receipt.savedAt },
          notification: { ...notification, status: "created", channel: "crewhq-provider-mention" },
        });
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
      case "portal-access": {
        const id = patientId(body.bhwPatientId);
        return response(200, await operationsRequest(`/v1/patient-portal-access/${encodeURIComponent(id)}`, session));
      }
      case "save-portal-access": {
        const id = patientId(body.bhwPatientId);
        const access = body.access && typeof body.access === "object" && !Array.isArray(body.access) ? body.access : {};
        return response(200, await operationsRequest(`/v1/patient-portal-access/${encodeURIComponent(id)}`, session, { method: "PUT", body: access }));
      }
      default:
        return response(400, { ok: false, error: "Unknown Patient Registry action" });
    }
  } catch (error) {
    return response(error.status || 500, { ok: false, error: error.message || "Patient Registry request failed" });
  }
};
