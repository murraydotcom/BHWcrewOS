import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const operationsPath = require.resolve("../netlify/functions/lib/operations-cloud.js");
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

function loadAction({ patients = [cloudPatient] } = {}) {
  const notionReads = [];
  const notionWrites = [];
  const cloudCalls = [];
  const operationCalls = [];
  const W = {
    title: (value) => ({ title: value }), text: (value) => ({ rich_text: value }),
    sel: (value) => ({ select: value }), date: (value) => ({ date: value }),
    rel: (ids) => ({ relation: ids }), check: (value) => ({ checkbox: Boolean(value) }),
  };
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: {
      DB: {}, DIVISIONS: ["Primary Care", "Care Management"],
      queryDb: async (...args) => { notionReads.push(args); return []; },
      createPage: async (...args) => { notionWrites.push(["create", ...args]); return { id: "legacy-write" }; },
      updatePage: async (...args) => { notionWrites.push(["update", ...args]); return {}; },
      P: {}, W,
      getSession: () => ({ staffId: "staff-synthetic", name: "Synthetic Staff" }),
      visibleDivisions: () => ["Primary Care", "Care Management"],
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: {
      parsePatientName: (name, explicitSuffix) => {
        const parts = String(name || "").trim().split(/\s+/);
        const suffix = explicitSuffix || (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts.at(-1)) ? parts.pop().replace(/\.$/, "") : "");
        return { name: [...parts, suffix].filter(Boolean).join(" "), legalFirstName: parts[0] || "", legalLastName: parts.at(-1) || "", nameSuffix: suffix };
      },
      listCloudPatients: async () => patients,
      cloudRequest: async (path, options) => {
        cloudCalls.push({ path, options });
        if (path === "/v1/prospective-patients") {
          return { patient: { bhwPatientId: "TMP0001", updatedAt: "2026-09-03T12:00:00.000Z" } };
        }
        throw new Error(`Unexpected Cloud call: ${path}`);
      },
    },
  };
  require.cache[operationsPath] = {
    id: operationsPath, filename: operationsPath, loaded: true,
    exports: {
      operationsRequest: async (path, options) => {
        operationCalls.push({ path, options });
        return { request: { id: "REQ-synthetic", updatedAt: "2026-09-03T12:00:00.000Z" } };
      },
    },
  };
  delete require.cache[actionPath];
  return { handler: require(actionPath).handler, notionReads, notionWrites, cloudCalls, operationCalls };
}

async function select(handler, bhwPatientId = cloudPatient.bhwPatientId) {
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ action: "patient-select", bhwPatientId }) });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test("selecting a patient returns the canonical Cloud Registry ID without a legacy write", async () => {
  const { handler, notionReads, notionWrites } = loadAction();
  const response = await select(handler);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "BHW0613");
  assert.equal(response.body.bhwId, "BHW0613");
  assert.equal(response.body.storage, "BHW Cloud");
  assert.equal(notionReads.length, 0);
  assert.equal(notionWrites.length, 0);
});

test("selecting a patient that is no longer in the Cloud Registry fails closed", async () => {
  const { handler, notionWrites } = loadAction({ patients: [] });
  const response = await select(handler);
  assert.equal(response.status, 404);
  assert.match(response.body.error, /no longer available/i);
  assert.equal(notionWrites.length, 0);
});

test("the picker chooses directly from the loaded Cloud Registry", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /onclick="npUseMaster\(\$\{i\},this\)"/);
  assert.match(html, /const existing = \(D\.patients\|\|\[\]\)\.find\(item=>item\.bhwId===bhwId\)/);
  assert.doesNotMatch(html, /action:"patient-select"/);
  assert.doesNotMatch(html, /function npBringIn\(/);
});

test("CrewOS builds every picker from the Cloud Registry only", async () => {
  const source = await readFile(new URL("../netlify/functions/ops-data.js", import.meta.url), "utf8");
  assert.match(source, /listCloudPatients\(session\)/);
  assert.match(source, /buildPatientDirectory\(patientRegistry\)/);
  assert.doesNotMatch(source, /DB\.patients|indexPatients|patientRegistry\.patients/);
});

test("every modal patient dropdown gets the shared Registry search", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /function enhancePatientPicker\(\)/);
  assert.match(html, /Search Patient Registry by name, BHW ID, DOB, MRN, or insurance/);
  assert.match(html, /enhancePatientPicker\(\);/);
});

test("a workflow submits the canonical Cloud Registry ID directly", async () => {
  const { handler, notionWrites, operationCalls } = loadAction();
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({
      action: "referral-create",
      patientId: cloudPatient.bhwPatientId,
      from: "Primary Care",
      to: "Care Management",
      type: "Division Referral",
      details: "Synthetic referral routing test",
    }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(notionWrites.length, 0);
  assert.equal(operationCalls.length, 1);
  assert.equal(operationCalls[0].path, "/v1/patient-requests");
  assert.equal(operationCalls[0].options.body.bhwPatientId, "BHW0613");
});

test("new registrations receive a temporary Cloud ID and preserve a suffix", async () => {
  const { handler, notionWrites, cloudCalls } = loadAction({ patients: [] });
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ action: "patient-create", name: "Synthetic Person Jr", dob: "1991-04-05" }),
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.id, "TMP0001");
  assert.equal(body.requiresReenrollment, true);
  assert.equal(body.storage, "BHW Cloud");
  assert.equal(cloudCalls[0].path, "/v1/prospective-patients");
  assert.equal(cloudCalls[0].options.body.nameSuffix.toLowerCase(), "jr");
  assert.equal(notionWrites.length, 0);
});
