import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  BILLING_PRE_RELEASE_REVIEW_SCHEMA,
  buildSyntheticBillingPreReleaseReview,
  validateHealthCoreBillingEvidence,
} from "../billing-clinical-evidence.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function evidence({ addenda = [] } = {}) {
  const note = {
    bhwPatientId: "BHW0000",
    encounterId: "ENC-SYNTHETIC-1",
    noteId: "NOTE-SYNTHETIC-1",
    version: 2,
    status: "provider-signed",
    contentHash: "a".repeat(64),
    recordContentHash: "b".repeat(64),
    sourceDraftRevision: 2,
    signedAt: "2026-10-08T12:00:00.000Z",
    signedBy: "provider@bhwmedical.org",
    signedByRole: "provider",
    signerName: "Synthetic Provider",
    signerCredential: "CRNP",
    addenda,
  };
  const evidenceHash = hash(note);
  return {
    schema: "bhw.health-core.billing-clinical-evidence.v1",
    evidenceId: `HC-BILL-${evidenceHash.slice(0, 24)}`,
    evidenceHash,
    sourceSystem: "BHW Health Core",
    readBackStatus: "read-back-verified",
    generatedAt: "2026-10-08T12:05:00.000Z",
    synthetic: true,
    realPatientAuthorized: false,
    claimable: false,
    narrativeIncluded: false,
    requiresReaudit: addenda.length > 0,
    patient: { bhwPatientId: "BHW0000" },
    encounter: { encounterId: note.encounterId },
    note,
    boundary: {
      purpose: "signed-note evidence for BHW RCM controlled pre-release review",
      mayCreateSuperbillDraft: false,
      mayCreateInvoice: false,
      mayCreateClaim: false,
      mayTransmit837: false,
    },
  };
}

const completeReview = {
  clinicalEvidenceReadBackConfirmed: true,
  encounterDateOfServiceConfirmed: true,
  signedProviderIdentityConfirmed: true,
  addendaReviewed: true,
  codingAndProgramRulesReviewed: true,
  payerAndCoverageReviewedSeparately: true,
};

test("CrewOS verifies the narrative-free Health Core signed-note evidence contract", () => {
  const verified = validateHealthCoreBillingEvidence(evidence());
  assert.equal(verified.patientId, "BHW0000");
  assert.equal(verified.note.status, "provider-signed");
  assert.equal(verified.requiresReaudit, false);
});

test("CrewOS rejects identity drift, narrative content, claimability, and tampering", () => {
  assert.throws(() => validateHealthCoreBillingEvidence({ ...evidence(), patient: { bhwPatientId: "BHW0123" } }), /valid synthetic/);
  assert.throws(() => validateHealthCoreBillingEvidence({ ...evidence(), narrative: "Must not cross this boundary" }), /forbidden clinical content/);
  assert.throws(() => validateHealthCoreBillingEvidence({ ...evidence(), claimable: true }), /valid synthetic/);
  const tampered = evidence();
  tampered.note.version = 3;
  assert.throws(() => validateHealthCoreBillingEvidence(tampered), /valid synthetic/);
});

test("billing pre-release review remains nonclaimable even after every human check is complete", () => {
  const result = buildSyntheticBillingPreReleaseReview({
    evidence: evidence(),
    review: completeReview,
    actor: { staffId: "synthetic-billing-reviewer", role: "billing-specialist" },
  }, { now: "2026-10-08T12:10:00.000Z" });
  assert.equal(result.schema, BILLING_PRE_RELEASE_REVIEW_SCHEMA);
  assert.equal(result.status, "human-review-complete-nonclaimable");
  assert.equal(result.claimable, false);
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.boundary, {
    narrativeStored: false,
    superbillDraftCreated: false,
    invoiceCreated: false,
    claimCreated: false,
    transaction837Created: false,
    clearinghouseTransmission: false,
    payerSubmission: false,
    patientChargeCreated: false,
    externalActions: 0,
  });
});

test("signed-note addenda force explicit reaudit before pre-release review can clear", () => {
  const addenda = [{ addendumId: "ADD-1", sequence: 1, contentHash: "c".repeat(64), addedAt: "2026-10-08T12:07:00.000Z" }];
  const result = buildSyntheticBillingPreReleaseReview({
    evidence: evidence({ addenda }),
    review: { ...completeReview, addendaReviewed: false },
    actor: { staffId: "synthetic-billing-reviewer", role: "billing-specialist" },
  });
  assert.equal(result.status, "blocked-pending-human-review");
  assert.deepEqual(result.blockers, ["review-required:addendaReviewed"]);
});
