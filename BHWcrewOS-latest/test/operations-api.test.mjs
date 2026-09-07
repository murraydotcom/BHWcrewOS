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
    CARE_CONNECT_CLIENT_ID: "care-connect",
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
