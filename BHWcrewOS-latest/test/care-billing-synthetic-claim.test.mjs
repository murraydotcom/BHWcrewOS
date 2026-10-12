import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { inspectSyntheticEncounter } = require("../netlify/functions/care-billing-synthetic-claim.js")._test;

function encounter(overrides = {}) {
  return {
    id: "ENC-2026-0101",
    bhwPatientId: "BHW0000",
    updatedAt: "2026-10-12T12:00:00.000Z",
    invoiceDraft: {
      invoiceId: "INV9101",
      claimReadinessStatus: "claimable",
      releaseStatus: "claimable",
      claimStatus: "not_created",
      transmissionStatus: "blocked",
      serviceLines: [{ cpt: "G0557" }, { cpt: "G0570" }],
    },
    ...overrides,
  };
}

test("CrewOS synthetic handoff accepts only a claimable APCM plus BHI BHW0000 encounter", () => {
  const result = inspectSyntheticEncounter(encounter());
  assert.equal(result.ok, true);
  assert.equal(result.bhwPatientId, "BHW0000");
  assert.deepEqual(result.codes, ["G0557", "G0570"]);
  assert.equal(result.transmissionStatus, "blocked");
});

test("CrewOS synthetic handoff refuses every real-patient encounter", () => {
  const result = inspectSyntheticEncounter(encounter({ bhwPatientId: "BHW0557" }));
  assert.equal(result.ok, false);
  assert.match(result.blockers.join(" "), /BHW0000/);
});

test("CrewOS synthetic handoff requires paired APCM and BHI lines with no unrelated codes", () => {
  const missingAddOn = inspectSyntheticEncounter(encounter({
    invoiceDraft: { ...encounter().invoiceDraft, serviceLines: [{ cpt: "G0557" }] },
  }));
  assert.equal(missingAddOn.ok, false);
  assert.match(missingAddOn.blockers.join(" "), /BHI or CoCM/);

  const unrelated = inspectSyntheticEncounter(encounter({
    invoiceDraft: { ...encounter().invoiceDraft, serviceLines: [{ cpt: "G0557" }, { cpt: "G0570" }, { cpt: "99214" }] },
  }));
  assert.equal(unrelated.ok, false);
  assert.match(unrelated.blockers.join(" "), /accepts only reviewed APCM/);
});

test("CrewOS synthetic handoff refuses duplicate synthetic claim creation", () => {
  const result = inspectSyntheticEncounter(encounter({
    syntheticProfessionalClaim: { status: "created_not_transmitted" },
  }));
  assert.equal(result.ok, false);
  assert.match(result.blockers.join(" "), /already exists/);
});
