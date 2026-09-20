const CONFIG_URL = "/.netlify/functions/operations-cloud-config";
const TOKEN_URL = "/.netlify/functions/operations-cloud-token";

function sessionError(message = "CrewOS session expired. Sign in again from this tab.") {
  return Object.assign(new Error(message), { status: 401, code: "CREWHQ_SESSION_EXPIRED" });
}

function readCrewToken(storage = globalThis.sessionStorage) {
  try { return storage?.getItem("crewos_token") || ""; } catch { return ""; }
}

function safeApiBase(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Patient workspace service is not configured safely.");
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

export function createPatientWorkspaceContextClient({
  fetchImpl = globalThis.fetch,
  storage = globalThis.sessionStorage,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  let apiBase = "";
  let operationsToken = "";
  let operationsTokenExpiresAt = 0;

  async function config() {
    if (apiBase) return apiBase;
    const response = await fetchImpl(CONFIG_URL, { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.enabled || !body.apiBase) {
      throw Object.assign(new Error(body.error || "Patient workspace service is not configured."), { status: response.status || 503 });
    }
    apiBase = safeApiBase(body.apiBase);
    return apiBase;
  }

  async function token(force = false) {
    if (!force && operationsToken && operationsTokenExpiresAt > Date.now() + 30_000) return operationsToken;
    const crewToken = readCrewToken(storage);
    if (!crewToken) throw sessionError();
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Authorization: `Bearer ${crewToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token) {
      if (response.status === 401) throw sessionError(body.error);
      throw Object.assign(new Error(body.error || "Patient workspace authorization failed."), { status: response.status });
    }
    operationsToken = body.token;
    operationsTokenExpiresAt = Date.now() + Math.max(30, Number(body.expiresIn) || 300) * 1000;
    return operationsToken;
  }

  async function request(path, options = {}, retry = true) {
    const base = await config();
    const bearer = await token();
    const response = await fetchImpl(`${base}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${bearer}`,
      },
    });
    if (response.status === 401 && retry) {
      await token(true);
      return request(path, options, false);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(body.error || `Patient workspace request failed (${response.status}).`), {
        status: response.status,
        code: body.code || "",
      });
    }
    return body;
  }

  return Object.freeze({
    async status() {
      return request("/v1/clinical-contexts/status");
    },
    async issue(bhwPatientId, destination) {
      const body = await request("/v1/clinical-contexts", {
        method: "POST",
        body: JSON.stringify({
          bhwPatientId,
          destination,
          treatmentPurposeAttestation: true,
        }),
      });
      return body.context;
    },
    async redeem(tokenValue, destination) {
      const body = await request("/v1/clinical-contexts/redeem", {
        method: "POST",
        body: JSON.stringify({ token: tokenValue, destination }),
      });
      return body.grant;
    },
    async listPatientRequests(bhwPatientId, limit = 100) {
      const query = new URLSearchParams({ bhwPatientId, limit: String(Math.max(1, Math.min(250, Number(limit) || 100))) });
      const body = await request(`/v1/patient-requests?${query}`);
      return Array.isArray(body.requests) ? body.requests : Array.isArray(body.patientRequests) ? body.patientRequests : [];
    },
  });
}

export { readCrewToken, safeApiBase };
