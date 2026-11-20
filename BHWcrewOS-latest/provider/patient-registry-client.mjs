const REGISTRY_URL = "/.netlify/functions/patient-registry";
export const CREW_SESSION_EXPIRED = "CREWHQ_SESSION_EXPIRED";

function sessionError(message = "CrewHQ session expired. Sign in again in this tab.") {
  return Object.assign(new Error(message), { status: 401, code: CREW_SESSION_EXPIRED });
}

const VERIFICATION_EVIDENCE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_VERIFICATION_EVIDENCE_BYTES = 3 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export async function verificationEvidencePayload(file, purpose = "patient-portal-consent") {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Choose a consent proof file first.");
  const contentType = String(file.type || "").trim().toLowerCase();
  if (!VERIFICATION_EVIDENCE_TYPES.has(contentType)) throw new Error("Consent proof must be a PDF, JPEG, or PNG.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_VERIFICATION_EVIDENCE_BYTES) throw new Error("Consent proof must be 3 MB or smaller.");
  return {
    purpose,
    contentType,
    byteLength: bytes.length,
    contentBase64: bytesToBase64(bytes),
  };
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
    savePatient(patient, expectedUpdatedAt = patient?.updatedAt || "") {
      return request("save-patient", { patient, expectedUpdatedAt });
    },
    recordingConsent(bhwPatientId) {
      return request("recording-consent", { bhwPatientId });
    },
    saveRecordingConsent(bhwPatientId, consent) {
      return request("save-recording-consent", { bhwPatientId, consent });
    },
    portalAccess(bhwPatientId) {
      return request("portal-access", { bhwPatientId });
    },
    savePortalAccess(bhwPatientId, access) {
      return request("save-portal-access", { bhwPatientId, access });
    },
    async uploadVerificationEvidence(bhwPatientId, file, purpose = "patient-portal-consent") {
      return request("upload-verification-evidence", {
        bhwPatientId,
        evidence: await verificationEvidencePayload(file, purpose),
      });
    },
  };
}
