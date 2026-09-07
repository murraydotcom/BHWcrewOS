export const SCHEMA_VERSION = 1;

export const COLLECTIONS = Object.freeze({
  patients: "patients",
  patientRequests: "patientRequests",
  tasks: "tasks",
  communications: "communications",
  auditEvents: "auditEvents",
  intakeReceipts: "intakeReceipts",
});

export const PATIENT_REQUEST_STATUSES = Object.freeze([
  "received",
  "triaged",
  "in-progress",
  "waiting-on-patient",
  "waiting-on-external",
  "resolved",
  "closed",
  "cancelled",
]);

export const PATIENT_REQUEST_TYPES = Object.freeze([
  "general",
  "referral",
  "medication",
  "paperwork",
  "prior-authorization",
  "scheduling",
  "billing",
  "records",
  "clinical-question",
  "clinical-review",
  "other",
]);

export const TASK_STATUSES = Object.freeze([
  "open",
  "in-progress",
  "blocked",
  "done",
  "cancelled",
]);

export const TASK_TYPES = Object.freeze([
  "triage",
  "request-fulfillment",
  "follow-up",
  "outreach",
  "review",
  "external-follow-up",
]);

export const COMMUNICATION_DIRECTIONS = Object.freeze(["inbound", "outbound", "internal"]);
export const COMMUNICATION_CHANNELS = Object.freeze([
  "portal",
  "sms",
  "phone",
  "voicemail",
  "email",
  "fax",
  "google-chat",
  "internal",
]);
export const COMMUNICATION_STATUSES = Object.freeze([
  "received",
  "draft",
  "not-sent",
  "sent",
  "delivered",
  "failed",
  "recorded",
]);

export const PRIORITIES = Object.freeze(["low", "routine", "high", "urgent"]);
export const TARGET_SYSTEMS = Object.freeze(["crewos", "medication-service", "rcm"]);
export const PATIENT_MATCH_STATUSES = Object.freeze(["matched", "unmatched", "needs-review"]);

export const REQUEST_TRANSITIONS = Object.freeze({
  received: Object.freeze(["triaged", "in-progress", "cancelled"]),
  triaged: Object.freeze(["in-progress", "waiting-on-patient", "waiting-on-external", "resolved", "cancelled"]),
  "in-progress": Object.freeze(["waiting-on-patient", "waiting-on-external", "resolved", "cancelled"]),
  "waiting-on-patient": Object.freeze(["in-progress", "resolved", "cancelled"]),
  "waiting-on-external": Object.freeze(["in-progress", "resolved", "cancelled"]),
  resolved: Object.freeze(["closed", "in-progress"]),
  closed: Object.freeze(["in-progress"]),
  cancelled: Object.freeze([]),
});

export const TASK_TRANSITIONS = Object.freeze({
  open: Object.freeze(["in-progress", "blocked", "done", "cancelled"]),
  "in-progress": Object.freeze(["open", "blocked", "done", "cancelled"]),
  blocked: Object.freeze(["open", "in-progress", "cancelled"]),
  done: Object.freeze(["open"]),
  cancelled: Object.freeze(["open"]),
});

export const BHW_PATIENT_ID_PATTERN = /^BHW\d{4}$/;
export const EXTERNAL_ID_PATTERN = /^(REQ|TSK|COM|AUD)-[A-Za-z0-9-]{8,80}$/;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const TEAM_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export function apiError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function cleanText(value, maxLength, { required = false, field = "value" } = {}) {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  if (required && !text) throw apiError(400, "validation_error", `${field} is required`);
  if (text.length > maxLength) throw apiError(400, "validation_error", `${field} is too long`);
  return text;
}

export function enumValue(value, allowed, field, fallback = "") {
  const normalized = cleanText(value || fallback, 80, { required: true, field }).toLowerCase();
  if (!allowed.includes(normalized)) {
    throw apiError(400, "validation_error", `${field} is not supported`);
  }
  return normalized;
}

export function optionalBhwPatientId(value) {
  const id = cleanText(value, 16).toUpperCase();
  if (id && !BHW_PATIENT_ID_PATTERN.test(id)) {
    throw apiError(400, "validation_error", "bhwPatientId must match BHW####");
  }
  return id;
}

export function assertBhwPatientId(value) {
  const id = optionalBhwPatientId(value);
  if (!id) throw apiError(400, "validation_error", "bhwPatientId is required");
  return id;
}

export function requireExternalId(value, prefix, field = "id") {
  const id = cleanText(value, 96, { required: true, field });
  if (!EXTERNAL_ID_PATTERN.test(id) || !id.startsWith(`${prefix}-`)) {
    throw apiError(400, "validation_error", `${field} is invalid`);
  }
  return id;
}

export function optionalIsoDate(value, field) {
  const text = cleanText(value, 40);
  if (!text) return "";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw apiError(400, "validation_error", `${field} must be an ISO date-time`);
  return new Date(parsed).toISOString();
}

export function requireIdempotencyKey(value) {
  const key = cleanText(value, 128, { required: true, field: "Idempotency-Key" });
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw apiError(400, "validation_error", "Idempotency-Key must be 8-128 safe characters");
  }
  return key;
}
