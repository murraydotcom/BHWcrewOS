import { buildMedicationAuthorizationReadiness } from "./medication-prior-auth.mjs";

const clean = (value, limit = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const cleanMultiline = (value, limit = 12000) => String(value ?? "").replace(/\r/g, "").trim().slice(0, limit);

export const PAYER_CATALOG = Object.freeze([
  { id: "unknown", label: "Unknown / other plan", family: "", lineOfBusiness: "unknown", patterns: [] },
  { id: "maryland_medicaid_ffs", label: "Maryland Medicaid — fee-for-service", family: "Maryland Medicaid", lineOfBusiness: "medicaid", patterns: [/maryland medicaid.*(?:ffs|fee.for.service)/i] },
  { id: "maryland_physicians_care", label: "Maryland Physicians Care", family: "Maryland Physicians Care", lineOfBusiness: "medicaid", patterns: [/maryland physicians care/i] },
  { id: "carefirst_community", label: "CareFirst Community — Medicaid", family: "CareFirst", lineOfBusiness: "medicaid", patterns: [/carefirst community/i] },
  { id: "carefirst_medicare", label: "CareFirst — Medicare Advantage", family: "CareFirst", lineOfBusiness: "medicare_advantage", patterns: [/carefirst.*(?:medicare|advantage)/i] },
  { id: "carefirst_commercial", label: "CareFirst — commercial", family: "CareFirst", lineOfBusiness: "commercial", patterns: [/carefirst/i] },
  { id: "alterwood", label: "Alterwood", family: "Alterwood", lineOfBusiness: "medicare_advantage", patterns: [/alterwood/i] },
  { id: "uhc_medicaid", label: "UnitedHealthcare — Medicaid / Community Plan", family: "UnitedHealthcare", lineOfBusiness: "medicaid", patterns: [/(?:united ?healthcare|uhc).*(?:medicaid|community plan)/i] },
  { id: "uhc_medicare", label: "UnitedHealthcare — Medicare", family: "UnitedHealthcare", lineOfBusiness: "medicare", patterns: [/(?:united ?healthcare|uhc).*(?:medicare|advantage)/i] },
  { id: "uhc_commercial", label: "UnitedHealthcare — commercial", family: "UnitedHealthcare", lineOfBusiness: "commercial", patterns: [/(?:united ?healthcare|uhc)/i] },
  { id: "humana_medicare", label: "Humana — Medicare", family: "Humana", lineOfBusiness: "medicare", patterns: [/humana.*(?:medicare|advantage)/i] },
  { id: "humana_commercial", label: "Humana — commercial / other", family: "Humana", lineOfBusiness: "commercial", patterns: [/humana/i] },
  { id: "cigna_commercial", label: "Cigna — commercial", family: "Cigna", lineOfBusiness: "commercial", patterns: [/cigna/i] },
  { id: "aetna_medicare", label: "Aetna — Medicare", family: "Aetna", lineOfBusiness: "medicare", patterns: [/aetna.*(?:medicare|advantage)/i] },
  { id: "aetna_commercial", label: "Aetna — commercial", family: "Aetna", lineOfBusiness: "commercial", patterns: [/aetna/i] },
  { id: "medicare", label: "Medicare / Part D plan not identified", family: "Medicare", lineOfBusiness: "medicare", patterns: [/medicare/i] },
  { id: "maryland_medicaid", label: "Maryland Medicaid — plan not identified", family: "Maryland Medicaid", lineOfBusiness: "medicaid", patterns: [/(?:maryland )?medicaid/i] },
]);

export const BENEFIT_ADMINISTRATORS = Object.freeze([
  { id: "unknown", label: "Unknown / not identified" },
  { id: "carelon", label: "Carelon / CarelonRx" },
  { id: "other", label: "Other PBM / administrator" },
]);

export const COVERAGE_EVIDENCE_STATUSES = Object.freeze({
  not_checked: "Not checked",
  likely_pa: "Likely PA — dated source",
  pa_required_confirmed: "PA required — externally confirmed",
  no_pa_required_confirmed: "No PA required — externally confirmed",
  step_therapy: "Step therapy identified",
  quantity_limit: "Quantity limit identified",
  non_formulary: "Not on formulary",
  coverage_unknown: "Coverage could not be confirmed",
});

export const COVERAGE_SOURCE_TYPES = Object.freeze({
  none: "Not recorded",
  payer_portal: "Payer / PBM portal",
  surescripts_portal: "Surescripts portal",
  covermymeds: "CoverMyMeds",
  charm: "CharmHealth",
  pharmacy: "Pharmacy response",
  payer_phone: "Payer / PBM phone verification",
  dated_formulary: "Dated formulary or published criteria",
  cms_data: "CMS formulary data",
  other: "Other authorized source",
});

export const EPA_SUBMISSION_METHODS = Object.freeze({
  none: "Not submitted",
  charm: "CharmHealth",
  surescripts_portal: "Surescripts portal",
  covermymeds: "CoverMyMeds",
  payer_portal: "Payer / PBM portal",
  fax: "Fax",
  phone: "Phone",
  other: "Other authorized method",
});

export const EPA_CASE_STATUSES = Object.freeze({
  draft: "Draft",
  provider_review: "Provider review",
  ready_for_staff: "Ready for MA / front desk",
  benefit_check: "Benefit check in progress",
  ready_to_submit: "Ready to submit externally",
  submitted_external: "Submitted externally",
  pending: "Pending payer decision",
  approved: "Approved",
  denied: "Denied — review next step",
  appeal: "Appeal / reconsideration",
  no_pa_required: "No PA required",
  closed: "Closed",
});

const TERMINAL_CASE_STATUSES = new Set(["approved", "no_pa_required", "closed"]);

function iso(value = "") {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function plusHours(value, hours) {
  const date = new Date(value);
  const base = Number.isFinite(date.getTime()) ? date : new Date();
  return new Date(base.getTime() + hours * 36e5).toISOString();
}

function catalogEntry(id) {
  return PAYER_CATALOG.find((item) => item.id === id) || PAYER_CATALOG[0];
}

export function matchPayerProfile(value = "") {
  const text = clean(value, 300);
  if (!text) return PAYER_CATALOG[0];
  return PAYER_CATALOG.find((item) => item.patterns.some((pattern) => pattern.test(text))) || PAYER_CATALOG[0];
}

export function normalizeCoverageProfile(value = {}, encounter = {}) {
  const source = value && typeof value === "object" ? value : {};
  const coverage = encounter.coverage && typeof encounter.coverage === "object" ? encounter.coverage : {};
  const payerText = clean(source.payer || coverage.payer || encounter.payer, 200);
  const matched = source.payerProfileId ? catalogEntry(source.payerProfileId) : matchPayerProfile(`${payerText} ${source.planName || coverage.planName || ""}`);
  return {
    payerProfileId: matched.id,
    payerFamily: clean(source.payerFamily || matched.family, 120),
    lineOfBusiness: clean(source.lineOfBusiness || matched.lineOfBusiness || "unknown", 80),
    payer: payerText,
    planName: clean(source.planName || coverage.planName, 200),
    benefitAdministratorId: clean(source.benefitAdministratorId || (/(?:carelon|carelonrx)/i.test(source.pbm || coverage.pbm || "") ? "carelon" : "unknown"), 80),
    pbm: clean(source.pbm || coverage.pbm, 160),
    memberId: clean(source.memberId || coverage.memberId || encounter.memberId, 160),
    bin: clean(source.bin || coverage.bin, 20),
    pcn: clean(source.pcn || coverage.pcn, 40),
    groupNumber: clean(source.groupNumber || coverage.groupNumber, 80),
    rxGroup: clean(source.rxGroup || coverage.rxGroup, 80),
    medicareContractId: clean(source.medicareContractId || coverage.medicareContractId, 20).toUpperCase(),
    medicarePbpId: clean(source.medicarePbpId || coverage.medicarePbpId, 20).toUpperCase(),
  };
}

function normalizeCoverageEvidence(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    status: COVERAGE_EVIDENCE_STATUSES[source.status] ? source.status : "not_checked",
    sourceType: COVERAGE_SOURCE_TYPES[source.sourceType] ? source.sourceType : "none",
    sourceLabel: clean(source.sourceLabel, 240),
    sourceUrl: clean(source.sourceUrl, 1000),
    checkedAt: iso(source.checkedAt),
    effectiveDate: clean(source.effectiveDate, 20),
    verifiedBy: clean(source.verifiedBy, 160),
    notes: cleanMultiline(source.notes, 3000),
  };
}

function normalizeSubmission(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    method: EPA_SUBMISSION_METHODS[source.method] ? source.method : "none",
    reference: clean(source.reference, 240),
    submittedAt: iso(source.submittedAt),
    followUpAt: iso(source.followUpAt),
    decisionAt: iso(source.decisionAt),
    expirationAt: iso(source.expirationAt),
    decisionReason: cleanMultiline(source.decisionReason, 3000),
    notes: cleanMultiline(source.notes, 3000),
  };
}

function normalizeProviderReview(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    attested: Boolean(source.attested),
    attestedBy: clean(source.attestedBy, 160),
    attestedAt: source.attested ? iso(source.attestedAt) : "",
  };
}

function normalizeQuestion(question = {}, fallback = {}) {
  const disposition = ["unanswered", "answered", "not_applicable"].includes(question.disposition)
    ? question.disposition
    : clean(question.answer || fallback.answer, 6000) ? "answered" : "unanswered";
  return {
    id: clean(question.id || fallback.id, 160),
    label: clean(question.label || fallback.label, 1000),
    answer: cleanMultiline(question.answer ?? fallback.answer, 6000),
    audience: question.audience === "staff" || fallback.audience === "staff" ? "staff" : "provider",
    disposition,
    source: clean(question.source || fallback.source || "encounter_readiness", 80),
  };
}

function mergeQuestions(generated = [], existing = []) {
  const existingMap = new Map([].concat(existing || []).map((item) => [item.id, item]));
  return generated.map((item) => {
    const prior = existingMap.get(item.id);
    const generatedQuestion = normalizeQuestion({
      ...item,
      disposition: item.answer ? "answered" : "unanswered",
      source: "encounter_readiness",
    });
    if (!prior) return generatedQuestion;
    const normalizedPrior = normalizeQuestion(prior, generatedQuestion);
    const wasEdited = prior.source === "provider" || prior.source === "staff" || prior.disposition === "not_applicable";
    return wasEdited ? normalizedPrior : generatedQuestion;
  });
}

function payerQuestionId(label, index) {
  const slug = clean(label, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `payer:${slug || index + 1}:${index + 1}`;
}

function anticipatedAnswer(label, questions = []) {
  const patterns = [
    [/diagnos|indication|condition/i, ["diagnosis_indication"]],
    [/previous|prior|tried|failed|step therap|response|adverse/i, ["prior_therapies"]],
    [/allerg|contraindicat|not appropriate|intoler/i, ["contraindications"]],
    [/symptom|severity|functional|impair/i, ["symptoms_severity"]],
    [/lab|a1c|bmi|weight|score|objective|exam/i, ["objective_findings", "glp1_metrics"]],
    [/quantity|day.?supply|duration|dose|frequency|strength/i, ["requested_medication", "quantity_duration"]],
    [/rationale|medically necessary|why/i, ["clinical_rationale"]],
  ];
  const ids = patterns.find(([pattern]) => pattern.test(label))?.[1] || [];
  return ids.map((id) => questions.find((item) => item.id === id)?.answer).filter(Boolean).join(" · ");
}

export function parsePayerQuestionnaire(rawText = "", commonQuestions = [], existingQuestions = []) {
  const previous = new Map([].concat(existingQuestions || []).map((item) => [clean(item.label, 1000).toLowerCase(), item]));
  return cleanMultiline(rawText, 12000).split(/\n+/).map((line) => clean(line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, ""), 1000)).filter(Boolean).slice(0, 40).map((label, index) => {
    const prior = previous.get(label.toLowerCase());
    const suggested = anticipatedAnswer(label, commonQuestions);
    return normalizeQuestion(prior || {
      id: payerQuestionId(label, index),
      label,
      answer: suggested,
      disposition: "unanswered",
      audience: "provider",
      source: suggested ? "encounter_suggestion" : "payer_questionnaire",
    });
  });
}

function normalizeQuestionnaire(value = {}, commonQuestions = []) {
  const source = value && typeof value === "object" ? value : {};
  const rawText = cleanMultiline(source.rawText, 12000);
  return {
    source: clean(source.source, 240),
    receivedAt: iso(source.receivedAt),
    rawText,
    questions: parsePayerQuestionnaire(rawText, commonQuestions, source.questions),
  };
}

function caseKey(candidate) {
  return clean(candidate.id || candidate.sourceText || candidate.name, 200).toLowerCase();
}

function normalizeCaseStatus(value) {
  return EPA_CASE_STATUSES[value] ? value : "draft";
}

export function buildMedicationEpaCases(encounter = {}, existingCases = [], now = new Date()) {
  const readiness = buildMedicationAuthorizationReadiness(encounter);
  const previousByKey = new Map([].concat(existingCases || []).map((item) => [clean(item.medicationKey || item.medicationId || item.sourceText, 200).toLowerCase(), item]));
  return readiness.candidates.map((candidate, index) => {
    const key = caseKey(candidate);
    const previous = previousByKey.get(key) || existingCases[index] || {};
    const questions = mergeQuestions(candidate.questions, previous.questions);
    const questionnaire = normalizeQuestionnaire(previous.payerQuestionnaire, questions);
    const createdAt = iso(previous.createdAt) || iso(encounter.completedAt) || new Date(now).toISOString();
    return {
      version: 1,
      id: clean(previous.id || `epa:${candidate.id || index + 1}`, 200),
      medicationId: clean(candidate.id, 160),
      medicationKey: key,
      medicationName: clean(candidate.name || candidate.sourceText, 240),
      sourceText: clean(candidate.sourceText, 1000),
      action: clean(candidate.action, 80),
      questionSetLabels: candidate.questionSets.map((item) => clean(item.label, 200)),
      status: normalizeCaseStatus(previous.status),
      coverageProfile: normalizeCoverageProfile(previous.coverageProfile, encounter),
      coverageEvidence: normalizeCoverageEvidence(previous.coverageEvidence),
      questions,
      payerQuestionnaire: questionnaire,
      providerReview: normalizeProviderReview({ attestedBy: encounter.provider, ...previous.providerReview }),
      submission: normalizeSubmission(previous.submission),
      nextActionAt: iso(previous.nextActionAt) || plusHours(createdAt, 24),
      createdAt,
      updatedAt: iso(previous.updatedAt) || new Date(now).toISOString(),
      events: [].concat(previous.events || []).slice(-50).map((event) => ({
        at: iso(event?.at) || new Date(now).toISOString(),
        text: clean(event?.text, 300),
      })).filter((event) => event.text),
    };
  });
}

export function providerQuestionSummary(caseItem = {}) {
  const questions = [
    ...[].concat(caseItem.questions || []).filter((item) => item.audience !== "staff"),
    ...[].concat(caseItem.payerQuestionnaire?.questions || []),
  ];
  const complete = questions.filter((item) => item.disposition === "not_applicable" || (item.disposition === "answered" && clean(item.answer, 6000))).length;
  return { total: questions.length, complete, missing: Math.max(0, questions.length - complete) };
}

export function validateMedicationEpaCase(caseItem = {}, targetStatus = caseItem.status) {
  const reasons = [];
  const status = normalizeCaseStatus(targetStatus);
  const providerSummary = providerQuestionSummary(caseItem);
  const needsProviderReady = ["ready_for_staff", "benefit_check", "ready_to_submit", "submitted_external", "pending", "approved", "denied", "appeal", "no_pa_required", "closed"].includes(status);
  if (needsProviderReady && providerSummary.missing) reasons.push(`${providerSummary.missing} provider question${providerSummary.missing === 1 ? " remains" : "s remain"} unanswered.`);
  if (needsProviderReady && !caseItem.providerReview?.attested) reasons.push("Provider attestation is required.");
  if (needsProviderReady && caseItem.providerReview?.attested && !clean(caseItem.providerReview?.attestedBy, 160)) reasons.push("Provider name is required for attestation.");
  const evidence = caseItem.coverageEvidence || {};
  if (["pa_required_confirmed", "no_pa_required_confirmed"].includes(evidence.status)) {
    if (!evidence.sourceType || evidence.sourceType === "none") reasons.push("Confirmed coverage requires an authorized source type.");
    if (!clean(evidence.sourceLabel, 240)) reasons.push("Confirmed coverage requires a source reference or label.");
    if (!evidence.checkedAt) reasons.push("Confirmed coverage requires the date and time checked.");
  }
  if (["ready_to_submit", "submitted_external", "pending", "approved", "denied", "appeal"].includes(status) && evidence.status !== "pa_required_confirmed") {
    reasons.push("Record an externally confirmed PA-required result before submission.");
  }
  if (status === "no_pa_required" && evidence.status !== "no_pa_required_confirmed") reasons.push("Record an externally confirmed no-PA-required result.");
  if (["submitted_external", "pending", "approved", "denied", "appeal"].includes(status)) {
    if (!caseItem.submission?.submittedAt) reasons.push("Submission date and time are required.");
    if (!caseItem.submission?.method || caseItem.submission.method === "none") reasons.push("Submission method is required.");
    if (!clean(caseItem.submission?.reference, 240)) reasons.push("Submission reference or confirmation is required.");
  }
  if (["approved", "denied"].includes(status) && !caseItem.submission?.decisionAt) reasons.push("Decision date and time are required.");
  if (status === "closed" && !clean(caseItem.submission?.decisionReason || caseItem.submission?.notes, 3000)) reasons.push("Document the closed outcome or reason.");
  return { valid: reasons.length === 0, reasons, providerSummary };
}

export function updateMedicationEpaCase(caseItem = {}, patch = {}, now = new Date()) {
  const updated = {
    ...caseItem,
    ...patch,
    coverageProfile: normalizeCoverageProfile({ ...caseItem.coverageProfile, ...patch.coverageProfile }),
    coverageEvidence: normalizeCoverageEvidence({ ...caseItem.coverageEvidence, ...patch.coverageEvidence }),
    providerReview: normalizeProviderReview({ ...caseItem.providerReview, ...patch.providerReview }),
    submission: normalizeSubmission({ ...caseItem.submission, ...patch.submission }),
    questions: [].concat(patch.questions || caseItem.questions || []).map((item) => normalizeQuestion(item)),
    nextActionAt: iso(patch.nextActionAt ?? caseItem.nextActionAt),
    updatedAt: new Date(now).toISOString(),
  };
  updated.payerQuestionnaire = normalizeQuestionnaire({ ...caseItem.payerQuestionnaire, ...patch.payerQuestionnaire }, updated.questions);
  const status = normalizeCaseStatus(patch.status ?? caseItem.status);
  const validation = validateMedicationEpaCase(updated, status);
  if (!validation.valid) return { ok: false, reasons: validation.reasons, caseItem };
  const priorStatus = normalizeCaseStatus(caseItem.status);
  updated.status = status;
  if (updated.providerReview.attested && !updated.providerReview.attestedAt) updated.providerReview.attestedAt = new Date(now).toISOString();
  if (!updated.providerReview.attested) updated.providerReview.attestedAt = "";
  if (priorStatus !== status) {
    updated.events = [...[].concat(caseItem.events || []), { at: new Date(now).toISOString(), text: `Status changed from ${EPA_CASE_STATUSES[priorStatus]} to ${EPA_CASE_STATUSES[status]}` }].slice(-50);
  }
  return { ok: true, reasons: [], caseItem: updated };
}

export function medicationEpaCaseUrgency(caseItem = {}, now = new Date()) {
  if (TERMINAL_CASE_STATUSES.has(caseItem.status)) return { level: "complete", label: "Complete", overdue: false };
  const due = new Date(caseItem.nextActionAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(due)) return { level: "warning", label: "Follow-up date needed", overdue: false };
  if (due <= current) return { level: "overdue", label: "PA follow-up overdue", overdue: true };
  const hours = (due - current) / 36e5;
  if (hours <= 4) return { level: "critical", label: "PA follow-up due soon", overdue: false };
  if (hours <= 24) return { level: "warning", label: "PA follow-up due today", overdue: false };
  return { level: "ontrack", label: "PA follow-up scheduled", overdue: false };
}

export function medicationEpaSummary(cases = [], now = new Date()) {
  return [].concat(cases || []).reduce((summary, item) => {
    summary.total += 1;
    if (TERMINAL_CASE_STATUSES.has(item.status)) summary.complete += 1;
    else summary.open += 1;
    if (item.status === "ready_for_staff") summary.readyForStaff += 1;
    if (["submitted_external", "pending"].includes(item.status)) summary.pending += 1;
    if (medicationEpaCaseUrgency(item, now).overdue) summary.overdue += 1;
    return summary;
  }, { total: 0, open: 0, complete: 0, readyForStaff: 0, pending: 0, overdue: 0 });
}

export function isMedicationEpaCaseComplete(caseItem = {}) {
  return TERMINAL_CASE_STATUSES.has(caseItem.status);
}
