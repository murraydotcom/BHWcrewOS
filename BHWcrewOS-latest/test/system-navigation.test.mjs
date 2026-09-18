import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authenticated CrewHQ pages receive a shared Back and CrewOS Home control", async () => {
  const gate = await readFile(new URL("../crew-provider-gate.js", import.meta.url), "utf8");
  assert.match(gate, /installSystemNavigation/);
  assert.match(gate, /data-system-nav="back"/);
  assert.match(gate, /data-system-nav="home"/);
  assert.match(gate, /history\.back\(\)/);
  assert.match(gate, /sameOriginReferrer/);
  assert.match(gate, /location\.assign\("\/crewos"\)/);
  assert.match(gate, /@media print/);
});
