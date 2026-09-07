import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { createResolver, publicPreview, sealIdentity, verifyIdentity, sealPreparedPreview, verifyPreparedPreview, signPreview, verifyPreview } = require("../netlify/functions/lib/patient-cloud-migration.js");
const { chunkFrontDeskRecords, prepareApplyBatches } = require("../netlify/functions/patient-cloud-migration.js");

const session = { staffId: "synthetic-admin", access: "Admin" };
const secret = "synthetic-preview-secret";
const prepared = {
  rosterCount: 1,
  datasets: {
    careLogs: {
      key: "careLogs",
      label: "Care logs",
      sourceCount: 2,
      sourceError: "",
      ready: [{ sourceId: "synthetic-source", bhwPatientId: "BHW0000", target: { kind: "rcm", path: "/v1/care-management/logs", method: "POST", body: { id: "synthetic-log" } } }],
      blocked: [{ sourceId: "synthetic-blocked", label: "Synthetic blocked record", reason: "No unique canonical Patient Registry match was found." }],
    },
  },
};

test("migration preview exposes counts and blockers but not write payloads", () => {
  const preview = publicPreview(prepared);
  assert.equal(preview.rosterCount, 1);
  assert.equal(preview.datasets[0].readyCount, 1);
  assert.equal(preview.datasets[0].blockedCount, 1);
  assert.equal(Object.hasOwn(preview.datasets[0], "ready"), false);
  assert.doesNotMatch(JSON.stringify(preview), /synthetic-log/);
});

test("migration approval is sealed to the administrator, dataset, and unchanged source", () => {
  const token = signPreview(prepared, session, secret, 1_000);
  assert.equal(verifyPreview(token, prepared, session, secret, "careLogs", 2_000), true);
  assert.throws(() => verifyPreview(token, prepared, { staffId: "different-admin" }, secret, "careLogs", 2_000), /expired/i);
  const changed = structuredClone(prepared);
  changed.datasets.careLogs.ready[0].target.body.id = "changed-after-preview";
  assert.throws(() => verifyPreview(token, changed, session, secret, "careLogs", 2_000), /source records changed/i);
});

test("legacy relationship crosswalk is encrypted, session-bound, and expires", () => {
  const identity = {
    roster: [{ bhwPatientId: "BHW0000", name: "Synthetic Patient", dob: "2000-01-01" }],
    indexEntries: [["synthetic-legacy-page", { bhwPatientId: "BHW0000", reason: "" }]],
  };
  const token = sealIdentity(identity, session, secret, 1_000);
  assert.doesNotMatch(token, /BHW0000|Synthetic Patient|synthetic-legacy-page/);
  assert.deepEqual(verifyIdentity(token, session, secret, 2_000), identity);
  assert.throws(() => verifyIdentity(token, { staffId: "different-admin" }, secret, 2_000), /expired or is not valid/i);
  assert.throws(() => verifyIdentity(token, session, secret, 31 * 60 * 1_000), /expired or is not valid/i);
});

test("approved migration payload is encrypted, immutable, session-bound, and expires", () => {
  const token = sealPreparedPreview(prepared, session, secret, 1_000);
  assert.doesNotMatch(token, /BHW0000|synthetic-source|synthetic-log/);
  assert.deepEqual(verifyPreparedPreview(token, session, secret, "careLogs", 2_000), prepared);
  assert.throws(() => verifyPreparedPreview(token, { staffId: "different-admin" }, secret, "careLogs", 2_000), /expired or is not valid/i);
  assert.throws(() => verifyPreparedPreview(token, session, secret, "careLogs", 31 * 60 * 1_000), /expired or is not valid/i);
  assert.throws(() => verifyPreparedPreview(`${token.slice(0, -1)}x`, session, secret, "careLogs", 2_000), /expired or is not valid/i);
});

test("approved Patient Requests are split below the protected bulk body ceiling", () => {
  const records = Array.from({ length: 240 }, (_, index) => ({
    target: {
      kind: "frontdesk",
      submissionId: `legacy-request:synthetic-${String(index).padStart(4, "0")}`,
      body: { bhwPatientId: "BHW0000", notificationMode: "none", message: "x".repeat(12_000) },
    },
  }));
  const batches = chunkFrontDeskRecords(records);
  assert.ok(batches.length > 2);
  assert.equal(batches.flat().length, records.length);
  for (const batch of batches) {
    assert.ok(batch.length <= 25);
    const bulkBody = { records: batch.map((record) => ({ submissionId: record.target.submissionId, body: record.target.body })) };
    assert.ok(Buffer.byteLength(JSON.stringify(bulkBody), "utf8") <= 48 * 1024);
  }
});

test("one approved Patient Request section becomes complete sealed apply batches", () => {
  const requests = Array.from({ length: 53 }, (_, index) => ({
    sourceId: `synthetic-${index}`,
    target: {
      kind: "frontdesk",
      submissionId: `legacy-request:synthetic-${String(index).padStart(4, "0")}`,
      body: { bhwPatientId: "BHW0000", notificationMode: "none", message: "Synthetic migration request" },
    },
  }));
  const input = { rosterCount: 1, datasets: { patientRequests: { key: "patientRequests", sourceCount: 60, sourceError: "", ready: requests, blocked: Array.from({ length: 7 }, (_, index) => ({ sourceId: `blocked-${index}` })) } } };
  const batches = prepareApplyBatches(input, "patientRequests");
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.flatMap((batch) => batch.datasets.patientRequests.ready), requests);
  for (const [index, batch] of batches.entries()) {
    const dataset = batch.datasets.patientRequests;
    assert.equal(dataset.blocked.length, 0);
    assert.equal(dataset.blockedCount, 7);
    assert.equal(dataset.applyBatchIndex, index);
    assert.equal(dataset.applyBatchCount, 3);
  }
});

test("the authoritative Cloud name and DOB repair a conflicting legacy BHW ID", () => {
  const resolver = createResolver([
    { bhwPatientId: "BHW0001", name: "First Synthetic", dob: "2000-01-01" },
    { bhwPatientId: "BHW0002", name: "Second Synthetic", dob: "2000-02-02" },
  ]);
  const repaired = resolver.direct({ bhwPatientId: "BHW0001", name: "Second Synthetic", dob: "2000-02-02" });
  assert.equal(repaired.bhwPatientId, "BHW0002");
  const verified = resolver.direct({ bhwPatientId: "BHW0001", name: "First Synthetic", dob: "2000-01-01" });
  assert.equal(verified.bhwPatientId, "BHW0001");
});

test("migration UI is session-gated, starts with preview, and distinguishes verified Cloud save", async () => {
  const html = await readFile(new URL("../bhw-cloud-migration.html", import.meta.url), "utf8");
  const handler = await readFile(new URL("../netlify/functions/patient-cloud-migration.js", import.meta.url), "utf8");
  assert.match(html, /crew-provider-gate\.js/);
  assert.match(html, /Run protected preview/);
  assert.match(html, /APPLY APPROVED CLOUD MIGRATION/);
  assert.match(html, /Saved to BHW Cloud/);
  assert.match(html, /read back/);
  assert.match(html, /Not saved/);
  assert.match(html, /Apply \$\{row\.readyCount\} verified only/);
  assert.match(html, /blocked remain not saved/);
  assert.match(handler, /createFrontDeskIntakeBulk/);
  assert.match(handler, /result\.verifiedCount !== batch\.length/);
  assert.match(handler, /key === "patientRequests"/);
  assert.match(handler, /body\.action === "identity"/);
  assert.match(handler, /prepareMigration\(session, datasetKeys, identity\)/);
  assert.match(handler, /verifyPreparedPreview\(body\.previewToken, session, process\.env\.SESSION_SECRET, key\)/);
  assert.match(handler, /blockedRemaining: Number\.isFinite\(dataset\.blockedCount\)/);
  assert.match(handler, /chunkFrontDeskRecords\(frontDesk\)/);
  assert.match(handler, /prepareApplyBatches\(prepared, key\)/);
  assert.match(handler, /previewTokens/);
  assert.match(handler, /body\.action === "preview"\) \{\s*const identity = verifyIdentity/);
  assert.doesNotMatch(handler, /dataset\.blocked\.length\) return json\(409/);
  assert.match(html, /PREVIEW_GROUPS/);
  assert.match(html, /identityToken/);
  assert.match(html, /data\.previewTokens/);
  assert.match(html, /batch \$\{index\+1\} of \$\{tokens\.length\}/);
  assert.doesNotMatch(html, /action:"apply"[^\n]+identityToken/);
  const migration = await readFile(new URL("../netlify/functions/lib/patient-cloud-migration.js", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /patientIndex:\s*DB\.patients/);
  assert.match(migration, /Every crosswalk entry was resolved against the authoritative Cloud roster/);
  assert.match(migration, /requests\.blocked\.push/);
  assert.match(migration, /const message = clean\(P\.text\(p\.Summary\) \|\| "Legacy Patient Request", 4000\)/);
  assert.match(migration, /const summary = clean\(message, 500\)/);
});
