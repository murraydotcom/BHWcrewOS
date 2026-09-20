// Synthetic-only cloud smoke. Never list patient queues or real staff/messages.
// The state file is produced by stage-staff-chat.ps1; no credential values are logged.
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
const statePath = process.argv[2];
const state = JSON.parse((await readFile(statePath, "utf8")).replace(/^\uFEFF/, ""));
assert.equal(state.service, "bhw-operations-api");
assert.equal(state.project, "constant-land-504517-i9");
assert.equal(state.database, "bhw-rcm-prod");
const base = new URL(state.candidateUrl);
assert.match(base.hostname, /^staff-chat-[a-z0-9-]+---bhw-operations-api-awknhudemq-uk\.a\.run\.app$/);
assert.equal(base.protocol, "https:");
assert.match(state.secretName, /^[A-Za-z0-9_-]+$/); assert.match(state.secretVersion, /^[A-Za-z0-9_-]+$/);
const gcloudToken = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "gcloud.cmd auth print-access-token"], { encoding: "utf8", windowsHide: true }).trim();
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000), ...options });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${value.error?.message || value.error || "request failed"}`), { status: response.status });
  return value;
}
const health = await fetchJson(new URL("/health", base));
assert.equal(health.service, "bhw-operations-api");
assert.equal(health.workflowAutomationEnabled, false, "Patient SMS must remain gated off.");
const access = await fetchJson(`https://secretmanager.googleapis.com/v1/projects/${state.project}/secrets/${state.secretName}/versions/${state.secretVersion}:access`, { headers: { Authorization: `Bearer ${gcloudToken}` } });
const secret = Buffer.from(access.payload.data, "base64");
const run = crypto.randomUUID().replaceAll("-", "");
const actorA = `crew:synthetic-chat-release-${run}-a`, actorB = `crew:synthetic-chat-release-${run}-b`, actorC = `crew:synthetic-chat-release-${run}-c`;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function token(actor) {
  const now = Math.floor(Date.now() / 1000);
  const data = { sub: actor, staffId: actor.slice(5), name: "Synthetic Chat Release Check", role: "operations-manager", iss: "bhw-crewhq", aud: "bhw-operations-cloud", iat: now, exp: now + 300 };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
async function call(path, body, actor = actorA) {
  return fetchJson(new URL(path, base), { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token(actor)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const room = `dm-${hash([actorA, actorB].sort().join("\u001f"))}`;
const messageKey = `synthetic-${run}`, messageId = hash(`${room}\u001f${actorA}\u001f${messageKey}`);
const requestId = `synthetic-chat-release-${run}`;
const noteKey = `synthetic-note-${run}`, noteId = `NOTE-${hash([requestId, actorA, noteKey].join("\u001f")).slice(0, 40)}`;
const paths = [
  `staffChatRooms/${room}/messages/${messageId}`, `staffChatRooms/${room}`,
  ...[actorA, actorB].flatMap((actor) => [`staffChatMembers/${hash(actor)}/rooms/${room}`, `staffChatMembers/${hash(actor)}/reads/${room}`, `staffChatMembers/${hash(actor)}/limits/send`, `staffChatMembers/${hash(actor)}`]),
  `patientRequestTeamNotes/${noteId}`, `patientRequestTeamNoteReads/${hash(`${requestId}:${actorB}`)}`,
  `patientRequests/${requestId}`, `tasks/${hash(`patient-request:${requestId}`)}`,
];
const report = { run, revision: state.revision, completedAt: "", syntheticOnly: true, productionTrafficChanged: false, assertions: [], cleanup: "pending", auditReceipts: "retained" };
const commitUrl = `https://firestore.googleapis.com/v1/projects/${state.project}/databases/${state.database}/documents:commit`;
const firestoreHeaders = { Authorization: `Bearer ${gcloudToken}`, "Content-Type": "application/json" };
// Check cleanup authority before creating any test records by deleting a fresh,
// nonexistent synthetic sentinel. This cannot target a real patient or staff record.
await fetchJson(commitUrl, { method: "POST", headers: firestoreHeaders, body: JSON.stringify({ writes: [{ delete: `projects/${state.project}/databases/${state.database}/documents/staffChatSmokeChecks/synthetic-${run}` }] }) });
try {
  const anon = await fetch(new URL("/v1/staff-chat/rooms", base), { redirect: "error", signal: AbortSignal.timeout(60000) });
  assert.equal(anon.status, 401); report.assertions.push("unauthenticated chat denied");
  for (const actor of [actorA, actorB]) await call("/v1/staff-chat/session", {}, actor);
  const conversation = await call("/v1/staff-chat/direct", { recipientId: actorB }); assert.equal(conversation.id, room);
  const input = { content: "Synthetic dark-launch connectivity check. No patient or real staff data.", idempotencyKey: messageKey, noPatientData: true };
  const created = await call(`/v1/staff-chat/rooms/${room}/messages`, input);
  const retried = await call(`/v1/staff-chat/rooms/${room}/messages`, input);
  assert.equal(created.message.id, messageId); assert.equal(retried.replayed, true);
  const history = await call(`/v1/staff-chat/rooms/${room}/messages`, undefined, actorB);
  assert.equal(history.messages.length, 1); assert.equal(history.messages[0].content, input.content);
  await assert.rejects(call(`/v1/staff-chat/rooms/${room}/messages`, undefined, actorC), { status: 404 });
  await call(`/v1/staff-chat/rooms/${room}/read`, { sequence: 1 }, actorB);
  await call("/v1/staff-chat/preferences", { showBadge: true }, actorB);
  assert.equal((await call("/v1/staff-chat/session", {}, actorB)).preferences.showBadge, true);
  report.assertions.push("Firestore DM read-back", "duplicate send suppressed", "third staff cannot read DM", "read marker saved", "notification preference read-back");
  const request = await call("/v1/patient-requests", { id: requestId, bhwPatientId: "BHW0000", requestType: "general", summary: "Synthetic release validation only", source: "crewos", status: "completed", notificationMode: "none" });
  assert.equal(request.chat.status, "suppressed"); assert.equal(request.notification.status, "suppressed");
  const noteInput = { content: "Synthetic protected Team Note. No patient data.", idempotencyKey: noteKey };
  const note = await call(`/v1/patient-requests/${requestId}/team-notes`, noteInput); assert.equal(note.note.id, noteId);
  assert.equal((await call(`/v1/patient-requests/${requestId}/team-notes`, noteInput)).replayed, true);
  const notes = await call(`/v1/patient-requests/${requestId}/team-notes`, undefined, actorB);
  assert.equal(notes.notes.length, 1); assert.equal(notes.notes[0].content, noteInput.content); assert.equal(notes.unreadCount, 1);
  await call(`/v1/patient-requests/${requestId}/team-notes/read`, { readThroughAt: notes.lastNoteAt }, actorB);
  assert.equal((await call(`/v1/patient-requests/${requestId}/team-notes`, undefined, actorB)).unreadCount, 0);
  const communications = await call(`/v1/patient-requests/${requestId}/communications`);
  assert.equal(communications.communications.length, 0);
  report.assertions.push("Team Notes index/query ready", "Team Note remote read-back", "note retry deduplicated", "per-staff read marker verified", "no SMS or Google Chat communications created");
  report.completedAt = new Date().toISOString();
} finally {
  // Only exact paths derived from this fresh synthetic UUID are removed; never list/delete a collection.
  let cleanupError;
  try {
    await fetchJson(commitUrl, { method: "POST", headers: firestoreHeaders, body: JSON.stringify({ writes: paths.map((path) => ({ delete: `projects/${state.project}/databases/${state.database}/documents/${path}` })) }) });
    report.cleanup = "exact synthetic message, note, membership, preference, request and task records removed; metadata-only audit receipts retained";
  } catch (error) { cleanupError = error; report.cleanup = "not confirmed; exact synthetic paths retained in this verification script"; report.completedAt = ""; }
  await writeFile(statePath.replace(/\.json$/, ".smoke.json"), JSON.stringify(report, null, 2));
  secret.fill(0);
  if (cleanupError) throw cleanupError;
}
console.log(JSON.stringify(report, null, 2));
