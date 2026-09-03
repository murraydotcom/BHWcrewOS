import crypto from "node:crypto";
import { FirestoreOperationsRepository } from "./firestore-repository.mjs";
import { normalizePhone } from "./dialpad-service.mjs";
import { sanitizePatientRequest, WORKFLOW_DEFINITIONS } from "./workflow-automation.mjs";

const clean = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const keyFor = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
const clone = (value) => value ? structuredClone(value) : value;

function workflowType(value) {
  const type = clean(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (["medication", "medication_refill"].includes(type)) return "refill";
  if (["prior_authorization", "priorauthorization", "pa"].includes(type)) return "prior_auth";
  if (["billing", "rcm"].includes(type)) return "billing_rcm";
  return ["refill", "referral", "prior_auth", "billing_rcm", "general"].includes(type) ? type : "general";
}

function workflowStatus(type, value) {
  const status = clean(value, 80).toLowerCase().replaceAll("-", "_");
  const definition = WORKFLOW_DEFINITIONS[type];
  if (definition.statuses[status]) return status;
  if (["received", "new"].includes(status)) return definition.received;
  if (["triaged", "in_progress"].includes(status)) return definition.inProgress;
  if (["resolved", "closed", "cancelled", "completed"].includes(status)) {
    if (definition.defaultResolution) return definition.defaultResolution;
    if (type === "referral") return "referral_completed";
  }
  return definition.inProgress;
}

function toWorkflowRequest(raw = {}) {
  const source = raw.request && raw.request.id ? raw.request : raw;
  if (source.id && source.requestType && source.statusCategory && source.version) return clone(source);
  const type = workflowType(source.requestType || source.type);
  const status = workflowStatus(type, source.status);
  const createdAt = source.createdAt || source.receivedAt || new Date().toISOString();
  const request = sanitizePatientRequest({
    id: source.id || source.patientRequestId,
    bhwPatientId: source.bhwPatientId || "BHW0000",
    requestType: type,
    source: source.source || source.sourceSystem || "crewos",
    sourceReference: source.sourceReference || source.sourceMetadata?.sourceRecordId,
    summary: source.summary || source.message || "Patient request",
    priority: ["routine", "time-sensitive", "urgent", "emergency"].includes(source.priority) ? source.priority : "routine",
    safetyFlags: source.safetyFlags || [],
    status,
    manualNotifyOnly: source.manualNotifyOnly === true,
    notificationMode: source.notificationMode || "automatic",
    workflowContext: source.workflowContext || {},
    createdBy: source.createdBy || source.receivedBy || "system:migration",
  }, { user: { sub: source.createdBy || source.receivedBy || "system:migration" }, now: new Date(createdAt) });
  request.patientRequestId = request.id;
  request.createdAt = createdAt;
  request.updatedAt = source.updatedAt || createdAt;
  request.receivedAt = source.receivedAt || createdAt;
  request.routing = source.routing || { targetSystem: "crewos", assignedTeam: request.assignedTeam };
  request.assignedTo = source.assignedTo || source.assignedToId || "";
  request.assignedToName = source.assignedToName || "";
  request.version = Math.max(1, Number(source.version) || 1);
  request.processedActionKeys = Array.isArray(source.processedActionKeys) ? source.processedActionKeys : [];
  request.statusHistory = Array.isArray(source.statusHistory) ? source.statusHistory : request.statusHistory;
  request.chatMessageName = source.chatMessageName || "";
  request.chatSpace = source.chatSpace || "";
  return request;
}

function safeCommunication(raw = {}) {
  if (raw.id) return raw;
  return {
    ...raw,
    id: raw.communicationId || "",
    requestId: raw.patientRequestId || "",
    channel: String(raw.channel || "internal").replace("google-chat", "google_chat"),
    status: raw.communicationStatus || raw.status || "recorded",
    content: raw.body || raw.summary || "",
    createdAt: raw.createdAt || raw.occurredAt || "",
  };
}

export class FirestoreWorkflowRepository extends FirestoreOperationsRepository {
  constructor(options = {}) {
    super(options);
    this.patientContacts = this.db.collection("patientContacts");
    this.communicationConsents = this.db.collection("communicationConsents");
    this.smsSuppressions = this.db.collection("smsSuppressions");
    this.notificationRules = this.db.collection("notificationRules");
  }

  async createPatientRequest(value, metadata = {}) {
    if (value?.request && value?.task) return super.createPatientRequest(value, metadata);
    const request = toWorkflowRequest(value);
    const ref = this.patientRequests.doc(request.id);
    const taskRef = this.tasks.doc(keyFor(`patient-request:${request.id}`));
    await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists) throw Object.assign(new Error("patient request id already exists"), { status: 409 });
      if (request.bhwPatientId !== "BHW0000") {
        const patient = await transaction.get(this.patients.doc(request.bhwPatientId));
        if (!patient.exists) throw Object.assign(new Error("BHW Patient ID was not found in the Patient Registry"), { status: 404 });
      }
      transaction.create(ref, { ...request, patientRequestId: request.id });
      transaction.set(taskRef, {
        taskId: `patient-request:${request.id}`,
        patientRequestId: request.id,
        requestId: request.id,
        patientReference: keyFor(request.bhwPatientId),
        serviceLine: request.serviceLine,
        assignedTeam: request.assignedTeam,
        assignedTo: request.assignedTo,
        taskStatus: "open",
        priority: request.priority,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        updatedBy: metadata.sub || metadata.id || "system",
      }, { merge: true });
    });
    return request;
  }

  async patientExists(bhwPatientId) {
    if (bhwPatientId === "BHW0000") return true;
    return (await this.patients.doc(bhwPatientId).get()).exists;
  }

  async getPatientRequest(requestId) {
    const id = clean(requestId, 100);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,99}$/.test(id)) return null;
    const snapshot = await this.patientRequests.doc(id).get();
    return snapshot.exists ? toWorkflowRequest(snapshot.data()) : null;
  }

  async listPatientRequests(filters = {}) {
    const snapshot = await this.patientRequests.limit(500).get();
    let rows = snapshot.docs.map((doc) => toWorkflowRequest(doc.data()));
    const status = clean(filters.status, 80).toLowerCase().replaceAll("-", "_");
    const serviceLine = clean(filters.serviceLine, 80).toLowerCase();
    const assignedTo = clean(filters.assignedTo, 200);
    const assignedTeam = clean(filters.assignedTeam, 80).toLowerCase();
    const patientId = clean(filters.bhwPatientId, 16).toUpperCase();
    if (status === "open") rows = rows.filter((row) => row.statusCategory !== "completed");
    else if (status) rows = rows.filter((row) => row.status === status || row.statusCategory === status);
    if (serviceLine) rows = rows.filter((row) => row.serviceLine === serviceLine);
    if (assignedTo) rows = rows.filter((row) => row.assignedTo === assignedTo);
    if (assignedTeam) rows = rows.filter((row) => row.assignedTeam === assignedTeam);
    if (patientId) rows = rows.filter((row) => row.bhwPatientId === patientId);
    rows.sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    rows = rows.slice(0, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
    const patientIds = [...new Set(rows.map((row) => row.bhwPatientId).filter((id) => id && id !== "BHW0000"))];
    const patientDocs = patientIds.length ? await this.db.getAll(...patientIds.map((id) => this.patients.doc(id))) : [];
    const contactDocs = patientIds.length ? await this.db.getAll(...patientIds.map((id) => this.patientContacts.doc(keyFor(`${id}:primary`)))) : [];
    const patientById = new Map(patientDocs.map((doc) => [doc.id, doc.data()?.patient || doc.data()]).filter(([, patient]) => patient));
    const contactById = new Map(contactDocs.map((doc, index) => [patientIds[index], doc.exists ? doc.data() : null]));
    return rows.map((row) => {
      const patient = patientById.get(row.bhwPatientId);
      const contact = contactById.get(row.bhwPatientId);
      return {
        ...row,
        patientName: row.bhwPatientId === "BHW0000" ? "Synthetic Patient" : [patient?.preferredName || patient?.legalFirstName, patient?.legalLastName, patient?.nameSuffix].filter(Boolean).join(" "),
        canSms: Boolean(contact?.active !== false && (contact?.phoneE164 || contact?.phone)),
      };
    });
  }

  async commitPatientRequestAction({ previousVersion, request, action, actionHash, user }) {
    const ref = this.patientRequests.doc(request.id);
    const taskRef = this.tasks.doc(keyFor(`patient-request:${request.id}`));
    return this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) throw Object.assign(new Error("patient request was not found"), { status: 404 });
      const current = toWorkflowRequest(existing.data());
      if ((current.processedActionKeys || []).includes(actionHash)) return { request: current, duplicate: true };
      if (Number(current.version) !== Number(previousVersion)) throw Object.assign(new Error("request changed; refresh before applying this action"), { status: 409 });
      transaction.set(ref, { ...request, patientRequestId: request.id }, { merge: true });
      transaction.set(taskRef, {
        taskId: `patient-request:${request.id}`,
        patientRequestId: request.id,
        requestId: request.id,
        patientReference: keyFor(request.bhwPatientId),
        serviceLine: request.serviceLine,
        assignedTeam: request.assignedTeam,
        assignedTo: request.assignedTo,
        assignedToName: request.assignedToName,
        taskStatus: request.statusCategory === "completed" ? "done" : request.statusCategory === "escalated" ? "blocked" : "open",
        priority: request.priority,
        workflowStatus: request.status,
        action,
        updatedAt: request.updatedAt,
        updatedBy: user.sub,
        ...(request.resolvedAt ? { completedAt: request.resolvedAt } : {}),
      }, { merge: true });
      return { request, duplicate: false };
    });
  }

  async attachChatDelivery(requestId, delivery) {
    const request = await this.getPatientRequest(requestId);
    if (!request) return null;
    const updated = {
      ...request,
      chatMessageName: clean(delivery.messageName, 400),
      chatSpace: clean(delivery.space, 200),
      chatSyncedAt: new Date().toISOString(),
    };
    await this.patientRequests.doc(requestId).set(updated, { merge: true });
    return updated;
  }

  async getPatientMessagingContext(bhwPatientId) {
    const [patientDoc, contactDoc, consentDoc, patientSuppressionDoc] = await Promise.all([
      this.patients.doc(bhwPatientId).get(),
      this.patientContacts.doc(keyFor(`${bhwPatientId}:primary`)).get(),
      this.communicationConsents.doc(keyFor(`${bhwPatientId}:patient-portal-sms`)).get(),
      this.smsSuppressions.doc(keyFor(bhwPatientId)).get(),
    ]);
    const contact = contactDoc.exists ? contactDoc.data() : null;
    const phone = normalizePhone(contact?.phoneE164 || contact?.phone);
    const phoneSuppressionDoc = phone ? await this.smsSuppressions.doc(keyFor(`phone:${phone}`)).get() : null;
    const patientSuppression = patientSuppressionDoc.exists ? patientSuppressionDoc.data() : null;
    const phoneSuppression = phoneSuppressionDoc?.exists ? phoneSuppressionDoc.data() : null;
    return {
      patient: patientDoc.exists ? patientDoc.data()?.patient || patientDoc.data() : null,
      contact,
      smsConsent: consentDoc.exists ? consentDoc.data()?.consent || consentDoc.data() : null,
      smsSuppression: patientSuppression?.active === true || phoneSuppression?.active === true
        ? { active: true, source: phoneSuppression?.active ? phoneSuppression.source : patientSuppression?.source }
        : patientSuppression || phoneSuppression,
    };
  }

  async setSmsSuppression(bhwPatientId, suppression) {
    const now = new Date().toISOString();
    await this.smsSuppressions.doc(keyFor(bhwPatientId)).set({
      patientReference: keyFor(bhwPatientId), active: suppression.active === true,
      source: clean(suppression.source || "manual", 80), occurredAt: suppression.occurredAt || now, updatedAt: now,
    }, { merge: true });
  }

  async setPhoneSmsSuppression(phone, suppression) {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    const now = new Date().toISOString();
    await this.smsSuppressions.doc(keyFor(`phone:${normalized}`)).set({
      destinationHash: keyFor(normalized), active: suppression.active === true,
      source: clean(suppression.source || "dialpad", 80), occurredAt: suppression.occurredAt || now, updatedAt: now,
    }, { merge: true });
  }

  async reserveCommunication(communication) {
    const ref = this.communications.doc(communication.id);
    return this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists) return { created: false, communication: safeCommunication(existing.data()) };
      const { bhwPatientId, ...safe } = communication;
      transaction.create(ref, { ...safe, patientReference: bhwPatientId ? keyFor(bhwPatientId) : safe.patientReference || "" });
      return { created: true, communication: safe };
    });
  }

  async getCommunication(id) {
    const doc = await this.communications.doc(clean(id, 200)).get();
    return doc.exists ? safeCommunication(doc.data()) : null;
  }

  async updateCommunication(id, patch) {
    const ref = this.communications.doc(clean(id, 200));
    await ref.set(patch, { merge: true });
    return safeCommunication((await ref.get()).data());
  }

  async updateCommunicationDelivery(providerMessageId, patch) {
    const snapshot = await this.communications.where("providerMessageId", "==", providerMessageId).limit(10).get();
    if (snapshot.empty) return 0;
    const writer = this.db.bulkWriter();
    snapshot.docs.forEach((doc) => writer.set(doc.ref, patch, { merge: true }));
    await writer.close();
    return snapshot.size;
  }

  async listRequestCommunications(requestId) {
    const [workflow, legacy] = await Promise.all([
      this.communications.where("requestId", "==", requestId).limit(200).get(),
      this.communications.where("patientRequestId", "==", requestId).limit(200).get(),
    ]);
    const rows = new Map([...workflow.docs, ...legacy.docs].map((doc) => [doc.id, safeCommunication(doc.data())]));
    return [...rows.values()].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async getLatestOutboundCommunication(requestId, channel) {
    return (await this.listRequestCommunications(requestId)).filter((item) => item.direction === "outbound" && item.channel === channel && ["sent", "delivered"].includes(item.status))
      .sort((left, right) => String(right.sentAt || right.createdAt).localeCompare(String(left.sentAt || left.createdAt)))[0] || null;
  }

  async listDueCommunications(now, limit = 50) {
    const snapshot = await this.communications.where("status", "==", "queued").limit(Math.max(1, Math.min(200, Number(limit) * 4))).get();
    return snapshot.docs.map((doc) => safeCommunication(doc.data())).filter((item) => item.sendAfter && item.sendAfter <= now)
      .sort((left, right) => String(left.sendAfter).localeCompare(String(right.sendAfter))).slice(0, limit);
  }

  async claimCommunication(id, now) {
    const ref = this.communications.doc(id);
    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      const communication = doc.exists ? safeCommunication(doc.data()) : null;
      if (!communication || communication.status !== "queued" || communication.sendAfter > now) return { claimed: false };
      const claimed = { ...communication, status: "pending", statusReason: "", claimedAt: now, updatedAt: now };
      transaction.set(ref, claimed, { merge: true });
      return { claimed: true, communication: claimed };
    });
  }

  async findPatientsByPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    const snapshot = await this.patientContacts.where("phoneE164", "==", normalized).limit(6).get();
    const ids = [...new Set(snapshot.docs.map((doc) => doc.data()).filter((contact) => contact.active !== false).map((contact) => contact.bhwPatientId))];
    const docs = ids.length ? await this.db.getAll(...ids.map((id) => this.patients.doc(id))) : [];
    return docs.map((doc) => doc.data()?.patient || doc.data()).filter((patient) => patient?.patientStatus === "active");
  }

  async findLatestOpenPatientRequest(bhwPatientId) {
    return (await this.listPatientRequests({ bhwPatientId, limit: 100 })).filter((request) => request.statusCategory !== "completed")[0] || null;
  }

  async getNotificationRule(id) {
    const doc = await this.notificationRules.doc(keyFor(id)).get();
    return doc.exists ? doc.data()?.rule || null : null;
  }
  async listNotificationRules() {
    return (await this.notificationRules.limit(200).get()).docs.map((doc) => doc.data()?.rule).filter(Boolean);
  }
  async saveNotificationRule(rule, user) {
    await this.notificationRules.doc(keyFor(rule.id)).set({ rule, updatedAt: rule.updatedAt, updatedBy: user.sub });
    return rule;
  }
  async recordWorkflowAudit(event) {
    const { bhwPatientId, ...safe } = event;
    await this.auditEvents.doc(crypto.randomUUID()).create({ ...safe, ...(bhwPatientId ? { patientReference: keyFor(bhwPatientId) } : {}) });
  }
}
