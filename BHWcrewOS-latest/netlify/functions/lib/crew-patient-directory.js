const normalizeName = (value) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");
const normalizeId = (value) => String(value || "").trim().toUpperCase();
const identityKey = (patient) => patient?.name && patient?.dob
  ? `${normalizeName(patient.name)}|${patient.dob}`
  : "";

function insuranceCategory(patient) {
  const value = `${patient?.primaryPayer || patient?.payer || ""} ${patient?.insurancePlanName || patient?.insurance || ""}`.toLowerCase();
  if (/dual|qmb|medicare.*medicaid|medicaid.*medicare/.test(value)) return "Medicare + Medicaid";
  if (/cigna/.test(value)) return "Cigna";
  if (/aetna/.test(value)) return "Aetna";
  if (/united|uhc|optum/.test(value)) return "UnitedHealthcare";
  if (/tricare/.test(value)) return "Tricare";
  if (/hopkins|ehp|priority partners/.test(value)) return "Johns Hopkins EHP";
  if (/carefirst|bcbs|blue\s*cross|bluechoice/.test(value)) return "CareFirst BCBS";
  if (/medicaid|physicians care|amerigroup|molina/.test(value)) return "Medicaid";
  if (/medicare/.test(value)) return "Medicare";
  if (/self.?pay|cash/.test(value)) return "Self-Pay";
  return patient?.insurance || patient?.insurancePlanName || patient?.primaryPayer || "";
}

function label(patient) {
  return `${patient.name || "Unknown patient"} (${patient.bhwId || "ID unavailable"})`;
}

function fallbackIndexDirectory(indexPatients) {
  const patients = indexPatients.map((patient) => ({
    ...patient,
    bhwId: patient.masterId || patient.indexBhwId || "",
    relationId: patient.id,
    registrySource: "legacy-index",
    registryLinked: true,
    selectable: true,
  }));
  return {
    patients,
    patientLabel: Object.fromEntries(patients.map((patient) => [patient.id, label(patient)])),
  };
}

function buildPatientDirectory(indexPatients, cloudPatients) {
  const indexes = Array.isArray(indexPatients) ? indexPatients : [];
  const cloud = (Array.isArray(cloudPatients) ? cloudPatients : []).filter((patient) => patient?.bhwPatientId && patient?.name);
  const cloudIdentityCounts = new Map();
  for (const patient of cloud) {
    const key = identityKey(patient);
    if (key) cloudIdentityCounts.set(key, (cloudIdentityCounts.get(key) || 0) + 1);
  }

  const patientLabel = {};
  for (const patient of indexes) {
    patientLabel[patient.id] = label({ ...patient, bhwId: patient.masterId || patient.indexBhwId });
  }

  const patients = cloud.map((patient) => {
    const bhwId = normalizeId(patient.bhwPatientId);
    const exactIdMatches = indexes.filter((index) => normalizeId(index.masterId) === bhwId);
    const key = identityKey(patient);
    const blankIdentityMatches = key && cloudIdentityCounts.get(key) === 1
      ? indexes.filter((index) => !normalizeId(index.masterId) && identityKey(index) === key)
      : [];
    const relation = exactIdMatches.length === 1
      ? exactIdMatches[0]
      : (exactIdMatches.length === 0 && blankIdentityMatches.length === 1 ? blankIdentityMatches[0] : null);
    const status = String(patient.patientStatus || patient.status || "active").toLowerCase();
    const directoryPatient = {
      id: relation?.id || bhwId,
      relationId: relation?.id || "",
      bhwId,
      name: patient.name,
      dob: patient.dob || patient.dateOfBirth || "",
      chart: patient.mrn || patient.chart || "",
      insurance: insuranceCategory(patient),
      insuranceLabel: patient.insurance || patient.insurancePlanName || patient.primaryPayer || "",
      memberId: patient.memberId || patient.member || "",
      hasMbi: !!patient.medicareMbi,
      email: patient.email || "",
      guardianEmail: patient.guardianEmail || "",
      status,
      registrySource: "cloud",
      registryLinked: !!relation,
      linkNeedsReview: exactIdMatches.length > 1 || blankIdentityMatches.length > 1,
      selectable: !["deceased", "transferred"].includes(status),
    };
    const display = label(directoryPatient);
    patientLabel[bhwId] = display;
    patientLabel[directoryPatient.id] = display;
    if (relation?.id) patientLabel[relation.id] = display;
    return directoryPatient;
  }).sort((left, right) => left.name.localeCompare(right.name));

  return { patients, patientLabel };
}

module.exports = { buildPatientDirectory, fallbackIndexDirectory, insuranceCategory, normalizeName };
