import crypto from "node:crypto";

export const HEALTH_CORE_BILLING_EVIDENCE_SCHEMA = "bhw.health-core.billing-clinical-evidence.v1";
export const BILLING_PRE_RELEASE_REVIEW_SCHEMA = "bhw.billing.pre-release-review.v1";

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "content",
  "narrative",
  "subjective",
  "objective",
  "assessment",
  "plan",
  "dateOfBirth",
  "mrn",
  "medicalRecordNumber",
  "email",
  "phone",
  "address",
]);

const clean = (value, maximum = 4000) => String(value ?? "").trim().slice(0, maximum);
const hex64 = (value) => /^[a-f0-9]{64}$/.test(clean(value, 64).toLowerCase());

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function assertNarrativeFree(value, key = "") {
  if (FORBIDDEN_EVIDENCE_KEYS.has(key)) throw new Error(`Health Core billing evidence contains forbidden clinical content field: ${key}`);
  if (Array.isArray(value)) return value.forEach((item) => assertNarrativeFree(item));
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => assertNarrativeFree(child, childKey));
  }
}

function normalizeAddenda(addenda) {
  return (Array.isArray(addenda) ? addenda : []).map((entry) => {
    const normalized = {
      addendumId: clean(entry?.addendumId, 100),
      sequence: Number(entry?.sequence),
      contentHash: clean(entry?.contentHash, 64).toLowerCase(),
      addedAt: clean(entry?.addedAt, 40),
    };
    if (!normalized.addendumId || !Number.isInteger(normalized.sequence) || normalized.sequence < 1
      || !hex64(normalized.contentHash) || !Number.isFinite(Date.parse(normalized.addedAt))) {
      throw new Error("Health Core billing evidence contains invalid addendum metadata.");
    }
    return normalized;
  });
}

export function validateHealthCoreBillingEvidence(evidence = {}) {
  assertNarrativeFree(evidence);
  const addenda = normalizeAddenda(evidence.note?.addenda);
  const note = {
    bhwPatientId: clean(evidence.note?.bhwPatientId, 20).toUpperCase(),
    encounterId: clean(evidence.note?.encounterId, 100),
    noteId: clean(evidence.note?.noteId, 100),
    version: Number(evidence.note?.version),
    status: clean(evidence.note?.status, 40),
    contentHash: clean(evidence.note?.contentHash, 64).toLowerCase(),
    recordContentHash: clean(evidence.note?.recordContentHash, 64).toLowerCase(),
    sourceDraftRevision: Number(evidence.note?.sourceDraftRevision),
    signedAt: clean(evidence.note?.signedAt, 40),
    signedBy: clean(evidence.note?.signedBy, 180),
    signedByRole: clean(evidence.note?.signedByRole, 80),
    signerName: clean(evidence.note?.signerName, 160),
    signerCredential: clean(evidence.note?.signerCredential, 120),
    addenda,
  };
  const evidenceHash = clean(evidence.evidenceHash, 64).toLowerCase();
  const encounterId = clean(evidence.encounter?.encounterId, 100);
  const patientId = clean(evidence.patient?.bhwPatientId, 20).toUpperCase();
  const boundary = evidence.boundary || {};
  const invalid = evidence.schema !== HEALTH_CORE_BILLING_EVIDENCE_SCHEMA
    || evidence.sourceSystem !== "BHW Health Core"
    || evidence.readBackStatus !== "read-back-verified"
    || evidence.synthetic !== true
    || evidence.realPatientAuthorized !== false
    || evidence.claimable !== false
    || evidence.narrativeIncluded !== false
    || patientId !== "BHW0000"
    || note.bhwPatientId !== patientId
    || !encounterId
    || note.encounterId !== encounterId
    || !note.noteId
    || !Number.isInteger(note.version) || note.version < 1
    || note.status !== "provider-signed"
    || !hex64(note.contentHash)
    || !hex64(note.recordContentHash)
    || !Number.isInteger(note.sourceDraftRevision) || note.sourceDraftRevision < 1
    || !Number.isFinite(Date.parse(note.signedAt))
    || !note.signedBy
    || !note.signerName
    || !hex64(evidenceHash)
    || evidenceHash !== digest(note)
    || evidence.evidenceId !== `HC-BILL-${evidenceHash.slice(0, 24)}`
    || evidence.requiresReaudit !== (addenda.length > 0)
    || boundary.mayCreateSuperbillDraft !== false
    || boundary.mayCreateInvoice !== false
    || boundary.mayCreateClaim !== false
    || boundary.mayTransmit837 !== false;
  if (invalid) throw new Error("Health Core did not provide valid synthetic signed-note billing evidence.");
  return Object.freeze({
    evidenceId: evidence.evidenceId,
    evidenceHash,
    patientId,
    encounterId,
    note: Object.freeze(note),
    requiresReaudit: addenda.length > 0,
  });
}

export function buildSyntheticBillingPreReleaseReview({ evidence, review = {}, actor = {} } = {}, { now = new Date().toISOString() } = {}) {
  const verified = validateHealthCoreBillingEvidence(evidence);
  const reviewer = {
    staffId: clean(actor.staffId || actor.id, 160),
    role: clean(actor.role, 80),
  };
  if (!reviewer.staffId || !reviewer.role) throw new Error("An attributable CrewOS reviewer is required.");
  const checks = {
    clinicalEvidenceReadBackConfirmed: review.clinicalEvidenceReadBackConfirmed === true,
    encounterDateOfServiceConfirmed: review.encounterDateOfServiceConfirmed === true,
    signedProviderIdentityConfirmed: review.signedProviderIdentityConfirmed === true,
    addendaReviewed: review.addendaReviewed === true,
    codingAndProgramRulesReviewed: review.codingAndProgramRulesReviewed === true,
    payerAndCoverageReviewedSeparately: review.payerAndCoverageReviewedSeparately === true,
  };
  const blockers = Object.entries(checks)
    .filter(([key, value]) => !value && (key !== "addendaReviewed" || verified.requiresReaudit))
    .map(([key]) => `review-required:${key}`);
  const createdAt = new Date(now).toISOString();
  const reviewBase = {
    schema: BILLING_PRE_RELEASE_REVIEW_SCHEMA,
    reviewId: `BILL-PREFLIGHT-${verified.evidenceHash.slice(0, 20)}`,
    status: blockers.length ? "blocked-pending-human-review" : "human-review-complete-nonclaimable",
    createdAt,
    reviewer,
    sourceEvidence: {
      evidenceId: verified.evidenceId,
      evidenceHash: verified.evidenceHash,
      encounterId: verified.encounterId,
      noteId: verified.note.noteId,
      noteVersion: verified.note.version,
      recordContentHash: verified.note.recordContentHash,
      signedAt: verified.note.signedAt,
      requiresReaudit: verified.requiresReaudit,
    },
    checks,
    blockers,
    claimable: false,
    boundary: {
      narrativeStored: false,
      superbillDraftCreated: false,
      invoiceCreated: false,
      claimCreated: false,
      transaction837Created: false,
      clearinghouseTransmission: false,
      payerSubmission: false,
      patientChargeCreated: false,
      externalActions: 0,
    },
  };
  return Object.freeze({ ...reviewBase, reviewContentHash: digest(reviewBase) });
}
