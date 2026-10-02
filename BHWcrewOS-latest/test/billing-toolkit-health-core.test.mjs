import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  billingToolkitHealthCoreContract,
  buildBillingToolkitHandoff,
  validateHealthCoreSavedMessage,
} from "../billing-toolkit-health-core.mjs";

test("Billing Toolkit creates a bounded synthetic-only Health Core draft without automatic save", () => {
  const payload = buildBillingToolkitHandoff({
    patient: { bhwPatientId: "BHW0000" },
    noteText: "Synthetic monthly care-management documentation.",
    encounterDate: "2026-10-02",
    handoffId: "handoff-synthetic-1",
  });
  assert.equal(payload.type, billingToolkitHealthCoreContract.payloadType);
  assert.equal(payload.bhwPatientId, "BHW0000");
  assert.equal(payload.draft.encounterType, "Care-management review");
  assert.match(payload.draft.plan, /signature required/);
  assert.throws(() => buildBillingToolkitHandoff({
    patient: { bhwPatientId: "BHW0123" }, noteText: "Real patient", encounterDate: "2026-10-02",
  }), /synthetic patient/);
});

test("provider notification accepts only a saved Health Core receipt", () => {
  const receipt = validateHealthCoreSavedMessage({
    type: billingToolkitHealthCoreContract.savedType,
    schema: billingToolkitHealthCoreContract.schema,
    handoffId: "handoff-synthetic-1",
    bhwPatientId: "BHW0000",
    noteId: "synthetic-note-1",
    revision: 2,
    contentHash: "a".repeat(64),
    savedAt: "2026-10-02T12:00:00.000Z",
  }, "handoff-synthetic-1");
  assert.equal(receipt.revision, 2);
  assert.throws(() => validateHealthCoreSavedMessage({ ...receipt, type: "unverified" }, "handoff-synthetic-1"), /valid saved-draft receipt/);
  assert.throws(() => validateHealthCoreSavedMessage({ ...receipt, type: billingToolkitHealthCoreContract.savedType, schema: billingToolkitHealthCoreContract.schema }, "different-handoff"), /valid saved-draft receipt/);
});

test("Billing Toolkit labels coordinator preparation separately from provider signature", async () => {
  const html = await readFile(new URL("../BHW_Care_Management_Toolkit.html", import.meta.url), "utf8");
  assert.match(html, /Coordinator preparation &amp; provider review/);
  assert.match(html, /does not sign the encounter note or authorize billing/);
  assert.doesNotMatch(html, /data-field="attest-signature"/);
  assert.match(html, /billing-toolkit-health-core\.mjs/);
  const registry = await readFile(new URL("../provider/patient-registry-app.mjs", import.meta.url), "utf8");
  assert.match(registry, /Main PCP CrewHQ staff ID/);
  assert.match(registry, /Main PCP Health Core profile ID/);
  assert.match(registry, /verificationStatus !== "verified"/);
});
