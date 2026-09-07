import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORKFLOW_DEFINITIONS, normalizeRequestType } from "../cloud/operations-api/workflow-automation.mjs";

test("clinical review is a manual, non-notifying CrewHQ workflow", () => {
  assert.equal(normalizeRequestType("clinical-review"), "clinical_review");
  const workflow = WORKFLOW_DEFINITIONS.clinical_review;
  assert.equal(workflow.assignedTeam, "clinical");
  assert.equal(workflow.serviceLine, "clinical");
  assert.ok(Object.values(workflow.statuses).every((state) => state.notify === false));
});

test("Patient 360 reads full Health Core check-ins and preserves patient scope", async () => {
  const app = await readFile(new URL("../provider/patient-360-app.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../provider/patient-360.css", import.meta.url), "utf8");

  assert.match(app, /record\.patientCheckins/);
  assert.match(app, /record\.monitoringPlans/);
  assert.match(app, /record\.monitoringModuleCatalog/);
  assert.match(app, /Patient-entered details from Care Connect, stored in Health Core/);
  assert.match(app, /Patient-entered readings/);
  assert.match(app, /Medications marked taken/);
  assert.match(app, /preservePatientLinks\(document\)/);
  assert.match(app, /Patient-scoped and role protected/);
  assert.match(app, /Individualized check-in plan/);
  assert.match(app, /Clinician approval required/);
  assert.match(app, /savePatientMonitoringPlan/);
  assert.match(app, /same-day review/);
  assert.match(css, /\.patient-checkin-card/);
  assert.match(css, /\.checkin-clinical-block/);
  assert.match(css, /\.monitoring-plan-editor/);
});

test("CrewHQ cloud client reads and saves a patient-scoped monitoring plan", async () => {
  const client = await readFile(new URL("../provider/cloud-queue.mjs", import.meta.url), "utf8");
  assert.match(client, /patientMonitoringPlan\(bhwPatientId/);
  assert.match(client, /savePatientMonitoringPlan\(bhwPatientId/);
  assert.match(client, /monitoring-plans\/\$\{encodeURIComponent\(program\)\}/);
  assert.match(client, /method: "PUT"/);
});

test("Patient Monitoring uses reference-only operations items and opens Patient 360", async () => {
  const html = await readFile(new URL("../bhw-patient-monitor-list.html", import.meta.url), "utf8");

  assert.match(html, /createOperationsCloudClient/);
  assert.match(html, /requestType==='clinical_review'/);
  assert.match(html, /clinical values stay in Health Core/);
  assert.match(html, /\/provider\/patient-360\.html\?patient=/);
  assert.doesNotMatch(html, /href\(p\).*bhw-patient-monitor\.html/);
  assert.doesNotMatch(html, /request\.(symptoms|vitals|medicationsTaken|foods|nutrition|well)/);
});
