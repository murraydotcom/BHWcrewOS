import crypto from "node:crypto";

const clean = (value, max = 2000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);

function actorId(value) {
  const id = clean(value, 160);
  if (!id) return "";
  return id.startsWith("crew:") ? id : `crew:${id}`;
}

export function sanitizeTeamNote(input = {}, { requestId = "", user = {}, now = new Date() } = {}) {
  const rawContent = String(input.content || input.message || "").replace(/\u0000/g, "").trim();
  if (rawContent.length > 2000) throw Object.assign(new Error("team note is too long"), { status: 400 });
  const content = rawContent;
  if (!content) throw Object.assign(new Error("team note is required"), { status: 400 });
  const idempotencyKey = clean(input.idempotencyKey, 160);
  if (!idempotencyKey) throw Object.assign(new Error("idempotency key is required"), { status: 400 });
  const authorId = actorId(user.sub || user.staffId);
  if (!authorId) throw Object.assign(new Error("signed-in staff identity is required"), { status: 401 });
  const mentions = [];
  const seen = new Set();
  for (const entry of Array.isArray(input.mentions) ? input.mentions.slice(0, 10) : []) {
    const staffId = clean(entry?.staffId || entry?.id, 160).replace(/^crew:/, "");
    const mentionActorId = actorId(staffId);
    if (!staffId || !mentionActorId || seen.has(mentionActorId)) continue;
    seen.add(mentionActorId);
    mentions.push({
      staffId,
      actorId: mentionActorId,
      name: clean(entry?.name, 120) || "Teammate",
    });
  }
  const createdAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const noteId = `NOTE-${crypto.createHash("sha256")
    .update([requestId, authorId, idempotencyKey].join("\u001f"))
    .digest("hex")
    .slice(0, 40)}`;
  return {
    id: noteId,
    requestId: clean(requestId, 100),
    content,
    mentions,
    authorId,
    authorStaffId: clean(user.staffId || authorId.replace(/^crew:/, ""), 160),
    authorName: clean(user.name, 120) || "CrewOS staff",
    authorRole: clean(user.role, 80) || "staff",
    visibility: "crewos-staff",
    deliveryChannels: [],
    createdAt,
    updatedAt: createdAt,
    idempotencyKeyHash: crypto.createHash("sha256").update(idempotencyKey).digest("hex"),
  };
}

export function noteIsUnread(note = {}, lastReadAt = "", user = {}) {
  const readerId = actorId(user.sub || user.staffId);
  if (!note.createdAt || note.authorId === readerId) return false;
  return !lastReadAt || String(note.createdAt) > String(lastReadAt);
}

export function teamNoteIndicator(request = {}, state = {}, user = {}) {
  const lastAt = String(request.teamNoteLastAt || "");
  const readerId = actorId(user.sub || user.staffId);
  const unread = Boolean(lastAt && request.teamNoteLastAuthorId !== readerId && (!state.lastReadAt || lastAt > state.lastReadAt));
  return {
    teamNoteUnread: unread,
    teamNoteMentioned: Boolean(unread && state.lastMentionAt && (!state.lastReadAt || state.lastMentionAt > state.lastReadAt)),
  };
}
