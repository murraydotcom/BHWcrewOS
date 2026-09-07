import crypto from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import {
  COLLECTIONS,
  PATIENT_REQUEST_STATUSES,
  TASK_STATUSES,
  apiError,
  cleanText,
  enumValue,
  optionalBhwPatientId,
  requireExternalId,
} from "./schema.mjs";
import {
  buildCommunication,
  normalizeTaskInput,
  transitionPatientRequest,
  transitionTask,
} from "./domain.mjs";
import {
  activatePatientPortalAccess,
  evaluatePatientPortalAccess,
  normalizePatientEmail,
  normalizePatientPhone,
  patientIdentityReference,
  patientPortalAuthorization,
  sanitizePatientPortalAccess,
  selectUniqueActivePatient,
} from "./patient-identity.mjs";
import {
  createWebsiteContent,
  normalizeWebsiteSiteId,
  projectPublishedWebsiteContent,
  requireWebsiteContentId,
  transitionWebsiteContent,
  updateWebsiteContentDraft,
  websiteContentAudit,
} from "./site-content.mjs";

function receiptId(scope, key) {
  return crypto.createHash("sha256").update(`${scope}:${key}`).digest("hex");
}

function dataOf(snapshot) {
  return snapshot.exists ? snapshot.data() : null;
}

function toLimit(value, fallback = 50, maximum = 100) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export class FirestoreOperationsRepository {
  constructor({ firestore, projectId, databaseId, patientIdentitySecret } = {}) {
    this.db = firestore || new Firestore({
      projectId: projectId || process.env.GOOGLE_CLOUD_PROJECT,
      databaseId: databaseId || process.env.FIRESTORE_DATABASE || "bhw-rcm-prod",
    });
    this.patientRequests = this.db.collection(COLLECTIONS.patientRequests);
    this.tasks = this.db.collection(COLLECTIONS.tasks);
    this.communications = this.db.collection(COLLECTIONS.communications);
    this.websiteContent = this.db.collection(COLLECTIONS.websiteContent);
    this.auditEvents = this.db.collection(COLLECTIONS.auditEvents);
    this.patients = this.db.collection(COLLECTIONS.patients);
    this.patientContacts = this.db.collection(COLLECTIONS.patientContacts);
    this.patientPortalAccess = this.db.collection(COLLECTIONS.patientPortalAccess);
    this.verificationEvents = this.db.collection(COLLECTIONS.verificationEvents);
    this.intakeReceipts = this.db.collection(COLLECTIONS.intakeReceipts);
    this.patientIdentitySecret = patientIdentitySecret || process.env.CARE_CONNECT_PATIENT_IDENTITY_SECRET || "";
  }

  async createWebsiteContent(input, actor, options = {}) {
    const record = createWebsiteContent(input, actor, options);
    const audit = websiteContentAudit(record, "website-content.created", actor, record.createdAt);
    const batch = this.db.batch();
    batch.create(this.websiteContent.doc(record.contentId), record);
    batch.create(this.auditEvents.doc(audit.auditEventId), audit);
    await batch.commit();
    return record;
  }

  async getWebsiteContent(id) {
    const contentId = requireWebsiteContentId(id);
    const record = dataOf(await this.websiteContent.doc(contentId).get());
    if (!record) throw apiError(404, "not_found", "website content was not found");
    return record;
  }

  async listWebsiteContent(filters = {}) {
    const siteId = normalizeWebsiteSiteId(filters.siteId || "care-connect");
    const snapshot = await this.websiteContent.where("siteId", "==", siteId).limit(250).get();
    const status = cleanText(filters.status, 40).toLowerCase();
    return snapshot.docs.map((doc) => doc.data())
      .filter((record) => !status || record.status === status)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, toLimit(filters.limit, 100, 250));
  }

  async updateWebsiteContent(id, input, actor, options = {}) {
    const contentId = requireWebsiteContentId(id);
    const ref = this.websiteContent.doc(contentId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw apiError(404, "not_found", "website content was not found");
      const record = updateWebsiteContentDraft(snapshot.data(), input, actor, options);
      const audit = websiteContentAudit(record, "website-content.updated", actor, record.updatedAt);
      transaction.set(ref, record);
      transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
      return record;
    });
  }

  async transitionWebsiteContent(id, input, actor, options = {}) {
    const contentId = requireWebsiteContentId(id);
    const ref = this.websiteContent.doc(contentId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw apiError(404, "not_found", "website content was not found");
      const record = transitionWebsiteContent(snapshot.data(), input, actor, options);
      const audit = websiteContentAudit(record, `website-content.${String(input.action || "updated")}`, actor, record.updatedAt);
      transaction.set(ref, record);
      transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
      return record;
    });
  }

  async publicWebsiteContent(siteId, options = {}) {
    const records = await this.listWebsiteContent({ siteId, limit: 250 });
    return projectPublishedWebsiteContent(records, siteId, options);
  }

  async resolvePatientIdentity(identity, { identityReference, now = new Date().toISOString() } = {}) {
    const attemptRef = this.verificationEvents.doc(identityReference);
    const attemptDoc = await attemptRef.get();
    const attemptState = attemptDoc.exists ? attemptDoc.data() : {};
    const nowMs = new Date(now).getTime();
    if (attemptState.lockedUntil && new Date(attemptState.lockedUntil).getTime() > nowMs) {
      throw apiError(429, "identity_locked", "identity matching is temporarily locked; please contact BHW or try again later");
    }

    const contacts = new Map();
    const addSnapshot = (snapshot) => snapshot.docs.forEach((doc) => {
      const value = doc.data();
      if (value.active !== false && value.bhwPatientId) contacts.set(doc.id, value);
    });
    if (identity.email) {
      addSnapshot(await this.patientContacts.where("emailNormalized", "==", identity.email).limit(5).get());
      if (!contacts.size) addSnapshot(await this.patientContacts.where("email", "==", identity.email).limit(5).get());
    }
    if (identity.phone) addSnapshot(await this.patientContacts.where("phoneE164", "==", identity.phone).limit(5).get());

    const candidateIds = [...new Set([...contacts.values()].map((contact) => contact.bhwPatientId))];
    const candidateDocs = candidateIds.length
      ? await this.db.getAll(...candidateIds.map((id) => this.patients.doc(id)))
      : [];
    const patient = selectUniqueActivePatient(
      candidateDocs.map((doc) => doc.data()?.patient || doc.data()),
      identity.dateOfBirth,
    );

    const verifiedChannel = identity.email ? "email" : "sms";
    const accessDoc = patient ? await this.patientPortalAccess.doc(patient.bhwPatientId).get() : null;
    const access = accessDoc?.exists ? accessDoc.data() : null;
    const accessState = patient && access
      ? evaluatePatientPortalAccess(access, patient, verifiedChannel, new Date(now), identityReference)
      : { eligible: false, reason: patient ? "access-record-missing" : "identity-not-matched" };

    if (!patient || !accessState.eligible) {
      const attempts = Math.max(0, Number(attemptState.attempts) || 0) + 1;
      const locked = attempts >= 5;
      const batch = this.db.batch();
      const auditEventId = `AUD-${crypto.randomUUID()}`;
      batch.set(attemptRef, {
        identityReference,
        attempts: locked ? 0 : attempts,
        lockedUntil: locked ? new Date(nowMs + 30 * 60 * 1000).toISOString() : "",
        lastFailedAt: now,
        source: "care-connect",
      }, { merge: true });
      batch.create(this.auditEvents.doc(auditEventId), {
        auditEventId,
        schemaVersion: 1,
        eventType: "patient-identity.match-failed",
        actorType: "integration",
        actorId: "care-connect",
        identityReference,
        denialReason: accessState.reason,
        occurredAt: now,
      });
      await batch.commit();
      return null;
    }

    const activatedAccess = activatePatientPortalAccess(access, new Date(now));
    const batch = this.db.batch();
    const auditEventId = `AUD-${crypto.randomUUID()}`;
    batch.set(attemptRef, { attempts: 0, lockedUntil: "", lastSucceededAt: now, source: "care-connect" }, { merge: true });
    batch.create(this.auditEvents.doc(auditEventId), {
      auditEventId,
      schemaVersion: 1,
      eventType: "patient-identity.matched",
      actorType: "integration",
      actorId: "care-connect",
      bhwPatientId: patient.bhwPatientId,
      identityReference,
      occurredAt: now,
    });
    batch.set(this.patientPortalAccess.doc(patient.bhwPatientId), activatedAccess);
    await batch.commit();
    return {
      bhwPatientId: patient.bhwPatientId,
      preferredName: cleanText(patient.preferredName || patient.legalFirstName || "Patient", 100),
      portalAuthorization: patientPortalAuthorization(activatedAccess, verifiedChannel),
    };
  }

  async getPatientPortalAccess(bhwPatientId) {
    const [patientDoc, accessDoc] = await Promise.all([
      this.patients.doc(bhwPatientId).get(),
      this.patientPortalAccess.doc(bhwPatientId).get(),
    ]);
    return {
      patient: patientDoc.exists ? patientDoc.data()?.patient || patientDoc.data() : null,
      access: accessDoc.exists ? accessDoc.data() : null,
    };
  }

  async savePatientPortalAccess(bhwPatientId, input, actor, { now = new Date() } = {}) {
    const accessRef = this.patientPortalAccess.doc(bhwPatientId);
    const patientRef = this.patients.doc(bhwPatientId);
    return this.db.runTransaction(async (transaction) => {
      const contactQuery = this.patientContacts.where("bhwPatientId", "==", bhwPatientId).limit(10);
      const [patientDoc, accessDoc, contactSnapshot] = await Promise.all([
        transaction.get(patientRef),
        transaction.get(accessRef),
        input.contactVerificationConfirmed === true ? transaction.get(contactQuery) : Promise.resolve(null),
      ]);
      const patient = patientDoc.exists ? patientDoc.data()?.patient || patientDoc.data() : null;
      let verifiedContactReference = "";
      if (input.contactVerificationConfirmed === true) {
        if (!this.patientIdentitySecret) {
          throw apiError(503, "patient_identity_not_configured", "exact patient contact verification is not configured");
        }
        const channel = cleanText(input.preferredChannel, 20).toLowerCase();
        const values = new Set((contactSnapshot?.docs || []).map((doc) => doc.data()).filter((contact) => contact.active !== false).map((contact) => (
          channel === "email"
            ? normalizePatientEmail(contact.emailNormalized || contact.email)
            : channel === "sms"
              ? normalizePatientPhone(contact.phoneE164 || contact.phone)
              : ""
        )).filter(Boolean));
        if (values.size !== 1) {
          throw apiError(409, "exact_contact_required", "the selected channel must resolve to exactly one current Patient Registry contact");
        }
        const [value] = values;
        verifiedContactReference = patientIdentityReference(channel === "email" ? { email: value } : { phone: value }, this.patientIdentitySecret);
      }
      const access = sanitizePatientPortalAccess(input, {
        patient,
        existing: accessDoc.exists ? accessDoc.data() : {},
        actor,
        verifiedContactReference,
        now,
      });
      const auditEventId = `AUD-${crypto.randomUUID()}`;
      transaction.set(accessRef, access);
      transaction.create(this.auditEvents.doc(auditEventId), {
        auditEventId,
        schemaVersion: 1,
        eventType: "patient-portal-access.updated",
        actorType: "staff",
        actorId: cleanText(actor.id || actor.staffId || actor.sub, 180),
        bhwPatientId,
        portalAccessStatus: access.portalAccessStatus,
        occurredAt: access.updatedAt,
      });
      return access;
    });
  }

  async createPatientRequest(bundle, { scope, key, payloadHash }) {
    const receiptRef = this.intakeReceipts.doc(receiptId(scope, key));
    return this.db.runTransaction(async (transaction) => {
      const receiptSnapshot = await transaction.get(receiptRef);
      if (receiptSnapshot.exists) {
        const receipt = receiptSnapshot.data();
        if (receipt.payloadHash !== payloadHash) {
          throw apiError(409, "idempotency_conflict", "Idempotency-Key was already used for different content");
        }
        const existingSnapshot = await transaction.get(this.patientRequests.doc(receipt.patientRequestId));
        if (!existingSnapshot.exists) throw apiError(409, "idempotency_orphaned", "intake receipt no longer resolves to a request");
        return { request: existingSnapshot.data(), replayed: true };
      }

      if (bundle.request.bhwPatientId) {
        const patientSnapshot = await transaction.get(this.patients.doc(bundle.request.bhwPatientId));
        if (!patientSnapshot.exists) throw apiError(404, "patient_not_found", "bhwPatientId was not found in the protected registry");
      }

      transaction.create(this.patientRequests.doc(bundle.request.patientRequestId), bundle.request);
      transaction.create(this.tasks.doc(bundle.task.taskId), bundle.task);
      transaction.create(this.communications.doc(bundle.communication.communicationId), bundle.communication);
      for (const audit of bundle.audits) transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
      transaction.create(receiptRef, {
        scope,
        keyHash: receiptId("key", key),
        payloadHash,
        patientRequestId: bundle.request.patientRequestId,
        createdAt: bundle.request.createdAt,
      });
      return { request: bundle.request, replayed: false };
    });
  }

  async getPatientRequest(id) {
    const patientRequestId = requireExternalId(id, "REQ", "patientRequestId");
    const request = dataOf(await this.patientRequests.doc(patientRequestId).get());
    if (!request) throw apiError(404, "not_found", "patient request was not found");
    return request;
  }

  async listPatientRequests(filters = {}) {
    if (filters.bhwPatientId && (filters.status || filters.assignedTeam)) {
      throw apiError(400, "unsupported_filter_combination", "bhwPatientId cannot be combined with status or assignedTeam");
    }
    let query = this.patientRequests;
    if (filters.status) query = query.where("status", "==", enumValue(filters.status, PATIENT_REQUEST_STATUSES, "status"));
    if (filters.bhwPatientId) query = query.where("bhwPatientId", "==", optionalBhwPatientId(filters.bhwPatientId));
    if (filters.assignedTeam) query = query.where("routing.assignedTeam", "==", cleanText(filters.assignedTeam, 40).toLowerCase());
    query = query.orderBy("receivedAt", "desc").limit(toLimit(filters.limit));
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data());
  }

  async updatePatientRequestStatus(id, input, actor, options = {}) {
    const patientRequestId = requireExternalId(id, "REQ", "patientRequestId");
    const requestRef = this.patientRequests.doc(patientRequestId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      if (!snapshot.exists) throw apiError(404, "not_found", "patient request was not found");
      const result = transitionPatientRequest(snapshot.data(), input, actor, options);
      if (result.unchanged) return result.request;
      transaction.set(requestRef, result.request);
      transaction.create(this.auditEvents.doc(result.audit.auditEventId), result.audit);
      return result.request;
    });
  }

  async createTask(patientRequestId, input, actor, options = {}) {
    const requestRef = this.patientRequests.doc(requireExternalId(patientRequestId, "REQ", "patientRequestId"));
    return this.db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw apiError(404, "not_found", "patient request was not found");
      const { task, audit } = normalizeTaskInput(input, requestSnapshot.data(), actor, options);
      transaction.create(this.tasks.doc(task.taskId), task);
      transaction.update(requestRef, {
        taskIds: [...new Set([...(requestSnapshot.data().taskIds || []), task.taskId])],
        updatedAt: task.updatedAt,
        updatedBy: actor.id,
      });
      transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
      return task;
    });
  }

  async listTasks(filters = {}) {
    if (filters.patientRequestId && (filters.taskStatus || filters.status || filters.assignedTeam)) {
      throw apiError(400, "unsupported_filter_combination", "patientRequestId cannot be combined with task status or assignedTeam");
    }
    let query = this.tasks;
    if (filters.taskStatus || filters.status) query = query.where("taskStatus", "==", enumValue(filters.taskStatus || filters.status, TASK_STATUSES, "taskStatus"));
    if (filters.patientRequestId) query = query.where("patientRequestId", "==", requireExternalId(filters.patientRequestId, "REQ", "patientRequestId"));
    if (filters.assignedTeam) query = query.where("assignedTeam", "==", cleanText(filters.assignedTeam, 40).toLowerCase());
    query = query.orderBy("createdAt", "desc").limit(toLimit(filters.limit));
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data());
  }

  async updateTaskStatus(id, input, actor, options = {}) {
    const taskId = requireExternalId(id, "TSK", "taskId");
    const taskRef = this.tasks.doc(taskId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists) throw apiError(404, "not_found", "task was not found");
      const result = transitionTask(snapshot.data(), input, actor, options);
      if (result.unchanged) return result.task;
      transaction.set(taskRef, result.task);
      transaction.create(this.auditEvents.doc(result.audit.auditEventId), result.audit);
      return result.task;
    });
  }

  async createCommunication(input, actor, options = {}) {
    const requestRef = this.patientRequests.doc(requireExternalId(input?.patientRequestId, "REQ", "patientRequestId"));
    return this.db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw apiError(404, "not_found", "patient request was not found");
      const request = requestSnapshot.data();
      const { communication, audit } = buildCommunication(input, request, actor, options);
      const notificationMetadata = { ...(request.notificationMetadata || {}) };
      if (communication.patientVisible && communication.direction === "outbound" && ["sent", "delivered"].includes(communication.communicationStatus)) {
        notificationMetadata.lastPatientNotifiedAt = communication.occurredAt;
        notificationMetadata.lastCommunicationId = communication.communicationId;
        notificationMetadata.deliveryState = communication.communicationStatus;
      }
      transaction.create(this.communications.doc(communication.communicationId), communication);
      transaction.update(requestRef, {
        communicationIds: [...new Set([...(request.communicationIds || []), communication.communicationId])],
        communicationCount: Number(request.communicationCount || 0) + 1,
        lastCommunicationAt: communication.occurredAt,
        notificationMetadata,
        updatedAt: communication.createdAt,
        updatedBy: actor.id,
      });
      transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
      return communication;
    });
  }

  async listCommunications(filters = {}) {
    if (filters.patientRequestId && filters.bhwPatientId) {
      throw apiError(400, "unsupported_filter_combination", "patientRequestId cannot be combined with bhwPatientId");
    }
    let query = this.communications;
    if (filters.patientRequestId) query = query.where("patientRequestId", "==", requireExternalId(filters.patientRequestId, "REQ", "patientRequestId"));
    if (filters.bhwPatientId) query = query.where("bhwPatientId", "==", optionalBhwPatientId(filters.bhwPatientId));
    query = query.orderBy("occurredAt", "desc").limit(toLimit(filters.limit));
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data());
  }
}
