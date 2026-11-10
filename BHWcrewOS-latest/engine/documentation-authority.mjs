export function canApproveDocumentation(actor = {}) {
  return /^(?:provider|physician|pmhnp|crnp|crnp\/fnp)$/i.test(String(actor.healthRole || actor.role || "").trim());
}

function confirmedDecisions(encounter = {}) {
  const decisions = [];
  for (const finding of encounter.clinicalAudit?.findings || []) {
    if (finding.decision && finding.decision !== "pending") decisions.push([`audit:${finding.id}`, finding.decision, finding.providerResponse || "", finding.approvedAddendum || ""]);
  }
  for (const item of encounter.codingRecommendations || []) for (const question of item.clarifications || []) {
    if (question.decision && question.decision !== "pending") decisions.push([`coding:${item.id}:${question.id}`, question.decision, question.providerResponse || "", question.approvedAddendum || ""]);
  }
  return decisions;
}

export function assertDocumentationAuthority(next = {}, previous = {}, actor = {}) {
  if (canApproveDocumentation(actor)) return;
  const deny = () => { throw Object.assign(new Error("Documentation staff may prepare drafts and request review. Provider decisions and clinical approval require a provider account."), { status: 403 }); };
  const evidenceFields = ["note", "sourceTranscript", "codes", "diagnoses", "notePlan", "noteBuilderInput", "clinicalAudit", "medications", "orders", "referrals", "followUp", "patientInstructions", "returnPrecautions"];
  if (next.providerApproved && (!previous?.providerApproved || evidenceFields.some(key => JSON.stringify(next[key]) !== JSON.stringify(previous?.[key])))) deny();
  if (next.status === "approved_for_entry" && !next.providerApproved && previous?.status !== "approved_for_entry") deny();
  if (next.noteDraftMeta?.warningsResolved && !previous?.noteDraftMeta?.warningsResolved) deny();
  const prior = new Set(confirmedDecisions(previous || {}).map(value => JSON.stringify(value)));
  if (confirmedDecisions(next).some(value => !prior.has(JSON.stringify(value)))) deny();
}
