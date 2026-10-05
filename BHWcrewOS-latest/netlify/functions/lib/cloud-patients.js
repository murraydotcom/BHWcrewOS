const crypto = require("crypto");

const apiBase = () => String(process.env.RCM_CLOUD_API_URL || "").replace(/\/$/, "");

const MBI_PATTERN = /^[1-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y0-9][0-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y0-9][0-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y][0-9][0-9]$/;
const normalizeMedicareMbi = (value) => String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const isValidMedicareMbi = (value) => MBI_PATTERN.test(normalizeMedicareMbi(value));

function primaryCoverageForPatient(patient = {}) {
  return (Array.isArray(patient.coverageRecords) ? patient.coverageRecords : [])
    .find((coverage) => String(coverage?.coverageOrder || coverage?.category || coverage?.order || coverage?.priority || "").trim().toLowerCase() === "primary");
}

function isOriginalMedicareCoverage(record = {}) {
  const insuranceType = String(record.insuranceType || "").trim().toLowerCase();
  if (insuranceType) return insuranceType === "original-medicare";
  const label = [record.primaryPayer, record.payer, record.payerName, record.insurancePlanName, record.planName, record.insurance]
    .filter(Boolean).join(" ").toLowerCase();
  if (/medicare advantage|dual complete|healthspring|alterwood advantage|medigap|medicare supplement|part\s*c|\bma\s+plan\b/.test(label)) return false;
  return /medicare|\bcms\b|part\s*[ab]\b/.test(label);
}

function isMedicareCoverage(record = {}) {
  const insuranceType = String(record.insuranceType || "").trim().toLowerCase();
  if (insuranceType) return ["original-medicare", "medicare-advantage"].includes(insuranceType);
  const label = [record.primaryPayer, record.payer, record.payerName, record.insurancePlanName, record.planName, record.insurance]
    .filter(Boolean).join(" ").toLowerCase();
  if (/medigap|medicare supplement/.test(label)) return false;
  return /medicare|\bcms\b|\bqmb\b|dual complete|healthspring|alterwood advantage|part\s*[abc]\b/.test(label);
}

function resolveMedicareCoverageOrder(patient = {}) {
  const coverages = Array.isArray(patient.coverageRecords) ? patient.coverageRecords : [];
  const withNestedMbi = coverages.find((coverage) => isMedicareCoverage(coverage) && isValidMedicareMbi(coverage?.medicareMbi));
  const coverage = withNestedMbi || coverages.find(isMedicareCoverage);
  if (coverage) {
    const order = String(coverage.coverageOrder || coverage.category || coverage.order || "").trim().toLowerCase();
    return ({ additional: "other", tertiary: "other" })[order] || (["primary", "secondary", "other"].includes(order) ? order : "unknown");
  }
  const primary = primaryCoverageForPatient(patient);
  if (isMedicareCoverage(primary || patient)) return "primary";
  return resolveMedicareMbi(patient) ? "unknown" : "";
}

function resolveMedicareMbi(patient = {}) {
  const explicit = normalizeMedicareMbi(patient.medicareMbi);
  if (isValidMedicareMbi(explicit)) return explicit;

  const coverages = Array.isArray(patient.coverageRecords) ? patient.coverageRecords : [];
  for (const coverage of coverages) {
    const nested = normalizeMedicareMbi(coverage?.medicareMbi);
    if (isValidMedicareMbi(nested)) return nested;
  }

  const primary = primaryCoverageForPatient(patient);
  const memberId = normalizeMedicareMbi(primary ? primary.memberId : patient.memberId || patient.member);
  if (isOriginalMedicareCoverage(primary || patient) && isValidMedicareMbi(memberId)) return memberId;
  for (const coverage of coverages) {
    const nestedMemberId = normalizeMedicareMbi(coverage?.memberId);
    if (isOriginalMedicareCoverage(coverage) && isValidMedicareMbi(nestedMemberId)) return nestedMemberId;
  }
  return "";
}

function cloudToken(actor = {}) {
  const secret = process.env.CREWHQ_CLOUD_TOKEN_SECRET;
  if (!secret) throw new Error("CREWHQ_CLOUD_TOKEN_SECRET is not configured");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: `crew:${actor.staffId || actor.sub || "server"}`,
    staffId: actor.staffId || actor.sub || "server",
    name: actor.name || "CrewOS server",
    role: actor.role || "operations",
    access: actor.access || "",
    ...(actor.scope ? { scope: actor.scope } : {}),
    ...(actor.authTime ? { authTime: Number(actor.authTime) } : {}),
    iss: "bhw-crewhq",
    aud: "bhw-rcm-cloud",
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function cloudRequest(path, { actor, method = "GET", body } = {}) {
  const base = apiBase();
  if (!base) throw new Error("RCM_CLOUD_API_URL is not configured");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cloudToken(actor)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Google Cloud patient registry returned ${response.status}`);
    error.status = response.status;
    error.details = data;
    if (Array.isArray(data.gaps)) error.gaps = data.gaps;
    throw error;
  }
  return data;
}

const SUFFIXES = new Map([
  ["jr", "Jr"], ["junior", "Jr"], ["sr", "Sr"], ["senior", "Sr"],
  ["ii", "II"], ["2nd", "II"], ["iii", "III"], ["3rd", "III"],
  ["iv", "IV"], ["4th", "IV"], ["v", "V"], ["5th", "V"],
]);

const cleanSuffix = (value) => SUFFIXES.get(String(value || "").trim().toLowerCase().replace(/[.,]/g, "")) || "";

function parsePatientName(value, explicitSuffix = "") {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const typedSuffix = cleanSuffix(explicitSuffix);
  const trailingSuffix = parts.length > 1 ? cleanSuffix(parts.at(-1)) : "";
  const nameSuffix = typedSuffix || trailingSuffix;
  if (trailingSuffix) parts.pop();
  return {
    legalFirstName: parts.slice(0, -1).join(" ") || parts[0] || "",
    legalLastName: parts.length > 1 ? parts.at(-1) : "Unknown",
    nameSuffix,
    name: [...parts, nameSuffix].filter(Boolean).join(" ").trim(),
  };
}

const fullName = (p) => [p.legalFirstName, p.middleName, p.legalLastName, p.nameSuffix].filter(Boolean).join(" ").trim();
function legacyPatient(p) {
  const {
    source: _legacySource,
    sourceRelations: _legacySourceRelations,
    sourceRecordId: _legacySourceRecordId,
    sourceUrl: _legacySourceUrl,
    patientPageUrl: _legacyPatientPageUrl,
    ...cloudPatient
  } = p || {};
  const programs = Array.isArray(p.programEnrollment) ? p.programEnrollment : [];
  const snapshot = p.clinicalSnapshot || {};
  const status = p.patientStatus || "";
  const medicareMbi = resolveMedicareMbi(p);
  const medicareCoverageOrder = resolveMedicareCoverageOrder(p);
  const primary = primaryCoverageForPatient(p);
  const primaryPayer = primary?.payerName || primary?.payer || p.primaryPayer || p.payerName || "";
  const memberId = primary ? primary.memberId || "" : p.memberId || "";
  const insurancePlanName = primary ? primary.planName || "" : p.insurancePlanName || "";
  return {
    ...cloudPatient,
    primaryPayer,
    memberId,
    insurancePlanName,
    coverageStatus: primary ? primary.coverageStatus || primary.status || "unknown" : p.coverageStatus,
    id: p.bhwPatientId,
    bhwId: p.bhwPatientId,
    ctl: p.bhwPatientId,
    name: fullName(p),
    dob: p.dateOfBirth || "",
    chart: p.mrn || "",
    mrn: p.mrn || p.bhwPatientId,
    payer: primaryPayer,
    mco: p.medicaidMco || "",
    insurance: insurancePlanName || primaryPayer,
    member: memberId,
    medicareMbi,
    hasMbi: Boolean(medicareMbi),
    medicareCoverageOrder,
    program: programs.join(" · "),
    programs,
    careProgramEnrollmentIds: Array.isArray(p.sourceRelations?.careProgramEnrollments) ? p.sourceRelations.careProgramEnrollments : [],
    status,
    selectable: !["deceased", "transferred"].includes(String(status).toLowerCase()),
    snapshot: snapshot.updatedAt || "",
    allergies: snapshot.allergies || p.allergies || "",
    meds: snapshot.medications || p.medications || "",
    lastVisit: p.preventiveCare?.lastVisitDate || "",
    nextVisit: p.preventiveCare?.nextVisitDate || "",
    icds: Array.isArray(snapshot.icds) ? snapshot.icds : [],
  };
}

async function listCloudPatients(actor) {
  const data = await cloudRequest("/v1/patients", { actor });
  return (Array.isArray(data.patients) ? data.patients : []).map(legacyPatient);
}

async function findCloudPatient(id, actor) {
  const value = String(id || "").trim();
  const patients = await listCloudPatients(actor);
  return patients.find((p) => p.bhwPatientId === value) || null;
}

function searchCloudPatients(patients, query, limit = 25) {
  const q = String(query || "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return patients.filter((p) => {
    const haystack = [p.name, p.bhwPatientId, p.mrn, p.email, p.memberId].join(" ").toLowerCase();
    if (haystack.includes(q)) return true;
    return qDigits.length >= 7 && String(p.phone || "").replace(/\D/g, "").endsWith(qDigits.slice(-10));
  }).slice(0, limit);
}

module.exports = {
  cloudRequest,
  legacyPatient,
  listCloudPatients,
  findCloudPatient,
  parsePatientName,
  searchCloudPatients,
  normalizeMedicareMbi,
  isValidMedicareMbi,
  resolveMedicareMbi,
  resolveMedicareCoverageOrder,
  isMedicareCoverage,
  primaryCoverageForPatient,
};
