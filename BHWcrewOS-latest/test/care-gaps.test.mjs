import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const hetsPreventive = require("../netlify/functions/lib/hets-preventive.js");

function loadHandler(source, overrides = {}) {
  const exports = {};
  const profiles = overrides.profiles || [
    {
      bhwPatientId: "BHW0000",
      payer: "Synthetic Medicare",
      preventiveGaps: [{ code: "AWV", label: "Annual Wellness Visit", state: "Open", open: true }],
      preventiveServices: [
        { code: "92552", info: "Synthetic audiology benefit", dates: [{ kind: "benefit.start", date: "2025-01-01" }] },
        { code: "92557", info: "Synthetic audiology benefit", dates: [{ kind: "benefit.start", date: "2025-01-01" }] },
      ],
      updatedAt: "2026-09-30T12:00:00.000Z",
    },
    {
      bhwPatientId: "BHW0001",
      payer: "Synthetic Medicare",
      preventiveGaps: [{ code: "COL", label: "Colorectal screening", state: "Open", open: true }],
      updatedAt: "2026-09-30T13:00:00.000Z",
    },
  ];
  const patients = overrides.patients || [
    { bhwPatientId: "BHW0000", name: "Synthetic Patient", memberId: "SYNTH-0000" },
    { bhwPatientId: "BHW0001", name: "Synthetic Patient", memberId: "SYNTH-0001" },
  ];
  vm.runInNewContext(source, {
    exports,
    require(id) {
      if (id === "./_lib") return {
        getSession: () => ({ staffId: "synthetic-test" }),
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      };
      if (id === "./lib/cloud-patients") return {
        cloudRequest: async () => ({ profiles }),
        listCloudPatients: async () => patients,
      };
      if (id === "./lib/hets-preventive") return hetsPreventive;
      throw new Error(`Unexpected require: ${id}`);
    },
  });
  return exports.handler;
}

test("payer gaps resolve by authoritative BHW patient ID even when names are ambiguous", async () => {
  const source = await readFile(new URL("../netlify/functions/care-gaps.js", import.meta.url), "utf8");
  const handler = loadHandler(source);
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ action: "for", bhwPatientId: "BHW0001", name: "Synthetic Patient" }),
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.matched, true);
  assert.equal(body.patient.bhwPatientId, "BHW0001");
  assert.equal(body.gaps[0].code, "colorectal-cancer-screening");
});

test("HETS audiology codes collapse to one review item and never become seven overdue screenings", async () => {
  const source = await readFile(new URL("../netlify/functions/care-gaps.js", import.meta.url), "utf8");
  const handler = loadHandler(source);
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ action: "for", bhwPatientId: "BHW0000" }),
  });
  const body = JSON.parse(response.body);
  const hearing = body.gaps.find((gap) => gap.measureId === "hearing-audiology-assessment");
  assert.equal(hearing.open, false);
  assert.equal(hearing.clinicalStatus, "needs-review");
  assert.deepEqual(hearing.sourceCodes, ["92552", "92557"]);
  assert.equal(hearing.codeCount, 2);
  assert.equal(body.openCount, 1);
});

test("exact BHW0000 requests use an isolated synthetic HETS fixture when Cloud has no profile", async () => {
  const source = await readFile(new URL("../netlify/functions/care-gaps.js", import.meta.url), "utf8");
  const handler = loadHandler(source, { profiles: [], patients: [] });
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ action: "for", bhwPatientId: "BHW0000" }),
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.matched, true);
  assert.equal(body.patient.bhwPatientId, "BHW0000");
  assert.equal(body.patient.payer, "Synthetic Medicare HETS fixture");
  assert.deepEqual(body.gaps.map((gap) => gap.measureId), [
    "annual-wellness-visit",
    "colorectal-cancer-screening",
    "hearing-audiology-assessment",
  ]);
  const hearing = body.gaps.find((gap) => gap.measureId === "hearing-audiology-assessment");
  assert.deepEqual(hearing.hetsSourceCodes, ["92552", "92557", "92567", "92653"]);
  assert.equal(body.gaps.every((gap) => gap.open === false && gap.clinicalStatus === "needs-review"), true);
});

test("the isolated BHW0000 HETS fixture never appears in ordinary payer-gap lists", async () => {
  const source = await readFile(new URL("../netlify/functions/care-gaps.js", import.meta.url), "utf8");
  const handler = loadHandler(source, { profiles: [], patients: [] });
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ action: "list" }) });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.patients, []);
  assert.equal(body.rows, 0);
});

test("payer gap list retains authoritative IDs for both shared queue views", async () => {
  const source = await readFile(new URL("../netlify/functions/care-gaps.js", import.meta.url), "utf8");
  const handler = loadHandler(source);
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ action: "list" }) });
  const body = JSON.parse(response.body);
  assert.deepEqual(body.patients.map((patient) => patient.bhwPatientId), ["BHW0000", "BHW0001"]);
  assert.equal(body.updated, "2026-09-30T13:00:00.000Z");
});
