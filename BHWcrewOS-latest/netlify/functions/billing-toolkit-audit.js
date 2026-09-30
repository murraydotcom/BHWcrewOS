const { getSession, json } = require("./_lib");
const { operationsRequest } = require("./lib/operations-cloud");

const EVENT_TYPES = Object.freeze([
  "billing-toolkit.opened",
  "billing-toolkit.section-viewed",
  "billing-toolkit.audit-calculated",
  "billing-toolkit.print-requested",
  "billing-toolkit.session-heartbeat",
  "billing-toolkit.session-ended",
]);
const SECTIONS = Object.freeze(["template", "audit", "apcm", "bhi", "rpm", "ccm", "pcm", "cocm", "overlap", "stacking", "dashboard"]);
const EVENT_FIELDS = Object.freeze(["eventId", "eventType", "sessionId", "section", "activeSeconds", "visibleSeconds", "reason", "summary"]);
const SUMMARY_FIELDS = Object.freeze(["audited", "pass", "review", "error"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function exactKeys(value, allowed, field) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw invalid(`${field} must be an object`);
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid(`${field} contains unsupported fields`);
}

function integer(value, field, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw invalid(`${field} is out of range`);
  return value;
}

function safeBillingToolkitActivity(input) {
  exactKeys(input, EVENT_FIELDS, "activity");
  if (!UUID_PATTERN.test(String(input.eventId || "")) || !UUID_PATTERN.test(String(input.sessionId || ""))) {
    throw invalid("activity identifiers must be UUIDs");
  }
  if (!EVENT_TYPES.includes(input.eventType)) throw invalid("eventType is not allowed");
  if (!SECTIONS.includes(input.section)) throw invalid("section is not allowed");

  const safe = {
    eventId: input.eventId.toLowerCase(),
    eventType: input.eventType,
    sessionId: input.sessionId.toLowerCase(),
    section: input.section,
  };
  const sessionEvent = ["billing-toolkit.session-heartbeat", "billing-toolkit.session-ended"].includes(input.eventType);
  const summaryEvent = input.eventType === "billing-toolkit.audit-calculated";
  if (sessionEvent !== (input.activeSeconds !== undefined || input.visibleSeconds !== undefined || input.reason !== undefined)) {
    throw invalid("session measurements are only allowed on session events");
  }
  if (summaryEvent !== (input.summary !== undefined)) throw invalid("summary is required only for audit-calculated events");

  if (summaryEvent) {
    exactKeys(input.summary, SUMMARY_FIELDS, "summary");
    safe.summary = Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, integer(input.summary[field], `summary.${field}`, 10_000)]));
    if (safe.summary.pass + safe.summary.review + safe.summary.error > safe.summary.audited) {
      throw invalid("summary outcomes cannot exceed audited rows");
    }
  }
  if (sessionEvent) {
    safe.activeSeconds = integer(input.activeSeconds, "activeSeconds", 43_200);
    safe.visibleSeconds = integer(input.visibleSeconds, "visibleSeconds", 43_200);
    if (safe.activeSeconds > safe.visibleSeconds) throw invalid("activeSeconds cannot exceed visibleSeconds");
    safe.reason = String(input.reason || "");
    const validReason = input.eventType === "billing-toolkit.session-ended"
      ? safe.reason === "pagehide"
      : ["interval", "hidden"].includes(safe.reason);
    if (!validReason) throw invalid("session reason is not allowed");
  }
  return safe;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again." });

  try {
    const body = JSON.parse(event.body || "{}");
    const activity = safeBillingToolkitActivity(body);
    const result = await operationsRequest("/v1/staff-activity/billing-toolkit", {
      actor: session,
      method: "POST",
      body: activity,
    });
    return json(result.replayed ? 200 : 201, result);
  } catch (error) {
    return json(Number(error.status) || 400, { ok: false, error: String(error.message || "Invalid activity event") });
  }
};

exports.safeBillingToolkitActivity = safeBillingToolkitActivity;
