import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageOrderFromFilename,
  insuranceUpdateMatches,
  parseInsuranceReport,
  prepareInsuranceUpdates,
} from "../provider/patient-insurance-import.mjs";

const VALID_MBI = "1EG4TE5MK73";
const headers = [
  "Patient Name", "Patient Address", "Payer Name", "Plan Name/Program Name", "Insurance ID",
  "Policy group / FECA #", "Payer ID", "Valid From", "Valid Until", "Insurance Eligibility Status",
];

function csvRow(values) {
  return values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
}

function report(rows) {
  return ["Patient Insurance Report", "Generated for test", csvRow(headers), ...rows.map(csvRow)].join("\r\n");
}

function sourceRow({ id = "BHW1234", payer, plan = "", member = "MEMBER-1", status = "Eligible" }) {
  return [`DOE (Q) JANE [${id}]`, "1 TEST STREET", payer, plan, member, "GROUP-1", "PAYER-1", "01/01/2026", "", status];
}

function patient(id = "BHW1234") {
  return {
    bhwPatientId: id,
    legalFirstName: "Jane",
    legalLastName: "Doe",
    phone: "4105550100",
    patientStatus: "active",
    updatedAt: "2026-10-05T12:00:00.000Z",
    coverageRecords: [{
      coverageOrder: "secondary",
      insuranceType: "commercial",
      payerName: "CareFirst BlueCross BlueShield",
      memberId: "KEEP-SECONDARY",
      coverageStatus: "verified",
    }],
  };
}

test("insurance filenames identify exactly the three coverage orders", () => {
  assert.equal(coverageOrderFromFilename("Patient Insurance Report_ 03Oct2026 primary.csv"), "primary");
  assert.equal(coverageOrderFromFilename("patient-insurance-SECONDARY.csv"), "secondary");
  assert.equal(coverageOrderFromFilename("other report.csv"), "other");
  assert.equal(coverageOrderFromFilename("insurance.csv"), "");
});

test("the row-three parser separates the named payer from its classification", () => {
  const [row] = parseInsuranceReport(report([
    sourceRow({ payer: "United Healthcare", plan: "Maryland HealthChoice" }),
  ]), "primary");
  assert.equal(row.sourceRow, 4);
  assert.equal(row.sourcePatientId, "BHW1234");
  assert.equal(row.coverageRecord.payerName, "UHC Community");
  assert.equal(row.coverageRecord.insuranceType, "medicaid-mco");
  assert.equal(row.coverageRecord.memberId, "MEMBER-1");
  assert.equal(row.coverageRecord.coverageStatus, "needs-review");
  assert.deepEqual(row.reasons, []);
});

test("Riverside becomes CareFirst Community Health only with Medicaid MCO evidence", () => {
  const [resolved] = parseInsuranceReport(report([
    sourceRow({ payer: "Riverside Health, Inc", plan: "Maryland Medicaid HealthChoice" }),
  ]), "primary");
  assert.equal(resolved.coverageRecord.payerName, "CareFirst Community Health");
  assert.equal(resolved.coverageRecord.insuranceType, "medicaid-mco");
  assert.deepEqual(resolved.reasons, []);

  const [unresolved] = parseInsuranceReport(report([
    sourceRow({ payer: "Riverside Health, Inc" }),
  ]), "primary");
  assert.equal(unresolved.coverageRecord.payerName, "Riverside Health, Inc");
  assert.equal(unresolved.coverageRecord.insuranceType, "");
  assert.equal(unresolved.classificationNeedsRegistry, true);

  const registryPatient = patient();
  registryPatient.coverageRecords.push({
    coverageOrder: "primary",
    insuranceType: "medicaid-mco",
    payerName: "Riverside Health, Inc",
    memberId: "OLD",
    coverageStatus: "needs-review",
  });
  const plan = prepareInsuranceUpdates([unresolved], [registryPatient]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].patient.coverageRecords.find((row) => row.coverageOrder === "primary").payerName, "CareFirst Community Health");
});

test("generic Medicaid and legacy IDs stay in review", () => {
  const rows = parseInsuranceReport(report([
    sourceRow({ payer: "Medicaid", id: "BHW1234" }),
    sourceRow({ payer: "CareFirst Community", id: "PAT999" }),
    sourceRow({ payer: "CareFirst Community", id: "BHWA1234" }),
    sourceRow({ payer: "CareFirst Community", id: "BHW0000" }),
  ]), "primary");
  assert.match(rows[0].reasons.join(" "), /named MCO/i);
  for (const row of rows.slice(1)) assert.match(row.reasons.join(" "), /legacy, reserved, or non-canonical/i);
});

test("only an Original Medicare member ID can become the separate MBI", () => {
  const [original] = parseInsuranceReport(report([
    sourceRow({ payer: "Medicare", member: VALID_MBI }),
  ]), "secondary");
  assert.equal(original.medicareMbi, VALID_MBI);

  const [advantage] = parseInsuranceReport(report([
    sourceRow({ payer: "UnitedHealthcare Medicare Advantage", member: VALID_MBI }),
  ]), "primary");
  assert.equal(advantage.coverageRecord.insuranceType, "medicare-advantage");
  assert.equal(advantage.medicareMbi, "");
});

test("safe updates preserve unrelated patient data and unreported coverage slots", () => {
  const rows = parseInsuranceReport(report([
    sourceRow({ payer: "CareFirst Community", member: "PRIMARY-NEW" }),
  ]), "primary");
  const plan = prepareInsuranceUpdates(rows, [patient()]);
  assert.equal(plan.summary.updatePatients, 1);
  assert.equal(plan.summary.updateCoverageRows, 1);
  assert.equal(plan.review.length, 0);
  const updated = plan.updates[0].patient;
  assert.equal(updated.phone, "4105550100");
  assert.equal(updated.coverageRecords.find((row) => row.coverageOrder === "primary").payerName, "CareFirst Community Health");
  assert.equal(updated.coverageRecords.find((row) => row.coverageOrder === "secondary").memberId, "KEEP-SECONDARY");
  assert.equal(plan.updates[0].expectedUpdatedAt, "2026-10-05T12:00:00.000Z");
  assert.equal(insuranceUpdateMatches(updated, plan.updates[0].patient), true);
});

test("conflicting rows and invalid existing MBIs block the whole patient update", () => {
  const conflictRows = parseInsuranceReport(report([
    sourceRow({ payer: "CareFirst Community", member: "ONE" }),
    sourceRow({ payer: "CareFirst Community", member: "TWO" }),
  ]), "primary");
  const conflict = prepareInsuranceUpdates(conflictRows, [patient()]);
  assert.equal(conflict.updates.length, 0);
  assert.match(conflict.review[0].reason, /conflicting primary/i);

  const invalidMbi = patient();
  invalidMbi.medicareMbi = "NOT-AN-MBI";
  const ordinaryRows = parseInsuranceReport(report([
    sourceRow({ payer: "CareFirst Community" }),
  ]), "primary");
  const invalid = prepareInsuranceUpdates(ordinaryRows, [invalidMbi]);
  assert.equal(invalid.updates.length, 0);
  assert.match(invalid.review[0].reason, /identifier is invalid/i);
});

test("an imported MBI that differs from the current Registry stays in review", () => {
  const current = patient();
  current.medicareMbi = VALID_MBI;
  const [row] = parseInsuranceReport(report([
    sourceRow({ payer: "Medicare", member: "2EG4TE5MK73" }),
  ]), "primary");
  const plan = prepareInsuranceUpdates([row], [current]);
  assert.equal(plan.updates.length, 0);
  assert.match(plan.review[0].reason, /conflicts with the current Registry/i);
  assert.equal(current.medicareMbi, VALID_MBI);
});

test("insurance reports never establish current eligibility", () => {
  for (const status of ["Eligible", "Not Eligible", "Couldn't be checked"]) {
    const [row] = parseInsuranceReport(report([
      sourceRow({ payer: "CareFirst Community", status }),
    ]), "primary");
    assert.equal(row.coverageRecord.coverageStatus, "needs-review");
  }
});

test("imports stay review-only when the current Registry version or coverage shape cannot be preserved", () => {
  const [row] = parseInsuranceReport(report([
    sourceRow({ payer: "CareFirst Community" }),
  ]), "primary");
  const versionless = patient();
  delete versionless.updatedAt;
  const missingVersion = prepareInsuranceUpdates([row], [versionless]);
  assert.equal(missingVersion.updates.length, 0);
  assert.match(missingVersion.review[0].reason, /version is missing/i);

  const extraCoverage = patient();
  extraCoverage.coverageRecords = [
    { coverageOrder: "primary", insuranceType: "commercial", payerName: "CareFirst BlueCross BlueShield", memberId: "ONE" },
    { coverageOrder: "secondary", insuranceType: "original-medicare", payerName: "Medicare", memberId: VALID_MBI },
    { coverageOrder: "other", insuranceType: "medicare-supplement", payerName: "Synthetic Supplement", memberId: "THREE" },
    { coverageOrder: "other", insuranceType: "behavioral-health", payerName: "Carelon Behavioral Health Maryland", memberId: "FOUR" },
  ];
  const unsupportedShape = prepareInsuranceUpdates([row], [extraCoverage]);
  assert.equal(unsupportedShape.updates.length, 0);
  assert.match(unsupportedShape.review[0].reason, /supports one primary, one secondary, and one additional/i);
});

test("an ambiguous payer remains review-only when the current Registry has no classification", () => {
  const [row] = parseInsuranceReport(report([
    sourceRow({ payer: "Riverside Health, Inc" }),
  ]), "primary");
  const plan = prepareInsuranceUpdates([row], [patient()]);
  assert.equal(plan.updates.length, 0);
  assert.match(plan.review[0].reason, /unresolved in both the report and current Registry/i);
});

test("unrecognized payer text cannot inherit a current Registry classification", () => {
  const [row] = parseInsuranceReport(report([
    sourceRow({ payer: "Not An Insurance Company" }),
  ]), "primary");
  const registryPatient = patient();
  registryPatient.coverageRecords.push({
    coverageOrder: "primary",
    insuranceType: "commercial",
    payerName: "CareFirst BlueCross BlueShield",
    coverageStatus: "verified",
  });
  const plan = prepareInsuranceUpdates([row], [registryPatient]);
  assert.equal(plan.updates.length, 0);
  assert.match(plan.review[0].reason, /not a recognized carrier/i);
});

test("an unrecognized payer stays review-only even when the plan text suggests a known classification", () => {
  const [row] = parseInsuranceReport(report([
    sourceRow({ payer: "Person Name", plan: "Maryland Medicaid HealthChoice" }),
  ]), "primary");
  assert.equal(row.coverageRecord.insuranceType, "medicaid-mco");
  assert.match(row.reasons.join(" "), /not a recognized carrier/i);
  const plan = prepareInsuranceUpdates([row], [patient()]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.review.length, 1);
});
