import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildPatientDirectory, fallbackIndexDirectory } = require("../netlify/functions/lib/crew-patient-directory.js");

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

const index = (overrides = {}) => ({
  id: "index-synthetic",
  name: "Synthetic Patient",
  dob: "1980-01-02",
  masterId: "BHW0613",
  indexBhwId: "BHW-3",
  ...overrides,
});

test("every Cloud Registry patient appears in CrewOS even without a legacy link", () => {
  const result = buildPatientDirectory([], [cloud()]);
  assert.equal(result.patients.length, 1);
  assert.equal(result.patients[0].id, "BHW0613");
  assert.equal(result.patients[0].bhwId, "BHW0613");
  assert.equal(result.patients[0].registryLinked, false);
  assert.equal(result.patientLabel.BHW0613, "Synthetic Patient (BHW0613)");
});

test("a verified Registry ID reuses the existing CrewOS relation id", () => {
  const result = buildPatientDirectory([index()], [cloud()]);
  assert.equal(result.patients[0].id, "index-synthetic");
  assert.equal(result.patients[0].relationId, "index-synthetic");
  assert.equal(result.patients[0].bhwId, "BHW0613");
  assert.equal(result.patientLabel["index-synthetic"], "Synthetic Patient (BHW0613)");
});

test("name and DOB fallback is used only when both registries are unambiguous", () => {
  const blankIndex = index({ masterId: "" });
  const unique = buildPatientDirectory([blankIndex], [cloud()]);
  assert.equal(unique.patients[0].id, "index-synthetic");

  const ambiguous = buildPatientDirectory([blankIndex], [
    cloud(),
    cloud({ bhwPatientId: "BHW0614" }),
  ]);
  assert.equal(ambiguous.patients[0].id, "BHW0613");
  assert.equal(ambiguous.patients[1].id, "BHW0614");
});

test("transferred and deceased records remain visible but cannot start new work", () => {
  const result = buildPatientDirectory([], [
    cloud({ patientStatus: "transferred" }),
    cloud({ bhwPatientId: "BHW0614", name: "Synthetic Deceased", patientStatus: "deceased" }),
  ]);
  assert.ok(result.patients.every((patient) => patient.selectable === false));
});

test("CrewOS keeps its linked fallback if the Cloud Registry is temporarily unavailable", () => {
  const result = fallbackIndexDirectory([index()]);
  assert.equal(result.patients[0].id, "index-synthetic");
  assert.equal(result.patients[0].bhwId, "BHW0613");
  assert.equal(result.patients[0].registrySource, "legacy-index");
});
