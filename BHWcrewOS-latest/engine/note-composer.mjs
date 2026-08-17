const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const PRIMARY_NOTE_TEMPLATES = Object.freeze({
  established_office: { label: "Established Office Visit", group: "medical" },
  new_patient: { label: "New Patient Visit", group: "medical" },
  urgent_visit: { label: "Urgent / Same-Day Visit", group: "medical" },
  transitional_care: { label: "Transitional Care Management", group: "medical" },
  preventive_exam: { label: "Preventive Examination", group: "medical" },
  pediatric_preventive: { label: "Pediatric Preventive Visit", group: "medical" },
  annual_wellness: { label: "Medicare Annual Wellness Visit", group: "medical" },
  biopsychosocial_intake: { label: "Biopsychosocial Intake (90791)", group: "behavioral" },
  individual_psychotherapy: { label: "Individual Psychotherapy", group: "behavioral" },
  family_psychotherapy: { label: "Family Psychotherapy", group: "behavioral" },
  charmed_minds_intake: { label: "CharmEd Minds Comprehensive Intake", group: "charmed_minds" },
  charmed_minds_care_plan: { label: "CharmEd Minds Individualized Care Plan", group: "charmed_minds" },
  charmed_minds_progress: { label: "CharmEd Minds Progress Visit", group: "charmed_minds" },
});

export const NOTE_MODULES = Object.freeze({
  condition_management: { label: "Condition Management" },
  preventive_care: { label: "Preventive Care" },
  controlled_medication: { label: "Controlled Medication Monitoring" },
  behavioral_health: { label: "Behavioral Health / Risk Review" },
  charmed_minds: { label: "CharmEd Minds Cognitive & Functional Review" },
});

export const ENCOUNTER_CONTEXT_FIELDS = Object.freeze({
  preVisitQuestionnaire: "Pre-Visit Questionnaire",
  hra: "Health Risk Assessment",
  medications: "Medication List",
  allergies: "Allergies",
  problemList: "Problem List",
  pharmacy: "Pharmacy",
  payer: "Payer / Coverage",
  careTeam: "Care Team",
  labs: "Recent Labs",
  imaging: "Recent Imaging",
  screenings: "Screenings",
  referrals: "Referrals",
  unresolvedItems: "Unresolved Items",
  controlledMedicationHistory: "Controlled-Medication History",
  charmedMinds: "CharmEd Minds Assessments & Goals",
});

const templateIds = new Set(Object.keys(PRIMARY_NOTE_TEMPLATES));
const moduleIds = new Set(Object.keys(NOTE_MODULES));

export function normalizeNotePlan(input = {}) {
  const requestedPrimary = clean(input.primaryTemplate || input.primary || "established_office");
  const primaryTemplate = templateIds.has(requestedPrimary) ? requestedPrimary : "established_office";
  const modules = [...new Set([].concat(input.modules || []).map(clean).filter((id) => moduleIds.has(id)))];
  if (primaryTemplate.startsWith("charmed_minds_") && !modules.includes("charmed_minds")) modules.push("charmed_minds");
  if (["biopsychosocial_intake", "individual_psychotherapy", "family_psychotherapy"].includes(primaryTemplate)
    && !modules.includes("behavioral_health")) modules.push("behavioral_health");
  if (["preventive_exam", "pediatric_preventive", "annual_wellness"].includes(primaryTemplate)
    && !modules.includes("preventive_care")) modules.push("preventive_care");
  return {
    primaryTemplate,
    modules,
    awvType: ["initial", "subsequent"].includes(input.awvType) ? input.awvType : "",
  };
}

function normalizeContextItem(value, index = 0) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  const itemValue = clean(object.value ?? object.text ?? object.name ?? object.label);
  const reconciliationStatus = ["confirmed", "reconciled", "reviewed", "patient_reported", "needs_reconciliation", "conflict"]
    .includes(object.reconciliationStatus) ? object.reconciliationStatus : "needs_reconciliation";
  return {
    id: clean(object.id) || `context:${index + 1}`,
    value: itemValue,
    source: clean(object.source) || "Patient master list",
    updatedAt: clean(object.updatedAt || object.collectedAt),
    patientReported: Boolean(object.patientReported || reconciliationStatus === "patient_reported"),
    reconciliationStatus,
    reviewedForNote: Boolean(object.reviewedForNote || ["confirmed", "reconciled", "reviewed"].includes(reconciliationStatus)),
  };
}

export function normalizeEncounterSnapshot(input = {}) {
  return Object.fromEntries(Object.keys(ENCOUNTER_CONTEXT_FIELDS).map((field) => {
    const values = Array.isArray(input[field]) ? input[field] : input[field] == null || input[field] === "" ? [] : [input[field]];
    return [field, values.map(normalizeContextItem).filter((item) => item.value).slice(0, 100)];
  }));
}

export function contextReviewSummary(snapshotInput = {}) {
  const snapshot = normalizeEncounterSnapshot(snapshotInput);
  return Object.entries(snapshot).reduce((summary, [field, items]) => {
    if (!items.length) return summary;
    summary.total += items.length;
    summary.reviewed += items.filter((item) => item.reviewedForNote).length;
    summary.needsReview += items.filter((item) => !item.reviewedForNote).length;
    summary.fields.push({ field, label: ENCOUNTER_CONTEXT_FIELDS[field], items });
    return summary;
  }, { total: 0, reviewed: 0, needsReview: 0, fields: [] });
}

const list = (value) => Array.isArray(value) ? value.map(clean).filter(Boolean) : clean(value) ? [clean(value)] : [];
const lines = (values) => list(values).map((value) => `- ${value}`).join("\n");
const reviewedValues = (snapshot, field) => (snapshot[field] || []).filter((item) => item.reviewedForNote).map((item) => item.value);

function addSection(sections, title, content, { required = false, missing = [] } = {}) {
  const text = Array.isArray(content) ? lines(content) : clean(content);
  sections.push({ title, content: text, required, complete: Boolean(text) });
  if (required && !text) missing.push(title);
}

function joinNarrative(value) {
  return list(value).join("\n");
}

export function composeEncounterNote(input = {}) {
  const plan = normalizeNotePlan(input.notePlan || input);
  const snapshot = normalizeEncounterSnapshot(input.encounterSnapshot || input.snapshot);
  const template = PRIMARY_NOTE_TEMPLATES[plan.primaryTemplate];
  const missing = [];
  const sections = [];
  const transcript = clean(input.transcript || input.note || input.clinicalNarrative);
  const transcriptReviewed = Boolean(input.transcriptReviewed || input.noteReviewed);
  const reviewedTranscript = transcriptReviewed ? transcript : "";

  addSection(sections, "Encounter", [
    input.bhwPatientId ? `BHW Patient ID: ${clean(input.bhwPatientId)}` : "",
    input.encounterId || input.id ? `Encounter ID: ${clean(input.encounterId || input.id)}` : "",
    input.provider ? `Rendering provider: ${clean(input.provider)}` : "",
    input.completedAt ? `Date/time: ${clean(input.completedAt)}` : "",
    `Primary template: ${template.label}`,
    plan.modules.length ? `Additional modules: ${plan.modules.map((id) => NOTE_MODULES[id].label).join(", ")}` : "",
  ].filter(Boolean));
  addSection(sections, "Chief Concern / Reason for Visit", input.chiefConcern, { required: true, missing });
  addSection(sections, "History of Present Illness", reviewedTranscript || input.hpi, { required: true, missing });
  if (transcript && !transcriptReviewed) missing.push("Provider review of transcription");

  addSection(sections, "Relevant Medical, Family, and Social History", input.relevantHistory);
  addSection(sections, "Medications Reconciled", reviewedValues(snapshot, "medications"));
  addSection(sections, "Allergies Reconciled", reviewedValues(snapshot, "allergies"));
  addSection(sections, "Active Problems Reviewed", reviewedValues(snapshot, "problemList"));
  addSection(sections, "Relevant Review of Systems", input.ros);
  addSection(sections, "Objective / Examination", input.exam);

  if (plan.primaryTemplate === "annual_wellness") {
    addSection(sections, "Annual Wellness Visit Type", plan.awvType ? `${plan.awvType === "initial" ? "Initial" : "Subsequent"} AWV` : "", { required: true, missing });
    addSection(sections, "Health Risk Assessment", reviewedValues(snapshot, "hra"), { required: true, missing });
    addSection(sections, "Medical and Family History Update", input.awv?.historyUpdate, { required: true, missing });
    addSection(sections, "Current Providers and Suppliers", joinNarrative(input.awv?.providers) || lines(reviewedValues(snapshot, "careTeam")), { required: true, missing });
    addSection(sections, "Measurements", input.awv?.measurements, { required: true, missing });
    addSection(sections, "Cognitive Assessment", input.awv?.cognition, { required: true, missing });
    addSection(sections, "Functional Ability and Safety", input.awv?.functionSafety, { required: true, missing });
    addSection(sections, "Screening and Prevention Schedule", input.awv?.preventionSchedule, { required: true, missing });
    addSection(sections, "Opioid and Substance-Use Risk Review", input.awv?.opioidSudReview, { required: true, missing });
    addSection(sections, "Personalized Prevention Plan", input.awv?.personalizedPlan, { required: true, missing });
  }

  if (plan.modules.includes("condition_management")) {
    addSection(sections, "Condition Management — Status and Interval Change", input.conditionManagement?.status, { required: true, missing });
    addSection(sections, "Condition Management — Objective Monitoring", input.conditionManagement?.objective || reviewedValues(snapshot, "labs"), { required: true, missing });
    addSection(sections, "Condition Management — Treatment and Response", input.conditionManagement?.treatmentResponse, { required: true, missing });
  }

  if (plan.modules.includes("preventive_care")) {
    addSection(sections, "Preventive Screening Review", input.preventiveCare?.screenings || reviewedValues(snapshot, "screenings"), { required: true, missing });
    addSection(sections, "Preventive Counseling and Plan", input.preventiveCare?.counselingPlan, { required: true, missing });
  }

  if (plan.modules.includes("controlled_medication")) {
    addSection(sections, "Controlled Medication — Indication, Adherence, Effect, and Adverse Effects", input.controlledMedication?.clinicalReview, { required: true, missing });
    addSection(sections, "Controlled Medication — PDMP", input.controlledMedication?.pdmp, { required: true, missing });
    addSection(sections, "Controlled Medication — Agreement / Consent", input.controlledMedication?.agreementConsent, { required: true, missing });
    addSection(sections, "Controlled Medication — Monitoring / Sample", input.controlledMedication?.sampleMonitoring, { required: true, missing });
    addSection(sections, "Controlled Medication — Safety Counseling", input.controlledMedication?.safetyCounseling, { required: true, missing });
    addSection(sections, "Controlled Medication — Follow-Up", input.controlledMedication?.followUp, { required: true, missing });
  }

  if (plan.modules.includes("behavioral_health")) {
    addSection(sections, "Mental Status Examination", input.behavioralHealth?.mse, { required: true, missing });
    addSection(sections, "Safety / Risk Assessment", input.behavioralHealth?.risk, { required: true, missing });
    addSection(sections, "Interventions, Response, and Progress", input.behavioralHealth?.interventionsResponse, { required: true, missing });
  }

  if (plan.modules.includes("charmed_minds")) {
    addSection(sections, "CharmEd Minds — Functional Concern and Context", input.charmedMinds?.functionalConcern, { required: true, missing });
    addSection(sections, "CharmEd Minds — Standardized Screening and Cognitive Profile", input.charmedMinds?.screeningProfile || reviewedValues(snapshot, "charmedMinds"), { required: true, missing });
    addSection(sections, "CharmEd Minds — Goals, Transfer, and Support Plan", input.charmedMinds?.goalsPlan, { required: true, missing });
  }

  addSection(sections, "Assessment", input.assessment, { required: true, missing });
  addSection(sections, "Plan", input.plan, { required: true, missing });
  addSection(sections, "Orders", input.orders);
  addSection(sections, "Referrals / Care Coordination", input.referrals);
  addSection(sections, "Patient Instructions and Return Precautions", [...list(input.patientInstructions), ...list(input.returnPrecautions)]);
  addSection(sections, "Follow-Up", input.followUp, { required: true, missing });
  addSection(sections, "Time / Medical Decision-Making Attestation", input.timeMdm);

  const note = [`BHW MEDICAL GROUP — ${template.label.toUpperCase()}`]
    .concat(sections.filter((section) => section.content).map((section) => `${section.title}\n${section.content}`))
    .join("\n\n");
  return {
    note,
    sections,
    missing: [...new Set(missing)],
    notePlan: plan,
    contextSummary: contextReviewSummary(snapshot),
    generatedAt: new Date().toISOString(),
    readyForProviderReview: Boolean(note) && missing.length === 0,
  };
}
