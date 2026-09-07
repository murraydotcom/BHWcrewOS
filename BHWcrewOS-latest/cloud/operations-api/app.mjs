import {
  PATIENT_REQUEST_STATUSES,
  PATIENT_REQUEST_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_STATUSES,
  SCHEMA_VERSION,
  assertBhwPatientId,
  apiError,
  requireIdempotencyKey,
} from "./schema.mjs";
import { buildPatientRequestBundle } from "./domain.mjs";
import { verifyCrewToken, verifyIntakeClient, verifyPatientIdentityClient } from "./auth.mjs";
import {
  patientIdentityReference,
  patientPortalAccessForStaff,
  patientPortalInvitationPreview,
  requirePatientPortalApprover,
  sanitizePatientIdentity,
} from "./patient-identity.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BULK_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BULK_RECORDS = 300;

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function allowedOrigins(environment) {
  return String(environment.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request, environment) {
  const origin = request.headers.get("origin") || "";
  if (!origin || !allowedOrigins(environment).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-BHW-Client-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    Vary: "Origin",
  };
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw apiError(413, "payload_too_large", "request body is too large");
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("object required");
    return value;
  } catch {
    throw apiError(400, "bad_json", "request body must be a JSON object");
  }
}

function queryFilters(url) {
  return Object.fromEntries([...url.searchParams.entries()].filter(([, value]) => value !== ""));
}

function staffActor(request, environment, now) {
  return verifyCrewToken(request.headers.get("authorization"), environment.CREWOS_OPERATIONS_TOKEN_SECRET, { now: now().getTime() });
}

function intakeActor(request, environment) {
  return verifyIntakeClient(
    request.headers.get("authorization"),
    environment.CARE_CONNECT_INTAKE_SECRET,
    request.headers.get("x-bhw-client-id"),
    environment.CARE_CONNECT_CLIENT_ID || "care-connect",
  );
}

function frontDeskReferralActor(request, environment) {
  return verifyIntakeClient(
    request.headers.get("authorization"),
    environment.FRONT_DESK_INTAKE_SECRET,
    request.headers.get("x-bhw-client-id"),
    environment.FRONT_DESK_CLIENT_ID || "front-desk-os",
  );
}

function workflowActor(actor = {}) {
  return {
    ...actor,
    sub: actor.sub || actor.id || (actor.staffId ? `crew:${actor.staffId}` : "system"),
    name: actor.name || actor.id || "CrewOS",
    role: actor.role || "staff",
  };
}

function patientIdentityActor(request, environment) {
  return verifyPatientIdentityClient(
    request.headers.get("authorization"),
    environment.CARE_CONNECT_PATIENT_IDENTITY_SECRET,
    request.headers.get("x-bhw-client-id"),
    environment.CARE_CONNECT_CLIENT_ID || "care-connect",
  );
}

export function createOperationsApp({
  repository,
  workflow = null,
  environment = process.env,
  now = () => new Date(),
  idFactory,
} = {}) {
  if (!repository) throw new Error("repository is required");

  return async function operationsApp(request) {
    const cors = corsHeaders(request, environment);
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/health" && request.method === "GET") {
        return json(200, {
          ok: true,
          service: "bhw-operations-api",
          schemaVersion: SCHEMA_VERSION,
          workflowAutomationEnabled: workflow?.automationEnabled === true,
        }, cors);
      }

      if (url.pathname === "/v1/chat/events" && request.method === "POST") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "Google Chat workflow is not configured");
        return json(200, await workflow.handleChatEvent(request), cors);
      }
      if (url.pathname === "/v1/webhooks/dialpad" && request.method === "POST") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "Dialpad workflow is not configured");
        return json(200, await workflow.handleDialpadWebhook(await request.text()), cors);
      }
      if (url.pathname === "/v1/workflow/dispatch" && request.method === "POST") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "workflow dispatcher is not configured");
        return json(200, await workflow.dispatchDue(request.headers.get("authorization")), cors);
      }
      if (url.pathname === "/v1/contracts/communication-foundation" && request.method === "GET") {
        staffActor(request, environment, now);
        return json(200, {
          ok: true,
          schemaVersion: SCHEMA_VERSION,
          patientRequestStatuses: PATIENT_REQUEST_STATUSES,
          patientRequestTypes: PATIENT_REQUEST_TYPES,
          taskStatuses: TASK_STATUSES,
          taskTypes: TASK_TYPES,
          communicationDirections: COMMUNICATION_DIRECTIONS,
          communicationChannels: COMMUNICATION_CHANNELS,
          communicationStatuses: COMMUNICATION_STATUSES,
          notificationAutomationEnabled: workflow?.automationEnabled === true,
        }, cors);
      }

      if (url.pathname === "/v1/intake/patient-requests" && request.method === "POST") {
        const actor = intakeActor(request, environment);
        const idempotencyKey = requireIdempotencyKey(request.headers.get("idempotency-key"));
        const body = await readJson(request);
        const timestamp = now().toISOString();
        const bundle = buildPatientRequestBundle({ ...body, source: "care-connect" }, actor, { now: timestamp, idFactory, intake: true });
        const result = await repository.createPatientRequest(bundle, {
          scope: `intake:${actor.id}`,
          key: idempotencyKey,
          payloadHash: bundle.payloadHash,
        });
        let automation = null;
        if (workflow && !result.replayed) {
          automation = await workflow.syncCreatedRequest(result.request.patientRequestId, {
            sub: `integration:${actor.id}`,
            name: actor.id,
            role: "system",
            source: "care-connect",
          });
        }
        return json(result.replayed ? 200 : 201, {
          ok: true,
          replayed: result.replayed,
          patientRequest: automation?.request || result.request,
          notification: automation?.notification || null,
          chat: automation?.chat || null,
        }, cors);
      }

      if (url.pathname === "/v1/intake/front-desk-referrals" && request.method === "POST") {
        const actor = frontDeskReferralActor(request, environment);
        const idempotencyKey = requireIdempotencyKey(request.headers.get("idempotency-key"));
        const body = await readJson(request);
        const timestamp = now().toISOString();
        const bundle = buildPatientRequestBundle({
          ...body,
          requestType: "referral",
          patientMatchStatus: "matched",
          source: "front-desk-os",
          routing: { targetSystem: "crewos", assignedTeam: "referrals" },
        }, actor, { now: timestamp, idFactory, intake: true });
        const result = await repository.createPatientRequest(bundle, {
          scope: `intake:${actor.id}`,
          key: idempotencyKey,
          payloadHash: bundle.payloadHash,
        });
        let automation = null;
        if (workflow && !result.replayed) {
          automation = await workflow.syncCreatedRequest(result.request.patientRequestId, {
            sub: `integration:${actor.id}`,
            name: "Front Desk OS",
            role: "front-desk",
            source: "front-desk-os",
          });
        }
        return json(result.replayed ? 200 : 201, {
          ok: true,
          replayed: result.replayed,
          patientRequest: automation?.request || result.request,
          notification: automation?.notification || null,
          chat: automation?.chat || null,
        }, cors);
      }

      if (url.pathname === "/v1/intake/front-desk-patient-requests" && request.method === "POST") {
        const actor = frontDeskReferralActor(request, environment);
        const idempotencyKey = requireIdempotencyKey(request.headers.get("idempotency-key"));
        const body = await readJson(request);
        const historicalTimestamp = body.notificationMode === "none" ? new Date(body.historicalReceivedAt || "") : null;
        const timestamp = historicalTimestamp && Number.isFinite(historicalTimestamp.getTime())
          ? historicalTimestamp.toISOString() : now().toISOString();
        const bundle = buildPatientRequestBundle({
          ...body,
          source: body.source || "front-desk-os",
          routing: { targetSystem: "crewos", assignedTeam: "front-desk", ...(body.routing || {}) },
          workflowContext: {
            kind: "patient-request",
            ...(body.workflowContext || {}),
            historicalReceivedAt: body.historicalReceivedAt || body.workflowContext?.historicalReceivedAt || "",
          },
        }, actor, { now: timestamp, idFactory, intake: true });
        const result = await repository.createPatientRequest(bundle, {
          scope: `intake:${actor.id}`,
          key: idempotencyKey,
          payloadHash: bundle.payloadHash,
        });
        let automation = null;
        if (workflow && !result.replayed && body.notificationMode !== "none") {
          automation = await workflow.syncCreatedRequest(result.request.patientRequestId, {
            sub: `integration:${actor.id}`,
            name: "Front Desk OS",
            role: "front-desk",
            source: "front-desk-os",
          });
        }
        return json(result.replayed ? 200 : 201, {
          ok: true,
          replayed: result.replayed,
          patientRequest: automation?.request || result.request,
          notification: automation?.notification || null,
          chat: automation?.chat || null,
        }, cors);
      }

      if (url.pathname === "/v1/intake/front-desk-patient-requests/bulk" && request.method === "POST") {
        const actor = frontDeskReferralActor(request, environment);
        const input = await readJson(request, MAX_BULK_BODY_BYTES);
        const records = Array.isArray(input.records) ? input.records : [];
        if (!records.length || records.length > MAX_BULK_RECORDS) {
          throw apiError(400, "validation_error", `bulk migration requires 1-${MAX_BULK_RECORDS} records`);
        }
        // Validate and normalize the entire batch before the first Firestore write.
        // A malformed record must not create a partially applied migration batch.
        const prepared = records.map((entry) => {
          const body = entry?.body && typeof entry.body === "object" ? entry.body : {};
          if (body.notificationMode !== "none") {
            throw apiError(400, "validation_error", "bulk migration records must suppress notifications");
          }
          const idempotencyKey = requireIdempotencyKey(entry?.submissionId);
          const historicalReceivedAt = body.historicalReceivedAt || body.workflowContext?.historicalReceivedAt || "";
          const historicalTimestamp = new Date(historicalReceivedAt);
          const timestamp = Number.isFinite(historicalTimestamp.getTime())
            ? historicalTimestamp.toISOString() : now().toISOString();
          const bundle = buildPatientRequestBundle({
            ...body,
            source: body.source || "front-desk-os",
            routing: { targetSystem: "crewos", assignedTeam: "front-desk", ...(body.routing || {}) },
            workflowContext: {
              kind: "patient-request",
              ...(body.workflowContext || {}),
              historicalReceivedAt,
            },
          }, actor, { now: timestamp, idFactory, intake: true });
          return { bundle, idempotencyKey };
        });
        const results = await mapLimit(prepared, 24, async ({ bundle, idempotencyKey }) => {
          const result = await repository.createPatientRequest(bundle, {
            scope: `intake:${actor.id}`,
            key: idempotencyKey,
            payloadHash: bundle.payloadHash,
          });
          const requestId = result.request.patientRequestId;
          const readBack = await repository.getPatientRequest(requestId);
          if (!readBack || readBack.patientRequestId !== requestId) {
            throw apiError(502, "readback_failed", "a migrated patient request was not read back from BHW Cloud");
          }
          return { submissionId: idempotencyKey, patientRequestId: requestId, replayed: result.replayed, verified: true };
        });
        return json(200, {
          ok: true,
          storage: "BHW Cloud",
          savedAt: now().toISOString(),
          writtenCount: results.length,
          verifiedCount: results.filter((result) => result.verified).length,
          replayedCount: results.filter((result) => result.replayed).length,
          results,
          notification: null,
          chat: null,
        }, cors);
      }

      const frontDeskReferralActionMatch = url.pathname.match(/^\/v1\/intake\/front-desk-referrals\/([^/]+)\/actions$/);
      if (frontDeskReferralActionMatch && request.method === "POST") {
        const actor = frontDeskReferralActor(request, environment);
        if (!workflow) throw apiError(503, "workflow_not_configured", "referral workflow is not configured");
        const body = await readJson(request);
        const idempotencyKey = requireIdempotencyKey(request.headers.get("idempotency-key"));
        return json(200, { ok: true, ...(await workflow.action(
          decodeURIComponent(frontDeskReferralActionMatch[1]),
          { ...body, idempotencyKey },
          { sub: `integration:${actor.id}`, name: "Front Desk OS", role: "front-desk", source: "front-desk-os" },
        )) }, cors);
      }

      if (url.pathname === "/v1/patient-identity/resolve" && request.method === "POST") {
        patientIdentityActor(request, environment);
        if (String(environment.PATIENT_PORTAL_PILOT_ENABLED || "false").trim().toLowerCase() !== "true") {
          throw apiError(503, "patient_portal_pilot_disabled", "patient portal access is not available right now");
        }
        const identity = sanitizePatientIdentity(await readJson(request));
        const match = await repository.resolvePatientIdentity(identity, {
          identityReference: patientIdentityReference(identity, environment.CARE_CONNECT_PATIENT_IDENTITY_SECRET),
          now: now().toISOString(),
        });
        if (!match) {
          throw apiError(403, "identity_not_matched", "we could not securely match this sign-in to one patient record; please contact BHW");
        }
        return json(200, { ok: true, patient: match }, cors);
      }

      const actor = staffActor(request, environment, now);
      const portalAccessMatch = url.pathname.match(/^\/v1\/patient-portal-access\/([^/]+)$/);
      if (portalAccessMatch && ["GET", "PUT"].includes(request.method)) {
        const bhwPatientId = assertBhwPatientId(decodeURIComponent(portalAccessMatch[1]));
        if (request.method === "GET") {
          const record = await repository.getPatientPortalAccess(bhwPatientId);
          if (!record?.patient) throw apiError(404, "patient_not_found", "patient was not found in the protected registry");
          return json(200, {
            ok: true,
            bhwPatientId,
            access: patientPortalAccessForStaff(record.access),
            invitationPreview: patientPortalInvitationPreview(),
            organizationPilotEnabled: String(environment.PATIENT_PORTAL_PILOT_ENABLED || "false").trim().toLowerCase() === "true",
          }, cors);
        }
        requirePatientPortalApprover(actor);
        const access = await repository.savePatientPortalAccess(
          bhwPatientId,
          await readJson(request),
          actor,
          { now: now() },
        );
        return json(200, { ok: true, bhwPatientId, access: patientPortalAccessForStaff(access), invitationPreview: patientPortalInvitationPreview() }, cors);
      }
      if (url.pathname === "/v1/patient-requests" && request.method === "GET") {
        const rows = workflow
          ? await workflow.listRequests(queryFilters(url), workflowActor(actor))
          : await repository.listPatientRequests(queryFilters(url));
        return json(200, { ok: true, requests: rows, patientRequests: rows }, cors);
      }
      if (url.pathname === "/v1/patient-requests" && request.method === "POST") {
        if (workflow) {
          const body = await readJson(request);
          const result = await workflow.createRequest(body, workflowActor(actor));
          return json(201, { ok: true, ...result }, cors);
        }
        const idempotencyKey = requireIdempotencyKey(request.headers.get("idempotency-key"));
        const body = await readJson(request);
        const timestamp = now().toISOString();
        const bundle = buildPatientRequestBundle({ ...body, source: body.source || "crewos" }, actor, { now: timestamp, idFactory });
        const result = await repository.createPatientRequest(bundle, {
          scope: `staff:${actor.staffId}`,
          key: idempotencyKey,
          payloadHash: bundle.payloadHash,
        });
        return json(result.replayed ? 200 : 201, { ok: true, replayed: result.replayed, patientRequest: result.request }, cors);
      }

      const requestMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)$/);
      if (requestMatch && request.method === "GET") {
        const patientRequest = workflow
          ? await workflow.getRequest(decodeURIComponent(requestMatch[1]), workflowActor(actor))
          : await repository.getPatientRequest(decodeURIComponent(requestMatch[1]));
        return json(200, { ok: true, request: patientRequest, patientRequest }, cors);
      }
      const requestActionMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)\/actions$/);
      if (requestActionMatch && request.method === "POST") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "patient request actions are not configured");
        return json(200, { ok: true, ...(await workflow.action(
          decodeURIComponent(requestActionMatch[1]), await readJson(request), workflowActor(actor),
        )) }, cors);
      }
      const requestNotifyMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)\/notify$/);
      if (requestNotifyMatch && request.method === "POST") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "patient notifications are not configured");
        const result = await workflow.manualNotify(decodeURIComponent(requestNotifyMatch[1]), await readJson(request), workflowActor(actor));
        return json(result.status === "sent" ? 200 : 202, { ok: true, ...result, communicationId: result.communication?.id || "" }, cors);
      }
      const requestMessagesMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)\/messages$/);
      if (requestMessagesMatch && request.method === "POST") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "patient messaging is not configured");
        const result = await workflow.sendManualSms(decodeURIComponent(requestMessagesMatch[1]), await readJson(request), workflowActor(actor));
        return json(result.status === "sent" ? 200 : 202, { ok: true, ...result, communicationId: result.communication?.id || "" }, cors);
      }
      const requestCommunicationsMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)\/communications$/);
      if (requestCommunicationsMatch && request.method === "GET") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "patient communications are not configured");
        return json(200, { ok: true, communications: await workflow.listCommunications(
          decodeURIComponent(requestCommunicationsMatch[1]), workflowActor(actor),
        ) }, cors);
      }
      const requestStatusMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)\/status$/);
      if (requestStatusMatch && request.method === "PATCH") {
        const patientRequest = await repository.updatePatientRequestStatus(
          decodeURIComponent(requestStatusMatch[1]),
          await readJson(request),
          actor,
          { now: now().toISOString(), idFactory },
        );
        return json(200, { ok: true, patientRequest }, cors);
      }
      const requestTasksMatch = url.pathname.match(/^\/v1\/patient-requests\/([^/]+)\/tasks$/);
      if (requestTasksMatch && request.method === "POST") {
        const task = await repository.createTask(
          decodeURIComponent(requestTasksMatch[1]),
          await readJson(request),
          actor,
          { now: now().toISOString(), idFactory },
        );
        return json(201, { ok: true, task }, cors);
      }

      if (url.pathname === "/v1/tasks" && request.method === "GET") {
        return json(200, { ok: true, tasks: await repository.listTasks(queryFilters(url)) }, cors);
      }
      const taskStatusMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/status$/);
      if (taskStatusMatch && request.method === "PATCH") {
        const task = await repository.updateTaskStatus(
          decodeURIComponent(taskStatusMatch[1]),
          await readJson(request),
          actor,
          { now: now().toISOString(), idFactory },
        );
        return json(200, { ok: true, task }, cors);
      }

      if (url.pathname === "/v1/communications" && request.method === "GET") {
        return json(200, { ok: true, communications: await repository.listCommunications(queryFilters(url)) }, cors);
      }
      if (url.pathname === "/v1/communications" && request.method === "POST") {
        const communication = await repository.createCommunication(
          await readJson(request),
          actor,
          { now: now().toISOString(), idFactory },
        );
        return json(201, { ok: true, communication }, cors);
      }

      if (url.pathname === "/v1/notification-rules" && request.method === "GET") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "notification rules are not configured");
        return json(200, { ok: true, rules: await workflow.listNotificationRules() }, cors);
      }
      const notificationRuleMatch = url.pathname.match(/^\/v1\/notification-rules\/([^/]+)$/);
      if (notificationRuleMatch && request.method === "PATCH") {
        if (!workflow) throw apiError(503, "workflow_not_configured", "notification rules are not configured");
        const rule = await workflow.saveNotificationRule(
          decodeURIComponent(notificationRuleMatch[1]), await readJson(request), workflowActor(actor),
        );
        return json(200, { ok: true, rule }, cors);
      }

      return json(404, { ok: false, code: "not_found", error: "route was not found" }, cors);
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) console.error("operations-api", error?.code || "internal_error", error?.message || error);
      return json(status, {
        ok: false,
        code: error?.code || "internal_error",
        error: status >= 500 && !error?.status ? "internal server error" : String(error?.message || "request failed"),
      }, cors);
    }
  };
}
