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
    source: "crewos",
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

test("source-filtered CrewOS work and paged completed fax history are not crowded out", async () => {
  const db = new MemoryFirestore();
  const repository = new FirestoreWorkflowRepository({ firestore: db });

  for (let index = 0; index < 520; index += 1) {
    const id = `synthetic-fax-${String(index).padStart(4, "0")}`;
    await repository.patientRequests.doc(id).set({
      ...request(id, `2026-09-25T${String(20 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`),
      source: "fax",
    });
  }
  const handoffId = "crew-handoff-source-lane-0001";
  await repository.patientRequests.doc(handoffId).set(request(handoffId, "2026-09-24T12:00:00.000Z", { kind: "handoff" }));
  const completedFax = { ...request("synthetic-fax-completed-0001", "2026-09-23T12:00:00.000Z"), source: "fax", status: "completed", statusCategory: "completed" };
  await repository.patientRequests.doc(completedFax.id).set(completedFax);

  const crewRows = await repository.listPatientRequests({ source: "crewos", status: "open", limit: 25 });
  assert.deepEqual(crewRows.map((row) => row.id), [handoffId]);

  const history = await repository.listPatientRequests({ source: "fax", status: "completed", limit: 25 });
  assert.deepEqual(history.map((row) => row.id), [completedFax.id]);

  const secondPage = await repository.listPatientRequests({ source: "fax", status: "open", before: "2026-09-25T23:00:00.000Z", limit: 5 });
  assert.equal(secondPage.length, 5);
  assert.ok(secondPage.every((row) => row.updatedAt < "2026-09-25T23:00:00.000Z"));
});
