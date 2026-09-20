import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { StaffChatRepository, TEAM_ROOM, directRoomId, unread } from "../cloud/operations-api/staff-chat.mjs";
import { createStaffChatApp } from "../cloud/operations-api/staff-chat-app.mjs";
import { MemoryFirestore } from "./helpers/firestore-memory.mjs";
const A = { type: "staff", id: "crew:synthetic-a", staffId: "synthetic-a", name: "Synthetic Alpha", role: "staff" };
const B = { type: "staff", id: "crew:synthetic-b", staffId: "synthetic-b", name: "Synthetic Beta", role: "provider" };
const C = { type: "staff", id: "crew:synthetic-c", staffId: "synthetic-c", name: "Synthetic Gamma", role: "staff" };
const NOW = Date.parse("2026-09-20T16:00:00Z");
const note = (key = "synthetic-send-001", content = "Synthetic staff coordination only.") => ({ content, idempotencyKey: key, noPatientData: true });
function fixture() {
  const db = new MemoryFirestore();
  let millis = NOW;
  const chat = new StaffChatRepository(db, () => new Date(millis));
  return { db, chat, advance: () => { millis += 61000; } };
}
function token(actor = A, claims = {}) {
  const body = Buffer.from(JSON.stringify({ sub: actor.id, staffId: actor.staffId, name: actor.name, role: actor.role, iss: "bhw-crewhq", aud: "bhw-operations-cloud", iat: NOW / 1000, exp: NOW / 1000 + 300, ...claims })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", "synthetic-test-secret").update(body).digest("base64url")}`;
}
function api(chat, environment = {}) {
  const app = createStaffChatApp({ chat, baseApp: () => new Response("base"), environment: { STAFF_CHAT_ENABLED: "true", ALLOWED_ORIGINS: "https://crewhq.bhwmedical.org", CREWOS_OPERATIONS_TOKEN_SECRET: "synthetic-test-secret", ...environment }, now: () => NOW });
  return async (path, body, actor = A, headers = {}) => app(new Request(`https://synthetic.invalid${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token(actor)}`, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
}
test("synthetic chat HTTP end-to-end: two staff, shared room, direct privacy, unread and stored preference", async () => {
  const { chat, db } = fixture(), call = api(chat);
  for (const actor of [A, B, C]) assert.equal((await call("/v1/staff-chat/session", {}, actor)).status, 200);
  const directory = await (await call("/v1/staff-chat/directory")).json();
  assert.equal(directory.people.length, 3);
  assert.deepEqual(Object.keys(directory.people[0]).sort(), ["id", "name"]);
  const sent = await (await call(`/v1/staff-chat/rooms/${TEAM_ROOM}/messages`, note())).json();
  assert.equal(sent.savedAt, new Date(NOW).toISOString());
  assert.equal(sent.message.sequence, 1);
  assert.equal((await (await call("/v1/staff-chat/rooms", undefined, B)).json()).rooms[0].unread, true);
  await call(`/v1/staff-chat/rooms/${TEAM_ROOM}/messages`, note("synthetic-b-reply"), B);
  assert.equal((await (await call("/v1/staff-chat/rooms", undefined, B)).json()).rooms[0].unread, true, "writing a reply must not mark another person's message read");
  await call(`/v1/staff-chat/rooms/${TEAM_ROOM}/read`, { sequence: 2 }, B);
  assert.equal((await (await call("/v1/staff-chat/rooms", undefined, B)).json()).rooms[0].unread, false);
  const direct = await (await call("/v1/staff-chat/direct", { recipientId: B.id })).json();
  assert.equal(direct.id, directRoomId(B.id, A.id));
  await call(`/v1/staff-chat/rooms/${direct.id}/messages`, note("synthetic-dm-message"));
  assert.equal((await call(`/v1/staff-chat/rooms/${direct.id}/messages`, undefined, C)).status, 404);
  assert.equal((await call(`/v1/staff-chat/rooms/${direct.id}/messages`, note("synthetic-intrusion"), C)).status, 404);
  assert.equal((await call(`/v1/staff-chat/rooms/${direct.id}/read`, { sequence: 1 }, C)).status, 404);
  assert.equal((await (await call("/v1/staff-chat/rooms", undefined, C)).json()).rooms.length, 1);
  assert.equal((await (await call("/v1/staff-chat/rooms")).json()).preferences.showBadge, false);
  await call("/v1/staff-chat/preferences", { showBadge: true });
  assert.equal((await (await call("/v1/staff-chat/rooms")).json()).preferences.showBadge, true);
  assert.ok([...db.records.keys()].every((key) => !key.startsWith("communications/") && !key.startsWith("patientRequests/")));
  for (const [key, audit] of db.records) if (key.startsWith("auditEvents/")) assert.equal("content" in audit, false);
});
test("concurrent retry has one immutable message and one metadata-only audit; altered payload conflicts", async () => {
  const { chat, db } = fixture();
  const results = await Promise.all(Array.from({ length: 12 }, () => chat.send(A, TEAM_ROOM, note())));
  assert.equal(results.filter((row) => !row.replayed).length, 1);
  assert.equal((await chat.messages(B, TEAM_ROOM)).messages.length, 1);
  assert.equal([...db.records.keys()].filter((key) => key.startsWith("auditEvents/")).length, 1);
  await assert.rejects(chat.send(A, TEAM_ROOM, note("synthetic-send-001", "Changed text")), { status: 409 });
});
test("ordered history returns all 115 messages without duplicates or omissions", async () => {
  const { chat, advance } = fixture();
  for (let i = 1; i <= 115; i++) { advance(); await chat.send(A, TEAM_ROOM, note(`synthetic-${i}`)); }
  const ids = new Set(); let cursor = "";
  do { const page = await chat.messages(B, TEAM_ROOM, cursor); for (const message of page.messages) { assert.equal(ids.has(message.id), false); ids.add(message.id); } cursor = page.nextBefore; } while (cursor);
  assert.equal(ids.size, 115);
});
test("read marker is monotonic and cannot run ahead; latest own messages preserve earlier unread", async () => {
  const { chat } = fixture();
  await chat.send(A, TEAM_ROOM, note());
  await chat.send(B, TEAM_ROOM, note("synthetic-b-two"));
  await chat.send(B, TEAM_ROOM, note("synthetic-b-three"));
  assert.equal((await chat.list(B)).rooms[0].unread, true);
  await chat.read(B, TEAM_ROOM, 3); await chat.read(B, TEAM_ROOM, 1);
  assert.equal((await chat.list(B)).rooms[0].unread, false);
  await assert.rejects(chat.read(B, TEAM_ROOM, 99), { status: 400 });
  assert.equal(unread({ sequence: 3, lastAuthorId: B.id, previousOtherSequence: 1 }, 0, B.id), true);
});
test("send throttling, invalid payloads, unknown recipient and unreadable room fail closed", async () => {
  const { chat } = fixture();
  await assert.rejects(chat.direct(A, "crew:not-registered"), { status: 404 });
  await assert.rejects(chat.direct(A, A.id), { status: 400 });
  await assert.rejects(chat.send(A, TEAM_ROOM, { ...note(), noPatientData: false }), { status: 400 });
  await assert.rejects(chat.send(A, TEAM_ROOM, note("synthetic-long", "x".repeat(2001))), { status: 400 });
  for (let i = 0; i < 30; i++) await chat.send(A, TEAM_ROOM, note(`synthetic-rate-${i}`));
  await assert.rejects(chat.send(A, TEAM_ROOM, note("synthetic-rate-blocked")), { status: 429 });
  assert.equal((await chat.send(A, TEAM_ROOM, note("synthetic-rate-0"))).replayed, true);
});
test("HTTP auth rejects no token, expired, wrong audience, forged identity, foreign origin; activation is explicit", async () => {
  const { chat } = fixture();
  const call = api(chat);
  for (const headers of [{ Authorization: "" }, { Authorization: `Bearer ${token(A, { exp: 1 })}` }, { Authorization: `Bearer ${token(A, { aud: "patient" })}` }, { Authorization: `Bearer ${token(A, { sub: B.id })}` }]) assert.equal((await call("/v1/staff-chat/rooms", undefined, A, headers)).status, 401);
  assert.equal((await call("/v1/staff-chat/rooms", undefined, A, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await api(chat, { STAFF_CHAT_ENABLED: "false" })("/v1/staff-chat/rooms")).status, 503);
  assert.equal((await api(chat, { CREWOS_OPERATIONS_TOKEN_SECRET: "" })("/v1/staff-chat/rooms")).status, 503);
  assert.equal((await call("/health")).status, 200, "existing backend remains delegated without side effects");
});
