import assert from "node:assert/strict";
import test from "node:test";
import { patientBodyProfile } from "../provider/patient-360-body-profile.mjs";

test("Patient 360 selects only the recorded female or male outline", () => {
  assert.equal(patientBodyProfile({ gender: "female" })?.sex, "female");
  assert.equal(patientBodyProfile({ gender: "male" })?.sex, "male");
});

test("Patient 360 keeps both outlines when gender is missing or unknown", () => {
  assert.equal(patientBodyProfile({}), null);
  assert.equal(patientBodyProfile({ gender: "unknown" }), null);
  assert.equal(patientBodyProfile({ gender: "nonbinary" }), null);
});

test("they/them pronouns keep both outlines even when a binary gender is recorded", () => {
  assert.equal(patientBodyProfile({ gender: "male", pronouns: "they/them" }), null);
  assert.equal(patientBodyProfile({ gender: "female", preferredPronouns: "they / them" }), null);
  assert.equal(patientBodyProfile({
    gender: "male",
    extension: [{ url: "https://bhwmedical.org/fhir/pronouns", valueString: "they/them" }],
  }), null);
});

