import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const actionPath = require.resolve("../netlify/functions/action.js");

const cloudPatient = {
  bhwPatientId: "BHW0613",
  name: "Synthetic Patient",
  dob: "1980-01-02",
  primaryPayer: "Medicare",
  insurancePlanName: "Medicare",
  memberId: "SYNTHETIC-MEMBER",
  mrn: "SYNTHETIC-MRN",
  programs: ["Primary Care"],
};

function notionPatient({ id = "index-existing", name = cloudPatient.name, dob = cloudPatient.dob, masterId = "" } = {}) {
  return {
    id,
    properties: {
      "Patient Name": { title: [{ plain_text: name }] },
      "DOB": { date: { start: dob } },
      "Patient ID #": { rich_text: masterId ? [{ plain_text: masterId }] : [] },
    },
  };
}

function loadAction({ indexRows = [], createId = "index-created" } = {}) {
  const writes = [];
  const updates = [];
  const W = {
    title: (value) => ({ title: value }), text: (value) => ({ rich_text: value }),
    sel: (value) => ({ select: value }), date: (value) => ({ date: value }),
  };
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: {
      DB: { patients: "patients-db" }, DIVISIONS: [], httpJson: async () => ({}),
      queryDb: async () => indexRows,
      createPage: async (db, properties) => { writes.push({ db, properties }); return { id: createId }; },
      updatePage: async (id, properties) => { updates.push({ id, properties }); return {}; }, P: {
        title: (prop) => prop?.title?.map((item) => item.plain_text).join("") || "",
        date: (prop) => prop?.date?.start || "", uid: () => "",
        text: (prop) => prop?.rich_text?.map((item) => item.plain_text).join("") || "",
      }, W, getSession: () => ({ staffId: "staff-synthetic" }), visibleDivisions: () => [],
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: { cloudRequest: async () => { throw new Error("Cloud must not be written"); }, listCloudPatients: async () => [cloudPatient] },
  };
  delete require.cache[actionPath];
  return { handler: require(actionPath).handler, writes, updates };
}

async function select(handler) {
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ action: "patient-select", bhwPatientId: cloudPatient.bhwPatientId }) });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test("selecting a Master patient reuses an exact CrewOS Index record", async () => {
  const { handler, writes, updates } = loadAction({ indexRows: [notionPatient({ masterId: cloudPatient.bhwPatientId })] });
  const response = await select(handler);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "index-existing");
  assert.equal(response.body.linked, false);
  assert.equal(writes.length, 0);
  assert.equal(updates.length, 0);
});

test("selecting a linked patient backfills the authoritative Master Patient ID", async () => {
  const { handler, writes, updates } = loadAction({ indexRows: [notionPatient()] });
  const response = await select(handler);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "index-existing");
  assert.equal(writes.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "index-existing");
  assert.equal(updates[0].properties["Patient ID #"].rich_text, cloudPatient.bhwPatientId);
});

test("selecting a same-name patient never overwrites a different Master Patient ID", async () => {
  const { handler, writes, updates } = loadAction({ indexRows: [notionPatient({ masterId: "BHW9998" })] });
  const response = await select(handler);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /different Master Patient ID/);
  assert.equal(writes.length, 0);
  assert.equal(updates.length, 0);
});

test("selecting a Cloud-only patient creates one CrewOS link without duplicating the Master", async () => {
  const { handler, writes } = loadAction();
  const response = await select(handler);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "index-created");
  assert.equal(response.body.bhwId, "BHW0613");
  assert.equal(response.body.linked, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].db, "patients-db");
  assert.equal(writes[0].properties["Patient Name"].title, cloudPatient.name);
  assert.deepEqual(Object.keys(writes[0].properties).sort(), ["DOB", "Patient ID #", "Patient Name"]);
  assert.equal(writes[0].properties["Patient ID #"].rich_text, cloudPatient.bhwPatientId);
});

test("the picker chooses a Master patient through patient-select, not patient-create", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /onclick="npUseMaster\(\$\{i\},this\)"/);
  assert.match(html, /action:"patient-select", bhwPatientId:/);
  assert.doesNotMatch(html, /function npBringIn\(/);
});

test("CrewOS displays the authoritative Master Patient ID after refresh", async () => {
  const source = await readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8");
  assert.match(source, /bhwId: P\.text\(pg\.properties\["Patient ID #"\]\) \|\| P\.uid\(pg\.properties\["BHW ID"\]\)/);
});

test("new registrations use the same safe Patient Index identity fields", async () => {
  const source = await readFile(new URL("../netlify/functions/action.js", import.meta.url), "utf8");
  assert.match(source, /\.\.\.patientIndexProperties\(\{ name, dob: b\.dob, bhwPatientId: ctlNo \}\)/);
  assert.doesNotMatch(source, /indexProps\["CharmHealth Chart #"\]/);
});
