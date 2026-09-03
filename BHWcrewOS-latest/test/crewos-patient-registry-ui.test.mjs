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
  const registryApp = await readFile(new URL("../provider/patient-registry-app.mjs", import.meta.url), "utf8");
  const workflowApp = await readFile(new URL("../provider/workflow-app.mjs", import.meta.url), "utf8");
  const transcriptionApp = await readFile(new URL("../provider/transcription-app.mjs", import.meta.url), "utf8");
  assert.match(hq, /name:'Patient Registry'.*href:'\/provider\/patient-registry\.html'/s);
  assert.match(hq, /name:'Load & Reconcile Patients'.*patient-loader\.html/s);
  assert.match(hq, /name:'Repair Patient IDs'.*patient-collision-repair\.html/s);
  assert.match(hq, /name:'Health 360 Care Plans'.*health-blueprint\.html/s);
  assert.doesNotMatch(hq, /save to Notion/);
  assert.match(registry, /href="\/crewos">← CrewOS<\/a>/);
  assert.match(registry, /href="\/hq">BHW HQ<\/a>/);
  assert.match(registry, /rcm\.bhwmedical\.org\/provider\/patient-loader\.html/);
  assert.match(registry, /rcm\.bhwmedical\.org\/provider\/patient-collision-repair\.html/);
  assert.match(registry, /rcm\.bhwmedical\.org\/provider\/health-blueprint\.html/);
  assert.match(registry, /Patient 360 — Synthetic/);
  assert.match(registryApp, /patient\.nameSuffix/);
  assert.match(registryApp, /"Suffix"/);
  assert.match(workflowApp, /patient\.nameSuffix/);
  assert.match(transcriptionApp, /patient\.nameSuffix/);
});
