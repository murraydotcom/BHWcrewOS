const CONFIG_URL = "/.netlify/functions/operations-cloud-config";
const TOKEN_URL = "/.netlify/functions/operations-cloud-token";
export const CREW_SESSION_EXPIRED = "CREWHQ_SESSION_EXPIRED";

function sessionError(message = "CrewHQ session expired. Sign in again in this tab.") {
  return Object.assign(new Error(message), { status: 401, code: CREW_SESSION_EXPIRED });
}

function clearCrewSession() {
  try { sessionStorage.removeItem("crewos_token"); } catch { /* storage unavailable */ }
}

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `crewos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createOperationsCloudClient(fetchImpl = fetch) {
  const configResponse = await fetchImpl(CONFIG_URL, { credentials: "same-origin", cache: "no-store" });
  if (!configResponse.ok) return null;
  const config = await configResponse.json();
  if (!config.enabled || !config.apiBase) return null;

  let token = "";
  let tokenExpiresAt = 0;
  let currentRole = "";

  async function getToken(force = false) {
    if (!force && token && tokenExpiresAt > Date.now() + 30000) return token;
    let crewToken = "";
    try { crewToken = sessionStorage.getItem("crewos_token") || ""; } catch { /* storage unavailable */ }
    if (!crewToken) throw sessionError();
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Authorization: `Bearer ${crewToken}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        clearCrewSession();
        throw sessionError();
      }
      throw Object.assign(new Error(body.error || `CrewOS operations authorization failed (${response.status})`), { status: response.status });
    }
    const body = await response.json();
    token = body.token;
    currentRole = String(body.role || "").trim().toLowerCase();
    tokenExpiresAt = Date.now() + Number(body.expiresIn || 300) * 1000;
    return token;
  }

  async function request(path, options = {}, retry = true) {
    const bearer = await getToken();
    const response = await fetchImpl(`${config.apiBase}${path}`, {
      ...options,
      headers: {
        ...(options.body && !options.headers?.["Content-Type"] ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        Authorization: `Bearer ${bearer}`,
      },
      cache: "no-store",
    });
    if (response.status === 401 && retry) {
      await getToken(true);
      return request(path, options, false);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(new Error(body.error || `Google Operations request failed (${response.status})`), { status: response.status, code: body.code || "" });
    }
    return response.json();
  }

  return {
    apiBase: config.apiBase,
    async staffChat(path, body) {
      if (!/^[a-z0-9/?=&._-]+$/i.test(path)) throw new Error("Invalid chat action");
      return request(`/v1/staff-chat/${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
    },
    get currentRole() { return currentRole; },
    async patientRequestCapabilities() {
      const body = await request("/v1/contracts/communication-foundation");
      return Array.isArray(body.patientRequestActions) ? body.patientRequestActions : [];
    },
    async listPatientRequests({ status = "open", serviceLine = "", assignedTo = "", assignedTeam = "", bhwPatientId = "", source = "", excludeSources = "", before = "", beforeId = "", limit = 100 } = {}) {
      const params = new URLSearchParams({ status, limit: String(Math.max(1, Math.min(500, Number(limit) || 100))) });
      if (serviceLine) params.set("serviceLine", serviceLine);
      if (assignedTo) params.set("assignedTo", assignedTo);
      if (assignedTeam) params.set("assignedTeam", assignedTeam);
      if (bhwPatientId) params.set("bhwPatientId", bhwPatientId);
      if (source) params.set("source", source);
      if (excludeSources) params.set("excludeSources", Array.isArray(excludeSources) ? excludeSources.join(",") : excludeSources);
      if (before) params.set("before", before);
      if (beforeId) params.set("beforeId", beforeId);
      const body = await request(`/v1/patient-requests?${params}`);
      return Array.isArray(body.requests) ? body.requests : Array.isArray(body.patientRequests) ? body.patientRequests : [];
    },
    async getPatientRequest(id) {
      const body = await request(`/v1/patient-requests/${encodeURIComponent(id)}`);
      return body.request || body.patientRequest || null;
    },
    async patientRequestAction(id, action, details = {}) {
      return request(`/v1/patient-requests/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, idempotencyKey: details.idempotencyKey || idempotencyKey(), ...details }),
      });
    },
    async notifyPatientRequest(id, details = {}) {
      return request(`/v1/patient-requests/${encodeURIComponent(id)}/notify`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: details.idempotencyKey || idempotencyKey(), ...details }),
      });
    },
    async sendPatientRequestSms(id, message, details = {}) {
      return request(`/v1/patient-requests/${encodeURIComponent(id)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          message,
          noPhiAttestation: details.noPhiAttestation === true,
          idempotencyKey: details.idempotencyKey || idempotencyKey(),
        }),
      });
    },
    async listPatientRequestCommunications(id) {
      const body = await request(`/v1/patient-requests/${encodeURIComponent(id)}/communications`);
      return Array.isArray(body.communications) ? body.communications : [];
    },
    async listPatientRequestTeamNotes(id, before = "") {
      return request(`/v1/patient-requests/${encodeURIComponent(id)}/team-notes${before ? `?before=${encodeURIComponent(before)}` : ""}`);
    },
    async addPatientRequestTeamNote(id, content, mentions = [], details = {}) {
      return request(`/v1/patient-requests/${encodeURIComponent(id)}/team-notes`, {
        method: "POST",
        body: JSON.stringify({
          content,
          mentions,
          idempotencyKey: details.idempotencyKey || idempotencyKey(),
        }),
      });
    },
    async markPatientRequestTeamNotesRead(id, readThroughAt) {
      return request(`/v1/patient-requests/${encodeURIComponent(id)}/team-notes/read`, {
        method: "POST",
        body: JSON.stringify({ readThroughAt }),
      });
    },
    async listWebsiteContent({ siteId = "care-connect", status = "", limit = 100 } = {}) {
      const params = new URLSearchParams({ siteId, limit: String(Math.max(1, Math.min(250, Number(limit) || 100))) });
      if (status) params.set("status", status);
      const body = await request(`/v1/site-content?${params}`);
      return Array.isArray(body.websiteContent) ? body.websiteContent : [];
    },
    async createWebsiteContent(input) {
      const body = await request("/v1/site-content", { method: "POST", body: JSON.stringify(input) });
      return body.websiteContent;
    },
    async updateWebsiteContent(id, input) {
      const body = await request(`/v1/site-content/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
      return body.websiteContent;
    },
    async websiteContentAction(id, action, expectedVersion, details = {}) {
      const body = await request(`/v1/site-content/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, expectedVersion, ...details }),
      });
      return body.websiteContent;
    },
  };
}
