const CONFIG_URL = "/.netlify/functions/rcm-cloud-config";
const TOKEN_URL = "/.netlify/functions/rcm-cloud-token";
export const CREW_SESSION_EXPIRED = "CREWHQ_SESSION_EXPIRED";

function sessionError(message = "CrewHQ session expired. Sign in again in this tab.") {
  return Object.assign(new Error(message), { status: 401, code: CREW_SESSION_EXPIRED });
}

function clearCrewSession() {
  try { sessionStorage.removeItem("crewos_token"); } catch { /* storage unavailable */ }
}

export async function createEncounterCloudClient(fetchImpl = fetch) {
  const configResponse = await fetchImpl(CONFIG_URL, { credentials: "same-origin", cache: "no-store" });
  if (!configResponse.ok) return null;
  const config = await configResponse.json();
  if (!config.enabled || !config.apiBase) return null;

  let token = "";
  let tokenExpiresAt = 0;

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
      throw Object.assign(
        new Error(body.error || `CrewHQ cloud authorization failed (${response.status})`),
        { status: response.status },
      );
    }
    const body = await response.json();
    token = body.token;
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
      throw Object.assign(new Error(body.error || `Google Cloud request failed (${response.status})`), { status: response.status });
    }
    return response.json();
  }

  return {
    apiBase: config.apiBase,
    async list() {
      const body = await request("/v1/encounters");
      return Array.isArray(body.encounters) ? body.encounters : [];
    },
    async create(encounterDraft, creationKey) {
      const body = await request("/v1/encounters", {
        method: "POST",
        body: JSON.stringify({ ...encounterDraft, creationKey }),
      });
      return body.encounter;
    },
    async save(encounter) {
      return request(`/v1/encounters/${encodeURIComponent(encounter.id)}`, {
        method: "PUT",
        body: JSON.stringify(encounter),
      });
    },
    async saveAll(encounters) {
      await Promise.all(encounters.map((encounter) => this.save(encounter)));
    },
    async analyze(encounter) {
      return request(`/v1/encounters/${encodeURIComponent(encounter.id)}/analyze`, {
        method: "POST",
        body: JSON.stringify(encounter),
      });
    },
    async structureNote(encounter) {
      return request(`/v1/encounters/${encodeURIComponent(encounter.id)}/structure-note`, {
        method: "POST",
        body: JSON.stringify(encounter),
      });
    },
    async transcribe(audioBlob, { bhwPatientId = "BHW0000", consentMode = "" } = {}) {
      return request("/v1/transcriptions", {
        method: "POST",
        headers: {
          "Content-Type": audioBlob.type || "audio/webm",
          "X-BHW-Patient-ID": bhwPatientId,
          "X-Recording-Consent": consentMode,
        },
        body: audioBlob,
      });
    },
    async transcriptionConfig() {
      return request("/v1/transcription-config");
    },
    async recordingConsent(bhwPatientId) {
      return request(`/v1/patients/${encodeURIComponent(bhwPatientId)}/recording-consent`);
    },
    async saveRecordingConsent(bhwPatientId, consent) {
      return request(`/v1/patients/${encodeURIComponent(bhwPatientId)}/recording-consent`, {
        method: "PUT",
        body: JSON.stringify(consent),
      });
    },
    async remove(id) {
      return request(`/v1/encounters/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async listPatients() {
      const body = await request("/v1/patients");
      return Array.isArray(body.patients) ? body.patients : [];
    },
    async healthRecord(bhwPatientId = "BHW0000") {
      return request(`/v1/patients/${encodeURIComponent(bhwPatientId)}/health-record`);
    },
    async listTcmEvents(limit = 1000) {
      const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 1000));
      const body = await request(`/v1/tcm/events?limit=${safeLimit}`);
      return Array.isArray(body.rows) ? body.rows : [];
    },
    async importTcmEvents(rows, { source = "CrewHQ Panel and Discharges", sourceFile = "", manual = true } = {}) {
      return request("/v1/tcm/events/import", {
        method: "POST",
        body: JSON.stringify({ source, sourceFile, manual, rows }),
      });
    },
    async savePatient(patient) {
      return request(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}`, {
        method: "PUT",
        body: JSON.stringify(patient),
      });
    },
    async listLegacyClaims() {
      const body = await request("/v1/legacy-claims");
      return body.snapshot && Array.isArray(body.snapshot.claims)
        ? body.snapshot
        : { version: 1, importedAt: "", claims: [] };
    },
    async saveLegacyClaims(claims, { mode = "replace" } = {}) {
      return request("/v1/legacy-claims", {
        method: "PUT",
        body: JSON.stringify({
          version: 1,
          importedAt: new Date().toISOString(),
          mode: mode === "merge" ? "merge" : "replace",
          claims,
        }),
      });
    },
    async listInsuranceRecords() { const body=await request("/v1/insurance-records"); return body.snapshot||{version:1,updatedAt:"",records:[]}; },
    async saveInsuranceRecords(records) { return request("/v1/insurance-records",{method:"PUT",body:JSON.stringify({records})}); },
  };
}

