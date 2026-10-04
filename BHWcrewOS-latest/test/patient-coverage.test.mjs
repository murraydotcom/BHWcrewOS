import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageSlotsForPatient,
  insuranceReviewFlags,
  insuranceStorageForPatient,
  insuranceValidationMessage,
  medicareMbiForPatient,
  sanitizeCoverageRecords,
} from "../shared/patient-coverage.mjs";

const VALID_MBI = "1EG4TE5MK73";

test("legacy primary payer and member ID remain a compatible primary coverage projection", () => {
  const patient = {
    primaryPayer: "CareFirst BCBS",
    memberId: "CF-123",
    coverageStatus: "verified",
  };
  const slots = coverageSlotsForPatient(patient);
  assert.equal(slots.primary.coverageOrder, "primary");
  assert.equal(slots.primary.insuranceType, "commercial");
  assert.equal(slots.primary.payerName, "CareFirst BCBS");
  assert.equal(slots.primary.memberId, "CF-123");

  const stored = insuranceStorageForPatient(patient);
  assert.equal(stored.primaryPayer, "CareFirst BCBS");
  assert.equal(stored.memberId, "CF-123");
  assert.equal(stored.coverageRecords.length, 1);
});

test("Registry stores primary, secondary, and additional policies separately", () => {
  const stored = insuranceStorageForPatient({}, {
    primary: { insuranceType: "commercial", payerName: "CareFirst BCBS", memberId: "PRIMARY-1", coverageStatus: "verified" },
    secondary: { insuranceType: "original-medicare", payerName: "Medicare", memberId: "SECONDARY-2", coverageStatus: "verified", medicareSecondaryReason: "12" },
    other: { insuranceType: "medicare-supplement", payerName: "Supplement Payer", memberId: "OTHER-3", coverageStatus: "pending" },
  }, VALID_MBI);

  assert.deepEqual(stored.coverageRecords.map((record) => record.coverageOrder), ["primary", "secondary", "other"]);
  assert.deepEqual(stored.coverageRecords.map((record) => record.memberId), ["PRIMARY-1", "SECONDARY-2", "OTHER-3"]);
  assert.equal(stored.medicareMbi, VALID_MBI);
  assert.equal(stored.coverageRecords[1].medicareMbi, VALID_MBI);
  assert.equal(stored.coverageRecords[1].medicareSecondaryReason, "12");
  assert.equal(stored.primaryPayer, "CareFirst BCBS");
  assert.equal(stored.memberId, "PRIMARY-1");
});

test("Medicare Advantage member ID is never inferred to be the MBI", () => {
  const patient = {
    coverageRecords: [{
      coverageOrder: "primary",
      insuranceType: "medicare-advantage",
      payerName: "UnitedHealthcare Medicare Advantage",
      memberId: VALID_MBI,
      coverageStatus: "verified",
    }],
  };
  assert.equal(medicareMbiForPatient(patient), "");
  assert.match(insuranceReviewFlags(patient).join(" "), /MBI not verified/);
});

test("valid Original Medicare member ID can seed the separate MBI during legacy migration", () => {
  const patient = { primaryPayer: "Medicare", memberId: VALID_MBI, coverageStatus: "verified" };
  assert.equal(medicareMbiForPatient(patient), VALID_MBI);
  assert.deepEqual(insuranceReviewFlags(patient), []);
});

test("secondary Medicare remains reviewable until its MSP reason is verified", () => {
  const patient = {
    medicareMbi: VALID_MBI,
    coverageRecords: [
      { coverageOrder: "primary", insuranceType: "commercial", payerName: "Aetna Commercial", memberId: "A-1" },
      { coverageOrder: "secondary", insuranceType: "original-medicare", payerName: "Medicare", memberId: VALID_MBI },
    ],
  };
  assert.match(insuranceReviewFlags(patient).join(" "), /MSP reason not verified/);
});

test("invalid MBI is rejected and nested coverage payloads are allowlisted", () => {
  assert.match(insuranceValidationMessage({ medicareMbi: "not-an-mbi", coverageRecords: [] }), /valid 11-character MBI/);
  const [record] = sanitizeCoverageRecords([{
    coverageOrder: "secondary",
    insuranceType: "original-medicare",
    payerName: "Medicare",
    memberId: VALID_MBI,
    medicareMbi: VALID_MBI,
    medicareSecondaryReason: "47",
    ignored: "drop-me",
  }]);
  assert.equal(record.medicareMbi, VALID_MBI);
  assert.equal(record.medicareSecondaryReason, "47");
  assert.equal(record.ignored, undefined);
});
