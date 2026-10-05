const { resolveMedicareMbi, resolveMedicareCoverageOrder, isMedicareCoverage, primaryCoverageForPatient } = require("./cloud-patients");

const normalizeId = (value) => String(value || "").trim().toUpperCase();

function insuranceCategory(patient) {
  const records = Array.isArray(patient?.coverageRecords) ? patient.coverageRecords : [];
  if (records.some(isMedicareCoverage)) {
    const hasMedicaid = records.some((record) => record.insuranceType === "medicaid-mco"
      || (!record.insuranceType && /medicaid|healthchoice|community plan|physicians care|priority partners/i.test(`${record.payerName || record.payer || ""} ${record.planName || ""}`)));
    const dualPlan = records.some((record) => /dual complete|\bqmb\b|medicare.*medicaid|medicaid.*medicare/i.test(`${record.payerName || record.payer || ""} ${record.planName || ""}`));
    return hasMedicaid || dualPlan ? "Medicare + Medicaid" : "Medicare";
  }
  const primary = primaryCoverageForPatient(patient);
  const value = primary
    ? `${primary.payerName || primary.payer || ""} ${primary.planName || ""}`.toLowerCase()
    : `${patient?.primaryPayer || patient?.payer || ""} ${patient?.insurancePlanName || patient?.insurance || ""}`.toLowerCase();
  if (/dual|qmb|medicare.*medicaid|medicaid.*medicare/.test(value)) return "Medicare + Medicaid";
  // Keep the program classification ahead of the carrier name. A Registry row
  // such as "United Healthcare Medicare" or "Aetna Medicare Advantage" still
  // belongs in the shared Medicare prevention queue.
  if (!records.length && isMedicareCoverage(patient)) return "Medicare";
  if (/cigna/.test(value)) return "Cigna";
  if (/aetna/.test(value)) return "Aetna";
  if (/united|uhc|optum/.test(value)) return "UnitedHealthcare";
  if (/tricare/.test(value)) return "Tricare";
  if (/hopkins|ehp|priority partners/.test(value)) return "Johns Hopkins EHP";
  if (/carefirst|bcbs|blue\s*cross|bluechoice/.test(value)) return "CareFirst BCBS";
  if (/medicaid|physicians care|amerigroup|molina/.test(value)) return "Medicaid";
  if (/self.?pay|cash/.test(value)) return "Self-Pay";
  return patient?.insurance || patient?.insurancePlanName || patient?.primaryPayer || "";
}

function label(patient) {
  return `${patient.name || "Unknown patient"} (${patient.bhwId || "ID unavailable"})`;
}

function buildPatientDirectory(cloudPatients) {
  const patients = (Array.isArray(cloudPatients) ? cloudPatients : [])
    .filter((patient) => patient?.bhwPatientId && patient?.name)
    .map((patient) => {
      const bhwId = normalizeId(patient.bhwPatientId);
      const status = String(patient.patientStatus || patient.status || "active").toLowerCase();
      const primary = primaryCoverageForPatient(patient);
      return {
        id: bhwId,
        bhwId,
        name: patient.name,
        dob: patient.dob || patient.dateOfBirth || "",
        chart: patient.mrn || patient.chart || "",
        insurance: insuranceCategory(patient),
        insuranceLabel: primary ? primary.planName || primary.payerName || primary.payer || "" : patient.insurance || patient.insurancePlanName || patient.primaryPayer || "",
        memberId: primary ? primary.memberId || "" : patient.memberId || patient.member || "",
        hasMbi: Boolean(resolveMedicareMbi(patient)),
        medicareCoverageOrder: resolveMedicareCoverageOrder(patient),
        email: patient.email || "",
        guardianEmail: patient.guardianEmail || "",
        status,
        registrySource: "cloud",
        selectable: !["deceased", "transferred", "prospective"].includes(status),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    patients,
    patientLabel: Object.fromEntries(patients.map((patient) => [patient.id, label(patient)])),
  };
}

module.exports = { buildPatientDirectory, insuranceCategory };
