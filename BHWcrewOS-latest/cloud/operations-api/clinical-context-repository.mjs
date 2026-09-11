import { FirestoreWorkflowRepository } from "./workflow-repository.mjs";
import {
  consumePatientWorkspaceContext,
  createPatientWorkspaceContext,
  normalizePatientWorkspaceDestination,
  normalizePatientWorkspaceToken,
  patientWorkspaceContextAudit,
  patientWorkspaceTokenHash,
} from "./clinical-context.mjs";
import { apiError, assertBhwPatientId } from "./schema.mjs";

function patientValue(snapshot) {
  if (!snapshot?.exists) return null;
  const value = snapshot.data();
  return value?.patient || value || null;
}

function activeRegistryPatient(patient) {
  return patient && String(patient.patientStatus || "").trim().toLowerCase() === "active";
}

export class ClinicalContextWorkflowRepository extends FirestoreWorkflowRepository {
  constructor(options = {}) {
    super(options);
    this.patientWorkspaceContexts = this.db.collection("patientWorkspaceContexts");
  }

  async issuePatientWorkspaceContext(input, actor, options = {}) {
    const bhwPatientId = assertBhwPatientId(input?.bhwPatientId);
    const patientSnapshot = await this.patients.doc(bhwPatientId).get();
    const patient = patientValue(patientSnapshot);
    if (!patient) {
      throw apiError(404, "patient_not_found", "patient was not found in the protected Patient Registry");
    }
    if (!activeRegistryPatient(patient)) {
      throw apiError(409, "patient_not_active", "only an active Patient Registry record may open a patient workspace");
    }

    const { token, record } = createPatientWorkspaceContext(input, actor, options);
    const contextRef = this.patientWorkspaceContexts.doc(record.tokenHash);
    const audit = patientWorkspaceContextAudit(record, "patient-workspace-context.issued", actor, record.issuedAt);
    await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(contextRef);
      if (existing.exists) throw apiError(409, "context_collision", "patient workspace context could not be created safely");
      transaction.create(contextRef, record);
      transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
    });

    return Object.freeze({
      contextId: record.contextId,
      token,
      destination: record.destination,
      launchPath: record.launchPath,
      expiresAt: record.expiresAt,
      oneTime: true,
      patientIdExposedInUrl: false,
    });
  }

  async redeemPatientWorkspaceContext(input, actor, options = {}) {
    const token = normalizePatientWorkspaceToken(input?.token);
    const destination = normalizePatientWorkspaceDestination(input?.destination);
    const contextRef = this.patientWorkspaceContexts.doc(patientWorkspaceTokenHash(token));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(contextRef);
      if (!snapshot.exists) throw apiError(404, "context_not_found", "patient workspace context was not found; return to Patient Registry");
      const { consumed, grant } = consumePatientWorkspaceContext(
        snapshot.data(),
        { destination },
        actor,
        options,
      );
      const audit = patientWorkspaceContextAudit(consumed, "patient-workspace-context.consumed", actor, consumed.consumedAt);
      transaction.set(contextRef, consumed);
      transaction.create(this.auditEvents.doc(audit.auditEventId), audit);
      return grant;
    });
  }
}
