import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const actionPath = require.resolve("../netlify/functions/action.js");

const cloudPatient = {
  bhwPatientId: "BHW9999",
  name: "Synthetic Screening Patient",
  dob: "1990-02-03",
};

function indexPatient({ id = "index-synthetic", name = cloudPatient.name, dob = cloudPatient.dob, masterId = "" } = {}) {
  return {
    id,
    properties: {
      "Patient Name": { title: [{ plain_text: name }] },
      "DOB": { date: { start: dob } },
      "Patient ID #": { rich_text: masterId ? [{ plain_text: masterId }] : [] },
    },
  };
}

function loadAction({ indexRows = [], cloudPatients = [cloudPatient] } = {}) {
  const updates = [];
  const cloudWrites = [];
  const W = {
    text: (value) => ({ rich_text: value }),
    title: (value) => ({ title: value }),
    date: (value) => ({ date: value }),
    sel: (value) => ({ select: value }),
    rel: (value) => ({ relation: value }),
  };
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: {
      DB: { patients: "patients-db" },
      DIVISIONS: [],
      httpJson: async () => ({}),
      queryDb: async (db) => db === "patients-db" ? indexRows : [],
      createPage: async () => ({ id: "unused" }),
      updatePage: async (id, properties) => { updates.push({ id, properties }); return {}; },
      P: {
        title: (prop) => prop?.title?.map((item) => item.plain_text).join("") || "",
        date: (prop) => prop?.date?.start || "",
        text: (prop) => prop?.rich_text?.map((item) => item.plain_text).join("") || "",
      },
      W,
      getSession: () => ({
        staffId: "staff-synthetic",
        name: "Synthetic Clinician",
        scope: "clinical",
        authTime: Date.now(),
      }),
      visibleDivisions: () => [],
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: {
      listCloudPatients: async () => cloudPatients,
      cloudRequest: async (path, options) => {
        cloudWrites.push({ path, options });
        return { eventId: "evt-synthetic", destination: "synthetic-portal" };
      },
    },
  };
  delete require.cache[actionPath];
  return { handler: require(actionPath).handler, updates, cloudWrites };
}

async function send(handler, patientId = "index-synthetic") {
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({
      action: "cm-send-screeners",
      assessmentId: "assessment-synthetic",
      patientId,
      kind: "adult",
      screeners: ["PHQ-9"],
      audience: "Self",
    }),
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test("CharmEd resolves an existing Patient Index relation through its BHW ID", async () => {
  const { handler, updates, cloudWrites } = loadAction({
    indexRows: [indexPatient({ masterId: cloudPatient.bhwPatientId })],
  });
  const response = await send(handler);
  assert.equal(response.status, 200);
  assert.equal(updates.length, 0);
  assert.equal(cloudWrites.length, 1);
  assert.equal(cloudWrites[0].path, "/v1/patients/BHW9999/charmed/screening-invitations");
  assert.deepEqual(cloudWrites[0].options.body.screenings, ["PHQ-9"]);
});

test("CharmEd backfills a blank legacy link only for one exact Registry identity", async () => {
  const { handler, updates, cloudWrites } = loadAction({ indexRows: [indexPatient()] });
  const response = await send(handler);
  assert.equal(response.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "index-synthetic");
  assert.equal(updates[0].properties["Patient ID #"].rich_text, "BHW9999");
  assert.equal(cloudWrites.length, 1);
});

test("CharmEd accepts a Cloud Patient 360 BHW ID directly", async () => {
  const { handler, updates, cloudWrites } = loadAction();
  const response = await send(handler, "BHW9999");
  assert.equal(response.status, 200);
  assert.equal(updates.length, 0);
  assert.equal(cloudWrites.length, 1);
});

test("CharmEd fails closed when name and DOB are not unique", async () => {
  const secondPatient = { ...cloudPatient, bhwPatientId: "BHW9998" };
  const { handler, updates, cloudWrites } = loadAction({
    indexRows: [indexPatient()],
    cloudPatients: [cloudPatient, secondPatient],
  });
  const response = await send(handler);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /more than one Patient Registry record/);
  assert.equal(updates.length, 0);
  assert.equal(cloudWrites.length, 0);
});

test("CharmEd fails closed when the assessment relation is absent from the Registry bridge", async () => {
  const { handler, updates, cloudWrites } = loadAction();
  const response = await send(handler, "missing-index-record");
  assert.equal(response.status, 409);
  assert.match(response.body.error, /could not match this assessment to the Patient Registry/);
  assert.equal(updates.length, 0);
  assert.equal(cloudWrites.length, 0);
});

test("the send dialog shows Patient 360 readiness before staff approval", async () => {
  const [html, opsData] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8"),
  ]);
  assert.match(opsData, /patientBhwIdByKey\[patient\] \|\| ""/);
  assert.match(html, /Patient 360 matched/);
  assert.match(html, /Patient Registry match will be verified before sending/);
});
