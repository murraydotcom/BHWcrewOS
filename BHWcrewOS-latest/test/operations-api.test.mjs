import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { createOperationsApp } from "../cloud/operations-api/app.mjs";
import {
  buildCommunication,
  buildPatientRequestBundle,
  transitionPatientRequest,
  transitionTask,
} from "../cloud/operations-api/domain.mjs";
import {
  activatePatientPortalAccess,
  ageAt,
  evaluatePatientPortalAccess,
  normalizePatientEmail,
  normalizePatientPhone,
  patientIdentityReference,
  patientPortalInvitationPreview,
  sanitizePatientPortalAccess,
  sanitizePatientIdentity,
  selectUniqueActivePatient,
} from "../cloud/operations-api/patient-identity.mjs";

const FIXED_NOW = "2026-08-25T12:00:00.000Z";

function idFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-synthetic-${String(++sequence).padStart(4, "0")}`;
}

function crewToken(secret, overrides = {}) {
  const nowSeconds = Math.floor(Date.parse(FIXED_NOW) / 1000);
  const claims = {
    sub: "crew:synthetic-staff-id",
    staffId: "synthetic-staff-id",
    name: "Synthetic Staff",
    role: "front-desk",
    iss: "bhw-crewhq",
    aud: "bhw-operations-cloud",
    iat: nowSeconds - 30,
    exp: nowSeconds + 300,
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

class MemoryRepository {
  constructor() {
    this.requests = new Map();
    this.tasks = new Map();
    this.communications = new Map();
    this.receipts = new Map();
    this.auditCount = 0;
    this.identityMatch = {
      bhwPatientId: "BHW0000",
      preferredName: "Synthetic",
      portalAuthorization: {
        schemaVersion: "bhw.patient-portal-access.v1",
        accessType: "self",
        proxyAccessAllowed: false,
        pilotCohort: "primary-care-adult-v1",
        programs: ["primary"],
        portalAccessStatus: "active",
        preferredChannel: "email",
        verifiedChannel: "email",
        contactVerifiedAt: FIXED_NOW,
        consentedAt: FIXED_NOW,
        portalInvitedAt: FIXED_NOW,
        authorizationUpdatedAt: FIXED_NOW,
      },
    };
    this.identityCalls = [];
    this.portalAccess = null;
  }

  async createPatientRequest(bundle, receipt) {
    const key = `${receipt.scope}:${receipt.key}`;
    const existing = this.receipts.get(key);
    if (existing) {
      if (existing.payloadHash !== receipt.payloadHash) {
        throw Object.assign(new Error("Idempotency-Key was already used for different content"), { status: 409, code: "idempotency_conflict" });
      }
      return { request: this.requests.get(existing.patientRequestId), replayed: true };
    }
    this.requests.set(bundle.request.patientRequestId, bundle.request);
    this.tasks.set(bundle.task.taskId, bundle.task);
    this.communications.set(bundle.communication.communicationId, bundle.communication);
    this.auditCount += bundle.audits.length;
    this.receipts.set(key, { patientRequestId: bundle.request.patientRequestId, payloadHash: receipt.payloadHash });
    return { request: bundle.request, replayed: false };
  }

  async getPatientRequest(id) {
    const request = this.requests.get(id);
    if (!request) throw Object.assign(new Error("patient request was not found"), { status: 404, code: "not_found" });
    return request;
  }

  async listPatientRequests() { return [...this.requests.values()]; }
  async listTasks() { return [...this.tasks.values()]; }
  async listCommunications() { return [...this.communications.values()]; }

  async resolvePatientIdentity(identity, options) {
    this.identityCalls.push({ identity, options });
    return this.identityMatch;
  }

  async getPatientPortalAccess(bhwPatientId) {
    return {
      patient: { bhwPatientId, patientStatus: "active", dateOfBirth: "1980-01-02" },
      access: this.portalAccess,
    };
  }

  async savePatientPortalAccess(bhwPatientId, input, actor, options) {
    this.portalAccess = sanitizePatientPortalAccess(input, {
      patient: { bhwPatientId, patientStatus: "active", dateOfBirth: "1980-01-02" },
      existing: this.portalAccess || {},
      actor,
      verifiedContactReference: "synthetic-exact-contact-reference",
      now: options.now,
    });
    return this.portalAccess;
  }

  async updatePatientRequestStatus(id, input, actor, options) {
    const result = transitionPatientRequest(await this.getPatientRequest(id), input, actor, options);
    this.requests.set(id, result.request);
    if (result.audit) this.auditCount += 1;
    return result.request;
  }

  async updateTaskStatus(id, input, actor, options) {
    const current = this.tasks.get(id);
    if (!current) throw Object.assign(new Error("task was not found"), { status: 404, code: "not_found" });
    const result = transitionTask(current, input, actor, options);
    this.tasks.set(id, result.task);
    if (result.audit) this.auditCount += 1;
    return result.task;
  }

  async createCommunication(input, actor, options) {
    const request = await this.getPatientRequest(input.patientRequestId);
    const result = buildCommunication(input, request, actor, options);
    this.communications.set(result.communication.communicationId, result.communication);
    this.auditCount += 1;
    return result.communication;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  const environment = {
    CREWOS_OPERATIONS_TOKEN_SECRET: "synthetic-crew-secret",
    CARE_CONNECT_INTAKE_SECRET: "synthetic-intake-secret",
    CARE_CONNECT_PATIENT_IDENTITY_SECRET: "synthetic-patient-identity-secret",
    CARE_CONNECT_CLIENT_ID: "care-connect",
    PATIENT_PORTAL_PILOT_ENABLED: "true",
    FRONT_DESK_INTAKE_SECRET: "synthetic-front-desk-secret",
    FRONT_DESK_CLIENT_ID: "front-desk-os",
    ALLOWED_ORIGINS: "https://crew.example.test",
  };
  const app = createOperationsApp({
    repository,
    environment,
    now: () => new Date(FIXED_NOW),
    idFactory: idFactory(),
  });
  return { app, repository, environment };
}

function frontDeskReferralRequest(body, key = "front-desk-referral:synthetic-0001", secret = "synthetic-front-desk-secret") {
  return new Request("https://operations.example.test/v1/intake/front-desk-referrals", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-BHW-Client-Id": "front-desk-os",
    },
    body: JSON.stringify(body),
  });
}

function frontDeskPatientRequest(body, key = "front-desk-request:synthetic-0001", secret = "synthetic-front-desk-secret") {
  return new Request("https://operations.example.test/v1/intake/front-desk-patient-requests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-BHW-Client-Id": "front-desk-os",
    },
    body: JSON.stringify(body),
  });
}

function frontDeskBulkRequest(records, secret = "synthetic-front-desk-secret") {
  return new Request("https://operations.example.test/v1/intake/front-desk-patient-requests/bulk", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "X-BHW-Client-Id": "front-desk-os",
    },
    body: JSON.stringify({ records }),
  });
}

function identityRequest(body, secret = "synthetic-patient-identity-secret") {
  return new Request("https://operations.example.test/v1/patient-identity/resolve", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "X-BHW-Client-Id": "care-connect",
    },
    body: JSON.stringify(body),
  });
}

function intakeRequest(body, key = "cc:synthetic-0001", secret = "synthetic-intake-secret") {
  return new Request("https://operations.example.test/v1/intake/patient-requests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-BHW-Client-Id": "care-connect",
    },
    body: JSON.stringify(body),
  });
}

const syntheticIntake = {
  bhwPatientId: "BHW0000",
  patientMatchStatus: "matched",
  requestType: "referral",
  summary: "Synthetic referral status request",
  message: "Please confirm the synthetic referral status.",
  requester: { displayName: "Synthetic Patient", preferredChannel: "portal" },
  routing: { targetSystem: "crewos", assignedTeam: "front-desk" },
  sourceMetadata: { sourceRecordId: "synthetic-submission-0001" },
};

test("patient identity contract normalizes one verified direct contact and DOB", () => {
  assert.equal(normalizePatientEmail(" Synthetic.Patient@Example.Test "), "synthetic.patient@example.test");
  assert.equal(normalizePatientPhone("(443) 555-0100"), "+14435550100");
  assert.deepEqual(sanitizePatientIdentity({
    verifiedEmail: "Synthetic.Patient@Example.Test",
    dateOfBirth: "1980-01-02",
  }), {
    email: "synthetic.patient@example.test",
    phone: "",
    dateOfBirth: "1980-01-02",
  });
  assert.throws(() => sanitizePatientIdentity({
    verifiedEmail: "synthetic.patient@example.test",
    verifiedPhone: "+14435550100",
    dateOfBirth: "1980-01-02",
  }), /exactly one verified/);
  assert.throws(() => sanitizePatientIdentity({ verifiedEmail: "bad", dateOfBirth: "1980-01-02" }), /exactly one verified/);
  assert.throws(() => sanitizePatientIdentity({ verifiedPhone: "+14435550100", dateOfBirth: "1980-02-31" }), /valid date of birth/);
  const reference = patientIdentityReference({ email: "synthetic.patient@example.test" }, "synthetic-secret");
  assert.equal(reference.length, 64);
  assert.doesNotMatch(reference, /synthetic|example/);
  const candidate = { bhwPatientId: "BHW0000", patientStatus: "active", dateOfBirth: "1980-01-02" };
  assert.equal(selectUniqueActivePatient([candidate], "1980-01-02"), candidate);
  assert.equal(selectUniqueActivePatient([candidate, { ...candidate }], "1980-01-02"), null);
  assert.equal(selectUniqueActivePatient([{ ...candidate, patientStatus: "inactive" }], "1980-01-02"), null);
});

test("adult Primary Care portal access is explicit, self-only, consented, and invite-gated", () => {
  const patient = { bhwPatientId: "BHW0000", patientStatus: "active", dateOfBirth: "1980-01-02" };
  const actor = { id: "synthetic-provider", role: "provider" };
  const approved = sanitizePatientPortalAccess({
    portalAccessStatus: "approved",
    allowlisted: true,
    preferredChannel: "email",
    contactVerificationConfirmed: true,
    consentStatus: "current",
    consentedAt: FIXED_NOW,
    consentEvidenceReference: "synthetic-consent-reference",
  }, { patient, actor, verifiedContactReference: "synthetic-exact-contact-reference", now: new Date(FIXED_NOW) });
  assert.equal(approved.accessType, "self");
  assert.equal(approved.proxyAccessAllowed, false);
  assert.deepEqual(approved.programs, ["primary"]);
  assert.equal(evaluatePatientPortalAccess(approved, patient, "email", new Date(FIXED_NOW), "synthetic-exact-contact-reference").eligible, false);
  assert.throws(() => sanitizePatientPortalAccess({ ...approved, portalAccessStatus: "invited" }, {
    patient, existing: approved, actor, now: new Date(FIXED_NOW),
  }), /confirm the invitation/);
  const invited = sanitizePatientPortalAccess({
    ...approved,
    portalAccessStatus: "invited",
    invitationDeliveryConfirmed: true,
  }, { patient, existing: approved, actor, now: new Date(FIXED_NOW) });
  assert.equal(evaluatePatientPortalAccess(invited, patient, "email", new Date(FIXED_NOW), "synthetic-exact-contact-reference").eligible, true);
  assert.equal(evaluatePatientPortalAccess(invited, patient, "email", new Date(FIXED_NOW), "different-contact-reference").reason, "contact-not-verified");
  assert.equal(evaluatePatientPortalAccess(invited, patient, "sms", new Date(FIXED_NOW), "synthetic-exact-contact-reference").reason, "verified-channel-mismatch");
  assert.equal(activatePatientPortalAccess(invited, new Date(FIXED_NOW)).portalAccessStatus, "active");
  assert.equal(evaluatePatientPortalAccess({ ...invited, portalInvitedAt: "2999-01-01T00:00:00.000Z" }, patient, "email", new Date(FIXED_NOW), "synthetic-exact-contact-reference").reason, "invitation-not-recorded");
  assert.throws(() => sanitizePatientPortalAccess({
    ...approved,
    consentedAt: "2999-01-01T00:00:00.000Z",
  }, { patient, existing: approved, actor, verifiedContactReference: "synthetic-exact-contact-reference", now: new Date(FIXED_NOW) }), /not in the future/);
  assert.equal(ageAt("2009-01-02", new Date(FIXED_NOW)), 17);
  assert.throws(() => sanitizePatientPortalAccess({
    portalAccessStatus: "approved",
    allowlisted: true,
    preferredChannel: "email",
    contactVerificationConfirmed: true,
    consentStatus: "current",
    consentedAt: FIXED_NOW,
    consentEvidenceReference: "synthetic-consent-reference",
  }, { patient: { ...patient, dateOfBirth: "2009-01-02" }, actor, verifiedContactReference: "synthetic-exact-contact-reference", now: new Date(FIXED_NOW) }), /adult patients/);
});

test("portal invitation preview is generic, unsent, and contains no clinical details", () => {
  const invitation = patientPortalInvitationPreview();
  assert.equal(invitation.deliveryStatus, "not-sent");
  assert.match(invitation.message, /secure patient portal/i);
  assert.doesNotMatch(JSON.stringify(invitation), /diagnosis|medication|primary care|program|symptom|treatment|BHW\d{4}/i);
});

test("Care Connect resolves one Google patient only after verified-contact authentication", async () => {
  const { app, repository } = fixture();
  const response = await app(identityRequest({
    verifiedEmail: "synthetic.patient@example.test",
    dateOfBirth: "1980-01-02",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    patient: repository.identityMatch,
  });
  assert.equal(repository.identityCalls.length, 1);
  assert.deepEqual(repository.identityCalls[0].identity, {
    email: "synthetic.patient@example.test",
    phone: "",
    dateOfBirth: "1980-01-02",
  });
  assert.equal(repository.identityCalls[0].options.identityReference.length, 64);

  const denied = await app(identityRequest({
    verifiedEmail: "synthetic.patient@example.test",
    dateOfBirth: "1980-01-02",
  }, "synthetic-intake-secret"));
  assert.equal(denied.status, 401);
  assert.equal(repository.identityCalls.length, 1);
});

test("the organization pilot switch stops identity resolution before registry matching", async () => {
  const { app, repository, environment } = fixture();
  environment.PATIENT_PORTAL_PILOT_ENABLED = "false";
  const response = await app(identityRequest({
    verifiedEmail: "synthetic.patient@example.test",
    dateOfBirth: "1980-01-02",
  }));
  assert.equal(response.status, 503);
  assert.equal(repository.identityCalls.length, 0);
});

test("approved CrewHQ roles manage one patient portal record without sending an invitation", async () => {
  const { app, environment } = fixture();
  const auth = `Bearer ${crewToken(environment.CREWOS_OPERATIONS_TOKEN_SECRET, { role: "provider" })}`;
  let response = await app(new Request("https://operations.example.test/v1/patient-portal-access/BHW0000", {
    headers: { Authorization: auth },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).invitationPreview.deliveryStatus, "not-sent");

  response = await app(new Request("https://operations.example.test/v1/patient-portal-access/BHW0000", {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      portalAccessStatus: "approved",
      allowlisted: true,
      preferredChannel: "email",
      contactVerificationConfirmed: true,
      consentStatus: "current",
      consentedAt: FIXED_NOW,
      consentEvidenceReference: "synthetic-consent-reference",
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access.portalAccessStatus, "approved");

  const frontDeskAuth = `Bearer ${crewToken(environment.CREWOS_OPERATIONS_TOKEN_SECRET)}`;
  response = await app(new Request("https://operations.example.test/v1/patient-portal-access/BHW0000", {
    method: "PUT",
    headers: { Authorization: frontDeskAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ portalAccessStatus: "revoked" }),
  }));
  assert.equal(response.status, 403);
});

test("ambiguous or missing Google patient matches fail closed without identity details", async () => {
  const { app, repository } = fixture();
  repository.identityMatch = null;
  const response = await app(identityRequest({
    verifiedPhone: "+14435550100",
    dateOfBirth: "1980-01-02",
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, "identity_not_matched");
  assert.doesNotMatch(JSON.stringify(body), /443|1980|BHW\d{4}/);
});

test("audit events remain metadata-only", () => {
  const bundle = buildPatientRequestBundle(syntheticIntake, { type: "integration", id: "care-connect", role: "intake" }, {
    now: FIXED_NOW,
    idFactory: idFactory(),
    intake: true,
  });
  const serializedAudits = JSON.stringify(bundle.audits);
  assert.doesNotMatch(serializedAudits, /Synthetic Patient/);
  assert.doesNotMatch(serializedAudits, /Please confirm/);
  assert.equal(bundle.audits[0].bhwPatientId, "BHW0000");
});

test("secure intake atomically builds the request, triage task, communication, and audit metadata", async () => {
  const { app, repository } = fixture();
  const response = await app(intakeRequest(syntheticIntake));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.patientRequest.bhwPatientId, "BHW0000");
  assert.equal(data.patientRequest.status, "received");
  assert.equal(data.patientRequest.notificationMetadata.policy, "manual-only");
  assert.equal(data.patientRequest.notificationMetadata.automationEnabled, false);
  assert.equal(data.patientRequest.notificationMetadata.deliveryState, "not-scheduled");
  assert.equal(repository.tasks.size, 1);
  assert.equal([...repository.tasks.values()][0].taskType, "triage");
  assert.equal(repository.communications.size, 1);
  assert.equal([...repository.communications.values()][0].direction, "inbound");
  assert.equal(repository.auditCount, 3);
});

test("intake authentication fails closed and idempotency replays safely", async () => {
  const { app, repository } = fixture();
  let response = await app(intakeRequest(syntheticIntake, "cc:synthetic-0001", "wrong-secret"));
  assert.equal(response.status, 401);
  assert.equal(repository.requests.size, 0);

  response = await app(intakeRequest(syntheticIntake));
  assert.equal(response.status, 201);
  const first = await response.json();
  response = await app(intakeRequest(syntheticIntake));
  assert.equal(response.status, 200);
  const replay = await response.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.patientRequest.patientRequestId, first.patientRequest.patientRequestId);
  assert.equal(repository.requests.size, 1);

  response = await app(intakeRequest({ ...syntheticIntake, message: "Different synthetic content" }));
  assert.equal(response.status, 409);
});

test("Front Desk referral intake creates one patient-linked workflow record without clinical narrative", async () => {
  const { app, repository } = fixture();
  const response = await app(frontDeskReferralRequest({
    bhwPatientId: "BHW0000",
    priority: "routine",
    summary: "Referral coordination · Endocrinology",
    message: "Referral document generated; clinical indication remains in the clinical record.",
    requester: { displayName: "Front Desk OS", preferredChannel: "internal" },
    sourceMetadata: {
      sourceRecordId: "front-desk-referral:synthetic-0001",
      sourcePage: "bhw-front-desk",
      referralDestination: "Endocrinology",
      referralDocumentState: "generated",
    },
  }));
  assert.equal(response.status, 201);
  const saved = (await response.json()).patientRequest;
  assert.equal(saved.bhwPatientId, "BHW0000");
  assert.equal(saved.requestType, "referral");
  assert.equal(saved.source, "front-desk-os");
  assert.equal(saved.routing.assignedTeam, "referrals");
  assert.equal(saved.sourceMetadata.referralDestination, "Endocrinology");
  assert.equal(saved.sourceMetadata.referralDocumentState, "generated");
  assert.doesNotMatch(JSON.stringify(saved), /diagnosis|brief history|test result/i);
  assert.equal(repository.requests.size, 1);
});

test("historical Front Desk intake preserves its received time and suppresses notifications", async () => {
  const { app, repository } = fixture();
  const response = await app(frontDeskPatientRequest({
    bhwPatientId: "BHW0000",
    patientMatchStatus: "matched",
    requestType: "general",
    summary: "Synthetic historical request",
    message: "Synthetic historical request",
    notificationMode: "none",
    historicalReceivedAt: "2026-08-01T13:30:00.000Z",
    source: "legacy-protected-migration",
    sourceMetadata: { sourceRecordId: "legacy-synthetic-request" },
  }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.notification, null);
  assert.equal(body.chat, null);
  assert.equal(body.patientRequest.createdAt, "2026-08-01T13:30:00.000Z");
  assert.equal(body.patientRequest.notificationMode, "none");
  assert.equal(repository.requests.size, 1);
});

test("bulk historical Front Desk migration saves, reads back, and replays without notifications", async () => {
  const { app, repository } = fixture();
  const records = [1, 2].map((index) => ({
    submissionId: `legacy-request:synthetic-000${index}`,
    body: {
      bhwPatientId: "BHW0000",
      patientMatchStatus: "matched",
      requestType: "general",
      summary: `Synthetic historical request ${index}`,
      message: `Synthetic historical request ${index}`,
      notificationMode: "none",
      historicalReceivedAt: `2026-08-0${index}T13:30:00.000Z`,
      source: "legacy-protected-migration",
      sourceMetadata: { sourceRecordId: `legacy-synthetic-request-${index}` },
    },
  }));
  let response = await app(frontDeskBulkRequest(records));
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.writtenCount, 2);
  assert.equal(body.verifiedCount, 2);
  assert.equal(body.replayedCount, 0);
  assert.equal(body.notification, null);
  assert.equal(body.chat, null);
  assert.equal(repository.requests.size, 2);
  assert.deepEqual([...repository.requests.values()].map((request) => request.createdAt).sort(), [
    "2026-08-01T13:30:00.000Z",
    "2026-08-02T13:30:00.000Z",
  ]);

  response = await app(frontDeskBulkRequest(records));
  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.verifiedCount, 2);
  assert.equal(body.replayedCount, 2);
  assert.equal(repository.requests.size, 2);
});

test("bulk historical Front Desk migration rejects any notification-enabled record", async () => {
  const { app, repository } = fixture();
  const response = await app(frontDeskBulkRequest([{
    submissionId: "legacy-request:synthetic-notify",
    body: { ...syntheticIntake, notificationMode: "automatic" },
  }]));
  assert.equal(response.status, 400);
  assert.equal(repository.requests.size, 0);
});

test("bulk historical Front Desk migration validates every record before writing", async () => {
  const { app, repository } = fixture();
  const response = await app(frontDeskBulkRequest([{
    submissionId: "legacy-request:synthetic-valid",
    body: { ...syntheticIntake, notificationMode: "none" },
  }, {
    submissionId: "legacy-request:synthetic-invalid",
    body: { ...syntheticIntake, notificationMode: "automatic" },
  }]));
  assert.equal(response.status, 400);
  assert.equal(repository.requests.size, 0);
});

test("Front Desk referral intake rejects the wrong integration secret", async () => {
  const { app, repository } = fixture();
  const response = await app(frontDeskReferralRequest({
    bhwPatientId: "BHW0000", summary: "Referral coordination · Endocrinology", message: "Synthetic",
  }, "front-desk-referral:synthetic-0002", "wrong-secret"));
  assert.equal(response.status, 401);
  assert.equal(repository.requests.size, 0);
});

test("CrewOS status changes validate transitions and keep notifications unscheduled", async () => {
  const { app, repository, environment } = fixture();
  let response = await app(intakeRequest(syntheticIntake));
  const created = (await response.json()).patientRequest;
  const auth = `Bearer ${crewToken(environment.CREWOS_OPERATIONS_TOKEN_SECRET)}`;

  response = await app(new Request(`https://operations.example.test/v1/patient-requests/${created.patientRequestId}/status`, {
    method: "PATCH",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  }));
  assert.equal(response.status, 409);

  for (const status of ["triaged", "in-progress", "resolved"]) {
    response = await app(new Request(`https://operations.example.test/v1/patient-requests/${created.patientRequestId}/status`, {
      method: "PATCH",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }));
    assert.equal(response.status, 200);
  }
  const request = repository.requests.get(created.patientRequestId);
  assert.equal(request.resolvedAt, FIXED_NOW);
  assert.equal(request.notificationMetadata.lastEligibleEvent, "request-resolved");
  assert.equal(request.notificationMetadata.deliveryState, "not-scheduled");
  assert.equal(request.notificationMetadata.automationEnabled, false);
  assert.equal(repository.auditCount, 6);
});

test("communication endpoint records a manual outbound event without sending it", async () => {
  const { app, repository, environment } = fixture();
  let response = await app(intakeRequest(syntheticIntake));
  const created = (await response.json()).patientRequest;
  response = await app(new Request("https://operations.example.test/v1/communications", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken(environment.CREWOS_OPERATIONS_TOKEN_SECRET)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      patientRequestId: created.patientRequestId,
      direction: "outbound",
      channel: "sms",
      communicationStatus: "not-sent",
      eventType: "manual-status-update",
      summary: "Synthetic draft status update",
      body: "Synthetic message that was not sent.",
      patientVisible: true,
    }),
  }));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.communication.communicationStatus, "not-sent");
  assert.equal(repository.communications.size, 2);
  assert.equal(repository.requests.get(created.patientRequestId).notificationMetadata.deliveryState, "not-scheduled");
});
