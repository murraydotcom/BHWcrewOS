import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CREW_SESSION_EXPIRED, createEncounterCloudClient } from "../provider/cloud-queue.mjs";

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
  await client.patientVisitNotes("BHW12/34");
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

  const visitNotes = requests.find(({ url }) => url.endsWith("/v1/patients/BHW12%2F34/visit-notes"));
  assert.ok(visitNotes, "Patient 360 requests only the selected patient's visit-note projection");

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

test("an expired CrewHQ session is cleared and reported before another cloud request", async () => {
  const removed = [];
  globalThis.sessionStorage = {
    getItem(key) { return key === "crewos_token" ? "expired-crew-session" : ""; },
    removeItem(key) { removed.push(key); },
  };
  const client = await createEncounterCloudClient(async (url) => {
    if (url === "/.netlify/functions/rcm-cloud-config") {
      return jsonResponse({ enabled: true, apiBase: "https://api.example.test" });
    }
    if (url === "/.netlify/functions/rcm-cloud-token") {
      return jsonResponse({ error: "Sign in to CrewOS again." }, { status: 401 });
    }
    throw new Error(`unexpected request: ${url}`);
  });

  await assert.rejects(
    () => client.listPatients(),
    (error) => error.code === CREW_SESSION_EXPIRED
      && error.message === "CrewHQ session expired. Sign in again in this tab.",
  );
  assert.deepEqual(removed, ["crewos_token"]);
});

test("large CRISP imports are retained in sequential requests below the cloud body limit", async () => {
  const requests = [];
  const progress = [];
  globalThis.sessionStorage = {
    getItem(key) { return key === "crewos_token" ? "crew-session-token" : ""; },
  };
  const client = await createEncounterCloudClient(async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/.netlify/functions/rcm-cloud-config") {
      return jsonResponse({ enabled: true, apiBase: "https://api.example.test" });
    }
    if (url === "/.netlify/functions/rcm-cloud-token") {
      return jsonResponse({ token: "short-cloud-token", expiresIn: 300 });
    }
    const body = JSON.parse(options.body);
    return jsonResponse({ retained: body.rows.length, created: body.rows.length, updated: 0 });
  });
  const rows = Array.from({ length: 5000 }, (_, index) => ({
    "First Name": `Patient${index}`,
    "Last Name": "Synthetic",
    "Date of Birth": "1980-01-01",
    "Encounter Type": "Inpatient",
    "Admit Date / Time": "2026-08-30 10:00",
    "Discharge Date / Time": "2026-08-31 12:00",
    "Discharge Disposition": "Home",
    Facility: "Synthetic Hospital",
    "Patient Complaint": "Synthetic test event",
  }));

  const saved = await client.importTcmEvents(rows, {
    sourceFile: "PanelDetails.xlsx",
    manual: false,
    onProgress(value) { progress.push(value); },
  });
  const imports = requests.filter(({ url }) => url.endsWith("/v1/tcm/events/import"));

  assert.equal(saved.retained, 5000);
  assert.equal(saved.created, 5000);
  assert.equal(saved.processed, 5000);
  assert.equal(saved.batches, 20);
  assert.equal(imports.length, 20);
  assert.ok(imports.every(({ options }) => Buffer.byteLength(options.body) < 2 * 1024 * 1024));
  assert.ok(imports.every(({ options }) => JSON.parse(options.body).rows.length <= 250));
  assert.deepEqual(progress.at(-1), {
    processed: 5000,
    total: 5000,
    batch: 20,
    batches: 20,
    retained: 5000,
    created: 5000,
    updated: 0,
  });
});

test("a failed CRISP batch reports how many rows were safely retained", async () => {
  let imports = 0;
  globalThis.sessionStorage = {
    getItem(key) { return key === "crewos_token" ? "crew-session-token" : ""; },
  };
  const client = await createEncounterCloudClient(async (url, options = {}) => {
    if (url === "/.netlify/functions/rcm-cloud-config") {
      return jsonResponse({ enabled: true, apiBase: "https://api.example.test" });
    }
    if (url === "/.netlify/functions/rcm-cloud-token") {
      return jsonResponse({ token: "short-cloud-token", expiresIn: 300 });
    }
    imports += 1;
    if (imports === 2) return jsonResponse({ error: "temporary failure" }, { status: 503 });
    const body = JSON.parse(options.body);
    return jsonResponse({ retained: body.rows.length, created: body.rows.length, updated: 0 });
  });
  const rows = Array.from({ length: 600 }, (_, index) => ({ id: index }));

  await assert.rejects(
    () => client.importTcmEvents(rows),
    (error) => error.message === "temporary failure"
      && error.importProgress.processed === 250
      && error.importProgress.total === 600
      && error.importProgress.batch === 2,
  );
});

test("CrewHQ frontend exposes verified-consent controls and preserves the provider gate", async () => {
  const [html, app, registry, registryHtml, gate] = await Promise.all([
    readFile(new URL("../provider/transcription.html", import.meta.url), "utf8"),
    readFile(new URL("../provider/transcription-app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../provider/patient-registry-app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../provider/patient-registry.html", import.meta.url), "utf8"),
    readFile(new URL("../crew-provider-gate.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /crew-provider-gate\.js/);
  assert.doesNotMatch(html, /auth-gate\.js/);
  assert.match(html, /Consent-gated visit transcription/);
  assert.match(html, /private temporary Google Cloud Storage object/);
  assert.match(html, /Verify the signed consent without leaving this page/);
  assert.match(html, /id="consentSignedAt"/);
  assert.match(html, /id="consentEvidence"/);
  assert.match(html, /id="saveRecordingConsent"/);
  assert.match(app, /session-recording-confirmed/);
  assert.match(app, /recordingConsent\(bhwPatientId\)/);
  assert.match(app, /saveRecordingConsent\(bhwPatientId/);
  assert.match(app, /verificationAttestation: true/);
  assert.match(app, /&& \$\("previsitConsent"\)\.checked/);
  assert.match(app, /\$\("previsitConsent"\)\.disabled = false/);
  assert.doesNotMatch(app, /\.checked = hasVerifiedConsent/);
  assert.match(app, /\$\("sessionConsent"\)\.disabled = !selected/);
  assert.match(app, /Saved to BHW Cloud/);
  assert.match(app, /longRecordingEnabled/);
  assert.match(app, /elapsedSeconds >= 600/);
  assert.match(registry, /Verify signed consent/);
  assert.match(registry, /new-patient-packet/);
  assert.match(registryHtml, /crew-provider-gate\.js/);
  assert.match(registryHtml, /\.consent-panel\{/);
  assert.match(registryHtml, /\.attestation\{/);
  assert.match(gate, /session\.exp/);
  assert.match(gate, /removeItem\("crewos_token"\)/);
  assert.match(app, /CREW_SESSION_EXPIRED/);
  assert.match(app, /crewos\?next=/);
});

