import crypto from "node:crypto";
import { apiError, assertBhwPatientId, cleanText } from "./schema.mjs";

export const PATIENT_WORKSPACE_CONTEXT_SCHEMA_VERSION = 1;
export const PATIENT_WORKSPACE_LAUNCH_TTL_SECONDS = 120;
export const PATIENT_WORKSPACE_SESSION_TTL_SECONDS = 15 * 60;

export const PATIENT_WORKSPACE_DESTINATIONS = Object.freeze({
  "clinical-map": Object.freeze({
    launchPath: "/provider/patient-360.html",
    label: "BHW Whole-Person Clinical Map",
    requiredScope: "clinical-map.read",
  }),
  "body-system-atlas": Object.freeze({
    launchPath: "/provider/patient-360-atlas.html",
    label: "Body-System Atlas",
    requiredScope: "body-system-atlas.read",
  }),
  "patient-operations": Object.freeze({
    launchPath: "/provider/patient-operations.html",
    label: "Patient Operations",
    requiredScope: "patient-operations.read",
  }),
});

export const PATIENT_WORKSPACE_READ_SCOPES = Object.freeze(
  Object.values(PATIENT_WORKSPACE_DESTINATIONS).map((item) => item.requiredScope),
);

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DENIED_ROLES = new Set(["", "patient", "anonymous", "integration", "intake", "system"]);

function cleanRole(value) {
  return cleanText(value, 80).trim().toLowerCase();
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw apiError(500, "invalid_clock", "clinical context clock is invalid");
  return date.toISOString();
}

export function normalizePatientWorkspaceDestination(value) {
  const destination = cleanText(value, 80, { required: true, field: "destination" }).toLowerCase();
  if (!PATIENT_WORKSPACE_DESTINATIONS[destination]) {
    throw apiError(400, "unsupported_destination", "patient workspace destination is not supported");
  }
  return destination;
}

export function requirePatientWorkspaceActor(actor = {}) {
  const role = cleanRole(actor.role);
  if (actor.type !== "staff" || !cleanText(actor.staffId, 160) || !cleanText(actor.id || actor.sub, 200)
    || DENIED_ROLES.has(role)) {
    throw apiError(403, "staff_context_required", "an authenticated individual CrewOS staff session is required");
  }
  return Object.freeze({
    staffId: cleanText(actor.staffId, 160),
    actorId: cleanText(actor.id || actor.sub, 200),
    name: cleanText(actor.name || "CrewOS staff", 160),
    role,
  });
}

export function normalizePatientWorkspaceToken(value) {
  const token = cleanText(value, 96, { required: true, field: "context token" });
  if (!TOKEN_PATTERN.test(token)) {
    throw apiError(400, "invalid_context_token", "patient workspace context token is invalid");
  }
  return token;
}

export function patientWorkspaceTokenHash(token) {
  return crypto.createHash("sha256").update(normalizePatientWorkspaceToken(token)).digest("hex");
}

export function protectedPatientReference(bhwPatientId, secret) {
  const id = assertBhwPatientId(bhwPatientId);
  const key = cleanText(secret, 512, { required: true, field: "patient workspace context secret" });
  if (Buffer.byteLength(key, "utf8") < 32) {
    throw apiError(503, "context_secret_invalid", "patient workspace context secret is not configured safely");
  }
  return crypto.createHmac("sha256", key).update(id).digest("hex");
}

export function createPatientWorkspaceContext(input = {}, actor = {}, options = {}) {
  const bhwPatientId = assertBhwPatientId(input.bhwPatientId);
  if (bhwPatientId === "BHW0000") {
    throw apiError(400, "synthetic_context_not_required", "BHW0000 uses the existing synthetic workspace and does not require a real-patient context token");
  }
  if (input.treatmentPurposeAttestation !== true) {
    throw apiError(400, "treatment_purpose_required", "treatment-purpose attestation is required before opening a patient workspace");
  }
  const destination = normalizePatientWorkspaceDestination(input.destination);
  const staff = requirePatientWorkspaceActor(actor);
  const issuedAt = new Date(options.now || new Date());
  if (!Number.isFinite(issuedAt.getTime())) throw apiError(500, "invalid_clock", "clinical context clock is invalid");
  const token = normalizePatientWorkspaceToken(
    options.token || (options.tokenFactory || (() => crypto.randomBytes(32).toString("base64url")))(),
  );
  const contextId = cleanText(
    options.contextId || `CTX-${(options.uuidFactory || crypto.randomUUID)()}`,
    100,
    { required: true, field: "contextId" },
  );
  const expiresAt = new Date(issuedAt.getTime() + PATIENT_WORKSPACE_LAUNCH_TTL_SECONDS * 1000);
  const record = Object.freeze({
    schemaVersion: PATIENT_WORKSPACE_CONTEXT_SCHEMA_VERSION,
    contextId,
    tokenHash: patientWorkspaceTokenHash(token),
    patientReference: protectedPatientReference(bhwPatientId, options.secret),
    bhwPatientId,
    sourceApplication: "patient-registry",
    destination,
    launchPath: PATIENT_WORKSPACE_DESTINATIONS[destination].launchPath,
    purposeOfUse: "treatment",
    scopes: Object.freeze([...PATIENT_WORKSPACE_READ_SCOPES]),
    staffId: staff.staffId,
    actorId: staff.actorId,
    actorRole: staff.role,
    status: "issued",
    issuedAt: iso(issuedAt),
    expiresAt: iso(expiresAt),
    consumedAt: "",
    sessionExpiresAt: "",
    revokedAt: "",
  });
  return Object.freeze({ token, record });
}

export function validatePatientWorkspaceContext(record = {}, input = {}, actor = {}, options = {}) {
  const staff = requirePatientWorkspaceActor(actor);
  const destination = normalizePatientWorkspaceDestination(input.destination);
  const now = new Date(options.now || new Date());
  if (!record || record.schemaVersion !== PATIENT_WORKSPACE_CONTEXT_SCHEMA_VERSION) {
    throw apiError(403, "context_not_authorized", "patient workspace context is not authorized for this staff member and destination");
  }
  if (record.revokedAt || record.status === "revoked") {
    throw apiError(410, "context_revoked", "patient workspace context was revoked");
  }
  if (record.consumedAt || record.status === "consumed") {
    throw apiError(409, "context_already_used", "patient workspace context was already used");
  }
  if (record.status !== "issued" || record.destination !== destination
    || record.staffId !== staff.staffId || record.actorId !== staff.actorId
    || record.purposeOfUse !== "treatment" || !Array.isArray(record.scopes)
    || !record.scopes.includes(PATIENT_WORKSPACE_DESTINATIONS[destination].requiredScope)) {
    throw apiError(403, "context_not_authorized", "patient workspace context is not authorized for this staff member and destination");
  }
  if (!Number.isFinite(now.getTime()) || new Date(record.expiresAt).getTime() <= now.getTime()) {
    throw apiError(410, "context_expired", "patient workspace context expired; return to Patient Registry");
  }
  return Object.freeze({ staff, destination, now });
}

export function consumePatientWorkspaceContext(record = {}, input = {}, actor = {}, options = {}) {
  const verified = validatePatientWorkspaceContext(record, input, actor, options);
  const consumedAt = verified.now;
  const sessionExpiresAt = new Date(consumedAt.getTime() + PATIENT_WORKSPACE_SESSION_TTL_SECONDS * 1000);
  const consumed = Object.freeze({
    ...record,
    status: "consumed",
    consumedAt: iso(consumedAt),
    sessionExpiresAt: iso(sessionExpiresAt),
  });
  const grant = Object.freeze({
    schemaVersion: PATIENT_WORKSPACE_CONTEXT_SCHEMA_VERSION,
    contextId: record.contextId,
    bhwPatientId: record.bhwPatientId,
    patientReference: record.patientReference,
    sourceApplication: record.sourceApplication,
    destination: record.destination,
    purposeOfUse: record.purposeOfUse,
    scopes: Object.freeze([...record.scopes]),
    authorizedStaffId: record.staffId,
    authorizedRole: record.actorRole,
    consumedAt: consumed.consumedAt,
    sessionExpiresAt: consumed.sessionExpiresAt,
  });
  return Object.freeze({ consumed, grant });
}

export function patientWorkspaceContextAudit(record = {}, eventType, actor = {}, occurredAt = new Date()) {
  const staff = requirePatientWorkspaceActor(actor);
  const allowed = new Set(["patient-workspace-context.issued", "patient-workspace-context.consumed", "patient-workspace-context.denied"]);
  if (!allowed.has(eventType)) throw apiError(500, "invalid_audit_event", "patient workspace audit event is invalid");
  return Object.freeze({
    auditEventId: `AUD-${crypto.randomUUID()}`,
    schemaVersion: 1,
    eventType,
    actorType: "staff",
    actorId: staff.actorId,
    staffId: staff.staffId,
    actorRole: staff.role,
    contextId: cleanText(record.contextId, 100),
    patientReference: cleanText(record.patientReference, 80),
    sourceApplication: "patient-registry",
    destination: cleanText(record.destination, 80),
    purposeOfUse: "treatment",
    occurredAt: iso(occurredAt),
  });
}
