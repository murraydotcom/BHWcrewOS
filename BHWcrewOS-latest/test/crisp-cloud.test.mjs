import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../netlify/functions/_lib.js");
const cloudPath = require.resolve("../netlify/functions/lib/cloud-patients.js");
const crispPath = require.resolve("../netlify/functions/crisp.js");
const adt = require("../netlify/functions/lib/adt.js");

function loadCrisp() {
  const calls = [];
  require.cache[libPath] = {
    id: libPath, filename: libPath, loaded: true,
    exports: { getSession: () => ({ staffId: "staff-synthetic", name: "Synthetic Staff" }) },
  };
  require.cache[cloudPath] = {
    id: cloudPath, filename: cloudPath, loaded: true,
    exports: {
      listCloudPatients: async () => [],
      cloudRequest: async (path, options = {}) => {
        calls.push({ path, options });
        if (options.method === "POST") {
          return { event: { id: "synthetic-crisp-event" }, snapshot: { updatedAt: "2026-09-03T12:00:00.000Z" } };
        }
        return { snapshot: { updatedAt: "2026-09-03T11:00:00.000Z", events: [{ id: "synthetic-crisp-event", bhwPatientId: "BHW0000" }] } };
      },
    },
  };
  delete require.cache[crispPath];
  return { handler: require(crispPath).handler, calls };
}

test("signed-in CRISP board reads only from the Cloud event store", async () => {
  const { handler, calls } = loadCrisp();
  const response = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.storage, "BHW Cloud");
  assert.equal(body.sampleMode, false);
  assert.equal(calls[0].path, "/v1/crisp-events");
});

test("CRISP webhook writes through the protected Cloud API and returns no patient details", async () => {
  const priorToken = process.env.CRISP_INGEST_TOKEN;
  process.env.CRISP_INGEST_TOKEN = "synthetic-crisp-token";
  const { handler, calls } = loadCrisp();
  try {
    const response = await handler({
      httpMethod: "POST",
      headers: { "x-crisp-token": "synthetic-crisp-token" },
      body: JSON.stringify({ patient: "Synthetic Patient", bhwPatientId: "BHW0000", type: "discharge", date: "2026-09-03" }),
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.storage, "BHW Cloud");
    assert.equal(calls[0].path, "/v1/crisp-events");
    assert.equal(calls[0].options.actor.staffId, "crisp-ingest");
    assert.doesNotMatch(response.body, /Synthetic Patient|BHW0000/);
  } finally {
    if (priorToken === undefined) delete process.env.CRISP_INGEST_TOKEN; else process.env.CRISP_INGEST_TOKEN = priorToken;
  }
});

test("CRISP HL7 parsing preserves a canonical BHW identifier when present", () => {
  const parsed = adt.parseHL7ADT([
    "MSH|^~\\&|CRISP|||BHW|202609031200||ADT^A03",
    "EVN|A03|||||20260903",
    "PID|||BHW0000||PATIENT^SYNTHETIC",
    "PV1||I|Synthetic Hospital",
  ].join("\r"));
  assert.equal(parsed.bhwPatientId, "BHW0000");
  assert.equal(parsed.type, "discharge");
});
