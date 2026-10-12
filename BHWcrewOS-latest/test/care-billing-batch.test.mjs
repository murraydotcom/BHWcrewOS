import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCareBillingBatch,
  buildClaimEntryExport,
  claimEntryCsv,
  exceptionCsv,
  validNpi,
} from "../engine/care-billing-batch.mjs";

function entry({
  id,
  program,
  code,
  patientId = "BHW0123",
  patientName = "Synthetic Patient",
  status = "Complete",
  payer = "Synthetic Medicare",
  memberId = "SYNTHETIC-123",
  icd = "I10",
  missing = ["claim processing"],
  blockers = [],
} = {}) {
  return {
    id,
    bhwPatientId: patientId,
    patientId,
    ctlNo: patientId,
    patientName,
    entry: `${patientName} — ${program}`,
    program,
    status,
    serviceMonth: "2026-09-01",
    payer,
    memberId,
    hasMbi: true,
    medicareCoverageOrder: "primary",
    icd,
    minutes: program === "BHI" ? 20 : 0,
    billingReadiness: { state: missing.length || blockers.length ? "incomplete" : "ready", missing, blockers },
    gaps: missing,
    billingReadinessEvidence: {
      billingPath: code,
      providerReviewedAt: "2026-09-30",
      coverageCheckedAt: "2026-09-29",
    },
  };
}

test("APCM and General BHI are paired as two lines on one manual claim worksheet", () => {
  const batch = buildCareBillingBatch([
    entry({ id: "apcm-1", program: "APCM", code: "G0557", patientName: "Patient, Synthetic" }),
    entry({ id: "bhi-1", program: "BHI", code: "G0570", icd: "F41.1" }),
  ], { serviceMonth: "2026-09", batchDate: "2026-10-01" });

  assert.deepEqual(batch.summary, { patients: 1, ready: 1, blocked: 0, claimLines: 2 });
  assert.equal(batch.groups[0].worksheetReference, "CM-202609-BHW0123");
  assert.deepEqual(batch.groups[0].lineItems.map((line) => line.code), ["G0557", "G0570"]);
  assert.equal(batch.boundary.claimCreated, false);
  assert.equal(batch.boundary.payerSubmission, false);
});

test("standalone BHI and legacy standalone BHI code fail closed in the APCM batch", () => {
  const noBase = buildCareBillingBatch([
    entry({ id: "bhi-1", program: "BHI", code: "G0570" }),
  ], { serviceMonth: "2026-09" });
  assert.equal(noBase.groups[0].status, "blocked");
  assert.match(noBase.groups[0].blockers.join(" "), /requires an APCM base row/);

  const legacy = buildCareBillingBatch([
    entry({ id: "apcm-1", program: "APCM", code: "G0556" }),
    entry({ id: "bhi-1", program: "BHI", code: "99484" }),
  ], { serviceMonth: "2026-09" });
  assert.equal(legacy.groups[0].status, "blocked");
  assert.match(legacy.groups[0].blockers.join(" "), /must use the reviewed 2026 add-on path G0570/);
});

test("source gaps and incomplete monthly rows remain exceptions", () => {
  const batch = buildCareBillingBatch([
    entry({ id: "apcm-1", program: "APCM", code: "G0558", status: "In progress", missing: ["monthly requirements"] }),
  ], { serviceMonth: "2026-09" });
  assert.equal(batch.summary.blocked, 1);
  assert.match(batch.groups[0].blockers.join(" "), /must be marked Complete/);
  assert.match(batch.groups[0].blockers.join(" "), /monthly requirements/);
  assert.match(exceptionCsv(batch), /BHW0123/);
});

test("claim-entry export requires reviewed batch metadata, charges, and a valid NPI", () => {
  const batch = buildCareBillingBatch([
    entry({ id: "apcm-1", program: "APCM", code: "G0557", patientName: "Patient, Synthetic" }),
    entry({ id: "bhi-1", program: "BHI", code: "G0570", patientName: "Patient, Synthetic", icd: "F41.1" }),
  ], { serviceMonth: "2026-09", batchDate: "2026-10-01" });

  assert.equal(validNpi("1234567893"), true);
  assert.equal(validNpi("1234567890"), false);
  const blocked = buildClaimEntryExport(batch, {});
  assert.equal(blocked.ok, false);
  assert.match(blocked.blockers.join(" "), /Final human review/);
  assert.match(blocked.blockers.join(" "), /positive charge for G0557/);

  const exported = buildClaimEntryExport(batch, {
    batchDate: "2026-10-01",
    serviceDate: "2026-09-30",
    billingProviderName: "Synthetic Provider",
    billingProviderNpi: "1234567893",
    placeOfService: "11",
    charges: { G0557: 125, G0570: 80 },
    reviewConfirmed: true,
  });
  assert.equal(exported.ok, true);
  assert.equal(exported.rows.length, 2);
  assert.equal(exported.rows[1].hcpcs_code, "G0570");
  assert.equal(exported.rows[1].charge, "80.00");
  const csv = claimEntryCsv(exported.rows);
  assert.match(csv, /"Patient, Synthetic"/);
  assert.match(csv, /ready-for-manual-entry/);
  assert.doesNotMatch(csv, /transaction837Created/);
});

test("service date must remain inside the service month", () => {
  const batch = buildCareBillingBatch([
    entry({ id: "apcm-1", program: "APCM", code: "G0556" }),
  ], { serviceMonth: "2026-09" });
  const result = buildClaimEntryExport(batch, {
    batchDate: "2026-10-01",
    serviceDate: "2026-10-01",
    billingProviderName: "Synthetic Provider",
    billingProviderNpi: "1234567893",
    placeOfService: "11",
    charges: { G0556: 100 },
    reviewConfirmed: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.blockers.join(" "), /inside the selected service month/);
});

test("conflicting coverage identity and malformed diagnosis codes stay out of the ready export", () => {
  const batch = buildCareBillingBatch([
    entry({ id: "apcm-1", program: "APCM", code: "G0556", icd: "not-a-code" }),
    { ...entry({ id: "bhi-1", program: "BHI", code: "G0570", icd: "F41.1" }), memberId: "DIFFERENT-ID" },
  ], { serviceMonth: "2026-09" });
  assert.equal(batch.groups[0].status, "blocked");
  assert.match(batch.groups[0].blockers.join(" "), /conflicting member IDs/);
  assert.match(batch.groups[0].blockers.join(" "), /verify the ICD-10 diagnosis format/);
  assert.throws(() => buildCareBillingBatch([], { serviceMonth: "2026-13" }), /YYYY-MM service month/);
});
