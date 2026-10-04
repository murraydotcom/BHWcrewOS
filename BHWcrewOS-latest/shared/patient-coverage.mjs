export const COVERAGE_ORDERS = ["primary", "secondary", "other"];

export const INSURANCE_TYPES = [
  "",
  "original-medicare",
  "medicare-advantage",
  "medicaid-mco",
  "commercial",
  "medicare-supplement",
  "tricare",
  "self-pay",
  "other",
];

export const COVERAGE_STATUSES = ["unknown", "verified", "pending", "needs-review", "inactive"];

export const MSP_REASONS = ["", "12", "13", "14", "15", "16", "41", "42", "43", "47"];

export const MSP_REASON_LABELS = {
  "": "Not yet verified",
  "12": "12 — Working aged beneficiary or spouse; employer group health plan",
  "13": "13 — End-stage renal disease coordination period; employer group health plan",
  "14": "14 — No-fault insurance, including auto, is primary",
  "15": "15 — Workers’ compensation is primary",
  "16": "16 — Public Health Service or other federal agency is primary",
  "41": "41 — Black Lung program is primary",
  "42": "42 — Veterans’ Administration is primary",
  "43": "43 — Disabled beneficiary under 65; large group health plan is primary",
  "47": "47 — Other liability insurance is primary",
};

export const INSURANCE_TYPE_LABELS = {
  "": "Not classified",
  "original-medicare": "Original Medicare",
  "medicare-advantage": "Medicare Advantage",
  "medicaid-mco": "Medicaid / MCO",
  commercial: "Commercial",
  "medicare-supplement": "Medicare supplement / Medigap",
  tricare: "TRICARE",
  "self-pay": "Self-pay",
  other: "Other",
};

export const MBI_PATTERN = /^[1-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y0-9][0-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y0-9][0-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y][0-9][0-9]$/;

const COVERAGE_FIELDS = [
  "coverageOrder",
  "insuranceType",
  "payerName",
  "planName",
  "memberId",
  "groupNumber",
  "payerId",
  "effectiveFrom",
  "effectiveTo",
  "coverageStatus",
  "medicareMbi",
  "medicareSecondaryReason",
];

const clean = (value) => String(value ?? "").trim();

export function normalizeMedicareMbi(value) {
  return clean(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isValidMedicareMbi(value) {
  return MBI_PATTERN.test(normalizeMedicareMbi(value));
}

export function isMedicareType(value) {
  return ["original-medicare", "medicare-advantage"].includes(clean(value));
}

export function inferInsuranceType(value) {
  const label = clean(value).toLowerCase();
  if (!label) return "";
  if (/medicare advantage|\bpart\s*c\b|\bma\s+plan\b|alterwood advantage/.test(label)) return "medicare-advantage";
  if (/original medicare|\bmedicare\b|\bpart\s*[ab]\b/.test(label)) return "original-medicare";
  if (/medicaid|community plan|maryland physicians care|better health/.test(label)) return "medicaid-mco";
  if (/tricare/.test(label)) return "tricare";
  if (/self[ -]?pay/.test(label)) return "self-pay";
  if (/carefirst|blue cross|blue shield|commercial|aetna|cigna|unitedhealthcare|uhc/.test(label)) return "commercial";
  return "other";
}

export function normalizeCoverageRecord(record = {}, forcedOrder = "") {
  const coverageOrder = clean(forcedOrder || record.coverageOrder || record.order || record.priority).toLowerCase();
  const normalizedOrder = COVERAGE_ORDERS.includes(coverageOrder) ? coverageOrder : "other";
  const payerName = clean(record.payerName || record.payer || record.insurance || record.primaryPayer);
  const planName = clean(record.planName || record.insurancePlanName);
  const inferredType = inferInsuranceType(`${payerName} ${planName}`);
  const statedInsuranceType = clean(record.insuranceType);
  const insuranceType = statedInsuranceType && INSURANCE_TYPES.includes(statedInsuranceType)
    ? statedInsuranceType
    : inferredType;
  const coverageStatus = COVERAGE_STATUSES.includes(clean(record.coverageStatus))
    ? clean(record.coverageStatus)
    : "unknown";
  const medicareSecondaryReason = MSP_REASONS.includes(clean(record.medicareSecondaryReason))
    ? clean(record.medicareSecondaryReason)
    : "";
  return {
    coverageOrder: normalizedOrder,
    insuranceType,
    payerName,
    planName,
    memberId: clean(record.memberId || record.member),
    groupNumber: clean(record.groupNumber),
    payerId: clean(record.payerId),
    effectiveFrom: clean(record.effectiveFrom),
    effectiveTo: clean(record.effectiveTo),
    coverageStatus,
    medicareMbi: normalizeMedicareMbi(record.medicareMbi),
    medicareSecondaryReason,
  };
}

export function hasCoverageIdentity(record = {}) {
  return Boolean([
    record.insuranceType,
    record.payerName,
    record.planName,
    record.memberId,
    record.groupNumber,
    record.payerId,
    record.effectiveFrom,
    record.effectiveTo,
  ].some((value) => clean(value)));
}

export function coverageSlotsForPatient(patient = {}) {
  const slots = Object.fromEntries(COVERAGE_ORDERS.map((order) => [order, normalizeCoverageRecord({}, order)]));
  const records = Array.isArray(patient.coverageRecords) ? patient.coverageRecords : [];
  for (const source of records) {
    const normalized = normalizeCoverageRecord(source);
    if (!hasCoverageIdentity(slots[normalized.coverageOrder])) slots[normalized.coverageOrder] = normalized;
  }
  if (!hasCoverageIdentity(slots.primary) && [patient.primaryPayer, patient.memberId, patient.coverageStatus].some((value) => clean(value))) {
    slots.primary = normalizeCoverageRecord({
      coverageOrder: "primary",
      payerName: patient.primaryPayer,
      memberId: patient.memberId,
      coverageStatus: patient.coverageStatus,
    }, "primary");
  }
  return slots;
}

export function medicareMbiForPatient(patient = {}) {
  const explicit = normalizeMedicareMbi(patient.medicareMbi);
  if (explicit) return explicit;
  const slots = coverageSlotsForPatient(patient);
  for (const record of Object.values(slots)) {
    const nested = normalizeMedicareMbi(record.medicareMbi);
    if (nested) return nested;
  }
  for (const record of Object.values(slots)) {
    if (record.insuranceType === "original-medicare" && isValidMedicareMbi(record.memberId)) {
      return normalizeMedicareMbi(record.memberId);
    }
  }
  return "";
}

function legacyPayerName(primary = {}) {
  if (clean(primary.payerName)) return clean(primary.payerName);
  if (clean(primary.planName)) return clean(primary.planName);
  return ({
    "original-medicare": "Medicare",
    "medicare-advantage": "Medicare Advantage",
    "medicaid-mco": "Medicaid / MCO",
    commercial: "Commercial",
    "medicare-supplement": "Medicare supplement",
    tricare: "TRICARE",
    "self-pay": "Self-pay",
    other: "Other",
  })[primary.insuranceType] || "";
}

export function insuranceStorageForPatient(patient = {}, slotInput = null, mbiInput = undefined) {
  const slots = slotInput || coverageSlotsForPatient(patient);
  const medicareMbi = normalizeMedicareMbi(mbiInput === undefined ? medicareMbiForPatient(patient) : mbiInput);
  const coverageRecords = COVERAGE_ORDERS
    .map((order) => normalizeCoverageRecord(slots[order] || {}, order))
    .filter(hasCoverageIdentity)
    .map((record) => isMedicareType(record.insuranceType) && medicareMbi
      ? { ...record, medicareMbi }
      : record);
  const primary = coverageRecords.find((record) => record.coverageOrder === "primary") || normalizeCoverageRecord({}, "primary");
  return {
    medicareMbi,
    coverageRecords,
    primaryPayer: legacyPayerName(primary),
    memberId: primary.memberId,
    coverageStatus: hasCoverageIdentity(primary) ? primary.coverageStatus : "unknown",
  };
}

export function insuranceValidationMessage(patient = {}) {
  const mbi = normalizeMedicareMbi(patient.medicareMbi);
  if (mbi && !isValidMedicareMbi(mbi)) return "The Medicare Beneficiary Identifier must be a valid 11-character MBI. Do not enter a Medicare Advantage plan member ID in the MBI field.";
  const records = Array.isArray(patient.coverageRecords) ? patient.coverageRecords.map((record) => normalizeCoverageRecord(record)) : [];
  if (records.length > 3) return "This Registry editor supports one primary, one secondary, and one additional coverage record.";
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.coverageOrder)) return `Only one ${record.coverageOrder} coverage record can be saved in this Registry view.`;
    seen.add(record.coverageOrder);
    if (!INSURANCE_TYPES.includes(record.insuranceType)) return `Choose a valid insurance type for ${record.coverageOrder} coverage.`;
  }
  return "";
}

export function insuranceReviewFlags(patient = {}) {
  const slots = coverageSlotsForPatient(patient);
  const records = Object.values(slots).filter(hasCoverageIdentity);
  const flags = [];
  if (!hasCoverageIdentity(slots.primary)) flags.push("Primary insurance not recorded");
  if (records.some((record) => isMedicareType(record.insuranceType)) && !isValidMedicareMbi(medicareMbiForPatient(patient))) {
    flags.push("Medicare coverage present; MBI not verified");
  }
  if (isMedicareType(slots.secondary.insuranceType) && !slots.secondary.medicareSecondaryReason) {
    flags.push("Medicare is secondary; MSP reason not verified");
  }
  return flags;
}

export function sanitizeCoverageRecords(records) {
  if (!Array.isArray(records)) throw new Error("coverageRecords must be an array.");
  if (records.length > 3) throw new Error("Only primary, secondary, and additional coverage records are supported.");
  return records.map((record) => {
    const normalized = normalizeCoverageRecord(record);
    return Object.fromEntries(COVERAGE_FIELDS.map((field) => [field, normalized[field]]));
  }).filter(hasCoverageIdentity);
}
