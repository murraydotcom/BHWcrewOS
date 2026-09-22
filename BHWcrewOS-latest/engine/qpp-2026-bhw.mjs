/* ============================================================================
 * 2026 BHW QUALITY COMMAND CENTER — QPP SHADOW + QUALITY OPERATIONS
 *
 * Purpose
 * -------
 * Give Baltimore Healthcare and Wellness one bounded quality-control layer for:
 *   - current MIPS eligibility and low-volume-threshold monitoring;
 *   - Traditional MIPS shadow readiness;
 *   - M0005 Value in Primary Care future-readiness / shadow mapping;
 *   - raw quality performance rates and care-gap operations;
 *   - small-practice Promoting Interoperability reweighting awareness; and
 *   - non-PHI implementation deadlines/readiness tracking.
 *
 * This module deliberately does NOT calculate an official CMS MIPS final score,
 * determine CMS eligibility, register an MVP, elect MIPS opt-in, or submit data.
 * CMS/QPP remains the source of truth for eligibility, specifications, scoring,
 * benchmarks, case minimums, attribution, and payment adjustments.
 * ========================================================================== */

const frozen = (value) => Object.freeze(value);

const asFiniteNonnegative = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export const BHW_QPP_2026 = frozen({
  performanceYear: 2026,
  paymentYear: 2028,
  mode: "shadow",
  participation: frozen({
    status: "opt-in-eligible",
    options: frozen(["individual", "group"]),
    preliminary: true,
    checkedOn: "2026-09-21",
    source: "CMS QPP Participation Status Tool and CCSQ Service Center ticket CS2783478",
    cmsTicket: "CS2783478",
    nextEligibilityReview: "2026-10",
    finalEligibilityExpected: "2026-12",
    submissionWindow: frozen({
      opens: "2027-01-02",
      closes: "2027-03-31",
    }),
  }),
  specialStatuses: frozen({
    smallPractice: frozen({ individual: true, group: true }),
    hpsa: frozen({ individual: true, group: true }),
  }),
  lowVolumeThreshold: frozen({
    beneficiaries: frozen({ threshold: 200, comparison: "greater-than", currentExceeds: false }),
    allowedCharges: frozen({ threshold: 90_000, comparison: "greater-than", currentExceeds: false }),
    coveredServices: frozen({ threshold: 200, comparison: "greater-than", currentExceeds: true }),
    sourceState: "CMS-QPP-initial-2026",
  }),
  traditionalMips: frozen({
    available: true,
    voluntaryReportingAvailable: true,
    optInAvailable: true,
    paymentAdjustmentAppliesOnlyAfterFormalOptIn: true,
  }),
  primaryMvp: frozen({
    id: "M0005",
    title: "Value in Primary Care",
    role: "future-readiness-shadow",
    rationale: "Primary-care MVP applicable to Family Medicine and Nurse Practitioners.",
    registrationDeadline: "2026-11-30T20:00:00-05:00",
    currentRegistrationState: "not-currently-available",
    eligibilityGate: "BHW must become required-to-report before the 2026 MVP registration deadline.",
  }),
  requirements: frozen({
    qualityPerformancePeriodMonths: 12,
    improvementActivitiesRequiredSmallPractice: 1,
    improvementActivityMinimumDays: 90,
    costSource: "CMS administrative claims",
    promotingInteroperability: "automatically-reweighted-small-practice",
    officialScoringAvailableInThisModule: false,
  }),
});

export const BHW_QUALITY_DEADLINES_2026 = frozen([
  frozen({ id: "eligibility-check-1", date: "2026-10-15", title: "Eligibility + special-status check", kind: "internal" }),
  frozen({ id: "eligibility-check-2", date: "2026-11-01", title: "Internal QPP eligibility checkpoint", kind: "internal" }),
  frozen({ id: "eligibility-hard-stop", date: "2026-11-13", title: "BHW pre-deadline hard stop", kind: "internal" }),
  frozen({ id: "mvp-registration", date: "2026-11-30", title: "CMS 2026 MVP registration deadline", kind: "cms" }),
  frozen({ id: "final-eligibility", date: "2026-12-31", title: "Final reconciled 2026 eligibility expected by December", kind: "cms-window" }),
  frozen({ id: "submission-open", date: "2027-01-02", title: "2026 MIPS submission window opens", kind: "cms" }),
  frozen({ id: "submission-close", date: "2027-03-31", title: "2026 MIPS submission window closes", kind: "cms" }),
]);

export const INTEROPERABILITY_READINESS_AREAS = frozen([
  frozen({ id: "cehrt", label: "CEHRT / certified-module strategy", owner: "Health Core + vendor modules" }),
  frozen({ id: "erx", label: "Embedded e-prescribing / EPCS", owner: "Health Core + eRx vendor" }),
  frozen({ id: "hie", label: "CRISP / referral-loop exchange", owner: "Health Core + CRISP" }),
  frozen({ id: "patient-access", label: "Patient electronic access / FHIR", owner: "Health Core + Care Connect" }),
  frozen({ id: "public-health", label: "Immunization + eCR exchange", owner: "Health Core + CRISP/MDH/module" }),
  frozen({ id: "sra", label: "Security Risk Analysis", owner: "BHW governance" }),
  frozen({ id: "safer", label: "SAFER Guide self-assessment", owner: "BHW clinical safety" }),
  frozen({ id: "onc-attestations", label: "ONC / interoperability attestations", owner: "BHW governance" }),
]);

export const QUALITY_GAP_ACTIONS = frozen([
  "outreach",
  "order",
  "appointment",
  "provider-review",
  "external-evidence",
  "documentation",
]);

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
      operationalActions: frozen(["order", "appointment", "provider-review", "documentation"]),
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
      operationalActions: frozen(["outreach", "order", "appointment", "external-evidence", "documentation"]),
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
      operationalActions: frozen(["appointment", "provider-review", "documentation"]),
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
      operationalActions: frozen(["outreach", "appointment", "provider-review", "documentation"]),
    }),
  }),
]);

export function evaluateLowVolumeFlags({
  beneficiaries = BHW_QPP_2026.lowVolumeThreshold.beneficiaries.currentExceeds,
  allowedCharges = BHW_QPP_2026.lowVolumeThreshold.allowedCharges.currentExceeds,
  coveredServices = BHW_QPP_2026.lowVolumeThreshold.coveredServices.currentExceeds,
} = {}) {
  const flags = {
    beneficiaries: beneficiaries === true,
    allowedCharges: allowedCharges === true,
    coveredServices: coveredServices === true,
  };
  const exceededCount = Object.values(flags).filter(Boolean).length;
  return frozen({
    ...flags,
    exceededCount,
    status: exceededCount === 3 ? "required-to-report" : exceededCount >= 1 ? "opt-in-eligible" : "voluntary-only",
  });
}

export function evaluateLowVolumeThreshold({ beneficiaries, allowedCharges, coveredServices } = {}) {
  const values = {
    beneficiaries: asFiniteNonnegative(beneficiaries),
    allowedCharges: asFiniteNonnegative(allowedCharges),
    coveredServices: asFiniteNonnegative(coveredServices),
  };
  const complete = Object.values(values).every((value) => value !== null);
  const flags = {
    beneficiaries: values.beneficiaries === null ? null : values.beneficiaries > BHW_QPP_2026.lowVolumeThreshold.beneficiaries.threshold,
    allowedCharges: values.allowedCharges === null ? null : values.allowedCharges > BHW_QPP_2026.lowVolumeThreshold.allowedCharges.threshold,
    coveredServices: values.coveredServices === null ? null : values.coveredServices > BHW_QPP_2026.lowVolumeThreshold.coveredServices.threshold,
  };
  const exceededCount = Object.values(flags).filter((value) => value === true).length;
  const status = !complete
    ? "incomplete"
    : exceededCount === 3
      ? "required-to-report"
      : exceededCount >= 1
        ? "opt-in-eligible"
        : "voluntary-only";
  return frozen({ values: frozen(values), flags: frozen(flags), exceededCount, complete, status });
}

export function rawPerformanceRate({ numerator, denominator, exclusions = 0 } = {}) {
  const n = asFiniteNonnegative(numerator);
  const d = asFiniteNonnegative(denominator);
  const x = asFiniteNonnegative(exclusions);
  if (n === null || d === null || x === null) return null;
  const eligible = d - x;
  if (eligible <= 0 || n > eligible) return null;
  return (n / eligible) * 100;
}

export function projectMeasure(measure, observation = {}) {
  const rawRate = rawPerformanceRate(observation);
  const denominator = asFiniteNonnegative(observation.denominator);
  const exclusions = asFiniteNonnegative(observation.exclusions ?? 0);
  const eligible = denominator === null || exclusions === null ? null : denominator - exclusions;
  return frozen({
    id: measure.id,
    title: measure.title,
    type: measure.type,
    highPriority: measure.highPriority,
    direction: measure.direction,
    denominator,
    exclusions,
    eligibleDenominator: eligible !== null && eligible >= 0 ? eligible : null,
    numerator: asFiniteNonnegative(observation.numerator),
    rawPerformanceRate: rawRate,
    cmsPoints: null,
    officialScore: false,
    scoringState: rawRate === null ? "needs-valid-counts" : "benchmark-not-loaded",
  });
}

export function summarizeCareGaps(gaps = []) {
  const measureIds = new Set(BHW_M0005_MEASURES.map((measure) => measure.id));
  const actionSet = new Set(QUALITY_GAP_ACTIONS);
  const normalized = (Array.isArray(gaps) ? gaps : []).map((gap) => {
    const measureId = String(gap?.measureId || "").trim();
    const action = String(gap?.action || "").trim();
    const status = String(gap?.status || "open").trim().toLowerCase();
    if (!measureIds.has(measureId) || !actionSet.has(action)) return null;
    return { measureId, action, status: ["open", "working", "closed", "excluded"].includes(status) ? status : "open" };
  }).filter(Boolean);

  const open = normalized.filter((gap) => !["closed", "excluded"].includes(gap.status));
  const byAction = Object.fromEntries(QUALITY_GAP_ACTIONS.map((action) => [action, open.filter((gap) => gap.action === action).length]));
  const byMeasure = Object.fromEntries(BHW_M0005_MEASURES.map((measure) => [measure.id, open.filter((gap) => gap.measureId === measure.id).length]));

  return frozen({
    total: normalized.length,
    open: open.length,
    closed: normalized.filter((gap) => gap.status === "closed").length,
    excluded: normalized.filter((gap) => gap.status === "excluded").length,
    byAction: frozen(byAction),
    byMeasure: frozen(byMeasure),
  });
}

export function daysUntilDate(date, now = new Date()) {
  const target = new Date(date);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(current.getTime())) return null;
  return Math.ceil((target.getTime() - current.getTime()) / 86_400_000);
}

export function daysUntilRegistrationDeadline(now = new Date()) {
  return daysUntilDate(BHW_QPP_2026.primaryMvp.registrationDeadline, now);
}

export function buildQualityCommandCenter(snapshot = {}) {
  const observations = snapshot.measures || {};
  const measures = BHW_M0005_MEASURES.map((measure) => projectMeasure(measure, observations[measure.id] || {}));
  const withRates = measures.filter((measure) => measure.rawPerformanceRate !== null).length;
  const eligibility = snapshot.lowVolumeValues
    ? evaluateLowVolumeThreshold(snapshot.lowVolumeValues)
    : evaluateLowVolumeFlags(snapshot.lowVolumeFlags || {});
  const careGaps = summarizeCareGaps(snapshot.careGaps || []);

  return frozen({
    config: BHW_QPP_2026,
    eligibility,
    measures: frozen(measures),
    quality: frozen({
      mappedMeasures: BHW_M0005_MEASURES.length,
      measuresWithShadowRates: withRates,
      officialPoints: null,
    }),
    careGaps,
    improvementActivities: frozen({
      status: "not-selected",
      requiredForSmallPractice: BHW_QPP_2026.requirements.improvementActivitiesRequiredSmallPractice,
      minimumContinuousDays: BHW_QPP_2026.requirements.improvementActivityMinimumDays,
      officialPoints: null,
    }),
    cost: frozen({ status: "cms-claims-calculated", officialPoints: null }),
    promotingInteroperability: frozen({
      status: "automatically-reweighted-small-practice",
      submissionRequired: false,
      readinessTrackedSeparately: true,
      officialPoints: null,
    }),
    mvp: frozen({
      id: BHW_QPP_2026.primaryMvp.id,
      registrationState: BHW_QPP_2026.primaryMvp.currentRegistrationState,
      role: BHW_QPP_2026.primaryMvp.role,
    }),
    officialFinalScore: null,
    canRegisterMvpNow: eligibility.status === "required-to-report",
    canSubmitToCms: false,
  });
}
