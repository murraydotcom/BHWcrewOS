import test from "node:test";
import assert from "node:assert/strict";
import {
  BHW_QPP_2026,
  BHW_M0005_MEASURES,
  evaluateLowVolumeFlags,
  evaluateLowVolumeThreshold,
  rawPerformanceRate,
  projectMeasure,
  summarizeCareGaps,
  buildQualityCommandCenter,
  daysUntilRegistrationDeadline,
} from "../engine/qpp-2026-bhw.mjs";

test("2026 BHW configuration reflects current opt-in eligible small-practice status", () => {
  assert.equal(BHW_QPP_2026.performanceYear, 2026);
  assert.equal(BHW_QPP_2026.mode, "shadow");
  assert.equal(BHW_QPP_2026.participation.status, "opt-in-eligible");
  assert.deepEqual(BHW_QPP_2026.participation.options, ["individual", "group"]);
  assert.equal(BHW_QPP_2026.participation.preliminary, true);
  assert.equal(BHW_QPP_2026.specialStatuses.smallPractice.individual, true);
  assert.equal(BHW_QPP_2026.specialStatuses.smallPractice.group, true);
  assert.equal(BHW_QPP_2026.specialStatuses.hpsa.group, true);
  assert.equal(BHW_QPP_2026.requirements.promotingInteroperability, "automatically-reweighted-small-practice");
  assert.equal(BHW_QPP_2026.primaryMvp.id, "M0005");
  assert.equal(BHW_QPP_2026.primaryMvp.currentRegistrationState, "not-currently-available");
});

test("current low-volume threshold flags resolve to opt-in eligible", () => {
  const result = evaluateLowVolumeFlags();
  assert.equal(result.beneficiaries, false);
  assert.equal(result.allowedCharges, false);
  assert.equal(result.coveredServices, true);
  assert.equal(result.exceededCount, 1);
  assert.equal(result.status, "opt-in-eligible");
});

test("numeric low-volume forecast uses strict greater-than thresholds", () => {
  const required = evaluateLowVolumeThreshold({
    beneficiaries: 201,
    allowedCharges: 90001,
    coveredServices: 201,
  });
  assert.equal(required.status, "required-to-report");
  assert.equal(required.exceededCount, 3);

  const boundary = evaluateLowVolumeThreshold({
    beneficiaries: 200,
    allowedCharges: 90000,
    coveredServices: 200,
  });
  assert.equal(boundary.status, "voluntary-only");
  assert.equal(boundary.exceededCount, 0);

  const incomplete = evaluateLowVolumeThreshold({
    beneficiaries: 100,
    allowedCharges: "",
    coveredServices: 300,
  });
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.complete, false);
});

test("BHW primary-care measure identifiers are unique and staged for M0005 shadow readiness", () => {
  const ids = BHW_M0005_MEASURES.map((measure) => measure.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["001", "112", "134", "236"]);
  for (const measure of BHW_M0005_MEASURES) {
    assert.equal(measure.mvp, "M0005");
    assert.equal(measure.sourceState, "verified-qpp-2026");
    assert.ok(Array.isArray(measure.dataMap.operationalActions));
    assert.ok(measure.dataMap.operationalActions.length > 0);
  }
});

test("raw performance rate applies exclusions without inventing CMS points", () => {
  assert.equal(rawPerformanceRate({ numerator: 72, denominator: 100, exclusions: 10 }), 80);
  assert.equal(rawPerformanceRate({ numerator: 91, denominator: 100, exclusions: 10 }), null);
  assert.equal(rawPerformanceRate({ numerator: 0, denominator: 0 }), null);
});

test("inverse measure keeps its observed rate and lower-is-better direction", () => {
  const diabetes = BHW_M0005_MEASURES.find((measure) => measure.id === "001");
  const projection = projectMeasure(diabetes, { numerator: 8, denominator: 100 });
  assert.equal(projection.rawPerformanceRate, 8);
  assert.equal(projection.direction, "lower");
  assert.equal(projection.cmsPoints, null);
  assert.equal(projection.officialScore, false);
});

test("care-gap summary remains aggregate and ignores invalid measure/action combinations", () => {
  const summary = summarizeCareGaps([
    { measureId: "112", action: "outreach", status: "open" },
    { measureId: "112", action: "external-evidence", status: "working" },
    { measureId: "236", action: "appointment", status: "closed" },
    { measureId: "134", action: "provider-review", status: "excluded" },
    { measureId: "999", action: "outreach", status: "open" },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.open, 2);
  assert.equal(summary.closed, 1);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.byAction.outreach, 1);
  assert.equal(summary.byAction["external-evidence"], 1);
  assert.equal(summary.byMeasure["112"], 2);
});

test("command center blocks MVP registration under current status and never submits to CMS", () => {
  const center = buildQualityCommandCenter({
    measures: {
      "001": { numerator: 8, denominator: 100 },
      "112": { numerator: 70, denominator: 100 },
      "134": { numerator: 80, denominator: 100 },
      "236": { numerator: 82, denominator: 100 },
    },
  });
  assert.equal(center.quality.measuresWithShadowRates, 4);
  assert.equal(center.eligibility.status, "opt-in-eligible");
  assert.equal(center.canRegisterMvpNow, false);
  assert.equal(center.promotingInteroperability.status, "automatically-reweighted-small-practice");
  assert.equal(center.promotingInteroperability.submissionRequired, false);
  assert.equal(center.officialFinalScore, null);
  assert.equal(center.canSubmitToCms, false);
  assert.ok(center.measures.every((measure) => measure.cmsPoints === null));
});

test("future required-to-report state may unlock the registration gate but not CMS submission", () => {
  const center = buildQualityCommandCenter({
    lowVolumeFlags: {
      beneficiaries: true,
      allowedCharges: true,
      coveredServices: true,
    },
  });
  assert.equal(center.eligibility.status, "required-to-report");
  assert.equal(center.canRegisterMvpNow, true);
  assert.equal(center.canSubmitToCms, false);
});

test("registration deadline remains in the future as of the September 2026 status review", () => {
  const days = daysUntilRegistrationDeadline(new Date("2026-09-21T12:00:00-04:00"));
  assert.ok(days > 0);
  assert.ok(days < 90);
});
