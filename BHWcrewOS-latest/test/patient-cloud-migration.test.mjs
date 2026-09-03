import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { publicPreview, signPreview, verifyPreview } = require("../netlify/functions/lib/patient-cloud-migration.js");

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

test("migration UI is session-gated, starts with preview, and distinguishes verified Cloud save", async () => {
  const html = await readFile(new URL("../bhw-cloud-migration.html", import.meta.url), "utf8");
  assert.match(html, /crew-provider-gate\.js/);
  assert.match(html, /Run protected preview/);
  assert.match(html, /APPLY APPROVED CLOUD MIGRATION/);
  assert.match(html, /Saved to BHW Cloud/);
  assert.match(html, /read back/);
  assert.match(html, /Not saved/);
});
