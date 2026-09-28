import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authenticated CrewHQ pages receive a shared Back and CrewHQ control", async () => {
  const [gate, workflow] = await Promise.all([
    readFile(new URL("../crew-provider-gate.js", import.meta.url), "utf8"),
    readFile(new URL("../provider/workflow.html", import.meta.url), "utf8"),
  ]);
  assert.match(gate, /installSystemNavigation/);
  assert.match(gate, /data-system-nav="back"/);
  assert.match(gate, /data-system-nav="home"/);
  assert.match(gate, /⌂ CrewHQ/);
  assert.match(gate, /href="\/hq\.html"/);
  assert.match(gate, /bhw_crewhq_navigation_v1/);
  assert.match(gate, /rememberPage/);
  assert.match(gate, /returnToPreviousPage/);
  assert.match(gate, /document\.referrer/);
  assert.match(gate, /location\.assign\(target\)/);
  assert.match(gate, /location\.assign\("\/hq\.html"\)/);
  assert.match(gate, /@media print/);
  assert.match(workflow, /crew-provider-gate\.js/);
  assert.doesNotMatch(workflow, /auth-gate\.js/);
});
