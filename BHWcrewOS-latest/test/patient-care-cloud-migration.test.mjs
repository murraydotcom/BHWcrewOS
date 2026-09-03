import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const carePlanPath = require.resolve("../netlify/functions/careplan-save.js");
const consolePath = require.resolve("../netlify/functions/console-data.js");

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

function loadCarePlan(cloudRequest, session = { staffId: "synthetic-staff", name: "Synthetic Clinician" }) {
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: { DIVISIONS: ["Primary Care", "Care Management", "Flow"], getSession: () => session, json },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true, exports: { cloudRequest },
  };
  delete require.cache[carePlanPath];
  return require(carePlanPath);
}

test("Care Plan Studio merges into the patient's existing Cloud Health Blueprint", async () => {
  const calls = [];
  const existing = {
    bhwPatientId: "BHW9999",
    status: "clinician-review",
    labHighlights: [{ test: "Synthetic marker", result: "1" }],
    treatmentBlueprint: {
      priorities: { first: ["Existing priority"], next: [], later: [] },
      medications: [{ name: "Synthetic medicine", purpose: "Test", intendedBenefit: "Test", howBenefitIsMeasured: "Test", tracking: { tolerance: "no-problems", benefit: "helping" } }],
      systemSpecificCare: [],
    },
    followUp: { monitoring: [], nextSteps: [], careTeam: "BHW team" },
  };
  const cloudRequest = async (path, options = {}) => {
    calls.push({ path, options });
    return options.method === "PUT"
      ? { blueprint: { ...options.body, updatedAt: "2026-09-03T12:00:00.000Z" }, readiness: { ready: false } }
      : { blueprint: existing };
  };
  const { handler } = loadCarePlan(cloudRequest);
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({
      program: "Primary Care", bhwId: "BHW9999", patientName: "Synthetic Patient",
      planDate: "2026-09-03", reviewDate: "2027-09-03", focus: "Synthetic focus",
      goals: "Improve energy", interventions: "Review results", patientRole: "Complete check-ins",
      actions: "Walk after meals", track: "Blood pressure", weeks1to4: "Establish baseline",
      weeks5to8: "Build routine", weeks9to12: "Review progress", careTeam: "Synthetic care team",
    }),
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.destination, "BHW Cloud");
  assert.equal(body.saved, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/patients/BHW9999/blueprint");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[1].options.body.status, "draft");
  assert.deepEqual(calls[1].options.body.labHighlights, existing.labHighlights);
  assert.equal(calls[1].options.body.treatmentBlueprint.medications[0].tracking.benefit, "helping");
  assert.equal(calls[1].options.body.documentSupport.programCarePlan.programId, "primary-care");
  assert.deepEqual(calls[1].options.body.documentSupport.programCarePlan.homeMonitoring, ["Blood pressure"]);
  assert.match(calls[1].options.body.followUp.nextSteps.join(" "), /Weeks 9–12: Review progress/);
});

test("Care Plan Studio fails closed without a verified BHW Patient ID", async () => {
  let requests = 0;
  const { handler } = loadCarePlan(async () => { requests += 1; return {}; });
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ program: "Primary Care", patientName: "Synthetic Patient" }) });
  assert.equal(response.statusCode, 400);
  assert.equal(requests, 0);
  assert.match(JSON.parse(response.body).error, /verified patient/i);
});

test("retired CrewCare endpoint exposes only the signed-in Cloud roster", async () => {
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: { getSession: () => null, json },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: { listCloudPatients: async () => { throw new Error("must not load"); } },
  };
  delete require.cache[consolePath];
  const response = await require(consolePath).handler({ httpMethod: "GET", queryStringParameters: { mode: "patients" } });
  assert.equal(response.statusCode, 401);

  const source = await readFile(new URL("../netlify/functions/console-data.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /NOTION_TOKEN|api\.notion\.com|publishblueprint|publishcareplan|postresult/);
  assert.match(source, /legacy patient-content write path is retired/i);
});

test("CrewCare and Care Plan Studio show the authoritative Cloud destinations", async () => {
  const portal = await readFile(new URL("../bhw-crewcare-portal.html", import.meta.url), "utf8");
  const studio = await readFile(new URL("../bhw-careplan.html", import.meta.url), "utf8");
  assert.doesNotMatch(portal, /Notion|DASH_KEY|Post to patient page/);
  assert.match(portal, /Google Cloud is the operational source of truth/);
  assert.match(portal, /createOperationsCloudClient/);
  assert.match(studio, /Save draft to BHW Cloud/);
  assert.match(studio, /Saving to BHW Cloud/);
  assert.match(studio, /Saved to BHW Cloud/);
  assert.match(studio, /Not saved/);
  assert.doesNotMatch(studio, /Save to Notion|save plans to Notion|Care Plans database in Notion/);
});
