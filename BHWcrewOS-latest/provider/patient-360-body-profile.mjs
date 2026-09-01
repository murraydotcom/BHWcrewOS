export const BODY_PROFILES = Object.freeze([
  Object.freeze({ sex: "male", label: "Male", asset: "patient-360-body-neutral.png" }),
  Object.freeze({ sex: "female", label: "Female", asset: "patient-360-body-curved.png" }),
]);

function extensionValue(extension = {}) {
  return extension.valueString
    || extension.valueCode
    || extension.valueCodeableConcept?.text
    || extension.valueCodeableConcept?.coding?.[0]?.display
    || extension.valueCodeableConcept?.coding?.[0]?.code
    || "";
}

export function patientPronouns(patient = {}) {
  const pronounExtension = patient.extension?.find((item) => String(item?.url || "").toLowerCase().includes("pronoun"));
  return String(
    patient.pronouns
    || patient.preferredPronouns
    || patient.preferredPronoun
    || patient.pronoun
    || extensionValue(pronounExtension),
  ).trim().toLowerCase();
}

export function patientBodyProfile(patient = {}) {
  const pronouns = patientPronouns(patient).replace(/\s+/g, "");
  if (pronouns.includes("they/them") || pronouns.includes("they-them")) return null;

  const birthSexExtension = patient.extension?.find((item) => String(item?.url || "").toLowerCase().includes("birthsex"));
  const recordedSex = String(
    patient.sexAtBirth
    || patient.birthSex
    || extensionValue(birthSexExtension)
    || patient.gender
    || "",
  ).trim().toLowerCase();

  if (["f", "female"].includes(recordedSex)) return BODY_PROFILES.find((profile) => profile.sex === "female");
  if (["m", "male"].includes(recordedSex)) return BODY_PROFILES.find((profile) => profile.sex === "male");
  return null;
}

