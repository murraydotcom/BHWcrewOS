import test from "node:test";
import assert from "node:assert/strict";
import {
  BHW_QPP_2026,
  BHW_M0005_MEASURES,
  rawPerformanceRate,
  projectMeasure,
  buildQualityCommandCenter,
  daysUntilRegistrationDeadline,
} from "../engine/qpp-2026-bhw.mjs";

test("2026 BHW configuration preserves the current preliminary opt-in status", () => {
  assert.equal(BHW_QPP_2026.performanceYear, 2026);
  assert.equal(BHW_QPP_2026.mode, "shadow");
  assert.equal(BHW_QPP_2026.participation.status, "opt-in-eligible");
  assert.deepEqual(BHW_QPP_2026.participation.options, ["individual", "group"]);
  assert.equal(BHW_QPP_2026.primaryMvp.id, "M0005");
  assert.equal(BHW_QPP_2026.participation.preliminary, true);
});

test("BHW primary-care measure identifiers are unique and verified for M0005", () => {
  const ids = BHW_M0005_MEASURES.map((measure) => measure.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["001", "112", "134", "236"]);
  for (const measure of BHW_M0005_MEASURES) {
    assert.equal(measure.mvp, "M0005");
    assert.equal(measure.sourceState, "verified-qpp-2026");
  }
});

test("raw performance rate applies exclusions without inventing CMS points", () => {
  assert.equal(rawPerformanceRate({ numerator: 72, denominator: 100, exclusions: 10 }), 80);
  assert.equal(rawPerformanceRate({ numerator: 91, denominator: 100, exclusions: 10 }), null);
  assert.equal(rawPerformanceRate({ numerator: 0, denominator: 0 }), null);
});

test("inverse measure keeps its raw observed rate and records lower-is-better direction", () => {
  const diabetes = BHW_M0005_MEASURES.find((measure) => measure.id === "001");
  const projection = projectMeasure(diabetes, { numerator: 8, denominator: 100 });
  assert.equal(projection.rawPerformanceRate, 8);
  assert.equal(projection.direction, "lower");
  assert.equal(projection.cmsPoints, null);
  assert.equal(projection.officialScore, false);
});

test("command center never presents a shadow projection as an official CMS score", () => {
  const center = buildQualityCommandCenter({
    measures: {
      "001": { numerator: 8, denominator: 100 },
      "112": { numerator: 70, denominator: 100 },
      "134": { numerator: 80, denominator: 100 },
      "236": { numerator: 82, denominator: 100 },
    },
  });
  assert.equal(center.quality.measuresWithShadowRates, 4);
  assert.equal(center.officialFinalScore, null);
  assert.equal(center.canSubmitToCms, false);
  assert.ok(center.measures.every((measure) => measure.cmsPoints === null));
});

test("registration deadline remains in the future as of the verified September status check", () => {
  const days = daysUntilRegistrationDeadline(new Date("2026-09-16T12:00:00-04:00"));
  assert.ok(days > 0);
  assert.ok(days < 90);
});
