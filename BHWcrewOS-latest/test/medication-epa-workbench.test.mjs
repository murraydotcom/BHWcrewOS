import test from "node:test";
import assert from "node:assert/strict";

import { buildEncounterPacket, refreshEncounterIntelligence } from "../engine/encounter-workflow.mjs";
import {
  buildMedicationEpaCases,
  matchPayerProfile,
  medicationEpaCaseUrgency,
  parsePayerQuestionnaire,
  providerQuestionSummary,
  updateMedicationEpaCase,
  validateMedicationEpaCase,
} from "../engine/medication-epa-workbench.mjs";

const encounter = {
  id: "ENC-SYNTH-EPA-1",
  encounterId: "ENC-SYNTH-EPA-1",
  bhwPatientId: "BHW0000",
  completedAt: "2026-08-27T12:00:00.000Z",
  provider: "Synthetic Provider",
  payer: "CareFirst Medicare Advantage",
  coverage: {
    payer: "CareFirst Medicare Advantage",
    planName: "Synthetic MA Plan",
    memberId: "SYNTH-MEMBER",
    pbm: "CarelonRx",
    bin: "000000",
    pcn: "SYNTH",
  },
  diagnoses: ["E66.9"],
  medications: [{ sourceText: "Start Wegovy 0.25 mg subcutaneously weekly for weight management." }],
  note: "Start Wegovy 0.25 mg subcutaneously weekly for weight management. BMI is 37.2. The patient completed six months of a structured nutrition and exercise program. Metformin was tried for three months and stopped because of gastrointestinal adverse effects.",
};

function completeProviderQuestions(caseItem) {
  return caseItem.questions.map((question) => ({
    ...question,
    answer: question.answer || "Not applicable based on provider review.",
    disposition: question.answer ? "answered" : "not_applicable",
    source: "provider",
  }));
}

test("payer matching keeps payer family and line of business distinct", () => {
  assert.equal(matchPayerProfile("CareFirst Medicare Advantage").id, "carefirst_medicare");
  assert.equal(matchPayerProfile("CareFirst Community Health Plan").id, "carefirst_community");
  assert.equal(matchPayerProfile("UnitedHealthcare Community Plan Medicaid").id, "uhc_medicaid");
  assert.equal(matchPayerProfile("Aetna commercial").id, "aetna_commercial");
});

test("interim ePA case carries coverage identity and anticipated questions", () => {
  const [caseItem] = buildMedicationEpaCases(encounter, [], new Date("2026-08-27T13:00:00.000Z"));
  assert.equal(caseItem.coverageProfile.payerProfileId, "carefirst_medicare");
  assert.equal(caseItem.coverageProfile.benefitAdministratorId, "carelon");
  assert.equal(caseItem.coverageProfile.bin, "000000");
  assert.equal(caseItem.coverageEvidence.status, "not_checked");
  assert.ok(caseItem.questions.some((question) => question.id === "glp1_metrics"));
  assert.ok(providerQuestionSummary(caseItem).missing > 0);
});

test("encounter packets create and retain structured ePA case work", () => {
  const packet = buildEncounterPacket(encounter);
  assert.equal(packet.medicationEpaCases.length, 1);
  packet.medicationEpaCases[0].questions[0] = {
    ...packet.medicationEpaCases[0].questions[0],
    answer: "Provider-confirmed packet answer.",
    disposition: "answered",
    source: "provider",
  };
  refreshEncounterIntelligence(packet, new Date("2026-08-27T13:15:00.000Z"));
  assert.equal(packet.medicationEpaCases[0].questions[0].answer, "Provider-confirmed packet answer.");
  assert.equal(packet.coverage.bin, "000000");
});

test("pasted payer questions receive encounter-supported suggestions without inventing answers", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const questions = parsePayerQuestionnaire([
    "1. What diagnosis supports the request?",
    "2. Which medications have been tried and failed?",
    "3. Is the patient enrolled in a manufacturer program?",
  ].join("\n"), caseItem.questions);
  assert.match(questions[0].answer, /E66\.9/);
  assert.match(questions[1].answer, /Metformin was tried/);
  assert.equal(questions[0].disposition, "unanswered");
  assert.equal(questions[1].disposition, "unanswered");
  assert.equal(questions[2].answer, "");
  assert.equal(questions[2].disposition, "unanswered");
});

test("provider handoff cannot advance with unanswered questions or missing attestation", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const validation = validateMedicationEpaCase(caseItem, "ready_for_staff");
  assert.equal(validation.valid, false);
  assert.match(validation.reasons.join(" "), /unanswered/i);
  assert.match(validation.reasons.join(" "), /attestation/i);
});

test("provider attestation records the responsible provider", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const result = updateMedicationEpaCase(caseItem, {
    status: "ready_for_staff",
    questions: completeProviderQuestions(caseItem),
    providerReview: { attested: true, attestedBy: "" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /provider name/i);
});

test("completed provider review can advance to staff without claiming PA is required", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const result = updateMedicationEpaCase(caseItem, {
    status: "ready_for_staff",
    questions: completeProviderQuestions(caseItem),
    providerReview: { attested: true, attestedBy: "Synthetic Provider" },
  }, new Date("2026-08-27T14:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.caseItem.status, "ready_for_staff");
  assert.equal(result.caseItem.coverageEvidence.status, "not_checked");
  assert.ok(result.caseItem.providerReview.attestedAt);
});

test("external submission requires confirmed coverage, method, timestamp, and reference", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const base = {
    ...caseItem,
    questions: completeProviderQuestions(caseItem),
    providerReview: { attested: true, attestedBy: "Synthetic Provider", attestedAt: "2026-08-27T14:00:00.000Z" },
  };
  const blocked = updateMedicationEpaCase(base, { status: "submitted_external" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reasons.join(" "), /PA-required/i);

  const submitted = updateMedicationEpaCase(base, {
    status: "submitted_external",
    coverageEvidence: {
      status: "pa_required_confirmed",
      sourceType: "payer_portal",
      sourceLabel: "Synthetic payer portal",
      checkedAt: "2026-08-27T14:15:00.000Z",
    },
    submission: {
      method: "payer_portal",
      reference: "SYNTH-REF-1",
      submittedAt: "2026-08-27T14:30:00.000Z",
    },
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.caseItem.status, "submitted_external");
});

test("confirmed coverage requires a source reference and check time", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const base = {
    ...caseItem,
    questions: completeProviderQuestions(caseItem),
    providerReview: { attested: true, attestedBy: "Synthetic Provider", attestedAt: "2026-08-27T14:00:00.000Z" },
  };
  const result = updateMedicationEpaCase(base, {
    status: "no_pa_required",
    coverageEvidence: { status: "no_pa_required_confirmed", sourceType: "payer_portal" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /source reference/i);
  assert.match(result.reasons.join(" "), /date and time checked/i);
});

test("closed cases require a documented outcome", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  const base = {
    ...caseItem,
    questions: completeProviderQuestions(caseItem),
    providerReview: { attested: true, attestedBy: "Synthetic Provider", attestedAt: "2026-08-27T14:00:00.000Z" },
  };
  assert.equal(updateMedicationEpaCase(base, { status: "closed" }).ok, false);
  assert.equal(updateMedicationEpaCase(base, { status: "closed", submission: { notes: "Synthetic closure after the request was withdrawn." } }).ok, true);
});

test("edited provider answers survive encounter intelligence refresh", () => {
  const [initial] = buildMedicationEpaCases(encounter);
  initial.questions[0] = {
    ...initial.questions[0],
    answer: "Provider-confirmed synthetic request details.",
    disposition: "answered",
    source: "provider",
  };
  const [refreshed] = buildMedicationEpaCases({ ...encounter, note: `${encounter.note} Follow up in four weeks.` }, [initial]);
  assert.equal(refreshed.questions[0].answer, "Provider-confirmed synthetic request details.");
  assert.equal(refreshed.questions[0].source, "provider");
});

test("open PA cases become overdue but completed cases do not", () => {
  const [caseItem] = buildMedicationEpaCases(encounter);
  caseItem.nextActionAt = "2026-08-27T15:00:00.000Z";
  assert.equal(medicationEpaCaseUrgency(caseItem, new Date("2026-08-27T16:00:00.000Z")).overdue, true);
  caseItem.status = "approved";
  assert.equal(medicationEpaCaseUrgency(caseItem, new Date("2026-08-27T16:00:00.000Z")).level, "complete");
});
