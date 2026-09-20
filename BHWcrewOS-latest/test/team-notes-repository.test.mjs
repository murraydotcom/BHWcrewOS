import test from "node:test";
import assert from "node:assert/strict";
import { MemoryFirestore } from "./helpers/firestore-memory.mjs";
import { FirestoreWorkflowRepository } from "../cloud/operations-api/workflow-repository.mjs";
import { sanitizeTeamNote, teamNoteIndicator } from "../cloud/operations-api/team-notes.mjs";
const A = { sub: "crew:synthetic-a", staffId: "synthetic-a", name: "Synthetic Alpha", role: "staff" };
const B = { sub: "crew:synthetic-b", staffId: "synthetic-b", name: "Synthetic Beta", role: "staff" };
const REQUEST = { id: "synthetic-request-001", requestType: "general", status: "received", statusCategory: "received", version: 1, bhwPatientId: "BHW0000", assignedTo: "", assignedToName: "", serviceLine: "general", assignedTeam: "staff", priority: "routine", updatedAt: "2026-09-20T15:00:00Z" };
const make = (key, user = A, content = "Synthetic coordination only.") => sanitizeTeamNote({ content, idempotencyKey: key }, { requestId: REQUEST.id, user, now: new Date("2026-09-20T16:00:00Z") });
async function fixture() {
  const db = new MemoryFirestore(), repository = new FirestoreWorkflowRepository({ firestore: db });
  await repository.patientRequests.doc(REQUEST.id).set(REQUEST);
  return { db, repository };
}
test("team note repository atomically deduplicates and rejects same key with different content", async () => {
  const { repository, db } = await fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => repository.createRequestTeamNote(make("synthetic-retry"), A)));
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal((await repository.getPatientRequest(REQUEST.id)).teamNoteCount, 1);
  assert.equal([...db.records.keys()].filter((path) => path.startsWith("auditEvents/")).length, 1);
  await assert.rejects(repository.createRequestTeamNote(make("synthetic-retry", A, "Different content"), A), { status: 409 });
});
test("concurrent workflow saves and Chat delivery metadata do not overwrite independent note summaries", async () => {
  const { repository } = await fixture();
  const stale = await repository.getPatientRequest(REQUEST.id);
  await repository.createRequestTeamNote(make("synthetic-first"), A);
  await repository.commitPatientRequestAction({ previousVersion: 1, request: { ...stale, version: 2, status: "in_progress", processedActionKeys: ["synthetic-action"] }, action: "start", actionHash: "synthetic-action", user: A });
  await repository.attachChatDelivery(REQUEST.id, { messageName: "spaces/synthetic/messages/synthetic", space: "spaces/synthetic" });
  const saved = await repository.getPatientRequest(REQUEST.id);
  assert.equal(saved.teamNoteCount, 1); assert.equal(saved.version, 2); assert.equal(saved.status, "in_progress");
});
test("writing your own note does not mark another author's earlier note read", async () => {
  const { repository } = await fixture();
  await repository.createRequestTeamNote(make("synthetic-a"), A);
  await repository.createRequestTeamNote(make("synthetic-b", B), B);
  await repository.createRequestTeamNote(make("synthetic-b-again", B), B);
  const request = await repository.getPatientRequest(REQUEST.id);
  const state = (await repository.getTeamNoteReadStates(B.sub, [REQUEST.id]))[REQUEST.id] || {};
  assert.equal(teamNoteIndicator(request, state, B).teamNoteUnread, true);
  const notes = await repository.listRequestTeamNotes(REQUEST.id, B.sub);
  await repository.markRequestTeamNotesRead(REQUEST.id, B.sub, notes.notes.at(-1).createdAt, new Date().toISOString());
  const after = (await repository.getTeamNoteReadStates(B.sub, [REQUEST.id]))[REQUEST.id];
  assert.equal(teamNoteIndicator(request, after, B).teamNoteUnread, false);
});
test("team notes have complete chronological pagination beyond 200, even with identical incoming timestamps", async () => {
  const { repository } = await fixture();
  for (let i = 1; i <= 205; i++) await repository.createRequestTeamNote(make(`synthetic-note-${i}`), A);
  const latest = await repository.listRequestTeamNotes(REQUEST.id, B.sub);
  const older = await repository.listRequestTeamNotes(REQUEST.id, B.sub, latest.nextBefore);
  assert.equal(latest.notes.length, 200); assert.equal(older.notes.length, 5);
  assert.ok(older.notes.at(-1).createdAt < latest.notes[0].createdAt);
  assert.equal(new Set([...older.notes, ...latest.notes].map((note) => note.id)).size, 205);
});
