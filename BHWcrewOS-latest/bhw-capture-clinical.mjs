const CONFIG_URL = "/.netlify/functions/rcm-cloud-config";
const CLINICAL_TOKEN_URL = "/.netlify/functions/bhw-capture-clinical-token";
const AUTH_URL = "/.netlify/functions/auth";

export const CLINICAL_LOCKED = "BHW_CAPTURE_CLINICAL_LOCKED";

function clinicalLockError(message = "Clinical mode is locked. Verify your CrewOS PIN again.") {
  return Object.assign(new Error(message), { status: 401, code: CLINICAL_LOCKED });
}

export function clinicalSessionValid(session, now = Date.now()) {
  return Boolean(session?.token && Number(session.expiresAt) > Number(now) + 5000);
}

export async function reauthenticateClinical(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const readCrewToken = options.getCrewToken || (() => {
    try { return sessionStorage.getItem("crewos_token") || ""; } catch { return ""; }
  });
  const crewToken = readCrewToken();
  if (!crewToken) throw clinicalLockError("Sign in to CrewOS again before opening Clinical mode.");
  const response = await fetchImpl(options.endpoint || AUTH_URL, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "clinical-login", pin: String(options.pin || "") }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) {
    throw Object.assign(new Error(body.error || "Clinical verification failed"), {
      status: response.status,
      code: response.status === 401 ? CLINICAL_LOCKED : "BHW_CAPTURE_CLINICAL_AUTH_FAILED",
    });
  }
  return {
    token: body.token,
    user: body.user || null,
    expiresAt: Date.now() + Number(body.expiresIn || 900) * 1000,
  };
}

export async function createClinicalCaptureClient(fetchImpl = fetch, options = {}) {
  const configResponse = await fetchImpl(options.configUrl || CONFIG_URL, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!configResponse.ok) return null;
  const config = await configResponse.json();
  if (!config.enabled || !config.apiBase) return null;

  const readClinicalSession = options.getClinicalSession || (() => null);
  let cloudToken = "";
  let cloudTokenExpiresAt = 0;

  async function getToken(force = false) {
    if (!force && cloudToken && cloudTokenExpiresAt > Date.now() + 30000) return cloudToken;
    const session = readClinicalSession();
    if (!clinicalSessionValid(session)) throw clinicalLockError();
    const response = await fetchImpl(options.tokenUrl || CLINICAL_TOKEN_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token) {
      if (response.status === 401 || response.status === 403) throw clinicalLockError(body.error);
      throw Object.assign(new Error(body.error || "Clinical cloud authorization failed"), { status: response.status });
    }
    cloudToken = body.token;
    cloudTokenExpiresAt = Date.now() + Number(body.expiresIn || 300) * 1000;
    return cloudToken;
  }

  async function request(path, requestOptions = {}, retry = true) {
    const bearer = await getToken();
    const response = await fetchImpl(`${config.apiBase}${path}`, {
      ...requestOptions,
      headers: {
        ...(requestOptions.body && !requestOptions.headers?.["Content-Type"] ? { "Content-Type": "application/json" } : {}),
        ...requestOptions.headers,
        Authorization: `Bearer ${bearer}`,
      },
      cache: "no-store",
    });
    if (response.status === 401 && retry) {
      await getToken(true);
      return request(path, requestOptions, false);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw clinicalLockError(body.error);
      throw Object.assign(new Error(body.error || `Clinical cloud request failed (${response.status})`), { status: response.status });
    }
    return body;
  }

  return {
    apiBase: config.apiBase,
    async config() {
      return request("/v1/capture-clinical/config");
    },
    async listPatients() {
      const body = await request("/v1/capture-clinical/patients");
      return Array.isArray(body.patients) ? body.patients : [];
    },
    async recordingConsent(bhwPatientId) {
      return request(`/v1/capture-clinical/patients/${encodeURIComponent(bhwPatientId)}/recording-consent`);
    },
    async transcribe(audioBlob, bhwPatientId) {
      return request("/v1/capture-clinical/transcriptions", {
        method: "POST",
        headers: {
          "Content-Type": audioBlob.type || "audio/webm",
          "X-BHW-Patient-ID": bhwPatientId,
          "X-Recording-Consent": "session-recording-confirmed",
        },
        body: audioBlob,
      });
    },
    async saveCapture(capture) {
      return request("/v1/capture-clinical", {
        method: "POST",
        body: JSON.stringify(capture),
      });
    },
    async listReferences() {
      const body = await request("/v1/capture-clinical/references");
      return Array.isArray(body.references) ? body.references : [];
    },
  };
}

