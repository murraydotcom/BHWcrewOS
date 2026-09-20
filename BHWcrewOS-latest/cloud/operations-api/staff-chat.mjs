import crypto from "node:crypto";

export const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
export const chatError = (status, message) => Object.assign(new Error(message), { status });
export const TEAM_ROOM = "bhw-team";
export function chatActor(actor) {
  if (actor?.type !== "staff" || !actor.staffId || actor.id !== `crew:${actor.staffId}`) throw chatError(401, "Verified CrewOS staff sign-in is required.");
  return { id: actor.id, name: String(actor.name || "BHW staff").slice(0, 120), role: String(actor.role || "staff").slice(0, 80) };
}
export function roomId(value) {
  if (!/^(bhw-team|dm-[a-f0-9]{64})$/.test(String(value))) throw chatError(400, "Invalid conversation.");
  return value;
}
export function directRoomId(left, right) { return `dm-${hash([left, right].sort().join("\u001f"))}`; }
export function assertMember(room, actor) {
  if (!room || (room.id !== TEAM_ROOM && !room.memberIds?.includes(actor.id))) throw chatError(404, "Conversation not found.");
}
export function sanitizeChatMessage(input, actor, conversationId) {
  const content = String(input.content || "").replace(/\u0000/g, "").trim();
  if (!content || content.length > 2000) throw chatError(400, "Enter a message of 1–2,000 characters.");
  const key = String(input.idempotencyKey || "");
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(key)) throw chatError(400, "A valid send key is required.");
  // No clinical/free-text forwarding, attachments, URLs fetched by the server, or external delivery.
  if (input.noPatientData !== true) throw chatError(400, "Confirm this staff message contains no patient or confidential HR information.");
  return { id: hash(`${conversationId}\u001f${actor.id}\u001f${key}`), content, contentHash: hash(content), authorId: actor.id, authorName: actor.name };
}
export function unread(room, readSequence, actorId) {
  const latestOther = room.lastAuthorId === actorId ? room.previousOtherSequence || 0 : room.sequence || 0;
  return latestOther > (Number(readSequence) || 0);
}

export class StaffChatRepository {
  constructor(db, clock = () => new Date()) {
    this.db = db;
    this.clock = clock;
    this.rooms = db.collection("staffChatRooms");
    this.people = db.collection("staffChatMembers");
    this.audit = db.collection("auditEvents");
  }
  person(id) { return this.people.doc(hash(id)); }
  async session(actor) {
    const ref = this.person(actor.id);
    const now = this.clock().toISOString();
    await ref.set({ ...actor, lastSeenAt: now }, { merge: true });
    const saved = (await ref.get()).data();
    return { actor, preferences: { showBadge: saved?.showBadge === true }, savedAt: now };
  }
  async preferences(actor, input) {
    if (typeof input.showBadge !== "boolean") throw chatError(400, "Choose whether to show unread badges.");
    await this.person(actor.id).set({ showBadge: input.showBadge }, { merge: true });
    return { showBadge: (await this.person(actor.id).get()).data().showBadge === true };
  }
  async directory() {
    const snapshot = await this.people.orderBy("name").limit(501).get();
    return { people: snapshot.docs.slice(0, 500).map((doc) => {
      const { id, name } = doc.data(); return { id, name };
    }), truncated: snapshot.docs.length > 500 };
  }
  async list(actor) {
    const [teamDoc, memberships, profile] = await Promise.all([
      this.rooms.doc(TEAM_ROOM).get(),
      this.person(actor.id).collection("rooms").orderBy("updatedAt", "desc").limit(101).get(),
      this.person(actor.id).get(),
    ]);
    const team = teamDoc.exists ? teamDoc.data() : { id: TEAM_ROOM, kind: "team", name: "BHW Team", sequence: 0 };
    const summaries = [team, ...memberships.docs.slice(0, 100).map((doc) => doc.data())];
    const reads = await this.db.getAll(...summaries.map((room) => this.person(actor.id).collection("reads").doc(room.id)));
    return {
      rooms: summaries.map((room, index) => ({
        id: room.id, kind: room.kind, name: room.id === TEAM_ROOM ? "BHW Team" : room.memberNames?.[room.memberIds.find((id) => id !== actor.id)] || "Direct message",
        sequence: room.sequence || 0, updatedAt: room.updatedAt || "", unread: unread(room, reads[index].data()?.sequence, actor.id),
      })),
      preferences: { showBadge: profile.data()?.showBadge === true }, truncated: memberships.docs.length > 100,
    };
  }
  async direct(actor, recipientId) {
    if (typeof recipientId !== "string" || recipientId === actor.id || recipientId.length > 165) throw chatError(400, "Choose another staff member.");
    const id = directRoomId(actor.id, recipientId);
    const ref = this.rooms.doc(id);
    return this.db.runTransaction(async (tx) => {
      const [recipient, prior] = await tx.getAll(this.person(recipientId), ref);
      if (!recipient.exists || recipient.data().id !== recipientId) throw chatError(404, "This staff member must open Staff Chat once before receiving direct messages.");
      if (prior.exists) { assertMember(prior.data(), actor); return { id }; }
      const now = this.clock().toISOString();
      const room = { id, kind: "direct", memberIds: [actor.id, recipientId].sort(), memberNames: { [actor.id]: actor.name, [recipientId]: recipient.data().name }, sequence: 0, updatedAt: now };
      tx.create(ref, room);
      for (const memberId of room.memberIds) tx.set(this.person(memberId).collection("rooms").doc(id), room);
      tx.create(this.audit.doc(crypto.randomUUID()), { eventType: "staff-chat.conversation-created", conversationId: id, actor: actor.id, occurredAt: now });
      return { id };
    });
  }
  async messages(actor, id, before = "") {
    roomId(id);
    const room = (await this.rooms.doc(id).get()).data() || (id === TEAM_ROOM ? { id, sequence: 0 } : null);
    assertMember(room, actor);
    let query = this.rooms.doc(id).collection("messages").orderBy("sequence", "desc");
    if (before) {
      if (!/^\d+$/.test(String(before)) || Number(before) < 1) throw chatError(400, "Invalid page cursor.");
      query = query.startAfter(Number(before));
    }
    const snapshot = await query.limit(51).get();
    const rows = snapshot.docs.slice(0, 50).map((doc) => doc.data());
    return {
      messages: rows.reverse().map(({ contentHash, ...message }) => message),
      nextBefore: snapshot.docs.length > 50 ? rows[0].sequence : null,
      sequence: room.sequence || 0,
    };
  }
  async send(actor, id, input) {
    roomId(id);
    const note = sanitizeChatMessage(input, actor, id);
    const roomRef = this.rooms.doc(id), messageRef = roomRef.collection("messages").doc(note.id);
    const rateRef = this.person(actor.id).collection("limits").doc("send");
    const result = await this.db.runTransaction(async (tx) => {
      const [roomDoc, existing, rate] = await tx.getAll(roomRef, messageRef, rateRef);
      const room = roomDoc.data() || (id === TEAM_ROOM ? { id, kind: "team", name: "BHW Team", sequence: 0 } : null);
      assertMember(room, actor);
      if (existing.exists) {
        if (existing.data().contentHash !== note.contentHash) throw chatError(409, "That send key already belongs to a different message.");
        return { messageId: note.id, replayed: true };
      }
      const now = this.clock();
      const window = Math.floor(now.getTime() / 60000);
      const count = rate.data()?.window === window ? rate.data().count : 0;
      if (count >= 30) throw chatError(429, "Please wait a minute before sending more messages.");
      const message = { ...note, sequence: (room.sequence || 0) + 1, createdAt: now.toISOString(), conversationId: id };
      const updated = { ...room, sequence: message.sequence, updatedAt: message.createdAt, lastAuthorId: actor.id, previousOtherSequence: room.lastAuthorId === actor.id ? room.previousOtherSequence || 0 : room.sequence || 0 };
      tx.create(messageRef, message);
      tx.set(roomRef, updated);
      tx.set(rateRef, { window, count: count + 1 });
      for (const memberId of room.memberIds || []) tx.set(this.person(memberId).collection("rooms").doc(id), updated);
      tx.create(this.audit.doc(crypto.randomUUID()), { eventType: "staff-chat.message-saved", conversationId: id, messageId: note.id, actor: actor.id, characterCount: note.content.length, occurredAt: message.createdAt });
      return { messageId: note.id, replayed: false };
    });
    // Verify remote persistence before telling the client Saved to BHW Cloud.
    const saved = (await messageRef.get()).data();
    if (!saved || saved.contentHash !== note.contentHash) throw chatError(503, "Save confirmation unavailable. Retry this same message.");
    const { contentHash, ...message } = saved;
    return { ...result, message, savedAt: saved.createdAt };
  }
  async read(actor, id, sequence) {
    roomId(id);
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw chatError(400, "Invalid read marker.");
    const ref = this.person(actor.id).collection("reads").doc(id);
    return this.db.runTransaction(async (tx) => {
      const [roomDoc, marker] = await tx.getAll(this.rooms.doc(id), ref);
      const room = roomDoc.data() || (id === TEAM_ROOM ? { id, sequence: 0 } : null);
      assertMember(room, actor);
      if (sequence > (room.sequence || 0)) throw chatError(400, "Read marker exceeds this conversation.");
      const next = Math.max(marker.data()?.sequence || 0, sequence);
      tx.set(ref, { sequence: next, updatedAt: this.clock().toISOString() });
      return { sequence: next };
    });
  }
}
