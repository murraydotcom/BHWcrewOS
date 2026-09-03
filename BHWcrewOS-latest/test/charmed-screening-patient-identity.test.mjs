import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const actionPath = require.resolve("../netlify/functions/action.js");
const cloudPatient = { bhwPatientId: "BHW9999", name: "Synthetic Screening Patient", dob: "1990-02-03" };
const assessment = { id: "assessment-synthetic", kind: "adult", bhwPatientId: cloudPatient.bhwPatientId, status: "Intake" };

function loadAction({ patients = [cloudPatient], assessments = [assessment] } = {}) {
  const cloudWrites = [];
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: {
      DB: {}, DIVISIONS: [],
      httpJson: async () => ({ ok: true, status: 200, data: {} }),
      queryDb: async () => [], createPage: async () => ({ id: "unused" }), updatePage: async () => ({}),
      P: { title: () => "", date: () => "", text: () => "" },
      W: { text: (value) => value, title: (value) => value, date: (value) => value, sel: (value) => value, rel: (value) => value },
      getSession: () => ({ staffId: "staff-synthetic", name: "Synthetic Clinician", scope: "clinical", authTime: Date.now() }),
      visibleDivisions: () => ["CharmEd Minds"],
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: {
      listCloudPatients: async () => patients,
      parsePatientName: () => ({}),
      cloudRequest: async (path, options) => {
        cloudWrites.push({ path, options });
        if (path.startsWith("/v1/charmed/assessments?")) return { assessments };
        if (path.includes("/screening-invitations")) return { eventId: "evt-synthetic", destination: "synthetic-portal" };
        return {};
      },
    },
  };
  delete require.cache[actionPath];
  return { handler: require(actionPath).handler, cloudWrites };
}

async function run(handler, body) {
  const response = await handler({ httpMethod: "POST", body: JSON.stringify(body) });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test("CharmEd sends only for the canonical Patient Registry identity already bound to the Cloud assessment", async () => {
  const { handler, cloudWrites } = loadAction();
  const response = await run(handler, {
    action: "cm-send-screeners", assessmentId: assessment.id, patientId: cloudPatient.bhwPatientId,
    kind: "adult", screeners: ["PHQ-9"], audience: "Self",
  });
  assert.equal(response.status, 200);
  assert.equal(cloudWrites.at(-1).path, "/v1/patients/BHW9999/charmed/screening-invitations");
  assert.deepEqual(cloudWrites.at(-1).options.body.screenings, ["PHQ-9"]);
});

test("CharmEd refuses a different patient ID instead of guessing through a legacy relation", async () => {
  const { handler, cloudWrites } = loadAction({ patients: [cloudPatient, { ...cloudPatient, bhwPatientId: "BHW9998" }] });
  const response = await run(handler, {
    action: "cm-send-screeners", assessmentId: assessment.id, patientId: "BHW9998",
    kind: "adult", screeners: ["PHQ-9"], audience: "Self",
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /do not match/);
  assert.equal(cloudWrites.some((call) => call.path.includes("screening-invitations")), false);
});

test("CharmEd readiness resolves only a real canonical Registry patient", async () => {
  const { handler } = loadAction();
  const ready = await run(handler, { action: "cm-screening-readiness", patientId: "BHW9999" });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.bhwPatientId, "BHW9999");
  const missing = await run(handler, { action: "cm-screening-readiness", patientId: "legacy-relation" });
  assert.equal(missing.status, 404);
});

test("assessment identity check never rewrites the patient relationship", async () => {
  const { handler } = loadAction();
  const correct = await run(handler, {
    action: "cm-screening-link-patient", assessmentId: assessment.id, patientId: "BHW9999", kind: "adult",
  });
  assert.equal(correct.status, 200);
  const wrong = await run(handler, {
    action: "cm-screening-link-patient", assessmentId: assessment.id, patientId: "BHW9998", kind: "adult",
  });
  assert.equal(wrong.status, 409);
});

test("the send dialog and dashboard use Patient Registry IDs and Cloud assessment records", async () => {
  const [html, opsData, action] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/action.js", import.meta.url), "utf8"),
  ]);
  assert.match(opsData, /cloudRequest\("\/v1\/charmed\/assessments"/);
  assert.match(opsData, /patient: assessment\.bhwPatientId/);
  assert.match(action, /The assessment and selected Patient Registry record do not match/);
  assert.match(html, /Patient 360 matched/);
  assert.match(html, /cm-screening-readiness/);
  assert.match(html, /Patient Registry check timed out/);
});
