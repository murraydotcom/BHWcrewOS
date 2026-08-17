import { controlledMedicationReviews } from "./structured-encounter.mjs";

const SEVERITIES = ["critical", "high", "moderate", "low"];
const RESOLVED_DECISIONS = new Set(["occurred", "already_documented", "not_done", "dismissed"]);

const clean = (value) => String(value ?? "").replace(/\r/g, "").trim();
const unique = (values) => Array.from(new Set(values.filter(Boolean)));

function severityFromText(text, fallback = "moderate") {
  const match = clean(text).match(/\b(CRITICAL|HIGH|MODERATE|LOW)\b/i);
  return match ? match[1].toLowerCase() : fallback;
}

function sectionFor(line) {
  const normalized = clean(line).replace(/^[^A-Z0-9]+/i, "").toUpperCase();
  if (/FIX BEFORE CLOSING/.test(normalized)) return "fix";
  if (/STRENGTHEN/.test(normalized)) return "strengthen";
  if (/NOTE FOR FUTURE/.test(normalized)) return "future";
  if (/GUIDELINE NOTES?/.test(normalized)) return "guidelines";
  if (/COMPLETE/.test(normalized)) return "complete";
  if (/CODING AS DOCUMENTED|CODES? AS DOCUMENTED|SUPPORTED (?:CODES?|CODING)/.test(normalized)) return "codes_documented";
  if (/CODING AFTER CONFIRMED CHANGES|AFTER (?:THE )?(?:FIX|FIXES|CHANGE|CHANGES)|SUGGESTED (?:CODES?|CODING)|THEN ADD CPT/.test(normalized)) return "codes_after";
  if (/NEXT ACTION/.test(normalized)) return "next";
  return "";
}

function stripListPrefix(line) {
  return clean(line).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

function stripMarkdownLabel(value, label) {
  return clean(value)
    .replace(new RegExp(`^\\*{0,2}${label}\\*{0,2}\\s*[:\\-]\\s*`, "i"), "")
    .replace(/^\*{1,2}|\*{1,2}$/g, "")
    .trim();
}

function findingLineRole(value) {
  const item = stripListPrefix(value);
  if (/^\*{0,2}(?:SUGGESTED\s+FIX|RECOMMENDED\s+FIX|FIX)\*{0,2}\s*[:\-]/i.test(item)) return "suggested_fix";
  if (/^\*{0,2}(?:LOCATION(?:\s*\/\s*FIX)?|WHERE\s+IN\s+(?:THE\s+)?NOTE)\*{0,2}\s*[:\-]/i.test(item)) return "location";
  if (/^\*{0,2}(?:ISSUE|FINDING)\*{0,2}\s*[:\-]/i.test(item)) return "issue";
  if (/^\*{0,2}(?:SUPPORTING\s+SOURCE|SOURCE)\*{0,2}\s*[:\-]/i.test(item)) return "supporting_source";
  return "";
}

function findingLineText(value, role) {
  const item = stripListPrefix(value);
  if (role === "suggested_fix") return stripMarkdownLabel(item, "(?:SUGGESTED\\s+FIX|RECOMMENDED\\s+FIX|FIX)");
  if (role === "location") return stripMarkdownLabel(item, "(?:LOCATION(?:\\s*\\/\\s*FIX)?|WHERE\\s+IN\\s+(?:THE\\s+)?NOTE)");
  if (role === "issue") return stripMarkdownLabel(item, "(?:ISSUE|FINDING)");
  if (role === "supporting_source") return stripMarkdownLabel(item, "(?:SUPPORTING\\s+SOURCE|SOURCE)");
  return item.replace(/^\*{1,2}|\*{1,2}$/g, "").trim();
}

function codeCandidates(text, type) {
  const source = clean(text).toUpperCase();
  if (type === "cpt") {
    return unique((source.match(/\b(?:[0-9]{5}|[A-Z][0-9]{4})\b/g) || [])
      .filter((code) => !/^20\d{3}$/.test(code)));
  }
  return unique((source.match(/\b[A-TV-Z][0-9][0-9](?:\.[A-Z0-9]{1,4})?\b/g) || []));
}

function parseSuggestedCodes(lines) {
  const cpt = [];
  const icd10 = [];
  lines.forEach((line) => {
    if (/CPT|HCPCS/i.test(line)) cpt.push(...codeCandidates(line, "cpt"));
    if (/ICD(?:-?10)?|DIAGNOS/i.test(line)) icd10.push(...codeCandidates(line, "icd10"));
  });
  return { cpt: unique(cpt), icd10: unique(icd10) };
}

function makeFinding(text, severity, index) {
  const role = findingLineRole(text);
  const item = findingLineText(text, role);
  const parts = item.split(/\s+\|\s+/).map(clean).filter(Boolean);
  const issuePart = parts.find((part) => /^(?:\[[^\]]+\]\s*)?(?:\*{0,2})?(?:ISSUE|FINDING)(?:\*{0,2})?\s*:/i.test(part));
  const locationPart = parts.find((part) => /^(?:\*{0,2})?(?:LOCATION|WHERE\s+IN\s+(?:THE\s+)?NOTE)(?:\*{0,2})?\s*:/i.test(part));
  const fixPart = parts.find((part) => /^(?:\*{0,2})?(?:SUGGESTED\s+FIX|RECOMMENDED\s+FIX|FIX)(?:\*{0,2})?\s*:/i.test(part));
  const sourcePart = parts.find((part) => /^(?:\*{0,2})?(?:SUPPORTING\s+SOURCE|SOURCE)(?:\*{0,2})?\s*:/i.test(part));
  const inlineLocation = item.match(/\bLocation\s*:\s*/i);
  const inlineFix = item.match(/\bSuggested\s+fix\s*:\s*/i);
  const firstInlineField = [inlineLocation?.index, inlineFix?.index].filter(Number.isInteger).sort((a, b) => a - b)[0];
  const legacyIssue = Number.isInteger(firstInlineField) ? item.slice(0, firstInlineField) : item;
  let legacyLocation = "";
  if (inlineLocation) {
    const start = inlineLocation.index + inlineLocation[0].length;
    const end = inlineFix && inlineFix.index > inlineLocation.index ? inlineFix.index : item.length;
    legacyLocation = item.slice(start, end).trim();
  }
  const legacyFix = inlineFix ? item.slice(inlineFix.index + inlineFix[0].length).trim() : "";
  const issue = clean(issuePart || legacyIssue)
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^\*{0,2}(?:ISSUE|FINDING)\*{0,2}\s*:\s*/i, "");
  const location = locationPart ? locationPart.replace(/^\*{0,2}(?:LOCATION|WHERE\s+IN\s+(?:THE\s+)?NOTE)\*{0,2}\s*:\s*/i, "").trim() : legacyLocation || "See audit finding";
  const suggestedFix = fixPart ? fixPart.replace(/^\*{0,2}(?:SUGGESTED\s+FIX|RECOMMENDED\s+FIX|FIX)\*{0,2}\s*:\s*/i, "").trim() : legacyFix || "Provider review/correction requested.";
  const supportingSource = sourcePart
    ? sourcePart.replace(/^\*{0,2}(?:SUPPORTING\s+SOURCE|SOURCE)\*{0,2}\s*:\s*/i, "").trim()
    : "Current primary-source or BHW policy verification required.";
  return {
    id: `audit:${index + 1}`,
    severity: severityFromText(item, severity),
    issue,
    location,
    suggestedFix,
    supportingSource,
    decision: "pending",
    providerResponse: "",
    approvedAddendum: "",
    decidedAt: "",
  };
}

export function emptyClinicalAudit() {
  return {
    status: "not_run",
    importedAt: "",
    source: "BHW chart audit",
    verdict: "",
    estimatedFixMinutes: null,
    recommendedRisk: "",
    rawReport: "",
    findings: [],
    guidelineNotes: [],
    guidelineChecks: [],
    completeNotes: [],
    codingAsDocumented: { cpt: [], icd10: [], hccRelevance: "", zCodes: [], zCodeEvidence: "" },
    suggestedCodesAfterChanges: { cpt: [], icd10: [] },
    baselineCodes: [],
    baselineDiagnoses: [],
    sourceNoteHash: "",
    automatedAt: "",
    model: "",
    automationRunId: "",
  };
}

const CONTROLLED_CHECK_LABELS = Object.freeze({
  diagnosisLinkage: "Diagnosis/indication linkage",
  doseFrequency: "Dose and frequency",
  pdmp: "Applicable PDMP review",
  agreementConsent: "Applicable agreement or consent",
  monitoring: "Applicable monitoring",
  safetyCounseling: "Safety counseling",
  followUp: "Follow-up plan",
});

const CONTROLLED_FINDING_PATTERNS = Object.freeze({
  diagnosisLinkage: /\b(?:diagnos(?:is|es|tic)|indication|icd-?10|linked?)\b/i,
  doseFrequency: /\b(?:dose|dosage|frequency|times? daily|bid|tid|qid|qhs|prn)\b/i,
  pdmp: /\b(?:pdmp|prescription drug monitoring|crisp\s+pdmp)\b/i,
  agreementConsent: /\b(?:agreement|consent|contract)\b/i,
  monitoring: /\b(?:monitoring|urine drug|drug screen|uds|toxicology|pill count)\b/i,
  safetyCounseling: /\b(?:safety counsel|side effect|safe storage|sedation|overdose|naloxone|avoid alcohol|do not drive|dependence|misuse)\w*\b/i,
  followUp: /\b(?:follow[- ]?up|return\s+(?:in|to)|rtc|recheck)\b/i,
});

function findingText(finding = {}) {
  return `${finding.issue || ""} ${finding.location || ""} ${finding.suggestedFix || ""}`.toLowerCase();
}

function findingAppliesToControlledMedication(finding, review, reviewCount) {
  if (finding.id?.startsWith(`${review.findingPrefix}:`)) return true;
  const text = findingText(finding);
  const medicationTokens = String(review.medicationKey || review.medication || "")
    .toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 5);
  if (medicationTokens.some((token) => text.includes(token))) return true;
  return reviewCount === 1 && /\b(?:controlled|schedule\s+(?:ii|iii|iv|v)|stimulant|opioid|benzodiazepine|pdmp|urine drug|uds|toxicology)\b/i.test(text);
}

function matchingControlledFinding(findings, review, checkKey, reviewCount) {
  const exactId = `${review.findingPrefix}:${checkKey}`;
  const exact = findings.find((finding) => finding.id === exactId);
  if (exact) return exact;
  const pattern = CONTROLLED_FINDING_PATTERNS[checkKey];
  if (!pattern) return null;
  return findings.find((finding) => pattern.test(findingText(finding))
    && findingAppliesToControlledMedication(finding, review, reviewCount)) || null;
}

export function controlledClinicalFinding(auditValue, review, checkKey, reviewCount = 1) {
  const audit = normalizeClinicalAudit(auditValue);
  return matchingControlledFinding(audit.findings, review, checkKey, reviewCount);
}

export function addRequiredClinicalFindings(auditValue, encounter = {}) {
  const audit = normalizeClinicalAudit(auditValue);
  const reviews = controlledMedicationReviews(encounter);
  const legacyControlled = audit.findings.filter((finding) => finding.id.startsWith("controlled:"));
  audit.findings = audit.findings.filter((finding) => !finding.id.startsWith("controlled:"));
  const existing = new Set(audit.findings.map((finding) => finding.id));
  reviews.forEach((review) => {
    Object.entries(review.checks).forEach(([key, check]) => {
      if (check.status === "documented") return;
      const id = `${review.findingPrefix}:${key}`;
      if (existing.has(id) || matchingControlledFinding(audit.findings, review, key, reviews.length)) return;
      const prior = legacyControlled
        .filter((finding) => finding.id === id || (
          finding.id.endsWith(`:${key}`)
          && (reviews.length === 1 || findingAppliesToControlledMedication(finding, review, reviews.length))
        ))
        .sort((left, right) => {
          const decisionDelta = Number(right.decision !== "pending") - Number(left.decision !== "pending");
          if (decisionDelta) return decisionDelta;
          return String(right.decidedAt || "").localeCompare(String(left.decidedAt || ""));
        })[0];
      if (prior) {
        audit.findings.push({ ...prior, id });
        existing.add(id);
        return;
      }
      const label = CONTROLLED_CHECK_LABELS[key] || key;
      audit.findings.push({
        id,
        severity: "high",
        issue: `${label} needs provider review for ${review.medication}.`,
        location: review.sourceText || "Medication list / assessment and plan",
        suggestedFix: `Confirm whether ${label.toLowerCase()} was completed or applicable; document only the provider-confirmed facts, or create follow-up work if it was not done.`,
        supportingSource: "BHW controlled-medication documentation checklist (2026); verify current medication-, payer-, and jurisdiction-specific guidance when applicable.",
        decision: "pending",
        providerResponse: "",
        approvedAddendum: "",
        decidedAt: "",
      });
      existing.add(id);
    });
  });
  audit.status = audit.findings.some((finding) => finding.decision === "pending") ? "needs_resolution" : "resolved";
  return audit;
}

export function parseClinicalAuditReport(reportText, encounter = {}) {
  const rawReport = clean(reportText);
  const audit = emptyClinicalAudit();
  audit.rawReport = rawReport;
  audit.importedAt = new Date().toISOString();
  audit.status = rawReport ? "imported" : "not_run";
  audit.baselineCodes = unique([].concat(encounter.codes || []).map((value) => clean(value).toUpperCase()));
  audit.baselineDiagnoses = unique([].concat(encounter.diagnoses || []).map((value) => clean(value).toUpperCase()));
  if (!rawReport) return audit;

  const verdict = rawReport.match(/CLOSURE VERDICT\s*:\s*([^\n]+)/i);
  audit.verdict = clean(verdict?.[1]).replace(/[*_]/g, "");
  const minutes = rawReport.match(/Estimated fix time\s*:\s*(\d+)/i);
  audit.estimatedFixMinutes = minutes ? Number(minutes[1]) : null;
  const risk = rawReport.match(/Recommended risk level\s*:\s*(Critical|High|Moderate|Low)/i);
  audit.recommendedRisk = risk ? risk[1].toLowerCase() : "";

  const lines = rawReport.split("\n");
  const codeLines = [];
  const documentedCodeLines = [];
  let section = "";
  let currentFinding = null;
  lines.forEach((line) => {
    const nextSection = sectionFor(line);
    if (nextSection) {
      section = nextSection;
      currentFinding = null;
      return;
    }
    const item = stripListPrefix(line);
    if (!item) return;
    if (section === "fix" || section === "strengthen" || section === "future") {
      const isNew = /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
      const role = findingLineRole(line);
      const detail = findingLineText(line, role);
      if (role === "suggested_fix" && currentFinding) {
        currentFinding.suggestedFix = detail;
        return;
      }
      if (role === "location" && currentFinding) {
        currentFinding.location = detail;
        return;
      }
      if (role === "supporting_source" && currentFinding) {
        currentFinding.supportingSource = detail;
        return;
      }
      const currentHasStructuredFix = currentFinding && currentFinding.suggestedFix !== "Provider review/correction requested.";
      const looksLikeCompleteLegacyFinding = /\bSuggested\s+fix\s*:/i.test(detail);
      if (!currentFinding || isNew || role === "issue" || (currentHasStructuredFix && looksLikeCompleteLegacyFinding)) {
        const fallback = section === "fix" ? "high" : section === "strengthen" ? "moderate" : "low";
        currentFinding = makeFinding(detail, fallback, audit.findings.length);
        audit.findings.push(currentFinding);
      } else {
        currentFinding.issue = `${currentFinding.issue} ${detail}`.trim();
      }
      return;
    }
    if (section === "guidelines") {
      audit.guidelineNotes.push(item);
      const parts = item.split(/\s+\|\s+/).map(clean);
      const field = (name) => clean(parts.find((part) => new RegExp(`^${name}\\s*:`, "i").test(part))?.replace(new RegExp(`^${name}\\s*:\\s*`, "i"), ""));
      audit.guidelineChecks.push({
        topic: field("(?:condition/topic|condition|topic)") || parts[0],
        source: field("source") || "Current primary-source verification required",
        year: field("year") || "Not stated",
        note: field("note") || item,
      });
    }
    if (section === "complete") audit.completeNotes.push(item);
    if (section === "codes_documented") documentedCodeLines.push(line);
    if (section === "codes_after") codeLines.push(line);
  });

  audit.guidelineNotes = unique(audit.guidelineNotes);
  audit.completeNotes = unique(audit.completeNotes);
  const documentedCodes = parseSuggestedCodes(documentedCodeLines);
  const hccLine = documentedCodeLines.find((line) => /HCC\s+relevance/i.test(line));
  const zCodeLine = documentedCodeLines.find((line) => /Z[- ]?code\s+opportunit/i.test(line));
  const zCodes = zCodeLine ? codeCandidates(zCodeLine, "icd10").filter((code) => code.startsWith("Z")) : [];
  audit.codingAsDocumented = {
    cpt: documentedCodes.cpt,
    icd10: unique([...documentedCodes.icd10, ...zCodes]),
    hccRelevance: clean(hccLine).replace(/^.*?HCC\s+relevance\s*:\s*/i, ""),
    zCodes,
    zCodeEvidence: clean(zCodeLine).replace(/^.*?Z[- ]?code\s+opportunit(?:y|ies)\s*:\s*/i, ""),
  };
  audit.suggestedCodesAfterChanges = parseSuggestedCodes(codeLines);
  audit.status = audit.findings.some((finding) => finding.decision === "pending") ? "needs_resolution" : "resolved";
  return addRequiredClinicalFindings(audit, encounter);
}

export function normalizeClinicalAudit(value) {
  if (!value || typeof value !== "object") return emptyClinicalAudit();
  const audit = { ...emptyClinicalAudit(), ...value };
  audit.findings = [].concat(value.findings || []).map((finding, index) => ({
    ...makeFinding(finding.issue || "Audit finding", severityFromText(finding.severity, "moderate"), index),
    ...finding,
    id: clean(finding.id) || `audit:${index + 1}`,
    severity: SEVERITIES.includes(finding.severity) ? finding.severity : severityFromText(finding.severity, "moderate"),
    decision: RESOLVED_DECISIONS.has(finding.decision) ? finding.decision : "pending",
  }));
  audit.guidelineNotes = unique([].concat(value.guidelineNotes || []).map(clean));
  audit.guidelineChecks = [].concat(value.guidelineChecks || []).map((item) => ({
    topic: clean(item?.topic),
    source: clean(item?.source) || "Current primary-source verification required",
    year: clean(item?.year) || "Not stated",
    note: clean(item?.note),
  })).filter((item) => item.topic || item.note);
  audit.completeNotes = unique([].concat(value.completeNotes || []).map(clean));
  audit.codingAsDocumented = {
    cpt: unique([].concat(value.codingAsDocumented?.cpt || []).map((item) => clean(item).toUpperCase())),
    icd10: unique([].concat(value.codingAsDocumented?.icd10 || []).map((item) => clean(item).toUpperCase())),
    hccRelevance: clean(value.codingAsDocumented?.hccRelevance),
    zCodes: unique([].concat(value.codingAsDocumented?.zCodes || []).map((item) => clean(item).toUpperCase())),
    zCodeEvidence: clean(value.codingAsDocumented?.zCodeEvidence),
  };
  audit.suggestedCodesAfterChanges = {
    cpt: unique([].concat(value.suggestedCodesAfterChanges?.cpt || []).map((value) => clean(value).toUpperCase())),
    icd10: unique([].concat(value.suggestedCodesAfterChanges?.icd10 || []).map((value) => clean(value).toUpperCase())),
  };
  audit.status = audit.status === "not_run" ? "not_run" : (audit.findings.some((finding) => finding.decision === "pending") ? "needs_resolution" : "resolved");
  return audit;
}

export function resolveClinicalAuditFinding(auditValue, findingId, decision, details = {}) {
  const audit = normalizeClinicalAudit(auditValue);
  if (!RESOLVED_DECISIONS.has(decision)) return audit;
  const finding = audit.findings.find((item) => item.id === findingId);
  if (!finding) return audit;
  finding.decision = decision;
  finding.providerResponse = clean(details.providerResponse);
  finding.approvedAddendum = decision === "occurred" ? clean(details.approvedAddendum) : "";
  finding.decidedAt = new Date().toISOString();
  audit.status = audit.findings.some((item) => item.decision === "pending") ? "needs_resolution" : "resolved";
  return audit;
}

export function clinicalAuditSummary(auditValue) {
  const audit = normalizeClinicalAudit(auditValue);
  const pending = audit.findings.filter((finding) => finding.decision === "pending");
  const blocking = pending.filter((finding) => ["critical", "high"].includes(finding.severity));
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, audit.findings.filter((finding) => finding.severity === severity).length]));
  return { status: audit.status, pending: pending.length, blocking: blocking.length, counts };
}

export function auditTasks(auditValue, encounter = {}, now = new Date()) {
  const audit = normalizeClinicalAudit(auditValue);
  const dueBase = new Date(encounter.completedAt || now);
  const dueAt = new Date((Number.isFinite(dueBase.getTime()) ? dueBase : new Date(now)).getTime() + 24 * 36e5).toISOString();
  return audit.findings
    .filter((finding) => finding.decision === "not_done")
    .map((finding) => ({
      id: `audit-task:${finding.id}`,
      type: "audit_follow_up",
      title: `Audit follow-up: ${finding.issue}`.slice(0, 160),
      reason: finding.providerResponse || "Provider confirmed the recommended action did not occur during the visit; complete follow-up without changing the historical note.",
      owner: encounter.owner || "Amaris",
      recommendedRole: "Provider / care team",
      dueAt,
      status: "open",
      completedAt: "",
      documentId: "",
    }));
}

export function approvedAuditAddenda(auditValue) {
  const audit = normalizeClinicalAudit(auditValue);
  return audit.findings
    .filter((finding) => finding.decision === "occurred" && clean(finding.approvedAddendum) && !finding.addendumAppliedAt)
    .map((finding) => ({ id: finding.id, text: clean(finding.approvedAddendum) }));
}
