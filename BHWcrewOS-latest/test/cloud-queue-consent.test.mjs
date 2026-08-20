import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEncounterCloudClient } from "../provider/cloud-queue.mjs";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function createFetch(requests) {
  return async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/.netlify/functions/rcm-cloud-config") {
      return jsonResponse({ enabled: true, apiBase: "https://api.example.test" });
    }
    if (url === "/.netlify/functions/rcm-cloud-token") {
      return jsonResponse({ token: "short-cloud-token", expiresIn: 300 });
    }
    return jsonResponse({ ok: true, eligible: true, consent: { status: "current" } });
  };
}

test("CrewHQ keeps its protected token exchange while using consent-aware transcription endpoints", async () => {
  const requests = [];
  globalThis.sessionStorage = {
    getItem(key) { return key === "crewos_token" ? "crew-session-token" : ""; },
  };
  const client = await createEncounterCloudClient(createFetch(requests));

  await client.transcriptionConfig();
  await client.recordingConsent("BHW12/34");
  await client.saveRecordingConsent("BHW12/34", {
    sourceType: "previsit-form",
    status: "current",
  });
  const audio = new Blob(["synthetic audio"], { type: "audio/webm" });
  await client.transcribe(audio, {
    bhwPatientId: "BHW1234",
    consentMode: "session-recording-confirmed",
  });

  const tokenRequest = requests.find(({ url }) => url === "/.netlify/functions/rcm-cloud-token");
  assert.equal(tokenRequest.options.headers.Authorization, "Bearer crew-session-token");

  const configRequest = requests.find(({ url }) => url.endsWith("/v1/transcription-config"));
  assert.equal(configRequest.options.headers.Authorization, "Bearer short-cloud-token");

  const consentRead = requests.find(({ url }) => url.endsWith("/v1/patients/BHW12%2F34/recording-consent") && !url.includes("transcriptions"));
  assert.ok(consentRead, "patient ID is encoded in the consent endpoint");

  const consentWrite = requests.find(({ url, options }) => url.endsWith("/v1/patients/BHW12%2F34/recording-consent") && options.method === "PUT");
  assert.deepEqual(JSON.parse(consentWrite.options.body), {
    sourceType: "previsit-form",
    status: "current",
  });

  const transcription = requests.find(({ url }) => url.endsWith("/v1/transcriptions"));
  assert.equal(transcription.options.headers["X-BHW-Patient-ID"], "BHW1234");
  assert.equal(transcription.options.headers["X-Recording-Consent"], "session-recording-confirmed");
  assert.equal(transcription.options.headers["Content-Type"], "audio/webm");
  assert.equal(transcription.options.body, audio);
});

test("CrewHQ frontend exposes verified-consent controls and preserves the provider gate", async () => {
  const [html, app, registry, registryHtml] = await Promise.all([
    readFile(new URL("../provider/transcription.html", import.meta.url), "utf8"),
    readFile(new URL("../provider/transcription-app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../provider/patient-registry-app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../provider/patient-registry.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /crew-provider-gate\.js/);
  assert.doesNotMatch(html, /auth-gate\.js/);
  assert.match(html, /Consent-gated visit transcription/);
  assert.match(app, /session-recording-confirmed/);
  assert.match(app, /recordingConsent\(bhwPatientId\)/);
  assert.match(registry, /Verify signed consent/);
  assert.match(registry, /new-patient-packet/);
  assert.match(registryHtml, /crew-provider-gate\.js/);
  assert.match(registryHtml, /\.consent-panel\{/);
  assert.match(registryHtml, /\.attestation\{/);
});

