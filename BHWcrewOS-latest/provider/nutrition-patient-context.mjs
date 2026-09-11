const BHW_PATIENT_ID = /^BHW\d{4}$/;

export function normalizeBhwPatientId(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return BHW_PATIENT_ID.test(normalized) ? normalized : "";
}

function patientResource(healthRecord = {}) {
  return (healthRecord.fhir?.entry || [])
    .map((entry) => entry?.resource)
    .find((resource) => resource?.resourceType === "Patient") || null;
}

function patientDisplayName(resource = {}) {
  const name = resource.name?.[0] || {};
  const parts = [...(name.given || []), name.family, ...(name.suffix || [])]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.join(" ").replace(/\b(\w+)\s+\1\b/gi, "$1");
}

export function verifiedNutritionPatientContext(healthRecord, expectedPatientId) {
  const expected = normalizeBhwPatientId(expectedPatientId);
  if (!expected) throw new Error("Choose a patient from the Patient Registry before opening Nutrition Intelligence.");
  if (normalizeBhwPatientId(healthRecord?.bhwPatientId) !== expected) {
    throw new Error("Health Core returned a different patient context. Nutrition Intelligence remains locked.");
  }

  const resource = patientResource(healthRecord);
  const identifiers = (resource?.identifier || []).map((identifier) => normalizeBhwPatientId(identifier?.value)).filter(Boolean);
  if (normalizeBhwPatientId(resource?.id) !== expected || !identifiers.includes(expected)) {
    throw new Error("The Patient 360 identity could not be verified against the selected BHW Patient ID.");
  }

  const displayName = patientDisplayName(resource);
  if (!displayName) throw new Error("The selected Patient 360 record has no verified patient name.");
  return Object.freeze({
    bhwPatientId: expected,
    displayName,
    birthDate: String(resource.birthDate || "").trim(),
    synthetic: expected === "BHW0000",
  });
}
