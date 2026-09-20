import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { createOperationsApp } from "../cloud/operations-api/app.mjs";

const SECRET = "synthetic-operations-secret";
const NOW = new Date("2026-08-31T16:00:00.000Z");

function bearer() {
  const seconds = Math.floor(NOW.getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({
    aud: "bhw-operations-cloud", iss: "bhw-crewhq", sub: "crew:synthetic-ops",
    staffId: "synthetic-ops", name: "Synthetic Operator", role: "operations-manager",
    iat: seconds - 10, exp: seconds + 300,
  })).toString("base64url");
  return `Bearer ${payload}.${crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

function request(path, { method = "GET", body, authorization = bearer() } = {}) {
  return new Request(`https://operations.example${path}`, {
    method,
    headers: {
      Authorization: authorization,
      Origin: "https://crewhq.bhwmedical.org",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("Operations API owns the authenticated request/action/communication contract", async () => {
  const calls = [];
  const patientRequest = {
    id: "synthetic-api-request", bhwPatientId: "BHW0000", requestType: "general",
    status: "received", statusCategory: "received", allowedRoles: ["operations-manager"],
  };
  const workflow = {
    automationEnabled: false,
    async listRequests(filters, user) { calls.push(["list", filters, user]); return [patientRequest]; },
    async action(id, input, user) { calls.push(["action", id, input, user]); return { request: { ...patientRequest, status: "completed", statusCategory: "completed" } }; },
    async listCommunications(id, user) { calls.push(["communications", id, user]); return [{ id: "comm-1", requestId: id, status: "sent" }]; },
    async listTeamNotes(id, user) { calls.push(["team-notes", id, user]); return { notes: [{ id: "NOTE-1", requestId: id, content: "Synthetic internal note" }], unreadCount: 1 }; },
    async createTeamNote(id, input, user) { calls.push(["team-note-create", id, input, user]); return { note: { id: "NOTE-2", requestId: id, content: input.content }, replayed: false }; },
    async markTeamNotesRead(id, input, user) { calls.push(["team-notes-read", id, input, user]); return { requestId: id, lastReadAt: input.readThroughAt }; },
  };
  const app = createOperationsApp({ repository: {}, workflow, environment: {
    ALLOWED_ORIGINS: "https://crewhq.bhwmedical.org", CREWOS_OPERATIONS_TOKEN_SECRET: SECRET,
  }, now: () => NOW });

  let response = await app(request("/v1/patient-requests?status=open"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).requests[0].id, patientRequest.id);

  response = await app(request(`/v1/patient-requests/${patientRequest.id}/actions`, {
    method: "POST", body: { action: "resolve", idempotencyKey: "synthetic-action-1" },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).request.status, "completed");

  response = await app(request(`/v1/patient-requests/${patientRequest.id}/communications`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).communications[0].id, "comm-1");

  response = await app(request(`/v1/patient-requests/${patientRequest.id}/team-notes`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notes[0].content, "Synthetic internal note");

  response = await app(request(`/v1/patient-requests/${patientRequest.id}/team-notes`, {
    method: "POST", body: { content: "Synthetic follow-up", idempotencyKey: "synthetic-note-key" },
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).note.content, "Synthetic follow-up");

  response = await app(request(`/v1/patient-requests/${patientRequest.id}/team-notes/read`, {
    method: "POST", body: { readThroughAt: NOW.toISOString() },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).readState.lastReadAt, NOW.toISOString());
  assert.deepEqual(calls.map((call) => call[0]), ["list", "action", "communications", "team-notes", "team-note-create", "team-notes-read"]);
});

test("Chat and Dialpad callbacks delegate verification to fail-closed workflow services", async () => {
  const calls = [];
  const workflow = {
    automationEnabled: false,
    async handleDialpadWebhook(raw) { calls.push(["dialpad", raw]); return { ok: true }; },
    async handleChatEvent(incoming) { calls.push(["chat", incoming.headers.get("authorization")]); return { text: "updated" }; },
  };
  const app = createOperationsApp({ repository: {}, workflow, environment: {}, now: () => NOW });
  let response = await app(new Request("https://operations.example/v1/webhooks/dialpad", { method: "POST", body: "signed.synthetic.jwt" }));
  assert.equal(response.status, 200);
  response = await app(new Request("https://operations.example/v1/chat/events", {
    method: "POST", headers: { Authorization: "Bearer synthetic-google-token" }, body: "{}",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["dialpad", "signed.synthetic.jwt"], ["chat", "Bearer synthetic-google-token"]]);
});

test("workflow endpoints fail closed when the workflow service is absent", async () => {
  const app = createOperationsApp({ repository: {}, environment: {}, now: () => NOW });
  const response = await app(new Request("https://operations.example/v1/webhooks/dialpad", { method: "POST", body: "anything" }));
  assert.equal(response.status, 503);
});
