const normalizeId = (value) => String(value || "").trim().toUpperCase();

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

function buildPatientDirectory(cloudPatients) {
  const patients = (Array.isArray(cloudPatients) ? cloudPatients : [])
    .filter((patient) => patient?.bhwPatientId && patient?.name)
    .map((patient) => {
      const bhwId = normalizeId(patient.bhwPatientId);
      const status = String(patient.patientStatus || patient.status || "active").toLowerCase();
      return {
        id: bhwId,
        bhwId,
        name: patient.name,
        dob: patient.dob || patient.dateOfBirth || "",
        chart: patient.mrn || patient.chart || "",
        insurance: insuranceCategory(patient),
        insuranceLabel: patient.insurance || patient.insurancePlanName || patient.primaryPayer || "",
        memberId: patient.memberId || patient.member || "",
        hasMbi: Boolean(patient.medicareMbi),
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
