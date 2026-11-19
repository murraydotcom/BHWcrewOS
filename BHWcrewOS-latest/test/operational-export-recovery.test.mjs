import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { importBundle } = require("../netlify/functions/operational-export-recovery")._test;
const store = require("../netlify/functions/lib/operational-store");

const namespace = "rooms";
const id = "00000000-0000-4000-8000-000000000001";
const page = { id, properties: { Room: { title: [{ plain_text: "Synthetic room" }] } } };
const bundle = { sourceDate: "2026-10-08", digest: "a".repeat(64), controls: [{ namespace, sourceDatabaseId: "synthetic", pages: [page] }] };

function database({ existing = false, corrupt = false } = {}) {
  const commands = [];
  const client = {
    release() { commands.push("RELEASE"); },
    async query(sql, args) {
      commands.push(sql);
      if (sql.includes("FOR UPDATE")) return { rows: [{ mode: "notion" }] };
      if (sql.startsWith("SELECT 1 FROM")) return { rows: existing ? [{}] : [] };
      if (sql.startsWith("SELECT payload")) return { rows: corrupt ? [] : [{ payload: page }] };
      return { rows: [] };
    },
  };
  return { commands, connect: async () => client };
}

test("the offline import activates authority only after transactional read-back", async () => {
  const db = database();
  const result = await importBundle(bundle, "synthetic-admin", db);
  assert.deepEqual(result.controls, [{ namespace, recordCount: 1, alreadyImported: false }]);
  const read = db.commands.findIndex(sql => sql.startsWith("SELECT payload"));
  const switchAuthority = db.commands.findIndex(sql => sql.startsWith("INSERT INTO crewos_cutover_state"));
  assert.ok(read > 0 && switchAuthority > read && db.commands.indexOf("COMMIT") > switchAuthority);
  assert.ok(!db.commands.some(sql => sql.startsWith("DELETE")));
});

test("an existing record or failed read-back blocks activation", async () => {
  for (const options of [{ existing: true }, { corrupt: true }]) {
    const db = database(options);
    await assert.rejects(importBundle(bundle, "synthetic-admin", db));
    assert.ok(db.commands.includes("ROLLBACK"));
    assert.ok(!db.commands.some(sql => sql.startsWith("INSERT INTO crewos_cutover_state")));
  }
});

test("the recovered namespace reads locally and an unrecovered namespace keeps its source", async () => {
  const pool = { query: async (sql, [key]) => {
    if (sql.startsWith("SELECT payload")) return { rows: [{ payload: page }] };
    return { rows: [{ mode: key === store.operationalStateKey(namespace) ? "database" : "notion" }] };
  } };
  const queryDbImpl = async source => [source];
  assert.deepEqual(await store.queryOperational(namespace, "rooms-live", undefined, undefined, { pool, queryDbImpl }), [page]);
  assert.deepEqual(await store.queryOperational("schedule", "schedule-live", undefined, undefined, { pool, queryDbImpl }), ["schedule-live"]);
});
