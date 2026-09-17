/* ============================================================================
 * 2026 BHW QUALITY COMMAND CENTER — QPP SHADOW MODE
 *
 * This module turns the existing BHW MIPS/MVP reference layer into a bounded
 * 2026 readiness and performance-rate projection for Baltimore Healthcare and
 * Wellness. It deliberately does NOT calculate an official MIPS score or submit
 * data to CMS. Official scoring requires current QPP measure specifications,
 * benchmarks, case minimums, data-completeness rules, special-status decisions,
 * and an authorized submission pathway.
 * ========================================================================== */

const frozen = (value) => Object.freeze(value);

export const BHW_QPP_2026 = frozen({
  performanceYear: 2026,
  paymentYear: 2028,
  mode: "shadow",
  participation: frozen({
    status: "opt-in-eligible",
    options: frozen(["individual", "group"]),
    preliminary: true,
    checkedOn: "2026-09-16",
    source: "CMS QPP Participation Status Tool",
    nextEligibilityReview: "2026-10",
  }),
  primaryMvp: frozen({
    id: "M0005",
    title: "Value in Primary Care",
    rationale: "Primary-care MVP applicable to Family Medicine and Nurse Practitioners.",
    registrationDeadline: "2026-11-30T20:00:00-05:00",
  }),
  requirements: frozen({
    qualityMeasureCount: 4,
    outcomeOrHighPriorityRequired: true,
    qualityPerformancePeriodMonths: 12,
    improvementActivitiesRequired: 1,
    costSource: "CMS administrative claims",
    populationHealthSource: "CMS administrative claims",
    promotingInteroperability: "Traditional MIPS PI requirements apply unless reweighted.",
  }),
});

export const BHW_M0005_MEASURES = frozen([
  frozen({
    id: "001",
    title: "Diabetes: Glycemic Status Assessment Greater Than 9%",
    type: "Intermediate Outcome",
    highPriority: true,
    direction: "lower",
    mvp: "M0005",
    sourceState: "verified-qpp-2026",
    dataMap: frozen({
      denominator: "Patients age 18–75 with diabetes meeting the current measure specification",
      numerator: "Eligible patients with glycemic status assessment >9% or otherwise meeting the current numerator definition",
      likelySources: frozen(["Health Core problems", "Health Core labs/results", "claims/eligibility context"]),
    }),
  }),
  frozen({
    id: "112",
    title: "Breast Cancer Screening",
    type: "Process",
    highPriority: false,
    direction: "higher",
    mvp: "M0005",
    sourceState: "verified-qpp-2026",
    dataMap: frozen({
      denominator: "Women age 50–74 meeting the current measure specification",
      numerator: "Eligible patients with qualifying mammography evidence in the measurement window",
      likelySources: frozen(["Health Core preventive evidence", "CRISP Preventive Services", "claims"]),
    }),
  }),
  frozen({
    id: "134",
    title: "Preventive Care and Screening: Screening for Depression and Follow-Up Plan",
    type: "Process",
    highPriority: false,
    direction: "higher",
    mvp: "M0005",
    sourceState: "verified-qpp-2026",
    dataMap: frozen({
      denominator: "Patients age 12+ with qualifying encounters under the current measure specification",
      numerator: "Standardized depression screening plus required follow-up documentation when positive",
      likelySources: frozen(["Health Core encounters", "screening/questionnaire results", "care plan/follow-up documentation"]),
    }),
  }),
  frozen({
    id: "236",
    title: "Controlling High Blood Pressure",
    type: "Intermediate Outcome",
    highPriority: true,
    direction: "higher",
    mvp: "M0005",
    sourceState: "verified-qpp-2026",
    dataMap: frozen({
      denominator: "Patients age 18–85 with essential hypertension meeting the current measure specification",
      numerator: "Eligible patients whose most recent qualifying blood pressure is controlled under the current specification",
      likelySources: frozen(["Health Core problems", "Health Core observations/vitals", "encounter documentation"]),
    }),
  }),
]);

function finiteNonnegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function rawPerformanceRate({ numerator, denominator, exclusions = 0 } = {}) {
  const n = finiteNonnegative(numerator);
  const d = finiteNonnegative(denominator);
  const x = finiteNonnegative(exclusions);
  if (n === null || d === null || x === null) return null;
  const eligible = d - x;
  if (eligible <= 0 || n > eligible) return null;
  return (n / eligible) * 100;
}

export function projectMeasure(measure, observation = {}) {
  const rawRate = rawPerformanceRate(observation);
  const denominator = finiteNonnegative(observation.denominator);
  const exclusions = finiteNonnegative(observation.exclusions ?? 0);
  const eligible = denominator === null || exclusions === null ? null : denominator - exclusions;
  return frozen({
    id: measure.id,
    title: measure.title,
    type: measure.type,
    highPriority: measure.highPriority,
    direction: measure.direction,
    denominator: denominator,
    exclusions: exclusions,
    eligibleDenominator: eligible !== null && eligible >= 0 ? eligible : null,
    numerator: finiteNonnegative(observation.numerator),
    rawPerformanceRate: rawRate,
    cmsPoints: null,
    officialScore: false,
    scoringState: rawRate === null ? "needs-valid-counts" : "benchmark-not-loaded",
  });
}

export function buildQualityCommandCenter(snapshot = {}) {
  const observations = snapshot.measures || {};
  const measures = BHW_M0005_MEASURES.map((measure) => projectMeasure(measure, observations[measure.id] || {}));
  const withRates = measures.filter((measure) => measure.rawPerformanceRate !== null).length;
  return frozen({
    config: BHW_QPP_2026,
    measures: frozen(measures),
    quality: frozen({
      mappedMeasures: BHW_M0005_MEASURES.length,
      measuresWithShadowRates: withRates,
      requiredMeasureCount: BHW_QPP_2026.requirements.qualityMeasureCount,
      officialPoints: null,
    }),
    improvementActivities: frozen({ status: "needs-2026-selection-and-evidence", required: 1, officialPoints: null }),
    cost: frozen({ status: "cms-claims-calculated", officialPoints: null }),
    promotingInteroperability: frozen({ status: "verify-special-status-or-reporting-path", officialPoints: null }),
    populationHealth: frozen({ status: "cms-claims-calculated", officialPoints: null }),
    officialFinalScore: null,
    canSubmitToCms: false,
  });
}

export function daysUntilRegistrationDeadline(now = new Date()) {
  const deadline = new Date(BHW_QPP_2026.primaryMvp.registrationDeadline);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return null;
  return Math.ceil((deadline.getTime() - current.getTime()) / 86_400_000);
}
