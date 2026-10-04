export const COVERAGE_ORDERS = ["primary", "secondary", "other"];

export const INSURANCE_TYPES = [
  "",
  "original-medicare",
  "medicare-advantage",
  "medicaid-mco",
  "commercial",
  "medicare-supplement",
  "tricare",
  "behavioral-health",
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
  "behavioral-health": "Behavioral health carve-out",
  "self-pay": "Self-pay",
  other: "Other",
};

// Payer names observed in the three Charm insurance reports are kept separate
// from their business classification. Entries with a blank insuranceType are
// intentionally ambiguous carrier-only names and require human review.
export const PAYER_DIRECTORY = [
  { name: "Medicare", insuranceType: "original-medicare" },
  { name: "MD MEDICARE", insuranceType: "original-medicare" },
  { name: "Medicare Part B of Maryland", insuranceType: "original-medicare" },

  { name: "Alterwood Advantage", insuranceType: "medicare-advantage" },
  { name: "CareFirst Medicare Advantage", insuranceType: "medicare-advantage" },
  { name: "CIGNA HealthSpring", insuranceType: "medicare-advantage", aliases: ["CIGNA HealthSprings", "OSNA Cigna Medicare"] },
  { name: "UnitedHealthcare Medicare Advantage", insuranceType: "medicare-advantage" },
  { name: "UnitedHealthcare Dual Complete", insuranceType: "medicare-advantage", aliases: ["UnitedHealthcare Community Plan / UnitedHealthcare Dual Complete"] },
  { name: "Aetna Medicare Advantage", insuranceType: "medicare-advantage" },
  { name: "Humana Medicare Advantage", insuranceType: "medicare-advantage" },

  { name: "Maryland Medicaid", insuranceType: "medicaid-mco", aliases: ["Medicaid of Maryland"] },
  { name: "Medicaid", insuranceType: "medicaid-mco" },
  { name: "Aetna Better Health of Maryland", insuranceType: "medicaid-mco", aliases: ["Aetna Better health"] },
  { name: "CareFirst Community Health Plan Maryland", insuranceType: "medicaid-mco", aliases: ["CareFirst Community", "Blue Choice Medicaid", "Carefirst community health", "Carefirst community health plan", "Carefirst Community Partner", "Carefirst Community partners", "Carefirst Community Plan"] },
  { name: "JAI Medical Systems", insuranceType: "medicaid-mco", aliases: ["Jai", "JAI MEDICAL"] },
  { name: "Kaiser Permanente Maryland HealthChoice", insuranceType: "medicaid-mco" },
  { name: "Maryland Physicians Care", insuranceType: "medicaid-mco", aliases: ["MAryland Phsycians care", "maryland Phycisians Care", "Maryland Physcians care", "Maryland Physiocians Care", "Marylnd Physicians Care", "Md physicians care"] },
  { name: "MedStar Family Choice", insuranceType: "medicaid-mco", aliases: ["Medstar Family Choice Maryland Healthchoice"] },
  { name: "Priority Partners", insuranceType: "medicaid-mco", aliases: ["Priority Partenrs"] },
  { name: "UnitedHealthcare Community Plan", insuranceType: "medicaid-mco", aliases: ["United Health Care Community", "United Health Care Community Plan", "United Healthcare community plan", "UnitedHealthcare Community Plan / CA, DC,  DE, FL, GA, HI, IA, KY, LA, MA, MD, MS, NC, NE, NM, NY, OH, OK, PA, RI, TX, VA, WA, WI"] },
  { name: "Wellpoint Maryland", insuranceType: "medicaid-mco", aliases: ["Wellpoint", "Wellpoint MD Inc", "We’ll point", "Amerigroup - Maryland and District of Columbia", "Amerigroup MD"] },
  { name: "Amerigroup of Iowa", insuranceType: "medicaid-mco" },

  { name: "AARP Medicare Supplement Plans insured by UnitedHealthcare Insurance Company", insuranceType: "medicare-supplement" },
  { name: "Mutual of Omaha Medicare Supplement", insuranceType: "medicare-supplement" },

  { name: "TRICARE East", insuranceType: "tricare" },
  { name: "TRICARE West", insuranceType: "tricare", aliases: ["TRICARE West / UnitedHealthcare Military & Veterans", "TRICARE West / UnitedHealthcare Military & Veterans (formerly TriWest)"] },
  { name: "TRICARE For Life", insuranceType: "tricare", aliases: ["Tricare for Life (All Regions 1-12)"] },
  { name: "Johns Hopkins US Family Health Plan", insuranceType: "tricare", aliases: ["Johns Hopkins (USFHP)", "Johns Hopkins (USFHP) (New submitter should send in their Billing NPI & Rendering servicing NPI)"] },

  { name: "Carelon Behavioral Health Maryland", insuranceType: "behavioral-health" },
  { name: "Optum Maryland Behavioral Health", insuranceType: "behavioral-health" },
  { name: "OptumHealth Behavioral Solutions", insuranceType: "behavioral-health", aliases: ["OptumHealth (OptumHealth Behavior Solutions)", "United Health Group Optum Health Behavioral Health"] },

  { name: "CareFirst BlueCross BlueShield", insuranceType: "commercial", aliases: ["CareFirst BCBS", "CareFirst Blue Cross Blue Shield", "CareFirst Administrators", "CareFirst BCBS - DC, National Capital Area", "Carefirst BCBS Maryland", "Carefirst Blue Cross Blue Shield District of Columbia"] },
  { name: "Aetna Commercial", insuranceType: "commercial", aliases: ["Aetna Health Plan - PPO", "Aetna Select Access", "Aetna healthfund", "Aetna select open access"] },
  { name: "Cigna Commercial", insuranceType: "commercial", aliases: ["CIGNA - PPO", "CIGNA Health Plan - HMO"] },
  { name: "UnitedHealthcare Commercial", insuranceType: "commercial" },
  { name: "UnitedHealthcare Choice Plus", insuranceType: "commercial", aliases: ["United Healthcare Choice Plus", "United Healthone"] },
  { name: "UMR", insuranceType: "commercial" },
  { name: "Surest", insuranceType: "commercial" },
  { name: "Freedom Life Insurance Company", insuranceType: "commercial" },
  { name: "Johns Hopkins Employer Health Programs", insuranceType: "commercial", aliases: ["Johns Hopkins EHP", "Johns Hopkins PPO Plan"] },
  { name: "Geisinger Health Plan", insuranceType: "commercial", aliases: ["Geisinger"] },
  { name: "Highmark Blue Cross Blue Shield", insuranceType: "commercial", aliases: ["Highmark BCBSD Health Options."] },
  { name: "Independence Blue Cross", insuranceType: "commercial", aliases: ["Independence", "Independent BLC of PA"] },
  { name: "AmeriHealth", insuranceType: "commercial", aliases: ["AmeriHealth Administrators"] },
  { name: "Anthem Blue Cross Blue Shield", insuranceType: "commercial", aliases: ["Anthem BCBS Virginia"] },
  { name: "Blue Cross Blue Shield commercial plan", insuranceType: "commercial", aliases: ["Blue Cross  Blue shield Alabama", "Blue cross blue sh", "Blue cross blue sheild", "Blue cross blue shield", "Blue Cross Blue Shield Of Texas", "Blue Shield of Maryland", "Blue Shield of Tennessee", "Horizon Blue Cross Blue Shield of New Jersey"] },
  { name: "NCAS", insuranceType: "commercial", aliases: ["NCAS - Charlotte, VA"] },

  { name: "Self-pay", insuranceType: "self-pay" },
  { name: "Other", insuranceType: "other" },

  { name: "Aetna", insuranceType: "" },
  { name: "Aetna Affordable Health Choices (SM)", insuranceType: "" },
  { name: "AmeriGroup", insuranceType: "" },
  { name: "Cigna", insuranceType: "" },
  { name: "Humana", insuranceType: "", aliases: ["HUMANA, Claims only"] },
  { name: "John Hopkins Healthcare (EHP/PP)", insuranceType: "" },
  { name: "Kaiser Permanente", insuranceType: "", aliases: ["Kaiser Foundation Health Plan of the Mid-Atlantic"] },
  { name: "Mutual of Omaha Insurance Company", insuranceType: "" },
  { name: "UnitedHealthcare", insuranceType: "", aliases: ["United Healthcare", "United Health Care", "United Health", "UHC"] },
  { name: "UnitedHealth Group Optum", insuranceType: "", aliases: ["United Health Group", "United Health group Optum", "United Healthgroup Optum"] },
  { name: "Riverside Health, Inc", insuranceType: "" },
];

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
const payerKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const PAYER_DIRECTORY_INDEX = new Map(PAYER_DIRECTORY.flatMap((entry) => [entry.name, ...(entry.aliases || [])]
  .map((name) => [payerKey(name), entry])));

export function payerDirectoryEntry(value) {
  return PAYER_DIRECTORY_INDEX.get(payerKey(value)) || null;
}

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
  const directoryEntry = payerDirectoryEntry(label);
  if (directoryEntry) return directoryEntry.insuranceType;
  if (/medicare advantage|dual complete|healthspring|\bpart\s*c\b|\bma\s+plan\b|alterwood advantage/.test(label)) return "medicare-advantage";
  if (/original medicare|\bmedicare\b|\bpart\s*[ab]\b/.test(label)) return "original-medicare";
  if (/medicaid|healthchoice|community plan|maryland physicians care|better health|priority partners|jai medical|wellpoint|medstar family choice|amerigroup\s*(?:md|of iowa|-\s*maryland)/.test(label)) return "medicaid-mco";
  if (/tricare|us family health plan|\busfhp\b/.test(label)) return "tricare";
  if (/carelon behavioral|optum.*behavior/.test(label)) return "behavioral-health";
  if (/medigap|medicare supplement/.test(label)) return "medicare-supplement";
  if (/self[ -]?pay/.test(label)) return "self-pay";
  if (/commercial|choice plus|\bppo\b|\bhmo\b|employer health|\behp\b|\bumr\b|surest|freedom life|carefirst|blue\s*(?:cross|shield|choice)|highmark|horizon blue|independence|amerihealth|anthem|geisinger|\bncas\b|healthfund|select access|\bfep\b|healthone/.test(label)) return "commercial";
  return "";
}

export function normalizeCoverageRecord(record = {}, forcedOrder = "") {
  const coverageOrder = clean(forcedOrder || record.coverageOrder || record.order || record.priority).toLowerCase();
  const normalizedOrder = COVERAGE_ORDERS.includes(coverageOrder) ? coverageOrder : "other";
  const payerName = clean(record.payerName || record.payer || record.insurance || record.primaryPayer);
  const planName = clean(record.planName || record.insurancePlanName);
  const inferredType = payerDirectoryEntry(planName)?.insuranceType
    || payerDirectoryEntry(payerName)?.insuranceType
    || inferInsuranceType(`${payerName} ${planName}`);
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
    "behavioral-health": "Behavioral health carve-out",
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
  for (const record of records) {
    if (!record.insuranceType) flags.push(`${record.coverageOrder[0].toUpperCase()}${record.coverageOrder.slice(1)} insurance is not classified`);
  }
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
