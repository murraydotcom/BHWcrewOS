import test from "node:test";
import assert from "node:assert/strict";
import { MemoryFirestore } from "./helpers/firestore-memory.mjs";
import { FirestoreWorkflowRepository } from "../cloud/operations-api/workflow-repository.mjs";

function request(id, updatedAt, workflowContext = {}) {
  return {
    id,
    patientRequestId: id,
    bhwPatientId: "BHW0000",
    requestType: "general",
    status: "received",
    statusCategory: "received",
    version: 1,
    updatedAt,
    createdAt: updatedAt,
    workflowContext,
  };
}

test("patient request listing reads newest records before applying the 500-record ceiling", async () => {
  const db = new MemoryFirestore();
  const repository = new FirestoreWorkflowRepository({ firestore: db });

  for (let index = 0; index < 500; index += 1) {
    const id = `synthetic-old-${String(index).padStart(4, "0")}`;
    await repository.patientRequests.doc(id).set(request(id, "2026-09-24T12:00:00.000Z"));
  }

  const handoffId = "crew-handoff-synthetic-latest";
  await repository.patientRequests.doc(handoffId).set(request(
    handoffId,
    "2026-09-25T12:26:02.411Z",
    { kind: "handoff", fromDivision: "Primary Care", toDivision: "CharmEd Minds" },
  ));

  const rows = await repository.listPatientRequests({ limit: 10 });

  assert.equal(rows[0].id, handoffId);
  assert.equal(rows[0].workflowContext.kind, "handoff");
  assert.equal(rows.length, 10);
});
