import crypto from "node:crypto";
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_STATUSES,
  PATIENT_MATCH_STATUSES,
  PATIENT_REQUEST_STATUSES,
  PATIENT_REQUEST_TYPES,
  PRIORITIES,
  REQUEST_TRANSITIONS,
  SCHEMA_VERSION,
  TARGET_SYSTEMS,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TASK_TYPES,
  TEAM_SLUG_PATTERN,
  apiError,
  cleanText,
  enumValue,
  optionalBhwPatientId,
  optionalIsoDate,
  requireExternalId,
} from "./schema.mjs";

const NOTIFICATION_EVENT_BY_STATUS = Object.freeze({
  received: "request-received",
  triaged: "request-triaged",
  "in-progress": "request-in-progress",
  "waiting-on-patient": "request-waiting-on-patient",
  "waiting-on-external": "request-waiting-on-external",
  resolved: "request-resolved",
  closed: "request-closed",
  cancelled: "request-cancelled",
});

export function defaultIdFactory(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function stableHash(value) {
  function stable(input) {
    if (Array.isArray(input)) return input.map(stable);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, stable(input[key])]));
  }
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function normalizeTeam(value, fallback = "front-desk") {
  const team = cleanText(value || fallback, 40, { required: true, field: "assignedTeam" }).toLowerCase();
  if (!TEAM_SLUG_PATTERN.test(team)) throw apiError(400, "validation_error", "assignedTeam is invalid");
  return team;
}

function normalizeSource(value, fallback) {
  const source = cleanText(value || fallback, 40, { required: true, field: "source" }).toLowerCase();
  if (!TEAM_SLUG_PATTERN.test(source)) throw apiError(400, "validation_error", "source is invalid");
  return source;
}

function normalizeRequester(input = {}) {
  return {
    displayName: cleanText(input.displayName, 120),
    callbackPhone: cleanText(input.callbackPhone, 40),
    email: cleanText(input.email, 254).toLowerCase(),
    preferredChannel: cleanText(input.preferredChannel, 20).toLowerCase(),
  };
}

function normalizeSourceMetadata(input = {}) {
  return {
    sourceRecordId: cleanText(input.sourceRecordId, 160),
    sourcePage: cleanText(input.sourcePage, 120),
    legacyNotionPageId: cleanText(input.legacyNotionPageId, 80),
    sourceUrl: cleanText(input.sourceUrl, 1000),
    referralDestination: cleanText(input.referralDestination, 160),
    referralDocumentState: cleanText(input.referralDocumentState, 40),
  };
}

export function normalizePatientRequestInput(input, { intake = false } = {}) {
  const bhwPatientId = optionalBhwPatientId(input?.bhwPatientId);
  const patientMatchStatus = enumValue(
    input?.patientMatchStatus,
    PATIENT_MATCH_STATUSES,
    "patientMatchStatus",
    bhwPatientId ? "matched" : "unmatched",
  );
  if (patientMatchStatus === "matched" && !bhwPatientId) {
    throw apiError(400, "validation_error", "matched requests require bhwPatientId");
  }
  if (bhwPatientId && patientMatchStatus === "unmatched") {
    throw apiError(400, "validation_error", "a request with bhwPatientId cannot be unmatched");
  }

  const targetSystem = enumValue(input?.routing?.targetSystem, TARGET_SYSTEMS, "routing.targetSystem", "crewos");
  const requestType = enumValue(input?.requestType, PATIENT_REQUEST_TYPES, "requestType", "general");
  const message = cleanText(input?.message, 4000, { required: intake, field: "message" });
  const summary = cleanText(input?.summary || message.slice(0, 500), 500, { required: true, field: "summary" });

  return {
    bhwPatientId,
    patientMatchStatus,
    requestType,
    priority: enumValue(input?.priority, PRIORITIES, "priority", "routine"),
    summary,
    message,
    source: normalizeSource(input?.source, intake ? "care-connect" : "crewos"),
    requester: normalizeRequester(input?.requester),
    routing: {
      targetSystem,
      assignedTeam: normalizeTeam(input?.routing?.assignedTeam),
      assignedTo: cleanText(input?.routing?.assignedTo, 120),
      ownerRole: cleanText(input?.routing?.ownerRole, 80).toLowerCase(),
      downstreamReference: cleanText(input?.routing?.downstreamReference, 160),
    },
    dueAt: optionalIsoDate(input?.dueAt, "dueAt"),
    sourceMetadata: normalizeSourceMetadata(input?.sourceMetadata),
  };
}

function notificationMetadata(status, now) {
  return {
    policy: "manual-only",
    automationEnabled: false,
    lastEligibleEvent: NOTIFICATION_EVENT_BY_STATUS[status],
    lastEligibleAt: now,
    deliveryState: "not-scheduled",
    lastPatientNotifiedAt: "",
    lastCommunicationId: "",
  };
}

function auditEvent({ idFactory, now, actor, action, resourceType, resourceId, bhwPatientId = "", changes = {} }) {
  return {
    auditEventId: idFactory("AUD"),
    schemaVersion: SCHEMA_VERSION,
    eventType: action,
    occurredAt: now,
    actor: {
      type: cleanText(actor?.type || "system", 40),
      id: cleanText(actor?.id || "system", 160),
      role: cleanText(actor?.role || "system", 80),
    },
    resource: { type: resourceType, id: resourceId },
    bhwPatientId,
    changes,
  };
}

export function buildPatientRequestBundle(input, actor, {
  now = new Date().toISOString(),
  idFactory = defaultIdFactory,
  intake = false,
} = {}) {
  const normalized = normalizePatientRequestInput(input, { intake });
  const patientRequestId = idFactory("REQ");
  const taskId = idFactory("TSK");
  const communicationId = idFactory("COM");
  const request = {
    patientRequestId,
    schemaVersion: SCHEMA_VERSION,
    bhwPatientId: normalized.bhwPatientId,
    patientMatchStatus: normalized.patientMatchStatus,
    requestType: normalized.requestType,
    source: normalized.source,
    priority: normalized.priority,
    summary: normalized.summary,
    requester: normalized.requester,
    routing: normalized.routing,
    status: "received",
    statusReasonCode: "",
    receivedAt: now,
    statusChangedAt: now,
    triagedAt: "",
    startedAt: "",
    waitingSince: "",
    resolvedAt: "",
    closedAt: "",
    cancelledAt: "",
    dueAt: normalized.dueAt,
    taskIds: [taskId],
    communicationIds: [communicationId],
    communicationCount: 1,
    lastCommunicationAt: now,
    notificationMetadata: notificationMetadata("received", now),
    sourceMetadata: normalized.sourceMetadata,
    createdAt: now,
    createdBy: actor.id,
    updatedAt: now,
    updatedBy: actor.id,
  };
  const task = {
    taskId,
    schemaVersion: SCHEMA_VERSION,
    patientRequestId,
    bhwPatientId: normalized.bhwPatientId,
    taskType: "triage",
    title: `Triage ${normalized.requestType} request`,
    taskStatus: "open",
    assignedTeam: normalized.routing.assignedTeam,
    assignedTo: normalized.routing.assignedTo,
    ownerRole: normalized.routing.ownerRole,
    targetSystem: normalized.routing.targetSystem,
    dueAt: normalized.dueAt,
    statusChangedAt: now,
    startedAt: "",
    blockedAt: "",
    completedAt: "",
    cancelledAt: "",
    createdAt: now,
    createdBy: actor.id,
    updatedAt: now,
    updatedBy: actor.id,
  };
  const communication = {
    communicationId,
    schemaVersion: SCHEMA_VERSION,
    patientRequestId,
    bhwPatientId: normalized.bhwPatientId,
    direction: "inbound",
    channel: normalized.source === "care-connect" ? "portal" : "internal",
    communicationStatus: "received",
    eventType: "request-received",
    patientVisible: true,
    body: normalized.message || normalized.summary,
    summary: normalized.summary,
    sender: normalized.requester,
    requestStatusAtEvent: "received",
    consentSnapshot: { required: false, verified: false, consentId: "" },
    occurredAt: now,
    createdAt: now,
    createdBy: actor.id,
  };
  const audits = [
    auditEvent({ idFactory, now, actor, action: "patient-request.created", resourceType: "patientRequest", resourceId: patientRequestId, bhwPatientId: normalized.bhwPatientId }),
    auditEvent({ idFactory, now, actor, action: "task.created", resourceType: "task", resourceId: taskId, bhwPatientId: normalized.bhwPatientId }),
    auditEvent({ idFactory, now, actor, action: "communication.recorded", resourceType: "communication", resourceId: communicationId, bhwPatientId: normalized.bhwPatientId }),
  ];
  return { request, task, communication, audits, payloadHash: stableHash(normalized) };
}

export function transitionPatientRequest(current, input, actor, {
  now = new Date().toISOString(),
  idFactory = defaultIdFactory,
} = {}) {
  const patientRequestId = requireExternalId(current?.patientRequestId, "REQ", "patientRequestId");
  const from = enumValue(current?.status, PATIENT_REQUEST_STATUSES, "current status");
  const to = enumValue(input?.status, PATIENT_REQUEST_STATUSES, "status");
  if (from === to) return { request: current, audit: null, unchanged: true };
  if (!REQUEST_TRANSITIONS[from].includes(to)) {
    throw apiError(409, "invalid_transition", `patient request cannot move from ${from} to ${to}`);
  }
  const next = {
    ...current,
    status: to,
    statusReasonCode: cleanText(input?.reasonCode, 80).toLowerCase(),
    statusChangedAt: now,
    updatedAt: now,
    updatedBy: actor.id,
    notificationMetadata: {
      ...(current.notificationMetadata || notificationMetadata(from, current.statusChangedAt || now)),
      policy: "manual-only",
      automationEnabled: false,
      lastEligibleEvent: NOTIFICATION_EVENT_BY_STATUS[to],
      lastEligibleAt: now,
      deliveryState: "not-scheduled",
    },
  };
  if (to === "triaged") next.triagedAt = now;
  if (to === "in-progress") {
    next.startedAt ||= now;
    next.waitingSince = "";
    if (["resolved", "closed"].includes(from)) {
      next.resolvedAt = "";
      next.closedAt = "";
    }
  }
  if (to.startsWith("waiting-")) next.waitingSince = now;
  if (to === "resolved") {
    next.resolvedAt = now;
    next.waitingSince = "";
  }
  if (to === "closed") next.closedAt = now;
  if (to === "cancelled") {
    next.cancelledAt = now;
    next.waitingSince = "";
  }
  const audit = auditEvent({
    idFactory,
    now,
    actor,
    action: "patient-request.status-changed",
    resourceType: "patientRequest",
    resourceId: patientRequestId,
    bhwPatientId: current.bhwPatientId,
    changes: { status: { from, to }, reasonCode: next.statusReasonCode },
  });
  return { request: next, audit, unchanged: false };
}

export function transitionTask(current, input, actor, {
  now = new Date().toISOString(),
  idFactory = defaultIdFactory,
} = {}) {
  const taskId = requireExternalId(current?.taskId, "TSK", "taskId");
  const from = enumValue(current?.taskStatus, TASK_STATUSES, "current task status");
  const to = enumValue(input?.taskStatus || input?.status, TASK_STATUSES, "taskStatus");
  if (from === to) return { task: current, audit: null, unchanged: true };
  if (!TASK_TRANSITIONS[from].includes(to)) {
    throw apiError(409, "invalid_transition", `task cannot move from ${from} to ${to}`);
  }
  const next = {
    ...current,
    taskStatus: to,
    statusReasonCode: cleanText(input?.reasonCode, 80).toLowerCase(),
    statusChangedAt: now,
    updatedAt: now,
    updatedBy: actor.id,
  };
  if (to === "in-progress") next.startedAt ||= now;
  if (to === "blocked") next.blockedAt = now;
  if (to === "done") next.completedAt = now;
  if (to === "cancelled") next.cancelledAt = now;
  if (to === "open") {
    next.completedAt = "";
    next.cancelledAt = "";
    next.blockedAt = "";
  }
  const audit = auditEvent({
    idFactory,
    now,
    actor,
    action: "task.status-changed",
    resourceType: "task",
    resourceId: taskId,
    bhwPatientId: current.bhwPatientId,
    changes: { taskStatus: { from, to }, reasonCode: next.statusReasonCode },
  });
  return { task: next, audit, unchanged: false };
}

export function buildCommunication(input, request, actor, {
  now = new Date().toISOString(),
  idFactory = defaultIdFactory,
} = {}) {
  const patientRequestId = requireExternalId(input?.patientRequestId, "REQ", "patientRequestId");
  if (patientRequestId !== request.patientRequestId) throw apiError(409, "request_mismatch", "patientRequestId does not match");
  const communicationId = idFactory("COM");
  const direction = enumValue(input?.direction, COMMUNICATION_DIRECTIONS, "direction");
  const channel = enumValue(input?.channel, COMMUNICATION_CHANNELS, "channel");
  const communicationStatus = enumValue(input?.communicationStatus, COMMUNICATION_STATUSES, "communicationStatus");
  const patientVisible = direction !== "internal" && input?.patientVisible !== false;
  const communication = {
    communicationId,
    schemaVersion: SCHEMA_VERSION,
    patientRequestId,
    bhwPatientId: request.bhwPatientId || "",
    direction,
    channel,
    communicationStatus,
    eventType: cleanText(input?.eventType || "manual", 80, { required: true, field: "eventType" }).toLowerCase(),
    patientVisible,
    body: cleanText(input?.body, 4000),
    summary: cleanText(input?.summary || input?.body, 500, { required: true, field: "summary" }),
    sender: {
      displayName: cleanText(input?.sender?.displayName, 120),
      contactReference: cleanText(input?.sender?.contactReference, 160),
    },
    recipient: {
      displayName: cleanText(input?.recipient?.displayName, 120),
      contactReference: cleanText(input?.recipient?.contactReference, 160),
    },
    requestStatusAtEvent: request.status,
    consentSnapshot: {
      required: Boolean(input?.consentSnapshot?.required),
      verified: Boolean(input?.consentSnapshot?.verified),
      consentId: cleanText(input?.consentSnapshot?.consentId, 160),
    },
    providerMessageId: cleanText(input?.providerMessageId, 200),
    failureCode: cleanText(input?.failureCode, 120),
    occurredAt: optionalIsoDate(input?.occurredAt, "occurredAt") || now,
    sentAt: optionalIsoDate(input?.sentAt, "sentAt"),
    deliveredAt: optionalIsoDate(input?.deliveredAt, "deliveredAt"),
    failedAt: optionalIsoDate(input?.failedAt, "failedAt"),
    createdAt: now,
    createdBy: actor.id,
  };
  const audit = auditEvent({
    idFactory,
    now,
    actor,
    action: "communication.recorded",
    resourceType: "communication",
    resourceId: communicationId,
    bhwPatientId: request.bhwPatientId,
    changes: { direction, channel, communicationStatus, patientVisible },
  });
  return { communication, audit };
}

export function normalizeTaskInput(input, request, actor, {
  now = new Date().toISOString(),
  idFactory = defaultIdFactory,
} = {}) {
  const taskId = idFactory("TSK");
  const taskType = enumValue(input?.taskType, TASK_TYPES, "taskType", "request-fulfillment");
  const task = {
    taskId,
    schemaVersion: SCHEMA_VERSION,
    patientRequestId: request.patientRequestId,
    bhwPatientId: request.bhwPatientId || "",
    taskType,
    title: cleanText(input?.title, 200, { required: true, field: "title" }),
    taskStatus: "open",
    assignedTeam: normalizeTeam(input?.assignedTeam || request.routing?.assignedTeam),
    assignedTo: cleanText(input?.assignedTo, 120),
    ownerRole: cleanText(input?.ownerRole, 80).toLowerCase(),
    targetSystem: enumValue(input?.targetSystem, TARGET_SYSTEMS, "targetSystem", request.routing?.targetSystem || "crewos"),
    dueAt: optionalIsoDate(input?.dueAt, "dueAt"),
    statusChangedAt: now,
    startedAt: "",
    blockedAt: "",
    completedAt: "",
    cancelledAt: "",
    createdAt: now,
    createdBy: actor.id,
    updatedAt: now,
    updatedBy: actor.id,
  };
  const audit = auditEvent({ idFactory, now, actor, action: "task.created", resourceType: "task", resourceId: taskId, bhwPatientId: task.bhwPatientId });
  return { task, audit };
}
