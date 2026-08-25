import {
  PATIENT_REQUEST_STATUSES,
  PATIENT_REQUEST_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_STATUSES,
  SCHEMA_VERSION,
  apiError,
  requireIdempotencyKey,
} from "./schema.mjs";
import { buildPatientRequestBundle } from "./domain.mjs";
import { verifyCrewToken, verifyIntakeClient } from "./auth.mjs";

const MAX_BODY_BYTES = 64 * 1024;

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

async function readJson(request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw apiError(413, "payload_too_large", "request body is too large");
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

export function createOperationsApp({
  repository,
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
        return json(200, { ok: true, service: "bhw-operations-api", schemaVersion: SCHEMA_VERSION }, cors);
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
          notificationAutomationEnabled: false,
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
        return json(result.replayed ? 200 : 201, { ok: true, replayed: result.replayed, patientRequest: result.request }, cors);
      }

      const actor = staffActor(request, environment, now);
      if (url.pathname === "/v1/patient-requests" && request.method === "GET") {
        return json(200, { ok: true, patientRequests: await repository.listPatientRequests(queryFilters(url)) }, cors);
      }
      if (url.pathname === "/v1/patient-requests" && request.method === "POST") {
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
        return json(200, { ok: true, patientRequest: await repository.getPatientRequest(decodeURIComponent(requestMatch[1])) }, cors);
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
