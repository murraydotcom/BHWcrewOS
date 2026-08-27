import { medicationAction } from "./medication-prior-auth.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const CONTROLLED_TERMS = [
  "adderall", "alprazolam", "ambien", "amphetamine", "belbuca", "buprenorphine",
  "butrans", "chlordiazepoxide", "clonazepam", "codeine", "concerta", "dexedrine",
  "dexmethylphenidate", "dextroamphetamine", "diazepam", "fentanyl", "focalin",
  "hydrocodone", "klonopin", "lisdexamfetamine", "lorazepam", "methadone",
  "methylphenidate", "morphine", "norco", "oxycontin", "oxycodone", "percocet",
  "pregabalin", "ritalin", "suboxone", "temazepam", "tramadol", "valium",
  "vicodin", "vyvanse", "xanax", "zolpidem",
];

const CONTROLLED_PATTERN = new RegExp(`\\b(?:${CONTROLLED_TERMS.join("|")}|controlled\\s+substance)\\b`, "i");
const DOSE_PATTERN = /\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|tablet(?:s)?|capsule(?:s)?)(?:\s+(?:daily|nightly|weekly|bid|tid|qid|qhs|prn|every\s+\d+\s+hours?))?/i;

function uniqueText(values = []) {
  return [...new Set([].concat(values || []).map(clean).filter(Boolean))];
}

function sentences(noteText = "") {
  return String(noteText || "")
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean);
}

function matchingSentences(noteText, pattern, limit = 20) {
  return uniqueText(sentences(noteText).filter((sentence) => pattern.test(sentence))).slice(0, limit);
}

export function isControlledMedicationText(value = "") {
  return CONTROLLED_PATTERN.test(clean(value));
}

export function controlledMedicationName(value = "") {
  const text = clean(value);
  const match = text.match(CONTROLLED_PATTERN);
  if (!match) return "";
  return match[0].replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeMedication(value, index = 0) {
  const sourceText = clean(typeof value === "string" ? value : value?.sourceText || value?.name);
  const name = clean(typeof value === "object" ? value?.name : "") || controlledMedicationName(sourceText) || sourceText.slice(0, 120);
  const doseFrequency = clean(typeof value === "object" ? value?.doseFrequency : "") || clean(sourceText.match(DOSE_PATTERN)?.[0]);
  return {
    id: clean(typeof value === "object" ? value?.id : "") || `medication:${index + 1}`,
    name,
    doseFrequency,
    sourceText,
    action: clean(typeof value === "object" ? value?.action : "") || medicationAction(sourceText),
    controlled: typeof value === "object" && typeof value?.controlled === "boolean"
      ? value.controlled
      : isControlledMedicationText(`${name} ${sourceText}`),
  };
}

export function detectStructuredEncounter(noteText = "") {
  const note = String(noteText || "");
  const medicationPattern = /\b(?:start(?:ed)?|continue(?:d)?|increase(?:d)?|decrease(?:d)?|stop(?:ped)?|discontinue(?:d)?|prescrib(?:e|ed|ing)|medication|tablet|capsule|mcg|mg)\b/i;
  const medicationSentences = uniqueText(sentences(note).filter((sentence) => medicationPattern.test(sentence) || CONTROLLED_PATTERN.test(sentence))).slice(0, 20);
  return {
    medications: medicationSentences.map(normalizeMedication),
    orders: matchingSentences(note, /\b(?:order(?:ed)?|lab(?:s)?|cbc|cmp|a1c|imaging|x-?ray|mri|ct scan|ultrasound)\b/i),
    referrals: matchingSentences(note, /\b(?:refer(?:red|ral)?|consult(?:ation)?|specialist)\b/i),
    followUp: matchingSentences(note, /\b(?:follow[- ]?up|return\s+(?:in|to)|rtc\b|recheck)\b/i),
    patientInstructions: matchingSentences(note, /\b(?:advis(?:e|ed)|educat(?:e|ed|ion)|instruct(?:ed|ions?)|discussed with patient|counsel(?:ed|ing))\b/i),
    pendingResults: matchingSentences(note, /\b(?:pending|await(?:ing)?|results?\s+(?:will|to be)|notify.*results?|follow.*results?)\b/i),
    returnPrecautions: matchingSentences(note, /\b(?:return precautions?|seek (?:urgent|emergency) care|go to (?:the )?(?:er|ed)|call 911|worsen(?:s|ing)?|red flags?)\b/i),
  };
}

export function normalizeStructuredEncounter(input = {}, noteText = "") {
  const detected = detectStructuredEncounter(noteText);
  const choose = (key) => Array.isArray(input?.[key]) && input[key].length ? input[key] : detected[key];
  const providedMedications = (Array.isArray(input?.medications) ? input.medications : []).map(normalizeMedication);
  const controlledFromNote = detected.medications.filter((medication) => medication.controlled);
  const medicationMap = new Map([...providedMedications, ...controlledFromNote].map((medication) => [
    clean(medication.sourceText || medication.name).toLowerCase(), medication,
  ]));
  return {
    medications: (medicationMap.size ? [...medicationMap.values()] : detected.medications)
      .map(normalizeMedication).filter((item) => item.sourceText || item.name).slice(0, 50),
    orders: uniqueText(choose("orders")).slice(0, 50),
    referrals: uniqueText(choose("referrals")).slice(0, 50),
    followUp: uniqueText(choose("followUp")).slice(0, 20),
    patientInstructions: uniqueText(choose("patientInstructions")).slice(0, 50),
    pendingResults: uniqueText(choose("pendingResults")).slice(0, 50),
    returnPrecautions: uniqueText(choose("returnPrecautions")).slice(0, 30),
  };
}

function documented(note, pattern) {
  const match = sentences(note).find((sentence) => pattern.test(sentence));
  return { status: match ? "documented" : "needs_review", evidence: match || "" };
}

export function controlledMedicationReviews(encounter = {}) {
  const note = String(encounter.note || "");
  const structured = normalizeStructuredEncounter(encounter, note);
  return structured.medications.filter((medication) => medication.controlled).map((medication) => ({
    medicationId: medication.id,
    medication: medication.name || medication.sourceText,
    sourceText: medication.sourceText,
    checks: {
      diagnosisLinkage: documented(medication.sourceText, /\b(?:for|due to|treat(?:ing|ment)?|indication|linked to|associated with)\b/i),
      doseFrequency: medication.doseFrequency
        ? { status: "documented", evidence: medication.doseFrequency }
        : { status: "needs_review", evidence: "" },
      pdmp: documented(note, /\b(?:pdmp|prescription drug monitoring|crisp\s+pdmp)\b/i),
      agreementConsent: documented(note, /\b(?:controlled[- ]substance agreement|treatment agreement|medication agreement|controlled[- ]medication consent|medication informed consent)\b/i),
      monitoring: documented(note, /\b(?:urine drug|drug screen|toxicology|pill count|controlled[- ]substance monitoring|controlled[- ]medication monitoring)\b/i),
      safetyCounseling: documented(note, /\b(?:safety counseling|sedation|overdose|naloxone|avoid alcohol|do not drive|safe storage|dependence|misuse)\b/i),
      followUp: documented(note, /\b(?:follow[- ]?up|return\s+(?:in|to)|rtc\b|recheck)\b/i),
    },
  }));
}

export function hasControlledMedication(encounter = {}) {
  const structured = normalizeStructuredEncounter(encounter, encounter.note);
  return structured.medications.some((medication) => medication.controlled)
    || isControlledMedicationText(encounter.note);
}

export function structuredLines(values = []) {
  return uniqueText(values).join("\n");
}
