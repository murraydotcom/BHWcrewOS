const CONFIG_URL = "/.netlify/functions/rcm-cloud-config";
const TOKEN_URL = "/.netlify/functions/rcm-cloud-token";

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
    if (!crewToken) throw Object.assign(new Error("Sign in to CrewOS again"), { status: 401 });
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Authorization: `Bearer ${crewToken}` },
    });
    if (!response.ok) throw Object.assign(new Error("Google Cloud authorization failed"), { status: response.status });
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
    async transcribe(audioBlob, { bhwPatientId = "BHW0000", syntheticRolePlay = false } = {}) {
      return request("/v1/transcriptions", {
        method: "POST",
        headers: {
          "Content-Type": audioBlob.type || "audio/webm",
          "X-BHW-Patient-ID": bhwPatientId,
          "X-Recording-Consent": syntheticRolePlay ? "synthetic-role-play" : "",
        },
        body: audioBlob,
      });
    },
    async remove(id) {
      return request(`/v1/encounters/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async listPatients() {
      const body = await request("/v1/patients");
      return Array.isArray(body.patients) ? body.patients : [];
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
