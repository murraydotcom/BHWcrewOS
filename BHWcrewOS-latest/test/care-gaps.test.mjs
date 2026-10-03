import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const hetsPreventive = require("../netlify/functions/lib/hets-preventive.js");

function loadHandler(source) {
  const exports = {};
  const profiles = [
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
  const patients = [
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

test("payer gap list retains authoritative IDs for both shared queue views", async () => {
  const source = await readFile(new URL("../netlify/functions/care-gaps.js", import.meta.url), "utf8");
  const handler = loadHandler(source);
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ action: "list" }) });
  const body = JSON.parse(response.body);
  assert.deepEqual(body.patients.map((patient) => patient.bhwPatientId), ["BHW0000", "BHW0001"]);
  assert.equal(body.updated, "2026-09-30T13:00:00.000Z");
});
