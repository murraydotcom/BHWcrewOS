import assert from "node:assert/strict";
import test from "node:test";
import {
  CLINICAL_LOCKED,
  clinicalSessionValid,
  createClinicalCaptureClient,
  reauthenticateClinical,
} from "../bhw-capture-clinical.mjs";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test("Clinical reauthentication uses the signed CrewOS identity and keeps the short token in memory", async () => {
  let request;
  const session = await reauthenticateClinical({
    pin: "246810",
    getCrewToken: () => "crew-session",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ token: "clinical-session", expiresIn: 900, user: { staffId: "staff-1", name: "Amaris" } });
    },
  });
  assert.equal(request.url, "/.netlify/functions/auth");
  assert.equal(request.options.headers.Authorization, "Bearer crew-session");
  assert.deepEqual(JSON.parse(request.options.body), { action: "clinical-login", pin: "246810" });
  assert.equal(session.token, "clinical-session");
  assert.equal(clinicalSessionValid(session), true);
  assert.equal(globalThis.sessionStorage, undefined);
});

test("Clinical client exchanges only the clinical token and calls protected Capture routes", async () => {
  const requests = [];
  const session = { token: "clinical-session", expiresAt: Date.now() + 900_000 };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/.netlify/functions/rcm-cloud-config") return response({ enabled: true, apiBase: "https://api.example.test" });
    if (url === "/.netlify/functions/bhw-capture-clinical-token") return response({ token: "clinical-cloud", expiresIn: 300 });
    if (url.endsWith("/patients")) return response({ patients: [{ bhwPatientId: "BHW0557", displayName: "Synthetic Patient" }] });
    if (url.includes("recording-consent")) return response({ eligible: true, sourceType: "previsit-form" });
    if (url.endsWith("/transcriptions")) return response({ transcript: "Synthetic clinical transcript" });
    if (url.endsWith("/references")) return response({ references: [{ id: "clinical-1", encounterId: "ENC-2026-0001" }] });
    if (url.endsWith("/capture-clinical")) return response({ reference: { id: "clinical-1", encounterId: "ENC-2026-0001" } }, 201);
    return response({ enabled: true, realPatientTranscriptionEnabled: true });
  };
  const client = await createClinicalCaptureClient(fetchImpl, { getClinicalSession: () => session });
  await client.config();
  await client.listPatients();
  await client.recordingConsent("BHW05/57");
  const audio = new Blob(["synthetic"], { type: "audio/webm" });
  await client.transcribe(audio, "BHW0557");
  await client.saveCapture({ id: "clinical-1", bhwPatientId: "BHW0557", sourceTranscript: "Synthetic" });
  await client.listReferences();

  const tokenRequest = requests.find(({ url }) => url.endsWith("bhw-capture-clinical-token"));
  assert.equal(tokenRequest.options.headers.Authorization, "Bearer clinical-session");
  const protectedRequests = requests.filter(({ url }) => url.startsWith("https://api.example.test"));
  assert.ok(protectedRequests.length >= 6);
  assert.ok(protectedRequests.every(({ options }) => options.headers.Authorization === "Bearer clinical-cloud"));
  assert.ok(requests.some(({ url }) => url.endsWith("/capture-clinical/patients/BHW05%2F57/recording-consent")));
  const transcription = requests.find(({ url }) => url.endsWith("/capture-clinical/transcriptions"));
  assert.equal(transcription.options.headers["X-Recording-Consent"], "session-recording-confirmed");
  assert.equal(transcription.options.body, audio);
});

test("Clinical client fails closed when the short reauthentication expires", async () => {
  const client = await createClinicalCaptureClient(async (url) => {
    if (url === "/.netlify/functions/rcm-cloud-config") return response({ enabled: true, apiBase: "https://api.example.test" });
    throw new Error(`unexpected request ${url}`);
  }, { getClinicalSession: () => ({ token: "expired", expiresAt: Date.now() - 1 }) });
  await assert.rejects(() => client.listPatients(), (error) => error.code === CLINICAL_LOCKED);
});

