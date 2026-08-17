const CMS_PFS_URL = "https://www.cms.gov/medicare/payment/fee-schedules/physician/evaluation-management-visits";
const CMS_G2211_URL = "https://www.cms.gov/files/document/mm13473-how-use-office-and-outpatient-evaluation-and-management-visit-complexity-add-code-g2211.pdf";
const CMS_ACP_URL = "https://www.cms.gov/medicare/coverage/preventive-services/medicare-wellness-visits/annual-wellness-visit";
const AMA_EM_URL = "https://www.ama-assn.org/practice-management/cpt/cpt-evaluation-and-management-em-revisions-faqs";

const EM_TIME = Object.freeze({
  new: [
    { code: "99202", min: 15, max: 29 },
    { code: "99203", min: 30, max: 44 },
    { code: "99204", min: 45, max: 59 },
    { code: "99205", min: 60, max: 74 },
  ],
  established: [
    { code: "99212", min: 10, max: 19 },
    { code: "99213", min: 20, max: 29 },
    { code: "99214", min: 30, max: 39 },
    { code: "99215", min: 40, max: 54 },
  ],
});

const EM_MDM = Object.freeze({
  new: { straightforward: "99202", low: "99203", moderate: "99204", high: "99205" },
  established: { straightforward: "99212", low: "99213", moderate: "99214", high: "99215" },
});

const MDM_RANK = Object.freeze({ straightforward: 1, low: 2, moderate: 3, high: 4 });
const MDM_LABEL = Object.freeze({ 1: "straightforward", 2: "low", 3: "moderate", 4: "high" });
const CLARIFICATION_DECISIONS = new Set(["pending", "occurred", "already_documented", "not_done", "not_applicable"]);

const EXACT_DIAGNOSES = Object.freeze([
  { phrase: "essential hypertension", code: "I10", label: "Essential (primary) hypertension" },
  { phrase: "primary hypertension", code: "I10", label: "Essential (primary) hypertension" },
  { phrase: "type 2 diabetes mellitus without complications", code: "E11.9", label: "Type 2 diabetes mellitus without complications" },
  { phrase: "mixed hyperlipidemia", code: "E78.2", label: "Mixed hyperlipidemia" },
  { phrase: "generalized anxiety disorder", code: "F41.1", label: "Generalized anxiety disorder" },
  { phrase: "major depressive disorder, recurrent, moderate", code: "F33.1", label: "Major depressive disorder, recurrent, moderate" },
  { phrase: "morbid (severe) obesity due to excess calories", code: "E66.01", label: "Morbid (severe) obesity due to excess calories" },
  { phrase: "chronic kidney disease, stage 3a", code: "N18.31", label: "Chronic kidney disease, stage 3a" },
  { phrase: "chronic kidney disease, stage 3b", code: "N18.32", label: "Chronic kidney disease, stage 3b" },
]);

const cleanCodes = (values = []) => new Set([].concat(values || []).map((value) => String(value).trim().toUpperCase()).filter(Boolean));

function evidenceSnippet(note, index, length) {
  const start = Math.max(0, index - 45);
  const end = Math.min(note.length, index + length + 80);
  return note.slice(start, end).replace(/\s+/g, " ").trim();
}

function matchEvidence(note, expression) {
  const match = expression.exec(note);
  return match ? evidenceSnippet(note, match.index, match[0].length) : "";
}

export function documentedTotalMinutes(noteText = "") {
  const note = String(noteText);
  const patterns = [
    /(?:total\s+(?:provider\s+)?time|total\s+time\s+spent)\D{0,24}(\d{1,3})\s*(?:minutes?|mins?)\b/i,
    /(?:spent|personally\s+spent)\s+(\d{1,3})\s*(?:minutes?|mins?)\b[^.\n]{0,60}\b(?:total|today|encounter|visit)\b/i,
    /\b(\d{1,3})\s*(?:minutes?|mins?)\s+(?:of\s+)?total\s+(?:provider\s+)?time\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(note);
    const minutes = Number(match?.[1]);
    if (Number.isInteger(minutes) && minutes > 0 && minutes <= 480) {
      return { minutes, evidence: evidenceSnippet(note, match.index, match[0].length) };
    }
  }
  return null;
}

function visitFamily(visitType = "", codes = new Set()) {
  const visit = String(visitType).toLowerCase();
  if (/new patient/.test(visit) || [...codes].some((code) => /^9920[2-5]$/.test(code))) return "new";
  if (/established|office|telehealth/.test(visit) || [...codes].some((code) => /^9921[2-5]$/.test(code))) return "established";
  return null;
}

function emForMinutes(family, minutes) {
  return EM_TIME[family]?.find((level) => minutes >= level.min && minutes <= level.max) || null;
}

function makeOpportunity(value) {
  return {
    id: `${value.category}:${value.action}:${value.replaceCode || "none"}:${value.code}`,
    status: "pending",
    confidence: "review",
    evidence: "",
    missingDocumentation: "",
    coverageNote: "",
    requiresDecision: false,
    clarifications: [],
    ...value,
  };
}

function mergeDecisionState(next, existing = []) {
  const decisions = new Map([].concat(existing || []).map((item) => [item.id, item]));
  const merged = next.map((item) => {
    const previous = decisions.get(item.id);
    if (!previous) return item;
    const clarificationDecisions = new Map([].concat(previous.clarifications || []).map((question) => [question.id, question]));
    const clarifications = [].concat(item.clarifications || []).map((question) => {
      const prior = clarificationDecisions.get(question.id);
      return prior ? {
        ...question,
        decision: CLARIFICATION_DECISIONS.has(prior.decision) ? prior.decision : "pending",
        providerResponse: prior.providerResponse || "",
        approvedAddendum: prior.approvedAddendum || "",
        decidedAt: prior.decidedAt || "",
        addendumAppliedAt: prior.addendumAppliedAt || "",
      } : question;
    });
    return { ...item, status: previous.status || "pending", decidedAt: previous.decidedAt || "", clarifications };
  });
  const currentIds = new Set(merged.map((item) => item.id));
  for (const previous of decisions.values()) {
    if (!currentIds.has(previous.id) && ["applied", "dismissed"].includes(previous.status)) merged.push(previous);
  }
  return merged;
}

function findCurrentEm(codes, family) {
  const expression = family === "new" ? /^9920[2-5]$/ : /^9921[2-5]$/;
  return [...codes].find((code) => expression.test(code)) || "";
}

function rankForEm(code = "", family = "") {
  const match = Object.entries(EM_MDM[family] || {}).find(([, value]) => value === String(code).toUpperCase());
  return match ? MDM_RANK[match[0]] : 0;
}

function sectionProblems(note = "") {
  const assessment = String(note).match(/\bassessment\s*:?([\s\S]*?)(?:\bplan\s*:|$)/i)?.[1] || "";
  const numbered = assessment.match(/(?:^|\n)\s*\d+[.)]\s*[^\n]+/gm) || [];
  return numbered.slice(0, 3).map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim());
}

function documentedChronicProblems(lines = []) {
  const chronic = /\b(?:chronic|adhd|attention[- ]deficit|hypertension|diabetes|hyperlipidemia|anxiety|depression|kidney\s+disease|ckd|asthma|copd|heart\s+failure|obesity|arthritis|migraine|seizure|hiv|hepatitis)\b/i;
  const addressed = /\b(?:stable|improved|controlled|continue|monitor|manage|treat|follow[- ]?up|refill|increase|decrease|adjust)\b/i;
  return lines.filter((line) => chronic.test(line) && addressed.test(line));
}

function mdmEvidence(noteText = "") {
  const note = String(noteText || "");
  const problems = { rank: 0, evidence: "", hint: "" };
  const data = { rank: 0, evidence: "", hint: "" };
  const risk = { rank: 0, evidence: "", hint: "" };

  const highProblem = matchEvidence(note, /\b(?:severe\s+exacerbation|severe\s+progression|threat(?:ens|ening)?\s+(?:to\s+)?life|threat(?:ens|ening)?\s+(?:to\s+)?bodily\s+function)\b/i);
  const moderateProblem = matchEvidence(note, /\b(?:exacerbation|progression|not\s+at\s+goal|uncontrolled|worsening|treatment\s+side\s+effects?|uncertain\s+prognosis|acute\s+illness\s+with\s+systemic\s+symptoms)\b/i);
  const assessedProblems = sectionProblems(note);
  const chronicProblems = documentedChronicProblems(assessedProblems);
  if (highProblem) Object.assign(problems, { rank: 4, evidence: highProblem });
  else if (moderateProblem) Object.assign(problems, { rank: 3, evidence: moderateProblem });
  else if (chronicProblems.length >= 2) Object.assign(problems, { rank: 3, evidence: chronicProblems.join(" | ") });
  else {
    const oneProblem = matchEvidence(note, /\b(?:stable|follow[- ]?up\s+(?:of|for)|assessment)\b[^.\n]{0,140}/i);
    if (oneProblem) Object.assign(problems, { rank: 2, evidence: oneProblem });
  }
  problems.hint = problems.evidence || matchEvidence(note, /\b(?:assessment|diagnosis|problem|condition|symptom|follow[- ]?up)\b[^.\n]{0,140}/i);

  const highRisk = matchEvidence(note, /\b(?:decision\s+(?:was\s+made\s+)?(?:to\s+)?hospitali[sz]e|hospital\s+admission|escalation\s+of\s+hospital[- ]level\s+care|drug\s+therapy\s+requiring\s+intensive\s+monitoring\s+for\s+toxicity|emergency\s+major\s+surgery|de[- ]escalation\s+of\s+care\s+because\s+of\s+poor\s+prognosis)\b/i);
  const prescriptionManagement = matchEvidence(note, /\b(?:start(?:ed|ing)?|initiat(?:e|ed|ing)|continue(?:d|ing)?|refill(?:ed|ing)?|renew(?:ed|ing)?|increase(?:d|ing)?|decrease(?:d|ing)?|adjust(?:ed|ing)?|discontinue(?:d|ing)?|stop(?:ped|ping)?|prescrib(?:e|ed|ing))\b[^.\n]{0,160}\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?)\b/i);
  const otherModerateRisk = matchEvidence(note, /\b(?:prescription\s+drug\s+management|decision\s+regarding\s+(?:elective\s+)?major\s+surgery|diagnosis\s+or\s+treatment\s+significantly\s+limited\s+by\s+social\s+determinants)\b/i);
  if (highRisk) Object.assign(risk, { rank: 4, evidence: highRisk });
  else if (prescriptionManagement || otherModerateRisk) Object.assign(risk, { rank: 3, evidence: prescriptionManagement || otherModerateRisk });
  risk.hint = risk.evidence || matchEvidence(note, /\b(?:medication|prescription|refill|dose|surgery|hospital|monitor(?:ing|ed)?)\b[^.\n]{0,140}/i);

  const highData = matchEvidence(note, /\b(?:independent\s+interpretation)\b[^.\n]{0,180}\b(?:discussed|discussion)\b[^.\n]{0,100}\b(?:external|physician|clinician|provider)\b/i);
  const moderateData = matchEvidence(note, /\b(?:independent\s+interpretation\s+of|discussed\s+(?:management|test\s+interpretation)\s+with\s+(?:an?\s+)?external\s+(?:physician|clinician|provider))\b/i);
  const lowData = matchEvidence(note, /\b(?:ordered|reviewed|analy[sz]ed)\b[^.\n]{0,120}\b(?:lab|test|imaging|x[- ]?ray|mri|ct|cbc|cmp|a1c|record|note|result)\b/i);
  if (highData) Object.assign(data, { rank: 4, evidence: highData });
  else if (moderateData) Object.assign(data, { rank: 3, evidence: moderateData });
  else if (lowData) Object.assign(data, { rank: 2, evidence: lowData });
  data.hint = data.evidence || matchEvidence(note, /\b(?:lab|test|imaging|x[- ]?ray|mri|ct|cbc|cmp|a1c|record|result|historian)\b[^.\n]{0,140}/i);

  const ranks = [problems.rank, data.rank, risk.rank].sort((a, b) => b - a);
  return { problems, data, risk, supportedRank: ranks[1] || 0 };
}

function clarificationFor(domain, signal, targetRank) {
  const target = MDM_LABEL[targetRank];
  const common = {
    id: `mdm:${target}:${domain}`,
    domain,
    targetLevel: target,
    evidence: signal.hint || "",
    decision: "pending",
    providerResponse: "",
    approvedAddendum: "",
    decidedAt: "",
    addendumAppliedAt: "",
  };
  if (domain === "problems") return {
    ...common,
    label: "Problems addressed",
    question: "The note references clinical problems, but the level of assessment and management is not fully explicit. Which problems actually affected your management today, and what was their documented status?",
    reason: "E/M selection by MDM requires the documented problems addressed at the encounter—not the problem list alone.",
  };
  if (domain === "data") return {
    ...common,
    label: "Data reviewed or analyzed",
    question: "The note references tests, records, or results. Which specific data did you personally order, review, independently interpret, or discuss with an external clinician today?",
    reason: "Only qualifying data work personally performed and documented for this encounter may count toward MDM.",
  };
  return {
    ...common,
    label: "Management risk",
    question: "The note references medication or another management decision. What prescription, procedure, hospitalization, or monitoring decision did you personally make today?",
    reason: "The risk element is based on the documented management decision, not merely the presence of a medication or condition.",
  };
}

function mdmOpportunity(encounter, codes, family) {
  if (!family) return null;
  const current = findCurrentEm(codes, family);
  if (!current) return null;
  const currentRank = rankForEm(current, family);
  const assessment = mdmEvidence(encounter.note);
  if (assessment.supportedRank > currentRank) {
    const level = MDM_LABEL[assessment.supportedRank];
    const code = EM_MDM[family][level];
    return makeOpportunity({
      category: "cpt",
      action: "replace",
      code,
      replaceCode: current,
      reviewKind: "mdm_supported",
      requiresDecision: true,
      supportedBy: "mdm",
      title: `Review ${current} → ${code} by documented ${level} MDM`,
      confidence: "high",
      evidence: [assessment.problems.evidence, assessment.data.evidence, assessment.risk.evidence].filter(Boolean).join(" | "),
      missingDocumentation: "Confirm that at least two of the three MDM elements are documented at this level and that the selected code matches the patient relationship and current-year rules.",
      coverageNote: "Provider review required. A code is never applied automatically, and medical necessity—not a desired payment level—must support the service.",
      sourceLabel: "AMA CPT E/M revisions FAQ",
      sourceUrl: AMA_EM_URL,
      mdm: assessment,
    });
  }

  const targetRank = Math.min(4, currentRank + 1);
  if (targetRank <= currentRank) return null;
  const domains = ["problems", "data", "risk"];
  const supportedDomains = domains.filter((domain) => assessment[domain].rank >= targetRank);
  const hintedMissingDomains = domains.filter((domain) => assessment[domain].rank < targetRank && assessment[domain].hint);
  if (!supportedDomains.length || !hintedMissingDomains.length) return null;
  const targetLevel = MDM_LABEL[targetRank];
  const code = EM_MDM[family][targetLevel];
  return makeOpportunity({
    category: "cpt",
    action: "review",
    code,
    replaceCode: current,
    reviewKind: "mdm_clarification",
    requiresDecision: true,
    supportedBy: "mdm",
    title: `Clarify whether ${code} is supported by ${targetLevel} MDM`,
    evidence: supportedDomains.map((domain) => assessment[domain].evidence).filter(Boolean).join(" | "),
    missingDocumentation: "One MDM element appears documented at the candidate level, but a second qualifying element is not yet clear. Answer only from work that actually occurred; do not add work after the visit to justify a higher code.",
    coverageNote: "Clarification only. The candidate remains unavailable until provider-confirmed facts are added to the note and the coding analysis supports the level on rerun.",
    sourceLabel: "AMA CPT E/M revisions FAQ",
    sourceUrl: AMA_EM_URL,
    mdm: assessment,
    clarifications: hintedMissingDomains.map((domain) => clarificationFor(domain, assessment[domain], targetRank)),
  });
}

function g2211Evidence(note = "") {
  const direct = matchEvidence(note, /\b(?:longitudinal|ongoing\s+(?:primary\s+)?care|continuing\s+care|principal\s+care|primary\s+care\s+relationship|continuing\s+focal\s+point|focal\s+point\s+for\s+(?:all\s+)?needed\s+health\s+care|ongoing\s+(?:medical\s+)?care\s+(?:related\s+to|for)\s+(?:a|the)\s+(?:single[,\s]+)?(?:serious|complex)\s+(?:condition|problem))\b/i);
  if (direct) return { evidence: direct, action: "add", confidence: "review", kind: "supported" };

  const continuityReview = matchEvidence(note, /\b(?:chronic\s+care\s+(?:management|follow[- ]?up)|follow[- ]?up\s+in\s+\d{1,2}\s+(?:days?|weeks?|months?)[^.\n]{0,100}\bchronic\s+care|return\s+in\s+\d{1,2}\s+(?:days?|weeks?|months?)[^.\n]{0,100}\bchronic\s+care)\b/i);
  if (continuityReview) return { evidence: continuityReview, action: "review", confidence: "review", kind: "documentation_needed" };
  return null;
}

export function codingOpportunities(encounter = {}, existing = []) {
  const note = String(encounter.note || "");
  const codes = cleanCodes(encounter.codes);
  const diagnoses = cleanCodes(encounter.diagnoses);
  const opportunities = [];
  const totalTime = documentedTotalMinutes(note);
  const family = visitFamily(encounter.visitType, codes);

  if (totalTime && family) {
    const recommended = emForMinutes(family, totalTime.minutes);
    const current = findCurrentEm(codes, family);
    if (recommended && current !== recommended.code) {
      const isHigher = !current || rankForEm(recommended.code, family) > rankForEm(current, family);
      const currentSupportedByMdm = !isHigher && mdmEvidence(note).supportedRank >= rankForEm(current, family);
      if (!currentSupportedByMdm) opportunities.push(makeOpportunity({
        category: "cpt",
        action: isHigher ? (current ? "replace" : "add") : "review",
        code: recommended.code,
        replaceCode: current,
        reviewKind: isHigher ? "time_supported" : "time_conflict",
        requiresDecision: true,
        supportedBy: "time",
        title: isHigher
          ? `${current ? `Review ${current} → ` : "Review adding "}${recommended.code} by documented total time`
          : `Reconcile ${current} with documented time range for ${recommended.code}`,
        confidence: "high",
        evidence: totalTime.evidence,
        missingDocumentation: isHigher
          ? "Confirm the documented total includes only qualifying same-day practitioner work before applying the higher time-based code."
          : "The documented time range is lower than the entered code. Do not replace it if the current code is instead supported by documented MDM; reconcile the selection before approval.",
        coverageNote: `The note explicitly states ${totalTime.minutes} total minutes. Confirm the time includes only permitted same-day practitioner work and that MDM does not support a different selection.`,
        sourceLabel: "CMS Evaluation & Management Services",
        sourceUrl: CMS_PFS_URL,
      }));
    }
  }

  const mdm = mdmOpportunity(encounter, codes, family);
  if (mdm) {
    const sameCandidate = opportunities.find((item) => item.category === "cpt" && item.code === mdm.code && item.replaceCode === mdm.replaceCode);
    if (sameCandidate && mdm.action === "replace") {
      sameCandidate.supportedBy = "time_and_mdm";
      sameCandidate.title = `${sameCandidate.title} (also supported by documented MDM)`;
      sameCandidate.evidence = [sameCandidate.evidence, mdm.evidence].filter(Boolean).join(" | ");
    } else opportunities.push(mdm);
  }

  const effectiveOfficeCode = findCurrentEm(codes, family) || opportunities.find((item) => item.category === "cpt" && /^992/.test(item.code))?.code;
  const g2211 = g2211Evidence(note);
  if (/medicare/i.test(String(encounter.payer || "")) && effectiveOfficeCode && g2211 && !codes.has("G2211")) {
    opportunities.push(makeOpportunity({
      category: "cpt",
      action: g2211.action,
      code: "G2211",
      reviewKind: g2211.kind,
      title: g2211.action === "add"
        ? "Revenue opportunity: review adding G2211"
        : "Revenue opportunity: evaluate G2211 eligibility",
      confidence: g2211.confidence,
      evidence: g2211.evidence,
      missingDocumentation: g2211.action === "add"
        ? "Confirm this visit reflects the clinician’s continuing focal point for needed care or ongoing care for a single serious/complex condition, and confirm same-day payment edits before adding the code."
        : "The note suggests planned chronic-care continuity, but that phrase alone does not establish G2211. Confirm the clinician-patient relationship and document the continuing focal-point or serious/complex-condition basis before billing.",
      coverageNote: "Medicare-specific review candidate. G2211 is an office/outpatient E/M visit-complexity add-on; verify current-year CMS rules, same-day service edits, and payer eligibility before billing.",
      sourceLabel: "CMS G2211 guidance",
      sourceUrl: CMS_G2211_URL,
    }));
  }

  const acpEvidence = matchEvidence(note, /\b(?:advance\s+care\s+planning|advance\s+directive|living\s+will|healthcare\s+(?:proxy|power\s+of\s+attorney)|goals\s+of\s+care)\b/i);
  if (acpEvidence && !codes.has("99497")) {
    const acpTimeMatch = /(?:advance\s+care\s+planning|ACP)[^.\n]{0,100}?(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(note)
      || /(\d{1,3})\s*(?:minutes?|mins?)[^.\n]{0,100}?(?:advance\s+care\s+planning|ACP)\b/i.exec(note);
    const acpMinutes = Number(acpTimeMatch?.[1] || 0);
    opportunities.push(makeOpportunity({
      category: "cpt",
      action: acpMinutes >= 16 ? "add" : "review",
      code: "99497",
      title: "Review advance-care-planning service 99497",
      confidence: acpMinutes >= 16 ? "high" : "review",
      evidence: acpEvidence,
      missingDocumentation: acpMinutes >= 16
        ? "Confirm the discussion was voluntary and all ACP billing elements are documented."
        : "A qualifying ACP time statement and voluntary-discussion documentation were not found; do not add the code until supported.",
      coverageNote: "99497 represents the first 30 minutes (minimum threshold applies). Check same-day code edits and payer policy.",
      sourceLabel: "CMS Advance Care Planning",
      sourceUrl: CMS_ACP_URL,
    }));
    if (acpMinutes >= 46 && !codes.has("99498")) {
      opportunities.push(makeOpportunity({
        category: "cpt",
        action: "add",
        code: "99498",
        title: "Review one additional ACP unit 99498",
        confidence: "high",
        evidence: evidenceSnippet(note, acpTimeMatch.index, acpTimeMatch[0].length),
        missingDocumentation: "Confirm total qualifying ACP time and the number of additional units.",
        coverageNote: "Additional-time code; verify unit count, same-day edits, and payer policy.",
        sourceLabel: "CMS Advance Care Planning",
        sourceUrl: CMS_ACP_URL,
      }));
    }
  }

  const lowerNote = note.toLowerCase();
  const suggestedDiagnoses = new Set();
  for (const diagnosis of EXACT_DIAGNOSES) {
    const index = lowerNote.indexOf(diagnosis.phrase);
    if (index < 0 || diagnoses.has(diagnosis.code) || suggestedDiagnoses.has(diagnosis.code)) continue;
    suggestedDiagnoses.add(diagnosis.code);
    opportunities.push(makeOpportunity({
      category: "icd",
      action: "add",
      code: diagnosis.code,
      title: `Review adding ${diagnosis.code} — ${diagnosis.label}`,
      confidence: "high",
      evidence: evidenceSnippet(note, index, diagnosis.phrase.length),
      missingDocumentation: "Confirm this diagnosis was assessed or affected management today, is current, and is coded to the highest supported specificity.",
      coverageNote: "Candidate is based on an exact diagnostic phrase in the note; it is not inferred from symptoms, medications, or test results.",
      sourceLabel: "Current ICD-10-CM code set—verify before claim submission",
      sourceUrl: "https://www.cdc.gov/nchs/icd/icd-10-cm/files.html",
    }));
  }

  return mergeDecisionState(opportunities, existing);
}

export function applyCodingOpportunity(encounter, opportunity, now = new Date()) {
  if (!encounter || !opportunity || !["add", "replace"].includes(opportunity.action)) return false;
  if ([].concat(opportunity.clarifications || []).some((question) => question.decision === "pending")) return false;
  const field = opportunity.category === "icd" ? "diagnoses" : "codes";
  const values = cleanCodes(encounter[field]);
  if (opportunity.action === "replace" && opportunity.replaceCode) values.delete(String(opportunity.replaceCode).toUpperCase());
  values.add(String(opportunity.code).toUpperCase());
  encounter[field] = [...values];
  opportunity.status = "applied";
  opportunity.decidedAt = new Date(now).toISOString();
  return true;
}

export function resolveCodingClarification(opportunity, clarificationId, decision, details = {}, now = new Date()) {
  if (!opportunity || !CLARIFICATION_DECISIONS.has(decision) || decision === "pending") return false;
  const question = [].concat(opportunity.clarifications || []).find((item) => item.id === clarificationId);
  if (!question) return false;
  const providerResponse = String(details.providerResponse || "").trim();
  const approvedAddendum = String(details.approvedAddendum || "").trim();
  if (decision === "occurred" && !approvedAddendum) return false;
  if (decision === "already_documented" && !providerResponse) return false;
  question.decision = decision;
  question.providerResponse = providerResponse;
  question.approvedAddendum = decision === "occurred" ? approvedAddendum : "";
  question.decidedAt = new Date(now).toISOString();
  const unresolved = opportunity.clarifications.some((item) => item.decision === "pending");
  const potentiallySupporting = opportunity.clarifications.some((item) => ["occurred", "already_documented"].includes(item.decision));
  if (!unresolved && !potentiallySupporting) {
    opportunity.status = "dismissed";
    opportunity.decidedAt = new Date(now).toISOString();
  }
  return true;
}

export function approvedCodingAddenda(recommendations = []) {
  return [].concat(recommendations || []).flatMap((recommendation) => [].concat(recommendation.clarifications || [])
    .filter((question) => question.decision === "occurred" && question.approvedAddendum && !question.addendumAppliedAt)
    .map((question) => ({ recommendationId: recommendation.id, id: question.id, text: question.approvedAddendum })));
}
