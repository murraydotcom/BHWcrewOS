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
      ...request(id, "2026-09-25T20:00:00.000Z"),
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

  const firstPage = await repository.listPatientRequests({ source: "fax", status: "open", limit: 5 });
  const secondPage = await repository.listPatientRequests({ source: "fax", status: "open", before: firstPage.at(-1).updatedAt, beforeId: firstPage.at(-1).cursorDocumentId, limit: 5 });
  assert.equal(secondPage.length, 5);
  assert.equal(secondPage.some((row) => firstPage.some((first) => first.id === row.id)), false);
});

test("an unmatched request never masquerades as the reserved synthetic patient", async () => {
  const db = new MemoryFirestore();
  const repository = new FirestoreWorkflowRepository({ firestore: db });
  const id = "portal-unmatched-registry-link-0001";
  await repository.patientRequests.doc(id).set({
    id,
    patientRequestId: id,
    bhwPatientId: "",
    patientMatchStatus: "unmatched",
    requestType: "general",
    source: "care-connect",
    status: "received",
    requester: { displayName: "Shared number" },
    summary: "Patient response awaiting identity reconciliation",
    createdAt: "2026-09-27T14:00:00.000Z",
    updatedAt: "2026-09-27T14:00:00.000Z",
  });

  const [row] = await repository.listPatientRequests({ limit: 10 });
  assert.equal(row.bhwPatientId, "");
  assert.equal(row.patientMatchStatus, "unmatched");
  assert.equal(row.patientName, "Shared number");
  assert.notEqual(row.patientName, "Synthetic Patient");
});

test("a pre-existing unmatched row with the old synthetic placeholder becomes connectable", async () => {
  const db = new MemoryFirestore();
  const repository = new FirestoreWorkflowRepository({ firestore: db });
  const id = "legacy-unmatched-placeholder-0001";
  await repository.patientRequests.doc(id).set({
    ...request(id, "2026-09-26T14:00:00.000Z"),
    bhwPatientId: "BHW0000",
    patientMatchStatus: "unmatched",
    requester: { displayName: "Existing Registry patient" },
  });

  const loaded = await repository.getPatientRequest(id);
  assert.equal(loaded.bhwPatientId, "");
  assert.equal(loaded.patientMatchStatus, "unmatched");
});

test("Registry status is rechecked transactionally before an existing-patient connection is committed", async () => {
  const db = new MemoryFirestore();
  const repository = new FirestoreWorkflowRepository({ firestore: db });
  const id = "transactional-registry-link-0001";
  const current = {
    ...request(id, "2026-09-27T14:00:00.000Z"),
    bhwPatientId: "",
    patientMatchStatus: "unmatched",
  };
  await repository.patientRequests.doc(id).set(current);
  await repository.patients.doc("BHW0613").set({ patient: { bhwPatientId: "BHW0613", patientStatus: "inactive" } });
  const linked = {
    ...current,
    bhwPatientId: "BHW0613",
    patientMatchStatus: "matched",
    version: 2,
    processedActionKeys: ["synthetic-link-hash"],
  };

  await assert.rejects(() => repository.commitPatientRequestAction({
    previousVersion: 1,
    request: linked,
    action: "link-patient",
    actionHash: "synthetic-link-hash",
    user: { sub: "crew:synthetic-front-desk" },
  }), /only an active Patient Registry record/i);
  assert.equal((await repository.getPatientRequest(id)).bhwPatientId, "");

  await repository.patients.doc("BHW0613").set({ patient: { bhwPatientId: "BHW0613", patientStatus: "active" } });
  const saved = await repository.commitPatientRequestAction({
    previousVersion: 1,
    request: linked,
    action: "link-patient",
    actionHash: "synthetic-link-hash",
    user: { sub: "crew:synthetic-front-desk" },
  });
  assert.equal(saved.request.bhwPatientId, "BHW0613");
  assert.equal((await repository.getPatientRequest(id)).patientMatchStatus, "matched");
});
