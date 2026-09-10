import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflowService } from "../cloud/operations-api/workflow-service.mjs";
import { noteIsUnread, sanitizeTeamNote, teamNoteIndicator } from "../cloud/operations-api/team-notes.mjs";

const NOW = new Date("2026-09-10T16:00:00.000Z");
const REQUEST = {
  id: "synthetic-team-notes-001",
  bhwPatientId: "BHW0000",
  requestType: "general",
  status: "received",
  statusCategory: "received",
  allowedRoles: ["operations-manager"],
  version: 1,
};
const AUTHOR = { sub: "crew:synthetic-ops", staffId: "synthetic-ops", name: "Synthetic Operator", role: "operations-manager" };
const READER = { sub: "crew:synthetic-provider", staffId: "synthetic-provider", name: "Synthetic Provider", role: "provider" };

function repositoryFixture() {
  const request = structuredClone(REQUEST);
  const notes = new Map();
  const reads = new Map();
  const mentions = new Map();
  return {
    request,
    notes,
    async getPatientRequest(id) { return id === request.id ? structuredClone(request) : null; },
    async listPatientRequests() { return [structuredClone(request)]; },
    async createRequestTeamNote(note) {
      if (notes.has(note.id)) return { note: structuredClone(notes.get(note.id)), replayed: true };
      notes.set(note.id, structuredClone(note));
      request.teamNoteCount = notes.size;
      request.teamNoteLastAt = note.createdAt;
      request.teamNoteLastAuthorId = note.authorId;
      reads.set(`${note.requestId}:${note.authorId}`, note.createdAt);
      note.mentions.forEach((mention) => mentions.set(`${note.requestId}:${mention.actorId}`, note.createdAt));
      return { note: structuredClone(note), replayed: false };
    },
    async listRequestTeamNotes(id, actorId) {
      return {
        notes: [...notes.values()].filter((note) => note.requestId === id).map((note) => structuredClone(note)),
        lastReadAt: reads.get(`${id}:${actorId}`) || "",
      };
    },
    async markRequestTeamNotesRead(id, actorId, readThroughAt) {
      reads.set(`${id}:${actorId}`, readThroughAt);
      return { requestId: id, lastReadAt: readThroughAt };
    },
    async getTeamNoteReadStates(actorId, requestIds) {
      return Object.fromEntries(requestIds.map((id) => [id, {
        lastReadAt: reads.get(`${id}:${actorId}`) || "",
        lastMentionAt: mentions.get(`${id}:${actorId}`) || "",
      }]));
    },
  };
}

test("team notes are immutable internal records with bounded mentions", () => {
  const note = sanitizeTeamNote({
    content: "Synthetic coordination note only.",
    idempotencyKey: "synthetic-team-note-key",
    mentions: [
      { staffId: "synthetic-provider", name: "Synthetic Provider" },
      { staffId: "synthetic-provider", name: "Duplicate" },
    ],
  }, { requestId: REQUEST.id, user: AUTHOR, now: NOW });

  assert.match(note.id, /^NOTE-[a-f0-9]{40}$/);
  assert.equal(note.visibility, "crewos-staff");
  assert.deepEqual(note.deliveryChannels, []);
  assert.equal(note.mentions.length, 1);
  assert.equal(note.mentions[0].actorId, "crew:synthetic-provider");
  assert.equal(noteIsUnread(note, "", READER), true);
  assert.equal(noteIsUnread(note, "", AUTHOR), false);
  assert.throws(() => sanitizeTeamNote({ content: " ", idempotencyKey: "synthetic-empty" }, { requestId: REQUEST.id, user: AUTHOR }), /required/);
  assert.throws(() => sanitizeTeamNote({ content: "x".repeat(2001), idempotencyKey: "synthetic-long" }, { requestId: REQUEST.id, user: AUTHOR }), /too long/);
});

test("request-linked team notes are idempotent, mention-aware, and become read per staff member", async () => {
  const repository = repositoryFixture();
  let externalSendCount = 0;
  const service = createWorkflowService(repository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "false" },
    dialpad: { configured: true, async sendSms() { externalSendCount += 1; } },
    chat: { enabled: true, async sendRequestCard() { externalSendCount += 1; } },
    clock: () => NOW,
  });
  const input = {
    content: "Please review this synthetic request.",
    idempotencyKey: "synthetic-team-note-create",
    mentions: [{ staffId: READER.staffId, name: READER.name }],
  };

  const created = await service.createTeamNote(REQUEST.id, input, AUTHOR);
  const replay = await service.createTeamNote(REQUEST.id, input, AUTHOR);
  assert.equal(created.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(repository.notes.size, 1);
  assert.equal(externalSendCount, 0, "an internal note never enters SMS or Google Chat delivery");

  const beforeRead = await service.listRequests({}, READER);
  assert.deepEqual(teamNoteIndicator(repository.request, {
    lastReadAt: "",
    lastMentionAt: NOW.toISOString(),
  }, READER), { teamNoteUnread: true, teamNoteMentioned: true });
  assert.equal(beforeRead[0].teamNoteUnread, true);
  assert.equal(beforeRead[0].teamNoteMentioned, true);
  const thread = await service.listTeamNotes(REQUEST.id, READER);
  assert.equal(thread.unreadCount, 1);
  assert.equal(thread.notes[0].content, input.content);

  await service.markTeamNotesRead(REQUEST.id, { readThroughAt: thread.lastNoteAt }, READER);
  const afterRead = await service.listRequests({}, READER);
  assert.equal(afterRead[0].teamNoteUnread, false);
  assert.equal(afterRead[0].teamNoteMentioned, false);
});
