import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const endpoint = require("../netlify/functions/intel-connections.js");
const { LEGACY_WORKFLOWS, LIVE_CONTROLS, safeApiBase, inspectNotionSchema, buildReport } = endpoint._test;

function notionCutoverStatus() {
  return { mode: "notion", complete: false, sources: LIVE_CONTROLS.map((item) => ({ namespace: item.namespace, verified: false, schemaProperties: [] })) };
}

function notionProperties(definition) {
  return Object.fromEntries(definition.requiredProperties.map((name) => [name, { type: "rich_text" }]));
}

test("BHW Intel accepts only HTTPS cloud service origins", () => {
  assert.equal(safeApiBase("https://operations.example.test/path/"), "https://operations.example.test/path");
  assert.equal(safeApiBase("http://operations.example.test"), "");
  assert.equal(safeApiBase("not a url"), "");
});

test("legacy workflow inspection validates schema without querying patient rows", async () => {
  process.env.NOTION_TOKEN = "synthetic-notion-token";
  const calls = [];
  const definition = LEGACY_WORKFLOWS[0];
  const result = await inspectNotionSchema(definition, {
    httpJsonImpl: async (method, url, body) => {
      calls.push({ method, url, body });
      return { ok: true, status: 200, data: { properties: notionProperties(definition) } };
    },
  });
  assert.equal(result.state, "connected");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, new RegExp(`/databases/${definition.databaseId}$`));
  assert.equal(calls[0].body, undefined);
});

test("the report queries rows only for approved non-patient Notion controls", async () => {
  process.env.NOTION_TOKEN = "synthetic-notion-token";
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.RCM_CLOUD_API_URL = "https://rcm.example.test";
  delete process.env.LAB_INTELLIGENCE_PRODUCTION_READY;
  delete process.env.LAB_INTELLIGENCE_API_URL;
  const queryIds = [];
  const definitions = [...LIVE_CONTROLS, ...LEGACY_WORKFLOWS];
  const httpJsonImpl = async (method, url) => {
    const definition = definitions.find((item) => url.includes(item.databaseId));
    assert.ok(definition, `unexpected Notion URL: ${url}`);
    if (method === "GET") return { ok: true, status: 200, data: { properties: notionProperties(definition) } };
    queryIds.push(definition.databaseId);
    return { ok: true, status: 200, data: { results: [], has_more: false } };
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, service: "synthetic" }) });
  const report = await buildReport({ httpJsonImpl, fetchImpl, cutoverStatusImpl: async () => notionCutoverStatus(), now: () => new Date("2026-10-08T12:00:00.000Z") });
  assert.deepEqual(new Set(queryIds), new Set(LIVE_CONTROLS.map((item) => item.databaseId)));
  assert.ok(LEGACY_WORKFLOWS.every((item) => !queryIds.includes(item.databaseId)));
  assert.ok(report.workflows.every((item) => item.legacySource.rowsRead === false));
  assert.equal(report.workflows.find((item) => item.key === "care-plan-lab").labActivation.state, "limited");
  assert.equal(report.ok, true);
});

test("after cutover the report reads CrewHQ Database and never calls Notion", async () => {
  process.env.NOTION_TOKEN = "must-not-be-used";
  process.env.OPERATIONS_CLOUD_API_URL = "https://operations.example.test";
  process.env.RCM_CLOUD_API_URL = "https://rcm.example.test";
  const cutover = {
    mode: "database",
    complete: true,
    sources: LIVE_CONTROLS.map((item) => ({ namespace: item.namespace, verified: true, schemaProperties: item.requiredProperties })),
  };
  const pool = {
    query: async (sql) => {
      if (sql.includes("SELECT mode FROM crewos_cutover_state")) return { rows: [{ mode: "database" }] };
      if (sql.includes("SELECT payload FROM crewos_operational_records")) return { rows: [] };
      throw new Error(`unexpected database query: ${sql}`);
    },
  };
  let notionCalls = 0;
  const report = await buildReport({
    cutoverStatusImpl: async () => cutover,
    operationalDependencies: { pool },
    httpJsonImpl: async () => { notionCalls += 1; throw new Error("Notion must not be called after cutover"); },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  });
  assert.equal(notionCalls, 0);
  assert.ok(report.controls.slice(0, LIVE_CONTROLS.length).every((item) => item.source === "CrewHQ Database"));
  assert.ok(report.workflows.every((item) => item.legacySource.state === "retired"));
  assert.match(report.boundary.notion, /Disconnected/);
});

test("BHW Intel page is session-gated and linked from CrewHQ", async () => {
  const [page, hq, source] = await Promise.all([
    readFile(new URL("../bhw-intel-connections.html", import.meta.url), "utf8"),
    readFile(new URL("../hq.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/intel-connections.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /crew-provider-gate\.js/);
  assert.match(page, /\.netlify\/functions\/intel-connections/);
  assert.match(page, /DISCONNECT NOTION/);
  assert.match(page, /notion-cutover/);
  assert.match(page, /patient rows read/);
  assert.match(hq, /BHW Intel Connections/);
  assert.match(hq, /bhw-intel-connections\.html/);
  assert.match(source, /Administrator access is required/);
  assert.doesNotMatch(source, /queryDb\(LEGACY_WORKFLOW_DB/);
});

