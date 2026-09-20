import { verifyCrewToken } from "./auth.mjs";
import {
  PATIENT_WORKSPACE_DESTINATIONS,
  PATIENT_WORKSPACE_LAUNCH_TTL_SECONDS,
  PATIENT_WORKSPACE_SESSION_TTL_SECONDS,
} from "./clinical-context.mjs";
import { apiError } from "./schema.mjs";

const MAX_CONTEXT_BODY_BYTES = 8 * 1024;

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

async function readJson(request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_CONTEXT_BODY_BYTES) {
    throw apiError(413, "payload_too_large", "patient workspace context request is too large");
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("object required");
    return parsed;
  } catch {
    throw apiError(400, "bad_json", "patient workspace context request must be a JSON object");
  }
}

function clinicalContextEnabled(environment) {
  return String(environment.PATIENT_WORKSPACE_CONTEXT_ENABLED || "false").trim().toLowerCase() === "true"
    && Buffer.byteLength(String(environment.PATIENT_WORKSPACE_CONTEXT_SECRET || ""), "utf8") >= 32;
}

function staffActor(request, environment, now) {
  return verifyCrewToken(
    request.headers.get("authorization"),
    environment.CREWOS_OPERATIONS_TOKEN_SECRET,
    { now: now().getTime() },
  );
}

function safeError(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      ok: false,
      code: error?.code || "internal_error",
      error: Number(error?.status) && Number(error.status) < 500
        ? String(error.message || "patient workspace context request failed")
        : "patient workspace context request failed",
    },
  };
}

export function createClinicalContextApp({
  baseApp,
  repository,
  environment = process.env,
  now = () => new Date(),
} = {}) {
  if (typeof baseApp !== "function") throw new Error("baseApp is required");
  if (!repository) throw new Error("repository is required");

  return async function clinicalContextApp(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/clinical-contexts")) return baseApp(request);
    const cors = corsHeaders(request, environment);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const actor = staffActor(request, environment, now);
      const enabled = clinicalContextEnabled(environment);
      if (url.pathname === "/v1/clinical-contexts/status" && request.method === "GET") {
        return json(200, {
          ok: true,
          enabled,
          destinations: Object.entries(PATIENT_WORKSPACE_DESTINATIONS).map(([id, value]) => ({
            id,
            label: value.label,
            launchPath: value.launchPath,
          })),
          launchTokenTtlSeconds: PATIENT_WORKSPACE_LAUNCH_TTL_SECONDS,
          tabSessionTtlSeconds: PATIENT_WORKSPACE_SESSION_TTL_SECONDS,
          patientIdInCrossApplicationUrl: false,
          actor: { staffId: actor.staffId, role: actor.role },
        }, cors);
      }
      if (!enabled) {
        throw apiError(503, "patient_workspace_context_disabled", "secure patient workspace launch is not activated");
      }
      if (url.pathname === "/v1/clinical-contexts" && request.method === "POST") {
        const result = await repository.issuePatientWorkspaceContext(
          await readJson(request),
          actor,
          { now: now(), secret: environment.PATIENT_WORKSPACE_CONTEXT_SECRET },
        );
        return json(201, { ok: true, context: result }, cors);
      }
      if (url.pathname === "/v1/clinical-contexts/redeem" && request.method === "POST") {
        const grant = await repository.redeemPatientWorkspaceContext(
          await readJson(request),
          actor,
          { now: now() },
        );
        return json(200, { ok: true, grant }, cors);
      }
      return json(405, { ok: false, code: "method_not_allowed", error: "patient workspace context route does not support this method" }, cors);
    } catch (error) {
      const response = safeError(error);
      return json(response.status, response.body, cors);
    }
  };
}

export { clinicalContextEnabled };
