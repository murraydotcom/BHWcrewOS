// Separates cumulative enrollment evidence from work that must be documented
// again for each service month. This prevents a prior month's completion from
// making a newly prepared row appear ready for billing.

const DURABLE_EVIDENCE_FIELDS = Object.freeze([
  "enrollmentStatus",
  "enrollmentRecordId",
  "workflowVersion",
  "intakeStatus",
  "intakeSource",
  "intakeReviewedAt",
  "intakeReviewedBy",
  "eligibilityStatus",
  "consentStatus",
  "consentDate",
  "consentReviewDue",
  "initiatingVisitStatus",
  "initiatingVisitDate",
  "carePlanStatus",
  "carePlanShared",
  "assignedPerson",
  "patientInstructionsProvided",
  "operationalRiskScore",
  "operationalRiskState",
  "suggestedContactCadence",
  "billingPath",
  "requiredMinutes",
  "requiredDeviceDays",
]);

function dateOnly(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function enrollmentEvidence(enrollment = {}) {
  const active = String(enrollment.status || "").toLowerCase() === "active";
  const reviewedAt = enrollment.practitionerReview?.reviewedAt || String(enrollment.updatedAt || "").slice(0, 10);
  return {
    enrollmentStatus: enrollment.status || "potential",
    enrollmentRecordId: enrollment.id || "",
    workflowVersion: enrollment.workflowVersion || "",
    intakeStatus: active ? "accepted" : "in-review",
    intakeSource: "patient-registry",
    intakeReviewedAt: reviewedAt,
    intakeReviewedBy: enrollment.practitionerReview?.reviewer || enrollment.updatedBy || "",
    eligibilityStatus: enrollment.practitionerReview?.status === "approved" ? "confirmed" : "potential",
    consentStatus: enrollment.consent?.status || "missing",
    consentDate: enrollment.consent?.date || "",
    consentReviewDue: enrollment.consent?.reviewDue || "",
    coverageStatus: enrollment.intake?.coverageDuplication?.verificationStatus || "unknown",
    coverageCheckedAt: enrollment.intake?.coverageDuplication?.checkedAt || "",
    initiatingVisitStatus: enrollment.initiatingVisit?.status || "missing",
    initiatingVisitDate: enrollment.initiatingVisit?.date || "",
    carePlanStatus: enrollment.carePlan?.status || "missing",
    carePlanShared: enrollment.carePlan?.shared === true,
    assignedPerson: enrollment.assignment?.assignedPerson || "",
    patientInstructionsProvided: enrollment.intake?.participationEducation?.patientInstructionsProvided === true,
    monthlyRequirementsMet: false,
    providerReviewStatus: enrollment.practitionerReview?.status === "approved" ? "approved" : "pending",
    providerReviewedAt: enrollment.practitionerReview?.reviewedAt || "",
    operationalRiskScore: enrollment.risk?.score,
    operationalRiskState: enrollment.risk?.state || "Incomplete",
    suggestedContactCadence: enrollment.risk?.override?.cadence || enrollment.risk?.suggestedCadence || "",
  };
}

function pickDurableEvidence(value = {}) {
  return Object.fromEntries(DURABLE_EVIDENCE_FIELDS
    .filter((field) => Object.hasOwn(value, field))
    .map((field) => [field, value[field]]));
}

function latestPriorMonthlyLog(logs, bhwPatientId, program, month) {
  return (Array.isArray(logs) ? logs : [])
    .filter((log) => String(log.type || "Monthly").toLowerCase() === "monthly"
      && log.bhwPatientId === bhwPatientId
      && String(log.program || "").toUpperCase() === String(program || "").toUpperCase()
      && String(log.serviceMonth || "").slice(0, 7) < month)
    .sort((left, right) => String(right.serviceMonth || "").localeCompare(String(left.serviceMonth || "")))[0] || null;
}

function monthlyCarryForwardEvidence({ enrollment, priorLog, month, now = new Date() } = {}) {
  const enrollmentSource = enrollment && String(enrollment.status || "").toLowerCase() === "active";
  const priorEvidence = priorLog?.billingReadinessEvidence || {};
  const durable = enrollmentSource
    ? { ...pickDurableEvidence(priorEvidence), ...pickDurableEvidence(enrollmentEvidence(enrollment)) }
    : pickDurableEvidence(priorEvidence);
  const source = enrollmentSource ? "care-program-enrollment" : priorLog ? "prior-month-care-log" : "";
  if (!source) return {
    monthlyRequirementsMet: false,
    interactiveCommunicationCompleted: false,
    deviceDataDays: 0,
    coverageStatus: "unknown",
    coverageCheckedAt: "",
    providerReviewStatus: "pending",
    providerReviewedAt: "",
    billingHoldStatus: "held",
    billingHoldReason: "Document this month's activities, communication, and applicable time or device requirements.",
  };
  return {
    ...durable,
    // These items can change or must be completed and reviewed for the new month.
    coverageStatus: "unknown",
    coverageCheckedAt: "",
    monthlyRequirementsMet: false,
    interactiveCommunicationCompleted: false,
    deviceDataDays: 0,
    providerReviewStatus: "pending",
    providerReviewedAt: "",
    billingHoldStatus: "held",
    billingHoldReason: "New service month: document activities, communication, and applicable time or device requirements.",
    carryForwardSource: source,
    carryForwardSourceMonth: enrollmentSource
      ? String(enrollment.updatedAt || "").slice(0, 7)
      : String(priorLog.serviceMonth || "").slice(0, 7),
    carryForwardAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    carryForwardFields: Object.keys(durable).join(", "),
    serviceMonthPrepared: month,
  };
}

function carriedNextFollowUp(enrollment, priorLog, serviceMonth) {
  const candidates = [enrollment?.assignment?.nextContact, priorLog?.nextFollowUp].map(dateOnly).filter(Boolean);
  return candidates.find((value) => value >= serviceMonth) || "";
}

module.exports = {
  DURABLE_EVIDENCE_FIELDS,
  carriedNextFollowUp,
  enrollmentEvidence,
  latestPriorMonthlyLog,
  monthlyCarryForwardEvidence,
  pickDurableEvidence,
};
