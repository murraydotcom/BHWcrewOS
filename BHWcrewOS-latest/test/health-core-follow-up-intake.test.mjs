import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createOperationsApp } from "../cloud/operations-api/app.mjs";
import { sanitizePatientRequest } from "../cloud/operations-api/workflow-automation.mjs";

const SECRET = "synthetic-health-core-follow-up-secret";
const ENV = {
  HEALTH_CORE_FOLLOW_UP_INTAKE_ENABLED: "true",
  HEALTH_CORE_FOLLOW_UP_INTAKE_SECRET: SECRET,
  HEALTH_CORE_FOLLOW_UP_CLIENT_ID: "health-core",
};
const healthCoreFollowUp = {
  schemaVersion: 1,
  noteId: "synthetic-note-1",
  signedVersion: 1,
  signedContentHash: "b".repeat(64),
  itemId: "route-whole-person-care-1",
  itemKind: "routing-request",
};
const deterministicId = (link = healthCoreFollowUp) => `hc-followup-${crypto.createHash("sha256")
  .update(`${link.noteId}:${link.signedVersion}:${link.signedContentHash}:${link.itemKind}:${link.itemId}`)
  .digest("hex").slice(0, 40)}`;
const body = {
  id: deterministicId(),
  bhwPatientId: "BHW0000",
  requestType: "referral",
  source: "health-core",
  sourceReference: "Health Core signed note synthetic-note-1 v1",
  summary: "Whole-person care / SDOH: Synthetic transportation barrier.",
  priority: "routine",
  notificationMode: "automatic",
  manualNotifyOnly: false,
  workflowContext: {
    kind: "referral",
    fromDivision: "Primary Care",
    toDivision: "Whole Person Care",
    details: "Synthetic transportation barrier.",
    needs: ["Transportation"],
  },
  healthCoreFollowUp,
};

function request(input = body, authorization = SECRET) {
  return new Request("https://operations.example.test/v1/intake/health-core-follow-up", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authorization}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.id,
      "X-BHW-Client-Id": "health-core",
    },
    body: JSON.stringify(input),
  });
}

test("Health Core intake creates a manual-review CrewOS item and replays its deterministic ID", async () => {
  const persistedShape = sanitizePatientRequest(body, {
    user: { sub: "integration:health-core" },
    now: new Date("2026-10-15T12:00:00.000Z"),
    patientId: "BHW0000",
  });
  assert.deepEqual(persistedShape.healthCoreFollowUp, healthCoreFollowUp);
  let saved = null;
  let createCount = 0;
  const workflow = {
    async getRequest(id) {
      if (saved?.id === id) return saved;
      throw Object.assign(new Error("not found"), { status: 404 });
    },
    async createRequest(input, actor) {
      createCount += 1;
      assert.equal(actor.role, "system");
      saved = sanitizePatientRequest(input, {
        user: actor,
        now: new Date("2026-10-15T12:00:00.000Z"),
        patientId: input.bhwPatientId,
      });
      return { request: saved, notification: { status: "suppressed" } };
    },
  };
  const app = createOperationsApp({ repository: {}, workflow, environment: ENV });
  const created = await app(request());
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.request.source, "health-core");
  assert.equal(createdBody.request.notificationMode, "manual");
  assert.equal(createdBody.request.manualNotifyOnly, true);
  const replay = await app(request());
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  const changedReplay = await app(request({ ...body, summary: "Changed after the first accepted request." }));
  assert.equal(changedReplay.status, 409);
  assert.equal(createCount, 1);
});

test("Health Core intake fails closed for disabled, unauthenticated, or unsigned-note-shaped requests", async () => {
  const workflow = {
    async getRequest() { throw Object.assign(new Error("not found"), { status: 404 }); },
    async createRequest() { throw new Error("must not create"); },
  };
  const disabled = createOperationsApp({ repository: {}, workflow, environment: { ...ENV, HEALTH_CORE_FOLLOW_UP_INTAKE_ENABLED: "false" } });
  assert.equal((await disabled(request())).status, 503);
  const enabled = createOperationsApp({ repository: {}, workflow, environment: ENV });
  assert.equal((await enabled(request(body, "wrong-secret"))).status, 401);
  assert.equal((await enabled(request({ ...body, healthCoreFollowUp: { ...body.healthCoreFollowUp, signedContentHash: "not-a-hash" } }))).status, 400);
  assert.equal((await enabled(request({ ...body, healthCoreFollowUp: { ...body.healthCoreFollowUp, itemId: "changed-item" } }))).status, 400);
});
