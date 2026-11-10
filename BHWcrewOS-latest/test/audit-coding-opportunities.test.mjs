import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCodingOpportunity,
  approvedCodingAddenda,
  codingOpportunities,
  documentedTotalMinutes,
  resolveCodingClarification,
} from "../engine/coding-opportunities.mjs";

test("explicit total time creates an E/M replacement recommendation", () => {
  const encounter = {
    visitType: "Established office visit",
    payer: "Medicare",
    codes: ["99213"],
    diagnoses: [],
    note: "I personally spent 35 minutes total on this encounter. Ongoing primary care relationship documented.",
  };
  const opportunities = codingOpportunities(encounter);
  const em = opportunities.find((item) => item.code === "99214");
  assert.equal(documentedTotalMinutes(encounter.note).minutes, 35);
  assert.equal(em.action, "replace");
  assert.equal(em.replaceCode, "99213");
  assert.ok(opportunities.some((item) => item.code === "G2211"));
});

test("ICD candidates require an exact diagnostic phrase and are not inferred", () => {
  const exact = codingOpportunities({ note: "Assessment: generalized anxiety disorder. Plan reviewed.", diagnoses: [], codes: [] });
  assert.ok(exact.some((item) => item.code === "F41.1"));
  const inferred = codingOpportunities({ note: "Patient feels nervous and takes an anxiety medication.", diagnoses: [], codes: [] });
  assert.equal(inferred.some((item) => item.category === "icd"), false);
});

test("an exact diagnosis phrase carried only on the problem list is not addable", () => {
  const encounter = { note: "Problem List:\nGeneralized anxiety disorder\n\nReason for visit: ankle sprain.", diagnoses: [], codes: [] };
  const recommendation = codingOpportunities(encounter).find((item) => item.code === "F41.1");
  assert.equal(recommendation.action, "review");
  assert.equal(recommendation.reviewKind, "encounter_evidence_required");
  assert.equal(applyCodingOpportunity(encounter, recommendation), false);
});

test("ACP is review-only when qualifying time documentation is missing", () => {
  const opportunities = codingOpportunities({ note: "Advance care planning and goals of care were discussed.", diagnoses: [], codes: [] });
  const acp = opportunities.find((item) => item.code === "99497");
  assert.equal(acp.action, "review");
  assert.match(acp.missingDocumentation, /time statement/i);
});

test("Medicare chronic-care follow-up is surfaced as a G2211 review candidate", () => {
  const encounter = {
    visitType: "Established office visit",
    payer: "Medicare",
    codes: ["99214"],
    diagnoses: ["I10"],
    note: "Assessment reviewed. Follow up in 1 month for chronic care management.",
  };
  const opportunity = codingOpportunities(encounter).find((item) => item.code === "G2211");
  assert.ok(opportunity);
  assert.equal(opportunity.action, "review");
  assert.equal(opportunity.reviewKind, "documentation_needed");
  assert.equal(applyCodingOpportunity(encounter, opportunity), false);
  assert.deepEqual(encounter.codes, ["99214"]);
});

test("explicit G2211 relationship language can create an add recommendation without duplicating the code", () => {
  const base = {
    visitType: "Established office visit",
    payer: "Medicare",
    codes: ["99214"],
    diagnoses: [],
    note: "This clinician is the continuing focal point for all needed health care services.",
  };
  const recommendation = codingOpportunities(base).find((item) => item.code === "G2211");
  assert.equal(recommendation.action, "add");
  assert.equal(codingOpportunities({ ...base, payer: "Commercial" }).some((item) => item.code === "G2211"), false);
  assert.equal(codingOpportunities({ ...base, codes: ["99214", "G2211"] }).some((item) => item.code === "G2211"), false);
});

test("applying a recommendation updates editable codes but retains a decision record", () => {
  const encounter = { visitType: "Established office visit", note: "Total time: 35 minutes.", codes: ["99213"], diagnoses: [] };
  encounter.codingRecommendations = codingOpportunities(encounter);
  const recommendation = encounter.codingRecommendations.find((item) => item.code === "99214");
  assert.equal(applyCodingOpportunity(encounter, recommendation, new Date("2026-08-05T12:00:00Z")), true);
  assert.deepEqual(encounter.codes, ["99214"]);
  const refreshed = codingOpportunities(encounter, encounter.codingRecommendations);
  assert.equal(refreshed.find((item) => item.code === "99214").status, "applied");
});

test("documented moderate MDM can recommend a higher established-patient E/M without relying on time", () => {
  const encounter = {
    visitType: "Established office visit",
    codes: ["99213"],
    diagnoses: ["I10"],
    note: `Assessment:
1. ADHD — symptoms stable. Continue amphetamine-dextroamphetamine 20 mg twice daily.
2. Hypertension — blood pressure remains above goal. Continue losartan 50 mg daily.
Plan:
Medication management completed.`,
  };
  const recommendation = codingOpportunities(encounter).find((item) => item.code === "99214");
  assert.equal(recommendation.action, "replace");
  assert.equal(recommendation.supportedBy, "mdm");
  assert.equal(recommendation.mdm.problems.rank, 3);
  assert.equal(recommendation.mdm.risk.rank, 3);
  assert.equal(recommendation.clarifications.length, 0);
});

test("one documented MDM element creates questions instead of an upcode", () => {
  const encounter = {
    visitType: "Established office visit",
    codes: ["99213"],
    diagnoses: ["I10"],
    note: "Hypertension remains uncontrolled. Medication list includes losartan 50 mg daily.",
  };
  const recommendation = codingOpportunities(encounter).find((item) => item.code === "99214");
  assert.equal(recommendation.action, "review");
  assert.equal(recommendation.reviewKind, "mdm_clarification");
  assert.ok(recommendation.clarifications.some((item) => item.domain === "risk"));
  assert.equal(applyCodingOpportunity(encounter, recommendation), false);
  assert.deepEqual(encounter.codes, ["99213"]);
});

test("coding clarification requires exact provider facts and survives a rerun", () => {
  const encounter = {
    visitType: "Established office visit",
    codes: ["99213"],
    diagnoses: ["I10"],
    note: "Hypertension remains uncontrolled. Medication list includes losartan 50 mg daily.",
  };
  encounter.codingRecommendations = codingOpportunities(encounter);
  const recommendation = encounter.codingRecommendations.find((item) => item.code === "99214");
  const question = recommendation.clarifications.find((item) => item.domain === "risk");
  assert.equal(resolveCodingClarification(recommendation, question.id, "occurred", {}), false);
  assert.equal(resolveCodingClarification(recommendation, question.id, "occurred", {
    approvedAddendum: "Continued losartan 50 mg daily after reviewing adherence and blood pressure response.",
  }, new Date("2026-08-16T20:00:00Z")), true);
  assert.equal(approvedCodingAddenda(encounter.codingRecommendations).length, 1);
  const refreshed = codingOpportunities(encounter, encounter.codingRecommendations);
  assert.equal(refreshed.find((item) => item.id === recommendation.id).clarifications[0].decision, "occurred");
});

test("a non-occurring clarification dismisses the candidate and never changes codes", () => {
  const encounter = {
    visitType: "Established office visit",
    codes: ["99213"],
    diagnoses: ["I10"],
    note: "Hypertension remains uncontrolled. Medication list includes losartan 50 mg daily.",
  };
  const recommendation = codingOpportunities(encounter).find((item) => item.code === "99214");
  for (const question of recommendation.clarifications) {
    assert.equal(resolveCodingClarification(recommendation, question.id, "not_done"), true);
  }
  assert.equal(recommendation.status, "dismissed");
  assert.equal(applyCodingOpportunity(encounter, recommendation), false);
  assert.deepEqual(encounter.codes, ["99213"]);
});

test("time-based and MDM-based support for the same code are combined", () => {
  const encounter = {
    visitType: "Established office visit",
    codes: ["99213"],
    diagnoses: [],
    note: `Total provider time was 35 minutes.
Assessment:
1. ADHD — stable. Continue amphetamine-dextroamphetamine 20 mg twice daily.
2. Hypertension — not at goal. Continue losartan 50 mg daily.
Plan: Continue treatment.`,
  };
  const recommendations = codingOpportunities(encounter).filter((item) => item.code === "99214");
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].supportedBy, "time_and_mdm");
});

test("new-patient total time can support a higher new-patient code", () => {
  const recommendation = codingOpportunities({
    visitType: "New patient office visit",
    codes: ["99203"],
    diagnoses: [],
    note: "Total provider time was 50 minutes today.",
  }).find((item) => item.code === "99204");
  assert.equal(recommendation.action, "replace");
  assert.equal(recommendation.supportedBy, "time");
});

test("high MDM requires two documented high-level domains", () => {
  const recommendation = codingOpportunities({
    visitType: "Established office visit",
    codes: ["99214"],
    diagnoses: [],
    note: "Severe exacerbation threatens bodily function. Decision was made to hospitalize the patient.",
  }).find((item) => item.code === "99215");
  assert.equal(recommendation.action, "replace");
  assert.equal(recommendation.mdm.problems.rank, 4);
  assert.equal(recommendation.mdm.risk.rank, 4);
});

test("a shorter documented time does not create a conflict when current code is supported by MDM", () => {
  const opportunities = codingOpportunities({
    visitType: "Established office visit",
    codes: ["99214"],
    diagnoses: [],
    note: `Total provider time was 20 minutes.
Assessment:
1. ADHD — stable. Continue amphetamine-dextroamphetamine 20 mg twice daily.
2. Hypertension — stable. Continue losartan 50 mg daily.`,
  });
  assert.equal(opportunities.some((item) => item.reviewKind === "time_conflict"), false);
});

test("legacy clinical-audit code lists without exact encounter evidence are context only", () => {
  const encounter = {
    visitType: "Established office visit",
    payer: "Medicare",
    codes: [],
    diagnoses: [],
    note: "Synthetic note without an exact diagnosis phrase for the local rule engine.",
    clinicalAudit: {
      status: "resolved",
      rawReport: "Synthetic completed audit",
      findings: [],
      codingAsDocumented: { cpt: [], icd10: ["M51.16"] },
      suggestedCodesAfterChanges: { cpt: [], icd10: [] },
    },
  };
  const recommendation = codingOpportunities(encounter).find((item) => item.id === "audit:icd:M51.16");
  assert.ok(recommendation);
  assert.equal(recommendation.action, "review");
  assert.equal(recommendation.origin, "clinical_audit");
  assert.match(recommendation.coverageNote, /AAPC\/Codify/);
  assert.equal(applyCodingOpportunity(encounter, recommendation), false);
  assert.deepEqual(encounter.diagnoses, []);
});

test("audit ICD-10 code is addable only with exact current-note evidence and an encounter role", () => {
  const evidence = "Lumbar disc disorder with radiculopathy was assessed today";
  const encounter = {
    payer: "Medicare",
    codes: [],
    diagnoses: [],
    note: `Assessment: ${evidence}. Plan: Continue the documented treatment plan.`,
    clinicalAudit: {
      status: "resolved",
      rawReport: "Synthetic completed audit",
      findings: [],
      codingAsDocumented: { cpt: [], icd10: ["M51.16"] },
      suggestedCodesAfterChanges: { cpt: [], icd10: [] },
      codingEvidence: {
        documented: [{ category: "icd", code: "M51.16", evidence, location: "Assessment", encounterRole: "assessed", relationship: "additional" }],
        afterChanges: [],
      },
    },
  };
  const recommendation = codingOpportunities(encounter).find((item) => item.id === "audit:icd:M51.16");
  assert.equal(recommendation.action, "add");
  assert.equal(recommendation.eligibleToApply, true);
  assert.equal(applyCodingOpportunity(encounter, recommendation), true);
  assert.deepEqual(encounter.diagnoses, ["M51.16"]);
});

test("same-family ICD-10 codes require an explicit additional-or-replacement relationship", () => {
  const evidence = "Lumbar disc disorder with radiculopathy was assessed today";
  const base = {
    payer: "Medicare",
    codes: [],
    diagnoses: ["M51.26"],
    note: `Assessment: ${evidence}.`,
    clinicalAudit: {
      status: "resolved",
      rawReport: "Synthetic completed audit",
      findings: [],
      codingAsDocumented: { cpt: [], icd10: ["M51.16"] },
      suggestedCodesAfterChanges: { cpt: [], icd10: [] },
      codingEvidence: {
        documented: [{ category: "icd", code: "M51.16", evidence, location: "Assessment", encounterRole: "assessed", relationship: "" }],
        afterChanges: [],
      },
    },
  };
  let recommendation = codingOpportunities(base).find((item) => item.id === "audit:icd:M51.16");
  assert.equal(recommendation.action, "review");
  assert.match(recommendation.missingDocumentation, /same code family/i);

  base.clinicalAudit.codingEvidence.documented[0].relationship = "replaces M51.26";
  base.clinicalAudit.codingEvidence.documented[0].replaceCode = "M51.26";
  recommendation = codingOpportunities(base).find((item) => item.id === "audit:icd:M51.16");
  assert.equal(recommendation.action, "replace");
  assert.equal(recommendation.replaceCode, "M51.26");
});

test("audit code suggested after changes remains review-only until the linked finding is confirmed", () => {
  const baseFinding = {
    id: "audit:1",
    issue: "Review M51.26 for documented radiculopathy and consider M51.16.",
    location: "Assessment and plan",
    suggestedFix: "Confirm the documented radiculopathy before replacing M51.26 with M51.16.",
    supportingSource: "ICD-10-CM Official Guidelines for Coding and Reporting 2026",
    decision: "pending",
  };
  const encounter = {
    payer: "Medicare + QMB",
    note: "Synthetic note.",
    codes: [],
    diagnoses: ["M51.26"],
    clinicalAudit: {
      status: "needs_resolution",
      rawReport: "Synthetic completed audit",
      findings: [baseFinding],
      codingAsDocumented: { cpt: [], icd10: [] },
      suggestedCodesAfterChanges: { cpt: [], icd10: ["M51.16"] },
    },
  };
  let recommendation = codingOpportunities(encounter).find((item) => item.id === "audit:icd:M51.16");
  assert.equal(recommendation.action, "review");
  assert.equal(applyCodingOpportunity(encounter, recommendation), false);

  encounter.clinicalAudit.findings[0] = { ...baseFinding, decision: "occurred", approvedAddendum: "Synthetic provider-confirmed clarification." };
  recommendation = codingOpportunities(encounter, [recommendation]).find((item) => item.id === "audit:icd:M51.16");
  assert.equal(recommendation.action, "review");
  assert.equal(recommendation.replaceCode, "M51.26");
  assert.equal(applyCodingOpportunity(encounter, recommendation), false);
  assert.deepEqual(encounter.diagnoses, ["M51.26"]);
});

test("a previously applied problem-list-only code is reopened for required review", () => {
  const encounter = {
    payer: "Medicare + QMB",
    note: "Synthetic note without encounter management of lumbar stenosis.",
    codes: [],
    diagnoses: ["M48.061"],
    clinicalAudit: {
      status: "resolved",
      rawReport: "Synthetic completed audit",
      findings: [],
      codingAsDocumented: { cpt: [], icd10: ["M48.061"] },
      suggestedCodesAfterChanges: { cpt: [], icd10: [] },
    },
  };
  const existing = [{ id: "audit:icd:M48.061", status: "applied", action: "add", category: "icd", code: "M48.061" }];
  const recommendation = codingOpportunities(encounter, existing).find((item) => item.id === "audit:icd:M48.061");
  assert.equal(recommendation.action, "review");
  assert.equal(recommendation.reviewKind, "current_code_evidence_review");
  assert.equal(recommendation.requiresDecision, true);
  assert.equal(recommendation.status, "pending");
});

test("clinical-audit and exact-phrase suggestions for the same diagnosis are deduplicated", () => {
  const opportunities = codingOpportunities({
    note: "Assessment: generalized anxiety disorder.",
    codes: [],
    diagnoses: [],
    clinicalAudit: {
      status: "resolved",
      rawReport: "Synthetic completed audit",
      findings: [],
      codingAsDocumented: { cpt: [], icd10: ["F41.1"] },
      suggestedCodesAfterChanges: { cpt: [], icd10: [] },
    },
  }).filter((item) => item.code === "F41.1");
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].auditSource, "BHW clinical audit");
});

