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
  constructor({ firestore, projectId, databaseId } = {}) {
    this.db = firestore || new Firestore({
      projectId: projectId || process.env.GOOGLE_CLOUD_PROJECT,
      databaseId: databaseId || process.env.FIRESTORE_DATABASE || "bhw-rcm-prod",
    });
    this.patientRequests = this.db.collection(COLLECTIONS.patientRequests);
    this.tasks = this.db.collection(COLLECTIONS.tasks);
    this.communications = this.db.collection(COLLECTIONS.communications);
    this.auditEvents = this.db.collection(COLLECTIONS.auditEvents);
    this.patients = this.db.collection(COLLECTIONS.patients);
    this.intakeReceipts = this.db.collection(COLLECTIONS.intakeReceipts);
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
