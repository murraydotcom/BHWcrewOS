import test from "node:test";
import assert from "node:assert/strict";

import { buildEncounterPacket, detectOutputs } from "../engine/encounter-workflow.mjs";
import {
  buildMedicationAuthorizationReadiness,
  medicationAction,
  medicationAuthorizationCandidates,
  medicationAuthorizationDocument,
  validateMedicationAuthorizationHandoff,
} from "../engine/medication-prior-auth.mjs";
import { materializeEncounterWork } from "../engine/output-work.mjs";

const encounter = {
  id: "ENC-SYNTH-1",
  encounterId: "ENC-SYNTH-1",
  bhwPatientId: "BHW0000",
  completedAt: "2026-08-26T15:00:00.000Z",
  provider: "Synthetic Provider",
  payer: "Synthetic Health Plan",
  coverage: { payer: "Synthetic Health Plan", planName: "Synthetic Silver", memberId: "SYNTH-001" },
  diagnoses: ["E66.9"],
  note: "Start semaglutide 0.25 mg subcutaneously weekly for weight management. BMI is 37.2. The patient completed six months of a structured nutrition and exercise program. Metformin was tried for three months and stopped because of gastrointestinal adverse effects.",
};

test("medication action detection distinguishes starts from continuation", () => {
  assert.equal(medicationAction("Start semaglutide 0.25 mg weekly"), "new");
  assert.equal(medicationAction("Increase sertraline to 100 mg daily"), "changed");
  assert.equal(medicationAction("Continue lisinopril 10 mg daily"), "continuation");
  assert.equal(medicationAction("Stop zolpidem"), "stopped");
});

test("new medication creates a clinical-readiness packet without asserting coverage", () => {
  const packet = buildEncounterPacket(encounter);
  const output = packet.outputs.find((item) => item.type === "medication_authorization");
  const task = packet.tasks.find((item) => item.type === "medication_authorization");
  const document = packet.documents.find((item) => item.type === "medication_authorization");

  assert.ok(output);
  assert.equal(task.owner, "MA / Front Desk");
  assert.equal(task.recommendedRole, "MA / Front Desk");
  assert.match(document.content, /Coverage has not been checked|does not establish formulary coverage/i);
  assert.match(document.content, /BMI is 37\.2/);
  assert.match(document.content, /Metformin was tried/);
  assert.match(document.content, /Ready|MA \/ FRONT-DESK HANDOFF/i);
});

test("continuation alone does not create a medication PA readiness task", () => {
  const note = "Continue lisinopril 10 mg daily. Blood pressure is controlled.";
  const outputs = detectOutputs(note, { medications: [note] });
  assert.equal(outputs.some((item) => item.type === "medication_authorization"), false);
  assert.equal(medicationAuthorizationCandidates({ note, medications: [note] }).length, 0);
});

test("non-medication treatment plans do not create medication PA work", () => {
  const note = "Start physical therapy twice weekly for six weeks and continue the home exercise program.";
  const outputs = detectOutputs(note, {});
  assert.equal(outputs.some((item) => item.type === "medication_authorization"), false);
});

test("explicit coverage language creates a medication packet for an otherwise unknown action", () => {
  const note = "Insurance reports that Nurtec is not covered and may require prior authorization. The patient has 10 migraine days per month.";
  const candidates = medicationAuthorizationCandidates({ note, medications: [{ sourceText: "Nurtec 75 mg as needed" }] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].questionSets[0].id, "migraine");
});

test("missing answers remain visible and are never invented", () => {
  const readiness = buildMedicationAuthorizationReadiness({
    ...encounter,
    note: "Start Wegovy 0.25 mg weekly for weight management.",
    medications: [{ sourceText: "Start Wegovy 0.25 mg weekly for weight management." }],
  });
  assert.equal(readiness.coverageStatus, "not_checked");
  assert.ok(readiness.candidates[0].missingProvider.length > 0);

  const document = medicationAuthorizationDocument({
    ...encounter,
    note: "Start Wegovy 0.25 mg weekly for weight management.",
    medications: [{ sourceText: "Start Wegovy 0.25 mg weekly for weight management." }],
  });
  assert.match(document, /\[Provider answer needed\]/);
  assert.doesNotMatch(document, /A1c is \d|failed two formulary alternatives/i);
});

test("clinician-edited medication PA drafts survive intelligence refresh", () => {
  const packet = buildEncounterPacket(encounter);
  const priorDocument = packet.documents.find((item) => item.type === "medication_authorization");
  const edited = { ...priorDocument, content: `${priorDocument.content}\n\nClinician reviewed: yes`, status: "ready" };
  const work = materializeEncounterWork(packet, packet.tasks, packet.documents.map((item) => item.id === edited.id ? edited : item), new Date("2026-08-26T16:00:00.000Z"));
  const refreshed = work.documents.find((item) => item.type === "medication_authorization");
  assert.match(refreshed.content, /Clinician reviewed: yes/);
  assert.equal(refreshed.status, "ready");
});

test("staff handoff requires completed clinical placeholders and clinician attestation", () => {
  const draft = medicationAuthorizationDocument({
    ...encounter,
    note: "Start Wegovy 0.25 mg weekly for weight management.",
    medications: [{ sourceText: "Start Wegovy 0.25 mg weekly for weight management." }],
  });
  assert.equal(validateMedicationAuthorizationHandoff(draft).valid, false);
  const ready = draft.replaceAll("[Provider answer needed]", "Not applicable").replace("[ ] I reviewed", "[x] I reviewed");
  assert.deepEqual(validateMedicationAuthorizationHandoff(ready), { valid: true, reasons: [] });
});
