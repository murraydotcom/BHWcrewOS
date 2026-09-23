import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const operationsPath = require.resolve("../netlify/functions/lib/operations-cloud.js");
const actionPath = require.resolve("../netlify/functions/action.js");
const patient = { bhwPatientId: "BHW0000", name: "Synthetic Patient" };

function loadAction({ verifyAssessment = true, verifyReadiness = true } = {}) {
  const assessment = { id: "assessment-synthetic", kind: "peds", bhwPatientId: patient.bhwPatientId, updatedAt: "2026-09-23T12:00:00.000Z" };
  const plan = { id: "readiness-synthetic", program: "Elevated Wellness", bhwPatientId: patient.bhwPatientId, updatedAt: "2026-09-23T12:05:00.000Z" };
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: {
      DB: {}, DIVISIONS: ["Primary Care", "CharmEd Minds", "Elevated Wellness"], normalizeDivision: (value) => value,
      queryDb: async () => [], createPage: async () => ({}), updatePage: async () => ({}), P: {}, W: {},
      getSession: () => ({ staffId: "synthetic-staff", name: "Synthetic Staff", access: "Admin" }),
      visibleDivisions: () => ["Primary Care", "CharmEd Minds", "Elevated Wellness"],
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: {
      listCloudPatients: async () => [patient],
      parsePatientName: () => ({}),
      cloudRequest: async (path) => {
        if (path === "/v1/patients/BHW0000/charmed/assessments") return { assessment };
        if (path === "/v1/charmed/assessments?kind=peds") return { assessments: verifyAssessment ? [assessment] : [] };
        if (path === "/v1/patients/BHW0000/program-care-plans") return { plan };
        if (path === "/v1/program-care-plans") return { plans: verifyReadiness ? [plan] : [] };
        throw new Error(`Unexpected cloud request: ${path}`);
      },
    },
  };
  require.cache[operationsPath] = {
    id: operationsPath, filename: operationsPath, loaded: true,
    exports: { operationsRequest: async () => ({}) },
  };
  delete require.cache[actionPath];
  return require(actionPath).handler;
}

async function run(handler, body) {
  const response = await handler({ httpMethod: "POST", body: JSON.stringify(body) });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test("CharmEd assessment creation is confirmed by a BHW Cloud read-back", async () => {
  const response = await run(loadAction(), {
    action: "cm-save", patientId: "BHW0000", step: 1, stepStatus: "In Progress", answers: { hopes: "Synthetic" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "assessment-synthetic");
  assert.equal(response.body.storage, "BHW Cloud");
  assert.equal(response.body.savedAt, "2026-09-23T12:00:00.000Z");
});

test("CharmEd assessment does not report saved when the write cannot be read back", async () => {
  const response = await run(loadAction({ verifyAssessment: false }), {
    action: "cm-save", patientId: "BHW0000", step: 1, stepStatus: "In Progress", answers: { hopes: "Synthetic" },
  });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /could not be read back/);
});

test("Elevated Wellness readiness creation is confirmed by a BHW Cloud read-back", async () => {
  const response = await run(loadAction(), {
    action: "ph-plan-save", patientId: "BHW0000", moveIn: "2026-09-23", drivers: ["Other"],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "readiness-synthetic");
  assert.equal(response.body.storage, "BHW Cloud");
  assert.equal(response.body.savedAt, "2026-09-23T12:05:00.000Z");
});

test("Elevated Wellness readiness does not report saved when the write cannot be read back", async () => {
  const response = await run(loadAction({ verifyReadiness: false }), {
    action: "ph-plan-save", patientId: "BHW0000", moveIn: "2026-09-23", drivers: ["Other"],
  });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /could not be read back/);
});
