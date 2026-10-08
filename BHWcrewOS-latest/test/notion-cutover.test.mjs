import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cutover = require("../netlify/functions/notion-cutover.js")._test;
const store = require("../netlify/functions/lib/operational-store.js");

test("cutover sanitizes records to the allowlisted operational schema", () => {
  const definition = cutover.SOURCE_DEFINITIONS.staff;
  const safe = { type: "title", title: [{ plain_text: "Synthetic Staff" }] };
  const record = cutover.sanitizePage({
    id: "staff-synthetic-1",
    properties: { Name: safe, "PIN Hash": { type: "rich_text", rich_text: [] }, Unexpected: { secret: true } },
  }, definition);
  assert.equal(record.id, "staff-synthetic-1");
  assert.deepEqual(Object.keys(record.properties).sort(), ["Name", "PIN Hash"]);
  assert.equal(Object.hasOwn(record.properties, "Unexpected"), false);
});

test("record verification hashes are stable across database ordering", () => {
  const first = { id: "b", properties: { Name: { title: [], type: "title" } } };
  const second = { id: "a", properties: { Name: { title: [] } } };
  assert.equal(store.recordsHash([first, second]), store.recordsHash([second, first]));
  assert.equal(
    store.recordsHash([first]),
    store.recordsHash([{ id: "b", properties: { Name: { type: "title", title: [] } } }]),
  );
});

test("stored operational records support the Notion filters used by scheduling", () => {
  const page = {
    properties: {
      Date: { date: { start: "2026-10-08" } },
      Status: { select: { name: "Scheduled" } },
      Active: { checkbox: true },
    },
  };
  assert.equal(store.matchesFilter(page, { and: [
    { property: "Date", date: { equals: "2026-10-08" } },
    { property: "Status", select: { equals: "Scheduled" } },
    { property: "Active", checkbox: { equals: true } },
  ] }), true);
  assert.equal(store.matchesFilter(page, { property: "Date", date: { equals: "2026-10-09" } }), false);
});

test("a locked cutover rejects stale snapshots from before writes paused", async () => {
  const staleRows = store.REQUIRED_NAMESPACES.map((namespace) => ({
    namespace,
    source_count: 1,
    imported_count: 1,
    schema_properties: [],
    imported_at: new Date("2026-10-08T11:59:00.000Z"),
  }));
  const pool = {
    query: async (sql) => sql.includes("crewos_cutover_state")
      ? { rows: [{ mode: "cutover", cutover_started_at: new Date("2026-10-08T12:00:00.000Z") }] }
      : { rows: staleRows },
  };
  const status = await store.cutoverStatus({ pool });
  assert.equal(status.complete, false);
  assert.ok(status.sources.every((source) => source.verified === false));
});
