import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { composeEncounterNote, PRIMARY_NOTE_TEMPLATES } from "../engine/note-composer.mjs";

const source = "Speaker 1: My knee hurts for two days. Speaker 2: Exam shows tenderness. Assessment: knee pain. Plan: rest. Return in one week.";
const fields = { chiefConcern: "Knee pain", hpi: "Knee pain for two days.", exam: "Knee tenderness.", problemList: "Knee pain — New", assessment: "Knee pain.", plan: "Rest.", followUp: "One week." };

test("every primary template uses organized fields without copying the source into HPI", () => {
  for (const primaryTemplate of Object.keys(PRIMARY_NOTE_TEMPLATES)) {
    const result = composeEncounterNote({ ...fields, transcript: source, transcriptReviewed: true, notePlan: { primaryTemplate } });
    assert.equal(result.sections.find(s => s.title === "History of Present Illness").content, fields.hpi);
    assert.equal(result.sections.find(s => s.title === "Assessment").content, fields.assessment);
    assert.equal(result.sections.find(s => s.title === "Plan").content, fields.plan);
    assert.equal(result.sections.find(s => s.title === "Problem List and Status").content, "- Knee pain — New");
    assert.ok(!result.note.includes(source));
    assert.ok(result.note.includes(PRIMARY_NOTE_TEMPLATES[primaryTemplate].label.toUpperCase()));
  }
});

test("reviewed source alone does not masquerade as completed HPI", () => {
  const result = composeEncounterNote({ transcript: source, transcriptReviewed: true });
  assert.ok(result.missing.includes("History of Present Illness"));
  assert.ok(!result.note.includes(source));
});

test("TCM and condition-management fields reach their selected template sections", () => {
  const result = composeEncounterNote({ ...fields, notePlan: { primaryTemplate: "transitional_care", modules: ["condition_management"] }, transitionalCare: { inpatientFacilityAndDates: "Synthetic hospital, September 1–3." }, conditionManagement: { problemsGoals: "Walk comfortably.", interventions: "Rest.", monitoringCoordination: "Return in one week." } });
  assert.match(result.note, /TCM — Inpatient Facility/);
  assert.match(result.note, /Walk comfortably/);
  assert.ok(result.missing.includes("TCM — Medication Reconciliation and Management"));
});

// Execute the actual browser click handler and composer with a protected-client
// double; this catches a button that formats unorganized fields without extraction.
const app = fs.readFileSync(new URL("../provider/workflow-app.mjs", import.meta.url), "utf8");
function harness(extract, reviewed = true) {
  const elements = { dTranscript: { value: source, focus() {} }, nbTranscriptReviewed: { focus() {} }, generateNote: {} };
  const row = { id: "SYNTHETIC-NOTE", note: "Existing provider draft", notePlan: { primaryTemplate: "established_office", modules: [] }, noteBuilderInput: { transcriptReviewed: reviewed }, providerApproved: true, charmDraftSaved: true };
  const messages = [];
  let calls = 0;
  let auditCalls = 0;
  const context = vm.createContext({ row, $: id => elements[id], notePlanFromDetail: r => r.notePlan, builderInputFromDetail: r => r.noteBuilderInput, cloudClient: { async structureNote(r) { calls++; return extract(r); } }, structuringId: "", render() {}, persist() {}, log() {}, showToast: message => messages.push(message), composeEncounterNote, PRIMARY_NOTE_TEMPLATES, normalizeClinicalAudit: () => ({ status: "not_run" }), WORKFLOW_STATUS: { DRAFT_RECEIVED: "draft_received" }, reports: new Map(), refreshEncounterIntelligence() {} });
  vm.runInContext(app.slice(app.indexOf("function composeReviewedNote("), app.indexOf("function wireDetail(")), context);
  Object.assign(context, { analyzingId: "", processingErrors: new Map(), async runEncounterAnalysis(packet) { auditCalls++; assert.match(packet.note, /History of Present Illness/); } });
  vm.runInContext(app.slice(app.indexOf('  $("generateNote").onclick'), app.indexOf('  $("rebuildNote").onclick')), context);
  return { row, messages, click: () => elements.generateNote.onclick(), calls: () => calls, auditCalls: () => auditCalls };
}

test("Generate organizes source and creates the medical note in one click", async () => {
  const h = harness(async () => ({ noteBuilderInput: fields, warnings: ["Examination is limited to documented findings."], sourceEvidence: ["hpi: Speaker 1"], sourceNoteHash: "synthetic-hash" }));
  await h.click();
  assert.equal(h.calls(), 1);
  assert.equal(h.auditCalls(), 1);
  assert.match(h.row.note, /History of Present Illness\nKnee pain for two days/);
  assert.match(h.row.note, /Assessment\nKnee pain/);
  assert.ok(!h.row.note.includes(source));
  assert.equal(h.row.sourceTranscript, source);
  assert.equal(h.row.providerApproved, false);
  assert.equal(h.row.charmDraftSaved, false);
  assert.equal(h.row.noteDraftMeta.warningsResolved, false);
  assert.equal(h.row.noteDraftMeta.warnings.length, 1);
});

test("failed extraction preserves the existing note", async () => {
  const h = harness(async () => { throw Error("Synthetic service failure"); });
  await h.click();
  assert.equal(h.row.note, "Existing provider draft");
  assert.equal(h.auditCalls(), 0);
  assert.ok(h.messages.includes("Synthetic service failure"));
});

test("unreviewed source cannot invoke extraction", async () => {
  const h = harness(async () => ({ noteBuilderInput: fields }), false);
  await h.click();
  assert.equal(h.calls(), 0);
  assert.equal(h.row.note, "Existing provider draft");
});

test("explicitly absent source fields do not carry old generated instructions or orders forward", async () => {
  const h = harness(async () => ({ noteBuilderInput: { ...fields, orders: "", referrals: "", patientInstructions: "", returnPrecautions: "", followUp: "" } }));
  h.row.orders = ["OLD ORDER THAT IS NOT IN THE NEW SOURCE"];
  h.row.patientInstructions = ["STALE GENERATED INSTRUCTIONS"];
  h.row.followUp = ["STALE FOLLOW-UP"];
  await h.click();
  assert.doesNotMatch(h.row.note, /OLD ORDER|STALE/);
  assert.ok(h.row.noteDraftMeta.missing.includes("Follow-Up"));
});

test("preventive drafts distinguish status, evaluation, and management", async () => {
  const h = harness(async () => ({ noteBuilderInput: {
    ...fields,
    problemList: "Elevated office BP — Under evaluation\r\nLipid monitoring — Ongoing",
    assessment: "Elevated office BP: Possible white-coat effect.\n\nLipid monitoring: Labs reviewed.",
    assessmentWorkup: "Review a home BP log.\nRepeat lipid panel if due.",
    plan: "",
    education: "Reviewed BP cuff technique.",
    nutrition: "Discussed ways to add vegetables.",
    movement: "Continue regular walking.",
    afterVisit: "Record BP for two weeks.",
    followUp: "Review log at next visit.",
  } }));
  h.row.notePlan.primaryTemplate = "preventive_exam";
  h.row.encounterSnapshot = { problemList: [
    { value: "Elevated office BP", clinicalStatus: "Historical", reviewedForNote: true },
    { value: "History of kidney stones", clinicalStatus: "Historical", reviewedForNote: true },
    { value: "Unreviewed chart concern", clinicalStatus: "Active" },
  ] };
  await h.click();
  assert.equal(h.auditCalls(), 1);
  assert.match(h.row.note, /Problem List and Status\n- Elevated office BP — Under evaluation\n- Lipid monitoring — Ongoing\n- History of kidney stones — Historical/);
  assert.match(h.row.note, /Assessment\nElevated office BP: Possible white-coat effect\.\n\nLipid monitoring: Labs reviewed\.\n\nLabs, Tests, and Other Evaluation\nReview a home BP log\.\nRepeat lipid panel if due\.\n\nPlan\nEducation/);
  assert.match(h.row.note, /Food Recommendations\nDiscussed ways to add vegetables\.\n\nMovement Recommendations\nContinue regular walking\.\n\nAfter-Visit Plan\nRecord BP for two weeks\./);
  assert.doesNotMatch(h.row.note, /Unreviewed chart concern|New Medications|\nOrders\n/);
  assert.ok(!h.row.noteDraftMeta.missing.includes("Plan"));
});

test("legacy assessment and plan lists regain line breaks without changing their clinical text", () => {
  const result = composeEncounterNote({
    assessment: "- Knee pain: New. - Headache: Improving.",
    plan: "1. Knee pain: • Continue current regimen. • Rest today. 2. Headache: • Track symptoms.",
  });
  assert.match(result.note, /Assessment\n- Knee pain: New\.\n- Headache: Improving\./);
  assert.match(result.note, /Plan\n1\. Knee pain:\n  • Continue current regimen\.\n  • Rest today\.\n\n2\. Headache:\n  • Track symptoms\./);
});

test("evaluation alone leaves the clinical assessment incomplete", () => {
  const result = composeEncounterNote({ assessmentWorkup: "Home BP log planned.", medicationChanges: "Documented medication change." });
  assert.ok(result.missing.includes("Assessment"));
  assert.ok(!result.missing.includes("Plan"));
  assert.match(result.note, /Labs, Tests, and Other Evaluation\nHome BP log planned\./);
  assert.match(result.note, /New Medications and Medication Changes\nDocumented medication change\./);
});
