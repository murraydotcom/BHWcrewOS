import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("CrewOS inline scripts compile with the shared Patient Registry picker", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length >= 1);
  for (const source of scripts) assert.doesNotThrow(() => new Function(source));
  assert.match(html, /href="\/provider\/patient-registry\.html">Patient Registry<\/a>/);
  assert.match(html, /function enhancePatientPicker\(\)/);
});

test("CrewHQ exposes the protected Patient Registry as a first-class tool", async () => {
  const hq = await readFile(new URL("../hq.html", import.meta.url), "utf8");
  const registry = await readFile(new URL("../provider/patient-registry.html", import.meta.url), "utf8");
  assert.match(hq, /name:'Patient Registry'.*href:'\/provider\/patient-registry\.html'/s);
  assert.match(registry, /href="\/crewos">← CrewOS<\/a>/);
  assert.match(registry, /href="\/hq">BHW HQ<\/a>/);
});
