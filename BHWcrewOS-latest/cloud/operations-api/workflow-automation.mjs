import crypto from "node:crypto";
import { assertBhwPatientId } from "./schema.mjs";

const cleanText = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const slug = (value) => cleanText(value, 100).toLowerCase().replace(/[\s_]+/g, "-");
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
const nowIso = (now = new Date()) => (now instanceof Date ? now : new Date(now)).toISOString();

export const REQUEST_TYPES = Object.freeze(["refill", "referral", "prior_auth", "billing_rcm", "general"]);
export const REQUEST_PRIORITIES = Object.freeze(["routine", "time-sensitive", "urgent", "emergency"]);
export const REQUEST_ACTIONS = Object.freeze(["assign", "start", "milestone", "resolve", "reopen", "escalate", "unassign"]);

const COMMON_RECEIVED = "BHW Medical Group: We received your request. Your care team will post details securely.";
const COMMON_IN_PROGRESS = "BHW Medical Group: Your care team is working on your request. Detailed updates stay in your secure BHW page.";
const COMMON_WAITING = "BHW Medical Group: Your request is still active and is waiting on another party. Detailed updates stay in your secure BHW page.";

export const WORKFLOW_DEFINITIONS = Object.freeze({
  refill: {
    label: "Medication request",
    serviceLine: "clinical",
    assignedTeam: "medication",
    allowedRoles: ["ma-bha", "provider", "pmhnp", "operations-manager", "executive"],
    received: "refill_received",
    inProgress: "refill_in_progress",
    defaultResolution: "refill_completed",
    statuses: {
      refill_received: { category: "received", label: "Received", notify: true, message: COMMON_RECEIVED },
      refill_in_progress: { category: "in_progress", label: "In progress", notify: false, message: COMMON_IN_PROGRESS },
      waiting_on_clinician: { category: "waiting", label: "Waiting on clinician", notify: true, message: COMMON_WAITING },
      waiting_on_pharmacy: { category: "waiting", label: "Waiting on pharmacy", notify: true, message: "BHW Medical Group: Your request is active and is waiting on another organization. Open your secure BHW page for details." },
      needs_visit: { category: "completed", label: "Visit needed", notify: true, message: "BHW Medical Group: Your care team posted next steps that need your attention. Please open your secure BHW page or call the office." },
      refill_declined: { category: "completed", label: "Not completed", notify: true, message: "BHW Medical Group: Your care team could not complete the requested action and posted secure next steps." },
      refill_completed: { category: "completed", label: "Completed", notify: true, message: "BHW Medical Group: The requested action is complete. Open your secure BHW page for details and next steps." },
    },
    cardOutcomes: [
      { label: "Complete", status: "refill_completed" },
      { label: "Needs visit", status: "needs_visit" },
    ],
    cardMilestones: [
      { label: "Waiting on clinician", status: "waiting_on_clinician" },
      { label: "Waiting on pharmacy", status: "waiting_on_pharmacy" },
    ],
  },
  referral: {
    label: "Referral request",
    serviceLine: "care-coordination",
    assignedTeam: "referrals",
    allowedRoles: ["front-desk", "ma-bha", "care-manager", "operations-manager", "executive"],
    received: "referral_received",
    inProgress: "referral_in_progress",
    defaultResolution: "",
    statuses: {
      referral_received: { category: "received", label: "Received", notify: true, message: COMMON_RECEIVED },
      referral_in_progress: { category: "in_progress", label: "In progress", notify: false, message: COMMON_IN_PROGRESS },
      referral_sent: { category: "waiting", label: "Referral sent", notify: true, message: "BHW Medical Group: The requested information was sent to the next organization. This does not mean an appointment is scheduled. See your secure BHW page." },
      ready_to_schedule: { category: "waiting", label: "Ready to schedule", notify: true, message: "BHW Medical Group: A scheduling update is available. Open your secure BHW page for contact details." },
      scheduled: { category: "waiting", label: "Scheduled", notify: true, message: "BHW Medical Group: A scheduling status update is available. Appointment details remain in your secure BHW page." },
      referral_completed: { category: "completed", label: "Completed", notify: true, message: "BHW Medical Group: Your care team completed the requested workflow. See your secure BHW page for details." },
      closed_without_scheduling: { category: "completed", label: "Closed without scheduling", notify: true, message: "BHW Medical Group: Your care team posted an update that needs your attention. Open your secure BHW page or call the office." },
    },
    cardOutcomes: [
      { label: "Complete", status: "referral_completed" },
      { label: "Close", status: "closed_without_scheduling" },
    ],
    cardMilestones: [
      { label: "Referral sent", status: "referral_sent" },
      { label: "Ready to schedule", status: "ready_to_schedule" },
      { label: "Scheduled", status: "scheduled" },
    ],
  },
  prior_auth: {
    label: "Prior authorization",
    serviceLine: "clinical",
    assignedTeam: "authorizations",
    allowedRoles: ["ma-bha", "provider", "pmhnp", "rcm", "operations-manager", "executive"],
    received: "pa_received",
    inProgress: "pa_in_progress",
    defaultResolution: "",
    statuses: {
      pa_received: { category: "received", label: "Received", notify: true, message: COMMON_RECEIVED },
      pa_in_progress: { category: "in_progress", label: "In progress", notify: false, message: COMMON_IN_PROGRESS },
      pa_submitted: { category: "waiting", label: "Submitted — awaiting decision", notify: true, message: "BHW Medical Group: Your request was submitted for outside review. It is not yet approved or denied. See your secure BHW page." },
      pa_approved: { category: "completed", label: "Approved", notify: true, message: "BHW Medical Group: A decision is available for your request. Your care team posted secure next steps." },
      pa_denied: { category: "completed", label: "Denied — next steps under review", notify: true, message: "BHW Medical Group: A decision is available for your request. Your care team is reviewing secure next steps." },
      pa_withdrawn: { category: "completed", label: "Withdrawn", notify: true, message: "BHW Medical Group: Your request is no longer active. Your care team posted secure details." },
      pa_expired: { category: "completed", label: "Expired", notify: true, message: "BHW Medical Group: A review period ended. Your care team posted secure next steps." },
    },
    cardOutcomes: [
      { label: "Approved", status: "pa_approved" },
      { label: "Denied", status: "pa_denied" },
    ],
    cardMilestones: [{ label: "PA submitted", status: "pa_submitted" }],
  },
  billing_rcm: {
    label: "Billing request",
    serviceLine: "revenue-cycle",
    assignedTeam: "rcm",
    allowedRoles: ["rcm", "operations-manager", "executive"],
    received: "billing_received",
    inProgress: "billing_in_progress",
    defaultResolution: "billing_resolved",
    statuses: {
      billing_received: { category: "received", label: "Received", notify: true, message: COMMON_RECEIVED },
      billing_in_progress: { category: "in_progress", label: "In progress", notify: false, message: COMMON_IN_PROGRESS },
      rcm_referred: { category: "waiting", label: "With billing specialist", notify: true, message: "BHW Medical Group: Your request is with the appropriate specialist. Detailed information is not included by text." },
      waiting_on_payer: { category: "waiting", label: "Waiting on payer", notify: true, message: "BHW Medical Group: Your request is still active and is waiting on an outside response. Open your secure BHW page for details." },
      billing_resolved: { category: "completed", label: "Resolved", notify: true, message: "BHW Medical Group: Your request was resolved. Open your secure BHW page or call the office if you still need help." },
    },
    cardOutcomes: [{ label: "Resolve", status: "billing_resolved" }],
    cardMilestones: [
      { label: "With RCM", status: "rcm_referred" },
      { label: "Waiting on payer", status: "waiting_on_payer" },
    ],
  },
  general: {
    label: "Patient request",
    serviceLine: "patient-access",
    assignedTeam: "front-desk",
    allowedRoles: ["front-desk", "ma-bha", "care-manager", "operations-manager", "executive"],
    received: "received",
    inProgress: "in_progress",
    defaultResolution: "completed",
    statuses: {
      received: { category: "received", label: "Received", notify: true, message: COMMON_RECEIVED },
      in_progress: { category: "in_progress", label: "In progress", notify: false, message: COMMON_IN_PROGRESS },
      waiting: { category: "waiting", label: "Waiting", notify: true, message: COMMON_WAITING },
      completed: { category: "completed", label: "Completed", notify: true, message: "BHW Medical Group: Your care team completed the action for your request. Detailed information remains in your secure BHW page." },
    },
    cardOutcomes: [{ label: "Resolve", status: "completed" }],
    cardMilestones: [{ label: "Waiting", status: "waiting" }],
  },
});

export function normalizeRequestType(value) {
  const normalized = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "billing" || normalized === "rcm") return "billing_rcm";
  if (normalized === "priorauthorization" || normalized === "pa") return "prior_auth";
  if (!REQUEST_TYPES.includes(normalized)) throw Object.assign(new Error("supported request type is required"), { status: 400 });
  return normalized;
}

export function routeForRequestType(value) {
  const requestType = normalizeRequestType(value);
  const definition = WORKFLOW_DEFINITIONS[requestType];
  return {
    requestType,
    serviceLine: definition.serviceLine,
    assignedTeam: definition.assignedTeam,
    allowedRoles: [...definition.allowedRoles],
  };
}

export function statusDefinition(requestType, status) {
  const definition = WORKFLOW_DEFINITIONS[normalizeRequestType(requestType)];
  if (status === "escalated") return { category: "escalated", label: "Escalated", notify: false, message: "" };
  const result = definition.statuses[cleanText(status, 80).toLowerCase()];
  if (!result) throw Object.assign(new Error(`status is not valid for ${definition.label}`), { status: 400 });
  return result;
}

export function sanitizePatientRequest(input = {}, { user = {}, now = new Date(), patientId = "" } = {}) {
  const requestType = normalizeRequestType(input.requestType || input.type || "general");
  const definition = WORKFLOW_DEFINITIONS[requestType];
  const bhwPatientId = assertBhwPatientId(patientId || input.bhwPatientId);
  const id = cleanText(input.id || input.requestId || crypto.randomUUID(), 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,99}$/.test(id)) throw Object.assign(new Error("valid request id is required"), { status: 400 });
  const priority = cleanText(input.priority || "routine", 40).toLowerCase();
  if (!REQUEST_PRIORITIES.includes(priority)) throw Object.assign(new Error("valid request priority is required"), { status: 400 });
  const timestamp = nowIso(now);
  const safetyFlags = unique((Array.isArray(input.safetyFlags) ? input.safetyFlags : []).slice(0, 10).map((item) => slug(item))).slice(0, 10);
  const status = cleanText(input.status || definition.received, 80).toLowerCase();
  const state = statusDefinition(requestType, status);
  const actor = cleanText(user.sub || input.createdBy || "system", 200);
  return {
    id,
    bhwPatientId,
    requestType,
    serviceLine: definition.serviceLine,
    assignedTeam: definition.assignedTeam,
    allowedRoles: [...definition.allowedRoles],
    source: cleanText(input.source || "staff", 80).toLowerCase(),
    sourceReference: cleanText(input.sourceReference, 200),
    summary: cleanText(input.summary || input.freeText, 4000),
    priority,
    safetyFlags,
    status,
    statusCategory: state.category,
    statusLabel: state.label,
    statusChangedAt: timestamp,
    assignedTo: "",
    assignedToName: "",
    assignedAt: "",
    firstResponseAt: "",
    resolvedAt: state.category === "completed" ? timestamp : "",
    escalatedAt: "",
    escalationReason: "",
    manualNotifyOnly: input.manualNotifyOnly === true,
    notificationMode: ["automatic", "manual", "none"].includes(cleanText(input.notificationMode, 20).toLowerCase())
      ? cleanText(input.notificationMode, 20).toLowerCase() : "automatic",
    version: 1,
    processedActionKeys: [],
    statusHistory: [{ status, category: state.category, at: timestamp, actor }],
    createdAt: timestamp,
    createdBy: actor,
    updatedAt: timestamp,
    updatedBy: actor,
  };
}

export function normalizeStaffRole(value) {
  const normalized = slug(value);
  const aliases = {
    staff: "front-desk",
    frontdesk: "front-desk",
    "porter-house-admin": "front-desk",
    ma: "ma-bha",
    bha: "ma-bha",
    "bh-assistant": "ma-bha",
    "behavioral-health-assistant": "ma-bha",
    "medical-assistant": "ma-bha",
    "bh-coordinator": "care-manager",
    "behavioral-health-coordinator": "care-manager",
    "chronic-care-manager": "care-manager",
    clinician: "provider",
    crnp: "provider",
    "crnp-fnp": "provider",
    "crnp/fnp": "provider",
    fnp: "provider",
    np: "provider",
    md: "provider",
    do: "provider",
    prescriber: "provider",
    psychiatrist: "provider",
    billing: "rcm",
    biller: "rcm",
    operations: "operations-manager",
    admin: "operations-manager",
    "office-manager": "operations-manager",
    ceo: "executive",
    owner: "executive",
  };
  return aliases[normalized] || normalized;
}

const NON_PROVIDER_QUEUE_ROLES = new Set([
  "front-desk", "ma-bha", "care-manager", "rcm", "operations-manager", "executive",
]);

export function isProviderRole(value) {
  return ["provider", "pmhnp"].includes(normalizeStaffRole(value));
}

export function requiresProviderAttention(request = {}, user = {}) {
  const status = slug(request.status || request.statusCategory);
  const category = slug(request.statusCategory);
  const priority = slug(request.priority);
  const assignedTo = cleanText(request.assignedTo || request.assignedToId, 200);
  const actorSub = cleanText(user.sub || user.id || (user.staffId ? `crew:${user.staffId}` : ""), 200);
  return ["urgent", "emergency"].includes(priority)
    || (Array.isArray(request.safetyFlags) && request.safetyFlags.length > 0)
    || status === "escalated"
    || category === "escalated"
    || Boolean(request.escalatedAt || request.escalationReason)
    || status === "waiting-on-clinician"
    || /(?:triage|provider|clinician).*(?:question|review)|(?:question|review).*(?:provider|clinician)/.test(status)
    || Boolean(assignedTo && actorSub && assignedTo === actorSub);
}

export function canActOnRequest(request, user = {}) {
  const role = normalizeStaffRole(user.role);
  if (role === "system" || NON_PROVIDER_QUEUE_ROLES.has(role)) return true;
  if (isProviderRole(role)) {
    return requiresProviderAttention(request, user)
      || (Array.isArray(request.allowedRoles) && request.allowedRoles.includes(role));
  }
  return false;
}

export function applyPatientRequestAction(request, input = {}, { user = {}, now = new Date() } = {}) {
  if (!request?.id || !request?.requestType) throw Object.assign(new Error("request was not found"), { status: 404 });
  if (!canActOnRequest(request, user)) throw Object.assign(new Error("role is not authorized for this service line"), { status: 403 });
  const action = slug(input.action);
  if (!REQUEST_ACTIONS.includes(action)) throw Object.assign(new Error("supported request action is required"), { status: 400 });
  const actionKey = cleanText(input.idempotencyKey || input.eventId, 160);
  if (!actionKey) throw Object.assign(new Error("idempotency key is required"), { status: 400 });
  const actionHash = crypto.createHash("sha256").update(actionKey).digest("hex");
  if ((request.processedActionKeys || []).includes(actionHash)) return { request, duplicate: true, actionHash };

  const timestamp = nowIso(now);
  const definition = WORKFLOW_DEFINITIONS[request.requestType];
  const actorSub = cleanText(user.sub, 200);
  const actorName = cleanText(user.name || user.email || user.sub || "Staff", 160);
  const currentState = statusDefinition(request.requestType, request.status);
  let nextStatus = request.status;
  let assignedTo = request.assignedTo || "";
  let assignedToName = request.assignedToName || "";
  let escalationReason = request.escalationReason || "";

  if (action === "assign") {
    const requestedAssignee = cleanText(input.assignedTo || actorSub, 200);
    const requestedName = cleanText(input.assignedToName || actorName, 160);
    if (requestedAssignee !== actorSub && !["executive", "operations-manager"].includes(normalizeStaffRole(user.role))) {
      throw Object.assign(new Error("only operations can assign a request to another person"), { status: 403 });
    }
    assignedTo = requestedAssignee;
    assignedToName = requestedName;
  } else if (action === "unassign") {
    if (assignedTo && assignedTo !== actorSub && !["executive", "operations-manager"].includes(normalizeStaffRole(user.role))) {
      throw Object.assign(new Error("only the owner or operations can unassign this request"), { status: 403 });
    }
    assignedTo = "";
    assignedToName = "";
  } else if (action === "start") {
    nextStatus = definition.inProgress;
    assignedTo ||= actorSub;
    assignedToName ||= actorName;
  } else if (action === "milestone") {
    nextStatus = cleanText(input.status || input.outcome, 80).toLowerCase();
    statusDefinition(request.requestType, nextStatus);
    if (statusDefinition(request.requestType, nextStatus).category === "completed") {
      throw Object.assign(new Error("use resolve for a terminal outcome"), { status: 400 });
    }
  } else if (action === "resolve") {
    nextStatus = cleanText(input.outcome || definition.defaultResolution, 80).toLowerCase();
    if (!nextStatus) {
      throw Object.assign(new Error(`${definition.label} requires a specific outcome before it can be resolved`), { status: 409 });
    }
    const outcomeState = statusDefinition(request.requestType, nextStatus);
    if (outcomeState.category !== "completed") throw Object.assign(new Error("resolution outcome must be terminal"), { status: 400 });
    assignedTo ||= actorSub;
    assignedToName ||= actorName;
  } else if (action === "reopen") {
    if (currentState.category !== "completed" && currentState.category !== "escalated") {
      throw Object.assign(new Error("only a completed or escalated request can be reopened"), { status: 409 });
    }
    nextStatus = definition.inProgress;
  } else if (action === "escalate") {
    nextStatus = "escalated";
    escalationReason = cleanText(input.reason, 500);
    if (!escalationReason) throw Object.assign(new Error("escalation reason is required"), { status: 400 });
  }

  const nextState = statusDefinition(request.requestType, nextStatus);
  if (currentState.category === "completed" && !["reopen", "assign", "unassign"].includes(action)) {
    throw Object.assign(new Error("completed request must be reopened before another workflow action"), { status: 409 });
  }
  const statusChanged = nextStatus !== request.status;
  const next = {
    ...request,
    status: nextStatus,
    statusCategory: nextState.category,
    statusLabel: nextState.label,
    statusChangedAt: statusChanged ? timestamp : request.statusChangedAt,
    assignedTo,
    assignedToName,
    assignedAt: assignedTo && assignedTo !== request.assignedTo ? timestamp : (request.assignedAt || ""),
    firstResponseAt: request.firstResponseAt || (["start", "milestone", "resolve", "escalate"].includes(action) ? timestamp : ""),
    resolvedAt: nextState.category === "completed" ? timestamp : (action === "reopen" ? "" : request.resolvedAt || ""),
    escalatedAt: action === "escalate" ? timestamp : (action === "reopen" ? "" : request.escalatedAt || ""),
    escalationReason: action === "reopen" ? "" : escalationReason,
    version: Math.max(1, Number(request.version) || 1) + 1,
    processedActionKeys: [...(request.processedActionKeys || []).slice(-39), actionHash],
    statusHistory: statusChanged ? [...(request.statusHistory || []).slice(-49), {
      status: nextStatus,
      category: nextState.category,
      at: timestamp,
      actor: actorSub,
      action,
    }] : (request.statusHistory || []),
    updatedAt: timestamp,
    updatedBy: actorSub,
  };
  return { request: next, duplicate: false, actionHash, statusChanged, previousStatus: request.status, action };
}

export function defaultNotificationRules() {
  const rules = [];
  for (const [requestType, definition] of Object.entries(WORKFLOW_DEFINITIONS)) {
    for (const [status, state] of Object.entries(definition.statuses)) {
      rules.push({
        id: `${requestType}:${status}:sms`,
        requestType,
        status,
        statusCategory: state.category,
        channel: "sms",
        enabled: state.notify === true,
        template: state.message,
        respectQuietHours: true,
        minimumMinutesBetweenMessages: state.category === "in_progress" ? 30 : 5,
        version: 1,
      });
    }
  }
  return rules;
}

const RULES_BY_ID = new Map(defaultNotificationRules().map((rule) => [rule.id, rule]));

export function notificationRuleId(request) {
  return `${normalizeRequestType(request.requestType)}:${cleanText(request.status, 80).toLowerCase()}:sms`;
}

export function resolveNotificationRule(request, ...overrides) {
  const id = notificationRuleId(request);
  const base = RULES_BY_ID.get(id);
  if (!base) return null;
  return overrides.filter(Boolean).reduce((rule, override) => {
    if (override.id && override.id !== id) return rule;
    return { ...rule, ...override, id, requestType: base.requestType, status: base.status, channel: "sms" };
  }, { ...base });
}

export function renderSmsTemplate(rule, { patientPortalUrl = "" } = {}) {
  let message = cleanText(rule?.template, 480);
  const link = (() => {
    try { const url = new URL(String(patientPortalUrl || "")); return url.protocol === "https:" ? url.toString() : ""; }
    catch { return ""; }
  })();
  message = message.replaceAll("{{patientPortalUrl}}", link);
  if (link && !message.includes(link)) message = `${message} ${link}`.trim();
  if (!message || message.length > 480) throw Object.assign(new Error("safe SMS template is not configured"), { status: 503 });
  if (/\{\{[^}]+\}\}/.test(message)) throw Object.assign(new Error("SMS template contains an unsupported field"), { status: 503 });
  return message;
}

export function sanitizeManualSms(value, { noPhiAttestation = false } = {}) {
  if (noPhiAttestation !== true) throw Object.assign(new Error("confirm that the message contains no PHI before sending"), { status: 400 });
  const message = cleanText(value, 480);
  if (!message) throw Object.assign(new Error("message is required"), { status: 400 });
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(message) || /\b(?:dob|date of birth|diagnosis|mrn|member id)\s*[:#]/i.test(message)) {
    throw Object.assign(new Error("message appears to contain protected identifiers; use the secure patient page"), { status: 400 });
  }
  return message;
}

export function isSmsOptOut(value) {
  return /^(?:stop|stopall|unsubscribe|cancel|end|quit)$/i.test(cleanText(value, 40));
}

export function isSmsOptIn(value) {
  return /^(?:start|unstop|yes)$/i.test(cleanText(value, 40));
}

function localMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

const parseClock = (value, fallback) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total >= 0 && total < 1440 ? total : fallback;
};

export function quietHoursState(now = new Date(), {
  timeZone = "America/New_York",
  start = "20:00",
  end = "08:00",
} = {}) {
  const date = now instanceof Date ? now : new Date(now);
  const startMinutes = parseClock(start, 20 * 60);
  const endMinutes = parseClock(end, 8 * 60);
  const minutes = localMinutes(date, timeZone);
  const quiet = startMinutes === endMinutes ? false
    : startMinutes < endMinutes ? minutes >= startMinutes && minutes < endMinutes
      : minutes >= startMinutes || minutes < endMinutes;
  if (!quiet) return { quiet: false, sendAfter: date.toISOString(), timeZone };
  let candidate = new Date(date.getTime());
  for (let i = 0; i < 24 * 60 + 5; i += 5) {
    candidate = new Date(candidate.getTime() + 5 * 60 * 1000);
    const candidateMinutes = localMinutes(candidate, timeZone);
    const candidateQuiet = startMinutes < endMinutes
      ? candidateMinutes >= startMinutes && candidateMinutes < endMinutes
      : candidateMinutes >= startMinutes || candidateMinutes < endMinutes;
    if (!candidateQuiet) return { quiet: true, sendAfter: candidate.toISOString(), timeZone };
  }
  return { quiet: true, sendAfter: new Date(date.getTime() + 12 * 60 * 60 * 1000).toISOString(), timeZone };
}

export function requiresSafetyHold(request) {
  return ["urgent", "emergency"].includes(request.priority) || (request.safetyFlags || []).length > 0;
}

function actionButton(text, action, request, extra = {}, style = "") {
  return {
    text,
    ...(style ? { color: style } : {}),
    onClick: { action: {
      function: "patient_request_action",
      parameters: [
        { key: "requestId", value: request.id },
        { key: "requestVersion", value: String(request.version || 1) },
        { key: "workflowAction", value: action },
        ...Object.entries(extra).map(([key, value]) => ({ key, value: String(value) })),
      ],
    } },
  };
}

export function buildGoogleChatCard(request, { crewOsUrl = "" } = {}) {
  const definition = WORKFLOW_DEFINITIONS[request.requestType];
  const openLink = (() => {
    try {
      const url = new URL(String(crewOsUrl || ""));
      if (url.protocol !== "https:") return "";
      url.searchParams.set("request", request.id);
      return url.toString();
    } catch { return ""; }
  })();
  const buttons = [];
  if (!request.assignedTo && request.statusCategory !== "completed") buttons.push(actionButton("Assign to me", "assign", request));
  if (!["in_progress", "completed"].includes(request.statusCategory)) buttons.push(actionButton("Start", "start", request));
  if (request.statusCategory !== "completed") {
    for (const milestone of (definition.cardMilestones || []).slice(0, 2)) {
      if (milestone.status !== request.status) buttons.push(actionButton(milestone.label, "milestone", request, { status: milestone.status }));
    }
    for (const outcome of definition.cardOutcomes.slice(0, 2)) {
      buttons.push(actionButton(outcome.label, "resolve", request, { outcome: outcome.status }));
    }
    buttons.push(actionButton("Escalate", "escalate", request, { reason: "Escalated from Google Chat" }));
  }
  if (openLink) buttons.push({ text: "Open in CrewOS", onClick: { openLink: { url: openLink } } });
  return {
    text: `${definition.label} ${request.id}: ${request.statusLabel}`,
    cardsV2: [{
      cardId: `request-${request.id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64),
      card: {
        header: { title: definition.label, subtitle: `${request.serviceLine} · ${request.priority}` },
        sections: [{ widgets: [
          { decoratedText: { topLabel: "Request", text: request.id } },
          { decoratedText: { topLabel: "Status", text: request.statusLabel } },
          { decoratedText: { topLabel: "Assigned team", text: request.assignedTeam } },
          { decoratedText: { topLabel: "Owner", text: request.assignedToName || "Unassigned" } },
          { buttonList: { buttons } },
        ] }],
      },
    }],
  };
}

export function deterministicId(...parts) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex");
}

