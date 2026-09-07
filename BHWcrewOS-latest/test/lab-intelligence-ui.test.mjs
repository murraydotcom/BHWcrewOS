import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSyntheticLabRecord,
  filteredWorkItems,
} from "../provider/lab-intelligence.mjs";

const fixtureUrl = new URL("../provider/fixtures/lab-intelligence.synthetic.json", import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixtureUrl, "utf8"));
const dashboardHtml = fs.readFileSync(new URL("../provider/lab-dashboard.html", import.meta.url), "utf8");

test("CrewOS queue fixture is locked to BHW0000 and the binding 21/49/8/70 directory", () => {
  const record = assertSyntheticLabRecord(fixture);
  assert.equal(record.boundary.readOnly, true);
  assert.equal(record.directory.authoritativePhysicalEntries, 21);
  assert.equal(record.directory.specialtyCandidates, 49);
  assert.equal(record.directory.escalationBranches, 8);
  assert.equal(record.directory.totalRecords, 70);
  assert.throws(() => assertSyntheticLabRecord(record, "BHW1234"), /only BHW0000/);
  const altered = structuredClone(record);
  altered.dashboard.workItems[0].bhwPatientId = "BHW1234";
  assert.throws(() => assertSyntheticLabRecord(altered), /link only to BHW0000/);
});

test("CrewOS retains operational critical, partial, outside-verification, and provider-review queues", () => {
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "critical").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "missing").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "outside").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "review").length, 2);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "all", "critical-result")[0].workItemId, "SYN-WORK-CRITICAL-1");
});

test("CrewOS queue payload contains references but no clinical laboratory record", () => {
  for (const field of ["results", "reports", "specimens", "trends", "timeline", "criticalEvents", "outsideIntakes"]) {
    assert.equal(Object.hasOwn(fixture, field), false, `${field} must remain in Health Core`);
  }
  assert.match(fixture.dashboard.workItems[0].healthCoreRecordReference, /^health-core:\/\//);
});

test("CrewOS dashboard does not expose a patient laboratory timeline", () => {
  assert.doesNotMatch(dashboardHtml, /patient-lab-timeline\.html/i);
  assert.match(dashboardHtml, /Results, trends, interpretations, orders, and correction history are opened and maintained in the Health Core EHR/);
});
