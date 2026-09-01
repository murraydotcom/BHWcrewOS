const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function unique(values = []) {
  return [...new Set([].concat(values || []).map(clean).filter(Boolean))];
}

function sentences(value = "") {
  return String(value || "")
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean);
}

function medicationText(medication = {}) {
  return clean(typeof medication === "string"
    ? medication
    : medication.sourceText || [medication.name, medication.doseFrequency].filter(Boolean).join(" — "));
}

function looksLikeNonMedicationPlan(text = "") {
  const value = clean(text);
  const nonDrugPlan = /\b(?:physical therapy|occupational therapy|speech therapy|psychotherapy|counseling|exercise program|diet(?:ary)? program|nutrition counseling|home exercise|referral|imaging|x-?ray|mri|ct scan|ultrasound|laboratory|labs?)\b/i.test(value);
  const medicationSignal = /\b(?:medication|medicine|drug|prescrib|pharmacy|tablet|capsule|injection|injectable|inhaler|patch|cream|ointment|solution|suspension|mg|mcg|gram|mL)\b/i.test(value)
    || classQuestionSets(value).length > 0;
  return nonDrugPlan && !medicationSignal;
}

export function medicationAction(value = "") {
  const text = medicationText(value);
  if (/\b(?:stop(?:ped)?|discontinue(?:d)?|hold)\b/i.test(text)) return "stopped";
  if (/\b(?:start(?:ed|ing)?|initiat(?:e|ed|ing)|begin|prescrib(?:e|ed|ing)|new\s+(?:medication|prescription)|trial\s+of)\b/i.test(text)) return "new";
  if (/\b(?:increase(?:d)?|decrease(?:d)?|titrate(?:d)?|restart(?:ed)?|switch(?:ed)?|change(?:d)?(?:\s+(?:to|from))?)\b/i.test(text)) return "changed";
  if (/\b(?:prior auth|authorization|not covered|formulary|step therapy|quantity limit)\b/i.test(text)) return "coverage_issue";
  if (/\b(?:continue(?:d)?|refill(?:ed)?|renew(?:ed)?)\b/i.test(text)) return "continuation";
  return "unknown";
}

function classQuestionSets(value = "") {
  const text = clean(value);
  const sets = [];
  const add = (id, label, questions) => sets.push({ id, label, questions });

  if (/\b(?:semaglutide|ozempic|wegovy|rybelsus|tirzepatide|mounjaro|zepbound|liraglutide|saxenda|victoza|dulaglutide|trulicity)\b/i.test(text)) {
    add("glp1", "GLP-1 / incretin readiness prompts", [
      ["glp1_indication", "Is the request for diabetes treatment, weight management, or another documented indication?", /\b(?:type\s*2 diabetes|diabetes|weight (?:loss|management)|obesity|overweight|indication)\b/i],
      ["glp1_metrics", "What recent BMI, weight trend, or A1c supports the request, when applicable?", /\b(?:bmi|body mass index|weighs?|weight\s*(?:is|was|today|:)|a1c|hba1c|hemoglobin a1c)\b/i],
      ["glp1_program", "What relevant nutrition, activity, or structured lifestyle treatment has been attempted?", /\b(?:nutrition|diet|exercise|physical activity|lifestyle|weight[- ]management program)\b/i],
    ]);
  }
  if (/\b(?:adderall|amphetamine|dextroamphetamine|lisdexamfetamine|vyvanse|methylphenidate|ritalin|concerta|focalin|dexmethylphenidate|atomoxetine|strattera|viloxazine|qelbree|guanfacine|intuniv)\b/i.test(text)) {
    add("adhd", "ADHD medication readiness prompts", [
      ["adhd_assessment", "What documented evaluation supports the ADHD diagnosis?", /\b(?:adhd|attention[- ]deficit|diagnostic evaluation|rating scale|vanderbilt|conners|asrs)\b/i],
      ["adhd_impairment", "What symptoms and functional impairment remain?", /\b(?:impair(?:ment|ed)|inattention|hyperactiv|impulsiv|school|work|home|function)\b/i],
      ["adhd_safety", "What applicable cardiovascular, substance-use, or PDMP review was documented?", /\b(?:blood pressure|heart rate|cardiac|cardiovascular|substance use|pdmp|prescription drug monitoring|crisp pdmp)\b/i],
    ]);
  }
  if (/\b(?:abilify|aripiprazole|invega|paliperidone|risperidone|risperdal|olanzapine|zyprexa|quetiapine|seroquel|vraylar|cariprazine|caplyta|lumateperone|latuda|lurasidone|haloperidol|haldol)\b/i.test(text)) {
    add("antipsychotic", "Antipsychotic readiness prompts", [
      ["antipsychotic_target", "What diagnosis and target symptoms support treatment?", /\b(?:schizophren|schizoaffective|bipolar|psychosis|hallucination|delusion|mood stabil|target symptom)\b/i],
      ["antipsychotic_response", "What response, relapse, adherence, or tolerability history supports this choice?", /\b(?:response|relapse|adherence|nonadherence|tolerat|side effect|effective|ineffective)\b/i],
      ["antipsychotic_monitoring", "What applicable metabolic or movement-disorder monitoring is documented?", /\b(?:a1c|glucose|lipid|weight|bmi|aims|abnormal involuntary movement|metabolic)\b/i],
      ["antipsychotic_oral", "For a long-acting injection, is oral tolerability or prior exposure documented?", /\b(?:long[- ]acting|lai\b|injection|injectable|oral tolerability|oral trial)\b/i],
    ]);
  }
  if (/\b(?:aimovig|erenumab|ajovy|fremanezumab|emgality|galcanezumab|nurtec|rimegepant|ubrelvy|ubrogepant|qulipta|atogepant|zavzpret|zavegepant)\b/i.test(text)) {
    add("migraine", "Migraine medication readiness prompts", [
      ["migraine_frequency", "How many headache or migraine days per month are documented?", /\b(?:headache|migraine)\s+days?\s+per\s+month|\b\d+\s+(?:headache|migraine)\s+days?\b/i],
      ["migraine_impact", "What duration, severity, or functional impact is documented?", /\b(?:duration|sever|disabil|miss(?:ed|ing) work|functional impact|hours?|days?)\b/i],
      ["migraine_trials", "Which preventive or acute treatments were tried, and what happened?", /\b(?:preventive|prophylaxis|acute treatment|triptan|topiramate|propranolol|amitriptyline|failed|ineffective|intoler)\b/i],
    ]);
  }
  if (/\b(?:belsomra|suvorexant|dayvigo|lemborexant|quviviq|daridorexant|ramelteon)\b/i.test(text)) {
    add("insomnia", "Insomnia medication readiness prompts", [
      ["insomnia_history", "What insomnia diagnosis, duration, and daytime impact are documented?", /\b(?:insomnia|sleep onset|sleep maintenance|daytime|duration)\b/i],
      ["insomnia_non_drug", "What sleep-hygiene or CBT-I treatment has been attempted?", /\b(?:sleep hygiene|cbt[- ]?i|cognitive behavioral therapy for insomnia|behavioral sleep)\b/i],
      ["insomnia_trials", "Which prior sleep medications were tried, and what happened?", /\b(?:tried|failed|ineffective|intoler|side effect|prior (?:sleep|insomnia) medication)\b/i],
    ]);
  }
  return sets;
}

function reviewedSnapshotValues(encounter, field) {
  return unique([].concat(encounter?.encounterSnapshot?.[field] || [])
    .filter((item) => typeof item === "string" || item?.reviewedForNote)
    .map((item) => typeof item === "string" ? item : item?.value));
}

function evidence(noteSentences, pattern, limit = 3) {
  return unique(noteSentences.filter((sentence) => pattern.test(sentence))).slice(0, limit).join(" ");
}

function question(id, label, answer, audience = "provider") {
  const value = clean(answer);
  return {
    id,
    label,
    answer: value,
    audience,
    status: value ? "documented" : audience === "staff" ? "needs_staff" : "needs_provider",
  };
}

export function medicationAuthorizationCandidates(encounter = {}) {
  const noteHasCoverageLanguage = /\b(?:prior auth|authorization|not covered|formulary|step therapy|quantity limit)\b/i.test(String(encounter.note || ""));
  return [].concat(encounter.medications || []).map((medication, index) => {
    const sourceText = medicationText(medication);
    const action = clean(medication?.action) || medicationAction(sourceText);
    return {
      id: clean(medication?.id) || `medication:${index + 1}`,
      name: clean(medication?.name) || sourceText.slice(0, 120),
      doseFrequency: clean(medication?.doseFrequency),
      sourceText,
      action,
      questionSets: classQuestionSets(sourceText),
    };
  }).filter((medication) => {
    if (!medication.sourceText || looksLikeNonMedicationPlan(medication.sourceText) || ["stopped", "continuation"].includes(medication.action)) return false;
    return ["new", "changed", "coverage_issue"].includes(medication.action) || noteHasCoverageLanguage;
  });
}

export function buildMedicationAuthorizationReadiness(encounter = {}) {
  const noteSentences = sentences(encounter.note);
  const diagnoses = unique(encounter.diagnoses).join(", ");
  const allergies = reviewedSnapshotValues(encounter, "allergies").join("; ");
  const coverage = encounter.coverage && typeof encounter.coverage === "object" ? encounter.coverage : {};
  const candidates = medicationAuthorizationCandidates(encounter).map((medication) => {
    const request = medication.sourceText || [medication.name, medication.doseFrequency].filter(Boolean).join(" — ");
    const questions = [
      question("requested_medication", "Requested medication, strength, route, and frequency", request),
      question("request_type", "Is this a new start, restart, dose change, or coverage problem?", medication.action.replaceAll("_", " ")),
      question("diagnosis_indication", "What diagnosis and clinical indication support the request?", [diagnoses, evidence(noteSentences, /\b(?:diagnos(?:is|ed)|indication|treat(?:ing|ment)?|for\s+(?:the\s+)?(?:management|treatment|control)\s+of)\b/i)].filter(Boolean).join(" · ")),
      question("symptoms_severity", "What current symptoms, severity, and functional impact are documented?", evidence(noteSentences, /\b(?:symptom|sever|impair|function|score|scale|frequency|episodes?|days? per (?:week|month))\b/i)),
      question("prior_therapies", "Which medications or therapies were previously tried, including dose/duration, response, and adverse effects?", evidence(noteSentences, /\b(?:tried|failed|failure|inadequate response|ineffective|did not respond|intoler|adverse|side effect|previously used|discontinued because)\b/i)),
      question("contraindications", "What allergies, contraindications, or reasons alternatives are not appropriate are documented?", [allergies, evidence(noteSentences, /\b(?:allerg|contraindicat|cannot take|not appropriate|not a candidate|intoler)\b/i)].filter(Boolean).join(" · ")),
      question("objective_findings", "What relevant exam findings, screening scores, labs, weight/BMI, or other objective results support the request?", evidence(noteSentences, /\b(?:exam|screen(?:ing)?|phq-?9|gad-?7|asrs|vanderbilt|score|lab|a1c|glucose|lipid|weight|bmi|blood pressure|heart rate)\b/i)),
      question("quantity_duration", "What quantity, days supplied, and requested duration are documented?", evidence(noteSentences, /\b(?:quantity|qty|\d+[- ]day supply|days? supply|\d+\s+(?:tablets?|capsules?|pens?|injections?|mL)\b|for\s+\d+\s+(?:days?|weeks?|months?))\b/i)),
      question("clinical_rationale", "Why is the requested medication preferred over covered alternatives?", evidence(noteSentences, /\b(?:clinical rationale|medically necessary|preferred alternative|formulary alternative|because (?:of|the)|not appropriate|best option)\b/i)),
    ];
    for (const set of medication.questionSets) {
      for (const [id, label, pattern] of set.questions) questions.push(question(id, label, evidence(noteSentences, pattern)));
    }
    const missingProvider = questions.filter((item) => item.status === "needs_provider");
    return {
      ...medication,
      questions,
      documented: questions.filter((item) => item.status === "documented").length,
      total: questions.length,
      missingProvider: missingProvider.map((item) => item.label),
      readyForStaffHandoff: missingProvider.length === 0,
    };
  });
  const administrative = [
    question("patient_id", "Verified BHW patient ID", encounter.bhwPatientId, "staff"),
    question("payer", "Current payer / pharmacy benefit", coverage.payer || encounter.payer, "staff"),
    question("member_id", "Member ID", coverage.memberId, "staff"),
    question("plan_name", "Plan or PBM name", coverage.planName, "staff"),
    question("benefit_check", "Patient-specific formulary / real-time benefit result", "", "staff"),
  ];
  return {
    version: 1,
    coverageStatus: "not_checked",
    candidates,
    administrative,
    missingStaff: administrative.filter((item) => item.status === "needs_staff").map((item) => item.label),
  };
}

function answerLine(item) {
  const placeholder = item.audience === "staff" ? "[MA/front desk completes]" : "[Provider answer needed]";
  return `${item.label}\nAnswer: ${item.answer || placeholder}`;
}

export function medicationAuthorizationDocument(encounter = {}) {
  const readiness = buildMedicationAuthorizationReadiness(encounter);
  const lines = [
    `Encounter ${clean(encounter.id || encounter.encounterId)}`,
    `Provider: ${clean(encounter.provider) || "Unassigned"}`,
    `Encounter date: ${new Date(encounter.completedAt || Date.now()).toLocaleDateString("en-US")}`,
    "",
    "MEDICATION PRIOR-AUTHORIZATION READINESS — DRAFT",
    "",
    "This packet preserves answers documented during the encounter so staff do not ask the clinician to repeat them. It does not establish formulary coverage or prove that prior authorization is required. The payer/PBM response remains authoritative.",
    "",
    "ADMINISTRATIVE / COVERAGE CHECK",
    ...readiness.administrative.flatMap((item) => [answerLine(item), ""]),
  ];
  for (const [index, candidate] of readiness.candidates.entries()) {
    lines.push(`MEDICATION REQUEST ${index + 1}`, `Documented request: ${candidate.sourceText}`, `Clinical readiness: ${candidate.documented}/${candidate.total} common questions documented`, "");
    const classLabels = candidate.questionSets.map((set) => set.label);
    if (classLabels.length) lines.push(`Additional question sets: ${classLabels.join("; ")}`, "");
    for (const item of candidate.questions) lines.push(answerLine(item), "");
  }
  lines.push(
    "PRESCRIBING CLINICIAN REVIEW",
    "[ ] I reviewed the extracted clinical answers above, corrected any errors, and completed or marked not applicable the items that require my judgment.",
    "",
    "MA / FRONT-DESK HANDOFF",
    "1. Verify the patient, active pharmacy benefit, member ID, medication details, and prescriber.",
    "2. Run the payer/PBM formulary or real-time prescription-benefit check.",
    "3. If no authorization is required, record the result and close this task.",
    "4. If authorization is required, reuse only the provider-reviewed answers above; send any payer-specific unanswered questions back to the clinician.",
    "5. Record the submission reference, decision/status, dates, and any appeal or follow-up deadline in the authorized operational system.",
    "",
    "Do not infer an answer, change the prescription, or represent this draft as payer approval.",
  );
  return lines.join("\n").trim();
}

export function validateMedicationAuthorizationHandoff(content = "") {
  const text = String(content || "");
  const reasons = [];
  if (text.includes("[Provider answer needed]")) reasons.push("Complete each provider item or mark it Not applicable.");
  if (!/\[(?:x|X|✓)\]\s+I reviewed the extracted clinical answers/.test(text)) reasons.push("The prescribing clinician review attestation is not marked.");
  return { valid: reasons.length === 0, reasons };
}
