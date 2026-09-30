import { apiError, cleanText } from "./schema.mjs";

export const BILLING_TOOLKIT_EVENT_TYPES = Object.freeze([
  "billing-toolkit.opened",
  "billing-toolkit.section-viewed",
  "billing-toolkit.audit-calculated",
  "billing-toolkit.print-requested",
  "billing-toolkit.session-heartbeat",
  "billing-toolkit.session-ended",
]);

export const BILLING_TOOLKIT_SECTIONS = Object.freeze([
  "template",
  "audit",
  "apcm",
  "bhi",
  "rpm",
  "ccm",
  "pcm",
  "cocm",
  "overlap",
  "stacking",
  "dashboard",
]);

const EVENT_FIELDS = Object.freeze([
  "eventId",
  "eventType",
  "sessionId",
  "section",
  "activeSeconds",
  "visibleSeconds",
  "reason",
  "summary",
]);
const SUMMARY_FIELDS = Object.freeze(["audited", "pass", "review", "error"]);
const SESSION_REASONS = Object.freeze(["interval", "hidden", "pagehide"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactKeys(value, allowed, field) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw apiError(400, "invalid_billing_toolkit_activity", `${field} must be an object`);
  }
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) {
    throw apiError(400, "invalid_billing_toolkit_activity", `${field} contains unsupported fields`);
  }
}

function uuid(value, field) {
  const result = cleanText(value, 36);
  if (!UUID_PATTERN.test(result)) {
    throw apiError(400, "invalid_billing_toolkit_activity", `${field} must be a UUID`);
  }
  return result.toLowerCase();
}

function integer(value, field, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw apiError(400, "invalid_billing_toolkit_activity", `${field} is out of range`);
  }
  return value;
}

function enumValue(value, allowed, field) {
  const result = cleanText(value, 80).toLowerCase();
  if (!allowed.includes(result)) {
    throw apiError(400, "invalid_billing_toolkit_activity", `${field} is not allowed`);
  }
  return result;
}

function auditSummary(value) {
  exactKeys(value, SUMMARY_FIELDS, "summary");
  const result = Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, integer(value[field], `summary.${field}`, 10_000)]));
  if (result.pass + result.review + result.error > result.audited) {
    throw apiError(400, "invalid_billing_toolkit_activity", "summary outcomes cannot exceed audited rows");
  }
  return result;
}

export function buildBillingToolkitAuditEvent(input, actor, { now = new Date() } = {}) {
  exactKeys(input, EVENT_FIELDS, "billing toolkit activity");
  const eventId = uuid(input.eventId, "eventId");
  const sessionId = uuid(input.sessionId, "sessionId");
  const eventType = enumValue(input.eventType, BILLING_TOOLKIT_EVENT_TYPES, "eventType");
  const section = enumValue(input.section, BILLING_TOOLKIT_SECTIONS, "section");
  const sessionEvent = ["billing-toolkit.session-heartbeat", "billing-toolkit.session-ended"].includes(eventType);
  const summaryEvent = eventType === "billing-toolkit.audit-calculated";

  if (sessionEvent !== (input.activeSeconds !== undefined || input.visibleSeconds !== undefined || input.reason !== undefined)) {
    throw apiError(400, "invalid_billing_toolkit_activity", "session measurements are only allowed on session events");
  }
  if (summaryEvent !== (input.summary !== undefined)) {
    throw apiError(400, "invalid_billing_toolkit_activity", "summary is required only for audit-calculated events");
  }

  const event = {
    auditEventId: `AUD-BILLING-${eventId}`,
    schemaVersion: 1,
    eventType,
    actorType: "staff",
    actorId: cleanText(actor?.id || actor?.sub, 180, { required: true, field: "actorId" }),
    actorRole: cleanText(actor?.role || "staff", 80).toLowerCase(),
    surface: "billing-toolkit",
    toolkitVersion: "2026-09-30",
    sessionId,
    section,
    occurredAt: new Date(now).toISOString(),
  };

  if (summaryEvent) event.auditSummary = auditSummary(input.summary);
  if (sessionEvent) {
    event.activeSeconds = integer(input.activeSeconds, "activeSeconds", 43_200);
    event.visibleSeconds = integer(input.visibleSeconds, "visibleSeconds", 43_200);
    if (event.activeSeconds > event.visibleSeconds) {
      throw apiError(400, "invalid_billing_toolkit_activity", "activeSeconds cannot exceed visibleSeconds");
    }
    event.durationMeasurement = "cumulative-session-seconds";
    event.reason = enumValue(input.reason, SESSION_REASONS, "reason");
    if (eventType === "billing-toolkit.session-ended" && event.reason !== "pagehide") {
      throw apiError(400, "invalid_billing_toolkit_activity", "session-ended reason must be pagehide");
    }
    if (eventType === "billing-toolkit.session-heartbeat" && !["interval", "hidden"].includes(event.reason)) {
      throw apiError(400, "invalid_billing_toolkit_activity", "session-heartbeat reason is not allowed");
    }
  }

  return event;
}
