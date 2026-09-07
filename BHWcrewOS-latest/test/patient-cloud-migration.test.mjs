import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { createResolver, publicPreview, sealIdentity, verifyIdentity, signPreview, verifyPreview } = require("../netlify/functions/lib/patient-cloud-migration.js");

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

test("a recorded canonical BHW ID cannot be reassigned by a legacy name match", () => {
  const resolver = createResolver([
    { bhwPatientId: "BHW0001", name: "First Synthetic", dob: "2000-01-01" },
    { bhwPatientId: "BHW0002", name: "Second Synthetic", dob: "2000-02-02" },
  ]);
  const mismatch = resolver.direct({ bhwPatientId: "BHW0001", name: "Second Synthetic", dob: "2000-02-02" });
  assert.equal(mismatch.bhwPatientId, "");
  assert.match(mismatch.reason, /different legal name/i);
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
  assert.match(handler, /createFrontDeskIntakeBulk/);
  assert.match(handler, /result\.verifiedCount !== batch\.length/);
  assert.match(handler, /key === "patientRequests"/);
  assert.match(handler, /body\.action === "identity"/);
  assert.match(handler, /prepareMigration\(session, datasetKeys, identity\)/);
  assert.match(handler, /prepareMigration\(session, \[key\], identity\)/);
  assert.match(html, /PREVIEW_GROUPS/);
  assert.match(html, /identityToken/);
  const migration = await readFile(new URL("../netlify/functions/lib/patient-cloud-migration.js", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /patientIndex:\s*DB\.patients/);
  assert.match(migration, /Every crosswalk entry was resolved against the authoritative Cloud roster/);
  assert.match(migration, /requests\.blocked\.push/);
});
