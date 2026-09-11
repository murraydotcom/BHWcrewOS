import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { composeEncounterNote, PRIMARY_NOTE_TEMPLATES } from "../engine/note-composer.mjs";

const source = "Speaker 1: My knee hurts for two days. Speaker 2: Exam shows tenderness. Assessment: knee pain. Plan: rest. Return in one week.";
const fields = { chiefConcern: "Knee pain", hpi: "Knee pain for two days.", exam: "Knee tenderness.", assessment: "Knee pain.", plan: "Rest.", followUp: "One week." };

test("every primary template uses organized fields without copying the source into HPI", () => {
  for (const primaryTemplate of Object.keys(PRIMARY_NOTE_TEMPLATES)) {
    const result = composeEncounterNote({ ...fields, transcript: source, transcriptReviewed: true, notePlan: { primaryTemplate } });
    assert.equal(result.sections.find(s => s.title === "History of Present Illness").content, fields.hpi);
    assert.equal(result.sections.find(s => s.title === "Assessment").content, fields.assessment);
    assert.equal(result.sections.find(s => s.title === "Plan").content, fields.plan);
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
  const context = vm.createContext({ row, $: id => elements[id], notePlanFromDetail: r => r.notePlan, builderInputFromDetail: r => r.noteBuilderInput, cloudClient: { async structureNote(r) { calls++; return extract(r); } }, structuringId: "", render() {}, persist() {}, log() {}, showToast: message => messages.push(message), composeEncounterNote, PRIMARY_NOTE_TEMPLATES, normalizeClinicalAudit: () => ({ status: "not_run" }), WORKFLOW_STATUS: { DRAFT_RECEIVED: "draft_received" }, reports: new Map(), refreshEncounterIntelligence() {} });
  vm.runInContext(app.slice(app.indexOf("function composeReviewedNote("), app.indexOf("function wireDetail(")), context);
  vm.runInContext(app.slice(app.indexOf('  $("generateNote").onclick'), app.indexOf('  $("rebuildNote").onclick')), context);
  return { row, messages, click: () => elements.generateNote.onclick(), calls: () => calls };
}

test("Generate organizes source and creates the medical note in one click", async () => {
  const h = harness(async () => ({ noteBuilderInput: fields, warnings: ["Examination is limited to documented findings."], sourceEvidence: ["hpi: Speaker 1"], sourceNoteHash: "synthetic-hash" }));
  await h.click();
  assert.equal(h.calls(), 1);
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
  assert.ok(h.messages.includes("Synthetic service failure"));
});

test("unreviewed source cannot invoke extraction", async () => {
  const h = harness(async () => ({ noteBuilderInput: fields }), false);
  await h.click();
  assert.equal(h.calls(), 0);
  assert.equal(h.row.note, "Existing provider draft");
});
