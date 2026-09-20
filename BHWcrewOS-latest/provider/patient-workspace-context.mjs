export const PATIENT_WORKSPACE_SESSION_KEY = "bhw_patient_workspace_context_v1";
export const SYNTHETIC_PATIENT_WORKSPACE_ID = "BHW0000";

export const PATIENT_WORKSPACE_SURFACES = Object.freeze({
  "clinical-map": Object.freeze({ requiredScope: "clinical-map.read" }),
  "body-system-atlas": Object.freeze({ requiredScope: "body-system-atlas.read" }),
  "patient-operations": Object.freeze({ requiredScope: "patient-operations.read" }),
});

const REAL_PATIENT_ID = /^BHW\d{4}$/;
const CONTEXT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function parseStored(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function destinationFromPath(pathname = "") {
  const path = String(pathname || "").toLowerCase();
  if (path.endsWith("/patient-operations.html")) return "patient-operations";
  if (path.endsWith("/patient-360-atlas.html")) return "body-system-atlas";
  if (/\/patient-360(?:-[a-z]+)?\.html$/.test(path)) return "clinical-map";
  throw new Error("This page is not a recognized patient workspace destination.");
}

export function contextAllowsDestination(context, destination) {
  const surface = PATIENT_WORKSPACE_SURFACES[destination];
  return Boolean(surface && context?.purposeOfUse === "treatment"
    && Array.isArray(context.scopes) && context.scopes.includes(surface.requiredScope));
}

export function readPatientWorkspaceContext(storage = globalThis.sessionStorage, destination = "clinical-map", now = Date.now()) {
  let raw = "";
  try { raw = storage?.getItem(PATIENT_WORKSPACE_SESSION_KEY) || ""; } catch { return null; }
  const context = parseStored(raw);
  if (!context || !REAL_PATIENT_ID.test(String(context.bhwPatientId || ""))
    || !Number.isFinite(Date.parse(context.sessionExpiresAt || ""))
    || Date.parse(context.sessionExpiresAt) <= Number(now)
    || !contextAllowsDestination(context, destination)) {
    try { storage?.removeItem(PATIENT_WORKSPACE_SESSION_KEY); } catch { /* storage unavailable */ }
    return null;
  }
  return Object.freeze({ ...context, scopes: Object.freeze([...context.scopes]) });
}

export function savePatientWorkspaceContext(context, storage = globalThis.sessionStorage) {
  if (!context || !REAL_PATIENT_ID.test(String(context.bhwPatientId || ""))
    || !Number.isFinite(Date.parse(context.sessionExpiresAt || ""))
    || !Array.isArray(context.scopes) || context.purposeOfUse !== "treatment") {
    throw new Error("Patient workspace context grant is incomplete.");
  }
  const safe = {
    schemaVersion: Number(context.schemaVersion) || 1,
    contextId: String(context.contextId || ""),
    bhwPatientId: String(context.bhwPatientId),
    patientReference: String(context.patientReference || ""),
    sourceApplication: String(context.sourceApplication || "patient-registry"),
    destination: String(context.destination || "clinical-map"),
    purposeOfUse: "treatment",
    scopes: [...context.scopes],
    authorizedStaffId: String(context.authorizedStaffId || ""),
    authorizedRole: String(context.authorizedRole || ""),
    consumedAt: String(context.consumedAt || ""),
    sessionExpiresAt: String(context.sessionExpiresAt),
  };
  storage?.setItem(PATIENT_WORKSPACE_SESSION_KEY, JSON.stringify(safe));
  return Object.freeze(safe);
}

export function clearPatientWorkspaceContext(storage = globalThis.sessionStorage) {
  try { storage?.removeItem(PATIENT_WORKSPACE_SESSION_KEY); } catch { /* storage unavailable */ }
}

export function cleanPatientWorkspaceUrl(locationLike = globalThis.location, historyLike = globalThis.history) {
  const url = new URL(locationLike.href);
  url.searchParams.delete("context");
  url.searchParams.delete("patient");
  historyLike.replaceState(historyLike.state, "", `${url.pathname}${url.search}${url.hash}`);
  return url;
}

export async function resolvePatientWorkspaceContext({
  destination,
  locationLike = globalThis.location,
  historyLike = globalThis.history,
  storage = globalThis.sessionStorage,
  redeem,
  now = Date.now(),
  allowSynthetic = true,
} = {}) {
  if (!PATIENT_WORKSPACE_SURFACES[destination]) throw new Error("Patient workspace destination is not supported.");
  const url = new URL(locationLike.href);
  const token = String(url.searchParams.get("context") || "").trim();
  const visiblePatientId = String(url.searchParams.get("patient") || "").trim().toUpperCase();

  if (token) {
    if (!CONTEXT_TOKEN.test(token) || typeof redeem !== "function") {
      cleanPatientWorkspaceUrl(locationLike, historyLike);
      throw new Error("The patient workspace launch could not be verified. Return to Patient Registry.");
    }
    try {
      const grant = await redeem(token, destination);
      const saved = savePatientWorkspaceContext(grant, storage);
      cleanPatientWorkspaceUrl(locationLike, historyLike);
      if (!contextAllowsDestination(saved, destination)) {
        clearPatientWorkspaceContext(storage);
        throw new Error("The patient workspace launch did not include this destination.");
      }
      return saved;
    } catch (error) {
      cleanPatientWorkspaceUrl(locationLike, historyLike);
      clearPatientWorkspaceContext(storage);
      throw error;
    }
  }

  if (visiblePatientId && visiblePatientId !== SYNTHETIC_PATIENT_WORKSPACE_ID) {
    cleanPatientWorkspaceUrl(locationLike, historyLike);
    clearPatientWorkspaceContext(storage);
    throw new Error("Real-patient workspaces must be opened from Patient Registry. A visible patient ID cannot authorize access.");
  }

  const stored = readPatientWorkspaceContext(storage, destination, now);
  if (stored) {
    cleanPatientWorkspaceUrl(locationLike, historyLike);
    return stored;
  }

  if (allowSynthetic && (!visiblePatientId || visiblePatientId === SYNTHETIC_PATIENT_WORKSPACE_ID)) {
    cleanPatientWorkspaceUrl(locationLike, historyLike);
    return Object.freeze({
      schemaVersion: 1,
      contextId: "SYNTHETIC-BHW0000",
      bhwPatientId: SYNTHETIC_PATIENT_WORKSPACE_ID,
      patientReference: "synthetic",
      sourceApplication: "synthetic-preview",
      destination,
      purposeOfUse: "treatment",
      scopes: Object.freeze(Object.values(PATIENT_WORKSPACE_SURFACES).map((item) => item.requiredScope)),
      authorizedStaffId: "synthetic-preview",
      authorizedRole: "provider-preview",
      consumedAt: new Date(Number(now)).toISOString(),
      sessionExpiresAt: new Date(Number(now) + 15 * 60 * 1000).toISOString(),
      synthetic: true,
    });
  }

  throw new Error("Open this patient workspace from Patient Registry.");
}

export function temporaryPatientQuery(context, locationLike = globalThis.location, historyLike = globalThis.history) {
  const url = new URL(locationLike.href);
  url.searchParams.set("patient", context.bhwPatientId);
  url.searchParams.delete("context");
  historyLike.replaceState(historyLike.state, "", `${url.pathname}${url.search}${url.hash}`);
  return () => cleanPatientWorkspaceUrl(locationLike, historyLike);
}
