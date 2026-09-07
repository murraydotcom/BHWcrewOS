import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEncounterCloudClient } from "../provider/cloud-queue.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("every CrewOS patient-list service reads identity from the protected Cloud Registry", async () => {
  const files = await Promise.all([
    "netlify/functions/ops-data.js",
    "netlify/functions/patients.js",
    "netlify/functions/frontdesk-data.js",
    "netlify/functions/console-data.js",
    "netlify/functions/monitor-data.js",
    "netlify/functions/panel-data.js",
    "netlify/functions/care-log-data.js",
    "netlify/functions/care-due-data.js",
  ].map(async (path) => [path, await read(path)]));

  for (const [path, source] of files) {
    assert.match(source, /listCloudPatients/, `${path} must use the protected Cloud Patient Registry`);
  }

  const ops = Object.fromEntries(files)["netlify/functions/ops-data.js"];
  assert.doesNotMatch(ops, /fallbackIndexDirectory/, "CrewOS must not silently show an older Patient Index when Cloud is unavailable");
  assert.match(ops, /\{ patients: \[\], patientLabel: \{\} \}/);
});

test("all Clinical Intelligence patient selectors refresh from the current Registry", async () => {
  const [registry, registryHtml, workflow, transcription] = await Promise.all([
    read("provider/patient-registry-app.mjs"),
    read("provider/patient-registry.html"),
    read("provider/workflow-app.mjs"),
    read("provider/transcription-app.mjs"),
  ]);

  assert.match(registryHtml, /id="refreshPatients"/);
  assert.match(registry, /window\.addEventListener\("focus"/);
  assert.match(registry, /visibilitychange/);
  assert.match(registry, /setInterval\(\(\) => \{ void refreshPatients\(\); \}, 60000\)/);
  assert.match(registry, /await refreshPatients\(\{ force: true, selectId: patient\.bhwPatientId \}\)/);
  assert.match(workflow, /patients = await cloudClient\.listPatients\(\)/);
  assert.match(transcription, /cloudClient\.listPatients\(\)/);
});

test("Panel Performance adds only an existing Registry patient and keeps names out of its offline cache", async () => {
  const [service, html] = await Promise.all([
    read("netlify/functions/panel-data.js"),
    read("bhw-panel-performance.html"),
  ]);

  assert.match(service, /action === "searchRegistry"/);
  assert.match(service, /findCloudPatient\(payload\?\.bhwPatientId\)/);
  assert.match(service, /Select a current patient from the protected Patient Registry/);
  assert.match(html, /id="pRegistrySearch"/);
  assert.doesNotMatch(html, /id="pLabel"/);
  assert.match(html, /filter\(p=>!p\.cloudOnly&&p\.rosterLinked\)/);
  assert.match(html, /map\(\(\{registryName,\.\.\.patient\}\)=>patient\)/);
});

test("CrewHQ 24-hour notes use optimistic concurrency and verified write-then-read", async () => {
  const requests = [];
  let current = null;
  globalThis.sessionStorage = {
    getItem(key) { return key === "crewos_token" ? "synthetic-crew-session" : ""; },
    removeItem() {},
  };
  const client = await createEncounterCloudClient(async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/.netlify/functions/rcm-cloud-config") return jsonResponse({ enabled: true, apiBase: "https://api.example.test" });
    if (url === "/.netlify/functions/rcm-cloud-token") return jsonResponse({ token: "synthetic-cloud-token", expiresIn: 300 });
    if (url.endsWith("/v1/encounters/ENC-0000-0001") && options.method === "PUT") {
      const incoming = JSON.parse(options.body);
      current = { ...incoming, updatedAt: "2026-09-06T12:01:00.000Z" };
      return jsonResponse({ encounter: current });
    }
    if (url.endsWith("/v1/encounters/ENC-0000-0001")) return jsonResponse({ encounter: current });
    throw new Error(`Unexpected request: ${url}`);
  });

  const saved = await client.saveAndVerify({
    id: "ENC-0000-0001",
    bhwPatientId: "BHW0000",
    note: "Synthetic updated note",
    updatedAt: "2026-09-06T12:00:00.000Z",
  });

  const write = requests.find(({ options }) => options.method === "PUT");
  assert.equal(JSON.parse(write.options.body).expectedUpdatedAt, "2026-09-06T12:00:00.000Z");
  assert.equal(saved.note, "Synthetic updated note");
  assert.equal(saved.updatedAt, "2026-09-06T12:01:00.000Z");
  assert.equal(requests.filter(({ url }) => url.endsWith("/v1/encounters/ENC-0000-0001")).length, 2);

  const workflow = await read("provider/workflow-app.mjs");
  assert.match(workflow, /Saved to BHW Cloud/);
  assert.match(workflow, /Saved on this device only/);
  assert.match(workflow, /Not saved/);
  assert.match(workflow, /saveAndVerify/);
  assert.match(workflow, /setTimeout\(autosaveNote, 900\)/);
});
