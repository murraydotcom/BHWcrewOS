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
