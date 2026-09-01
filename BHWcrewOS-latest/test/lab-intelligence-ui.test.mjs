import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  activeResults,
  assertSyntheticLabRecord,
  filteredTimeline,
  filteredWorkItems,
  resultRevisionChain,
  trendSummary,
} from "../provider/lab-intelligence.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("../provider/fixtures/lab-intelligence.synthetic.json", import.meta.url), "utf8"));

test("Lab Dashboard fixture is locked to BHW0000 and the binding 21/49/8/70 directory", () => {
  const record = assertSyntheticLabRecord(fixture);
  assert.equal(record.boundary.readOnly, true);
  assert.deepEqual(record.directory, {
    authoritativePhysicalEntries: 21,
    specialtyCandidates: 49,
    escalationBranches: 8,
    totalRecords: 70,
    vendorValidationStatus: "pending-live-labcorp-validation",
  });
  assert.throws(() => assertSyntheticLabRecord(record, "BHW1234"), /only BHW0000/);
});

test("Dashboard queues preserve critical, partial, outside-verification, and provider-review work", () => {
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "critical").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "missing").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "outside").length, 1);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "review").length, 2);
  assert.equal(filteredWorkItems(fixture.dashboard.workItems, "all", "potassium")[0].workItemId, "SYN-WORK-CRITICAL-1");
});

test("corrected results become active without deleting the original revision", () => {
  const active = activeResults(fixture.results);
  assert.equal(active.some((result) => result.resultId === "SYN-WBC-2026-CORRECTED"), true);
  assert.equal(active.some((result) => result.resultId === "SYN-WBC-2026-ORIGINAL"), false);
  const chain = resultRevisionChain(fixture.results, "SYN-WBC-2026-CORRECTED");
  assert.deepEqual(chain.map((result) => result.resultId), ["SYN-WBC-2026-CORRECTED", "SYN-WBC-2026-ORIGINAL"]);
});

test("patient timeline filters keep source and status evidence", () => {
  const critical = filteredTimeline(fixture.timeline, "critical");
  assert.equal(critical.length, 1);
  assert.equal(critical[0].sourceId, "SYN-CRITICAL-1");
  assert.equal(filteredTimeline(fixture.timeline, "all", "corrected WBC")[0].verification, "verified");
});

test("three-timepoint drift stays descriptive and requires provider interpretation", () => {
  const summary = trendSummary(fixture.trends[0]);
  assert.match(summary, /clinical meaning requires provider review/);
  assert.match(summary, /net \+0.6/);
});

test("critical closure remains open until patient action and provider closure are documented", () => {
  const event = fixture.criticalEvents[0];
  assert.ok(event.providerAcknowledgedAt);
  assert.ok(event.assessment);
  assert.equal(event.patientAction, null);
  assert.equal(event.closure, null);
  assert.equal(fixture.dashboard.workItems.some((item) => item.status === "blocked"), true);
});
