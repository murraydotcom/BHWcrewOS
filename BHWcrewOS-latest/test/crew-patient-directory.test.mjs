import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildPatientDirectory } = require("../netlify/functions/lib/crew-patient-directory.js");

const cloud = (overrides = {}) => ({
  bhwPatientId: "BHW0613",
  name: "Synthetic Patient",
  dob: "1980-01-02",
  mrn: "SYNTHETIC-MRN",
  primaryPayer: "Medicare",
  memberId: "SYNTHETIC-MEMBER",
  patientStatus: "active",
  ...overrides,
});

test("every Cloud Registry patient uses the canonical BHW ID as its only picker key", () => {
  const result = buildPatientDirectory([cloud()]);
  assert.equal(result.patients.length, 1);
  assert.equal(result.patients[0].id, "BHW0613");
  assert.equal(result.patients[0].bhwId, "BHW0613");
  assert.equal(result.patients[0].registrySource, "cloud");
  assert.equal(Object.hasOwn(result.patients[0], "relationId"), false);
  assert.deepEqual(Object.keys(result.patientLabel), ["BHW0613"]);
  assert.equal(result.patientLabel.BHW0613, "Synthetic Patient (BHW0613)");
});

test("transferred, deceased, and prospective records remain visible but cannot start new work", () => {
  const result = buildPatientDirectory([
    cloud({ patientStatus: "transferred" }),
    cloud({ bhwPatientId: "BHW0614", name: "Synthetic Deceased", patientStatus: "deceased" }),
    cloud({ bhwPatientId: "TMP-202609030001", name: "Synthetic Prospect", patientStatus: "prospective" }),
  ]);
  assert.ok(result.patients.every((patient) => patient.selectable === false));
});

test("no fallback roster is produced when the Cloud Registry is unavailable", () => {
  const result = buildPatientDirectory();
  assert.deepEqual(result, { patients: [], patientLabel: {} });
});

test("nested Registry MBI status reaches every CrewHQ chart through the shared directory", () => {
  const result = buildPatientDirectory([cloud({
    memberId: "",
    coverageRecords: [{ coverageOrder: "secondary", insuranceType: "original-medicare", payer: "CMS Medicare", medicareMbi: "1EG4-TE5-MK73" }],
  })]);
  assert.equal(result.patients[0].hasMbi, true);
  assert.equal(result.patients[0].medicareCoverageOrder, "secondary");
});

test("carrier-branded Medicare plans remain in the Medicare prevention queue", () => {
  const result = buildPatientDirectory([
    cloud({ bhwPatientId: "BHW0001", primaryPayer: "United Healthcare Medicare" }),
    cloud({ bhwPatientId: "BHW0002", primaryPayer: "Aetna Medicare Advantage" }),
  ]);
  assert.deepEqual(result.patients.map((patient) => patient.insurance), ["Medicare", "Medicare"]);
});

test("secondary Medicare and named Advantage plans reach the AWV queue without replacing the actual payer", () => {
  for (const [primary, secondary, expected] of [
    [{ insuranceType: "commercial", payerName: "CareFirst BCBS" }, { insuranceType: "original-medicare", payerName: "Medicare" }, "Medicare"],
    [{ insuranceType: "medicaid-mco", payerName: "Maryland Physicians Care" }, { insuranceType: "original-medicare", payerName: "Medicare" }, "Medicare + Medicaid"],
    [{ insuranceType: "medicare-advantage", payerName: "Alterwood Advantage" }, null, "Medicare"],
    [{ insuranceType: "medicare-advantage", payerName: "CIGNA HealthSpring" }, null, "Medicare"],
  ]) {
    const coverageRecords = [{ ...primary, coverageOrder: "primary", memberId: "PRIMARY-1" }];
    if (secondary) coverageRecords.push({ ...secondary, coverageOrder: "secondary", medicareMbi: "1EG4TE5MK73" });
    const result = buildPatientDirectory([cloud({ primaryPayer: primary.payerName, coverageRecords })]).patients[0];
    assert.equal(result.insurance, expected);
    assert.equal(result.insuranceLabel, primary.payerName);
    assert.equal(result.medicareCoverageOrder, secondary ? "secondary" : "primary");
  }
});

test("a supplement alone does not put a patient in the Medicare AWV queue", () => {
  const [patient] = buildPatientDirectory([cloud({
    primaryPayer: "Medicare Supplement", memberId: "1EG4TE5MK73",
    coverageRecords: [{ coverageOrder: "primary", insuranceType: "medicare-supplement", payerName: "Medicare Supplement", memberId: "1EG4TE5MK73" }],
  })]).patients;
  assert.equal(patient.hasMbi, false);
  assert.equal(patient.medicareCoverageOrder, "");
  assert.notEqual(patient.insurance, "Medicare");
});
