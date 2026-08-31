import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { alertKey, collectSafeAlerts, roleRoutes, safeAlertForRequest } from "../bhw-alert-center.mjs";

const synthetic = (overrides = {}) => ({
  id: "BHW0000-ALERT-1",
  version: 1,
  requestType: "general",
  status: "received",
  statusLabel: "Received",
  statusCategory: "received",
  assignedTeam: "front-desk",
  serviceLine: "patient-access",
  assignedTo: "",
  assignedToName: "",
  priority: "routine",
  patientName: "BHW0000 Synthetic",
  createdAt: "2026-08-30T12:00:00.000Z",
  ...overrides,
});

test("role routes keep routine alerts inside the responsible service line", () => {
  assert.deepEqual(roleRoutes({ role: "Medical Assistant" }).sort(), ["authorizations", "clinical", "medication"]);
  assert.ok(roleRoutes({ role: "Office Manager" }).includes("*"));
  assert.deepEqual(
    collectSafeAlerts([synthetic()], { staffId: "synthetic-ma", name: "Synthetic MA", role: "Medical Assistant" }),
    [],
    "a medication role does not receive a routine front-desk request",
  );
  assert.equal(
    collectSafeAlerts([synthetic()], { staffId: "synthetic-front", name: "Synthetic Front Desk", role: "Front Desk" }).length,
    1,
  );
});

test("alerts contain workflow metadata and a deep link but no patient details", () => {
  const alert = safeAlertForRequest(synthetic({
    requestType: "prior_auth",
    assignedTeam: "authorizations",
    serviceLine: "clinical",
    status: "escalated",
    statusLabel: "Escalated",
    statusCategory: "escalated",
    summary: "Synthetic detail that must not appear",
  }), { staffId: "synthetic-ma", name: "Synthetic MA", role: "Medical Assistant" });

  assert.equal(alert.label, "Prior authorization");
  assert.equal(alert.reason, "Escalated");
  assert.match(alert.href, /^\/bhw-requests\.html\?request=/);
  assert.equal("patientName" in alert, false);
  assert.equal("summary" in alert, false);
  assert.doesNotMatch(JSON.stringify(alert), /BHW0000 Synthetic|Synthetic detail/);
});

test("completed work disappears and each workflow version has a distinct alert key", () => {
  assert.equal(safeAlertForRequest(synthetic({ status: "completed", statusCategory: "completed" }), { role: "Office Manager" }), null);
  assert.notEqual(alertKey(synthetic({ version: 1 })), alertKey(synthetic({ version: 2 })));
});

test("the installed alert module never requests browser notifications", async () => {
  const source = await readFile(new URL("../bhw-alert-center.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Notification\.requestPermission|new Notification/);
  assert.match(source, /bhw-alert-bell/);
  assert.match(source, /bhw:requests-updated/);
});

test("the alert center is installed on primary authenticated CrewOS surfaces", async () => {
  const pages = [
    "index.html", "bhw-requests.html", "bhw-care-due.html",
    "bhw-patient-monitor-list.html", "bhw-patient-materials.html", "bhw-dpc.html",
    "bhw-discharges.html", "bhw-careplan.html",
    "bhw-care-management.html", "bhw-staff-guide.html",
  ];
  for (const page of pages) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /<script type="module" src="\/bhw-alert-center\.mjs"><\/script>/, page);
  }
});
