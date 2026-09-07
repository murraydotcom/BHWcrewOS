import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOperationalWorkItem,
  assertSyntheticLabRecord,
  buildOperationalActionPreview,
  closureAssessment,
  escalationAssessment,
  filteredWorkItems,
  queueCounts,
  resultQueueItems,
} from "../provider/lab-intelligence.mjs";

const fixtureUrl = new URL("../provider/fixtures/lab-intelligence.synthetic.json", import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixtureUrl, "utf8"));
const dashboardHtml = fs.readFileSync(new URL("../provider/lab-dashboard.html", import.meta.url), "utf8");
const resultQueuesHtml = fs.readFileSync(new URL("../provider/lab-result-queues.html", import.meta.url), "utf8");

test("CrewOS queue fixture is synthetic-only, read-only, and locked to BHW0000", () => {
  const record = assertSyntheticLabRecord(fixture);
  assert.equal(record.boundary.readOnly, true);
  assert.equal(record.boundary.operationalWritesEnabled, false);
  assert.equal(record.boundary.healthCoreRoutingEnabled, false);
  assert.equal(record.boundary.clinicalPayloadAllowed, false);
  assert.throws(() => assertSyntheticLabRecord(record, "BHW1234"), /only BHW0000/);
});

test("binding 21/49/8/70 directory remains intact and cannot change template membership", () => {
  assert.equal(fixture.directory.authoritativePhysicalEntries, 21);
  assert.equal(fixture.directory.specialtyCandidates, 49);
  assert.equal(fixture.directory.escalationBranches, 8);
  assert.equal(fixture.directory.totalRecords, 70);
  assert.equal(fixture.dashboard.orderIntegrity.templatePreserved, true);
  assert.equal(fixture.dashboard.orderIntegrity.authoritativeTemplateItemCount, 21);
});

test("critical, missing, and partial result work are distinct operational queues", () => {
  assert.equal(resultQueueItems(fixture.dashboard.workItems, "critical").length, 1);
  assert.equal(resultQueueItems(fixture.dashboard.workItems, "missing").length, 1);
  assert.equal(resultQueueItems(fixture.dashboard.workItems, "partial").length, 1);
  assert.equal(resultQueueItems(fixture.dashboard.workItems, "all").length, 3);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "outside").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "review").length, 2);
});

test("declared queue counts equal the actual work items", () => {
  assert.deepEqual(queueCounts(fixture.dashboard.workItems), fixture.dashboard.queues);
});

test("every work item has ownership, due time, escalation, closure, and an opaque Health Core reference", () => {
  for (const item of fixture.dashboard.workItems) {
    assertOperationalWorkItem(item);
    assert.ok(item.owner.team);
    assert.ok(item.owner.requiredRole);
    assert.ok(item.sla.dueAt);
    assert.ok(item.sla.policyStatus);
    assert.equal(Number.isInteger(item.escalation.level), true);
    assert.match(item.healthCoreRecordReference, /^health-core:\/\//);
    assert.equal(Array.isArray(item.closureRequirements), true);
  }
});

test("CrewOS payload contains no clinical laboratory record or result fields", () => {
  for (const field of ["orders", "results", "reports", "specimens", "trends", "timeline", "criticalEvents", "outsideIntakes", "interpretations", "justifications", "blueprints"]) {
    assert.equal(Object.hasOwn(fixture, field), false, `${field} must remain in Health Core`);
  }
  const prohibited = new Set(["result", "resultValue", "value", "unit", "referenceRange", "testName", "laboratoryName", "specimen", "methodology", "clinicalAssessment", "patientAction", "patientDisposition", "diagnosis", "sourceDocument", "reportPayload", "orderPayload"]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(prohibited.has(key), false, `${key} is clinical payload and must remain in Health Core`);
      visit(child);
    }
  };
  fixture.dashboard.workItems.forEach(visit);
});

test("critical work cannot close until all four Health Core clinical signals are complete", () => {
  const critical = resultQueueItems(fixture.dashboard.workItems, "critical")[0];
  const assessment = closureAssessment(critical);
  assert.equal(assessment.readyForOperationalClosure, false);
  assert.deepEqual(assessment.healthCoreSignalsOpen, ["patient-action-or-disposition", "documented-provider-closure"]);
  assert.throws(() => buildOperationalActionPreview(fixture, critical.workItemId, "close-after-health-core-confirmation"), /prerequisites remain open/);
});

test("an operational close preview requires Health Core confirmation and still performs no write", () => {
  const altered = structuredClone(fixture);
  const missing = altered.dashboard.workItems.find((item) => item.queue === "missing");
  for (const step of missing.closureRequirements) if (step.key !== "operational-queue-closure") step.status = "complete";
  const assessment = closureAssessment(missing);
  assert.equal(assessment.readyForOperationalClosure, true);
  const preview = buildOperationalActionPreview(altered, missing.workItemId, "close-after-health-core-confirmation");
  assert.equal(preview.eligibleForLiveExecution, false);
  assert.equal(preview.blockers.includes("operational-writes-disabled"), true);
  assert.equal(preview.persisted, false);
  assert.equal(preview.actionRecorded, false);
  assert.equal(preview.healthCoreMutationCreated, false);
  assert.equal(preview.clinicalPayloadWritten, false);
});

test("Health Core navigation remains blocked without authenticated routing", () => {
  const critical = resultQueueItems(fixture.dashboard.workItems, "critical")[0];
  const preview = buildOperationalActionPreview(fixture, critical.workItemId, "view-health-core");
  assert.equal(preview.eligibleForLiveExecution, false);
  assert.deepEqual(preview.blockers, ["operational-writes-disabled", "authenticated-health-core-routing-disabled"]);
});

test("escalation assessment is deterministic and never closes the clinical loop", () => {
  const critical = resultQueueItems(fixture.dashboard.workItems, "critical")[0];
  const assessment = escalationAssessment(critical, "2026-09-01T05:35:00.000Z");
  assert.equal(assessment.overdue, true);
  assert.equal(assessment.escalationLevel, 2);
  assert.equal(assessment.escalationStatus, "escalated");
});

test("result queue definitions keep Health Core as clinical source of truth", () => {
  for (const queue of ["critical", "missing", "partial"]) {
    assert.equal(fixture.queueDefinitions[queue].recordType, "operational-work-item");
    assert.equal(fixture.queueDefinitions[queue].clinicalSourceOfTruth, "Health Core EHR");
    assert.equal(fixture.queueDefinitions[queue].policyStatus, "synthetic-proposed-not-approved");
  }
});

test("CrewOS screens expose operational result queues without a patient laboratory timeline", () => {
  assert.doesNotMatch(dashboardHtml, /patient-lab-timeline\.html/i);
  assert.doesNotMatch(resultQueuesHtml, /patient-lab-timeline\.html/i);
  assert.match(dashboardHtml, /lab-result-queues\.html\?patient=BHW0000/);
  assert.match(resultQueuesHtml, /Critical, Missing &amp; Partial Result Queues/);
  assert.match(resultQueuesHtml, /CrewOS may not retain here/);
  assert.match(resultQueuesHtml, /test identity, result value, unit, interval/i);
});
