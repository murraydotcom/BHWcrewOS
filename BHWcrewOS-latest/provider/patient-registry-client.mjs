const REGISTRY_URL = "/.netlify/functions/patient-registry";
export const CREW_SESSION_EXPIRED = "CREWHQ_SESSION_EXPIRED";

function sessionError(message = "CrewHQ session expired. Sign in again in this tab.") {
  return Object.assign(new Error(message), { status: 401, code: CREW_SESSION_EXPIRED });
}

export async function createPatientRegistryClient(fetchImpl = fetch, storage = globalThis.sessionStorage) {
  async function request(action, values = {}) {
    const crewToken = storage?.getItem("crewos_token") || "";
    if (!crewToken) throw sessionError();
    const apiResponse = await fetchImpl(REGISTRY_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${crewToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...values }),
    });
    const body = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      if (apiResponse.status === 401) {
        storage?.removeItem("crewos_token");
        throw sessionError();
      }
      throw Object.assign(new Error(body.error || `Patient Registry request failed (${apiResponse.status})`), { status: apiResponse.status });
    }
    return body;
  }

  return {
    async listPatients() {
      const body = await request("list");
      return Array.isArray(body.patients) ? body.patients : [];
    },
    savePatient(patient) {
      return request("save-patient", { patient });
    },
    recordingConsent(bhwPatientId) {
      return request("recording-consent", { bhwPatientId });
    },
    saveRecordingConsent(bhwPatientId, consent) {
      return request("save-recording-consent", { bhwPatientId, consent });
    },
  };
}
