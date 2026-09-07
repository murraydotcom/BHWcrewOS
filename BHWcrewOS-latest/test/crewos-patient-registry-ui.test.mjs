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

test("every CrewOS workflow picker submits the canonical BHW Registry ID", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const helperSource = html.match(/function patientPickerValue\(p\)\{\s*return String\(p\?\.bhwId\|\|p\?\.id\|\|""\)\.trim\(\);\s*\}/)?.[0];
  assert.ok(helperSource);
  const patientPickerValue = new Function(`${helperSource}; return patientPickerValue;`)();
  assert.equal(patientPickerValue({ id: "legacy-index-id", bhwId: "BHW0000" }), "BHW0000");
  assert.equal(patientPickerValue({ id: "legacy-index-id" }), "legacy-index-id");
  assert.match(html, /<option value="\$\{esc\(patientPickerValue\(p\)\)\}"/);
  assert.match(html, /matches\.some\(p=>patientPickerValue\(p\)===selected\)/);
  assert.match(html, /find\(item=>patientPickerValue\(item\)===s\.value\)/);
  assert.match(html, /npSelectInPicker\(patientPickerValue\(existing\),/);
});

test("CrewHQ keeps patient maintenance tools inside the protected Patient Registry", async () => {
  const hq = await readFile(new URL("../hq.html", import.meta.url), "utf8");
  const registry = await readFile(new URL("../provider/patient-registry.html", import.meta.url), "utf8");
  const registryApp = await readFile(new URL("../provider/patient-registry-app.mjs", import.meta.url), "utf8");
  const workflowApp = await readFile(new URL("../provider/workflow-app.mjs", import.meta.url), "utf8");
  const transcriptionApp = await readFile(new URL("../provider/transcription-app.mjs", import.meta.url), "utf8");
  assert.match(hq, /name:'Patient Registry'.*href:'\/provider\/patient-registry\.html'/s);
  assert.doesNotMatch(hq, /name:'Load & Reconcile Patients'/);
  assert.doesNotMatch(hq, /name:'Repair Patient IDs'/);
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
  assert.match(registryApp, /Care Connect pilot access/);
  assert.match(registryApp, /Adult Primary Care pilot/);
  assert.match(registryApp, /proxy and guardian access disabled/i);
  assert.match(registryApp, /invitationPreview/);
  assert.match(registryApp, /No invitation was sent/);
  assert.match(registryApp, /portalAccessStatus/);
  assert.match(workflowApp, /patient\.nameSuffix/);
  assert.match(transcriptionApp, /patient\.nameSuffix/);
});

test("CrewOS and Front Desk patient lists keep Cloud identity, suffix, and status together", async () => {
  const files = await Promise.all([
    "bhw-front-desk.html", "bhw-documents.html", "bhw-paperwork.html",
    "bhw-careplan.html", "bhw-crewcare-portal.html",
  ].map(async (name) => [name, await readFile(new URL(`../${name}`, import.meta.url), "utf8")]));
  const source = Object.fromEntries(files);

  for (const [name, html] of files) {
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script), `${name} inline script should compile`);
  }

  assert.match(source["bhw-front-desk.html"], /m\.status&&m\.status!=='active'/);
  assert.match(source["bhw-documents.html"], /m\.ctl.*m\.status&&m\.status!=='active'/);
  assert.match(source["bhw-paperwork.html"], /patientChoice\(p\).*p\.bhwId/s);
  assert.match(source["bhw-paperwork.html"], /p\.selectable===false/);
  assert.match(source["bhw-careplan.html"], /patientChoice\(p\).*p\.bhwId/s);
  assert.match(source["bhw-careplan.html"], /p\.selectable===false/);
  assert.match(source["bhw-crewcare-portal.html"], /patient\.selectable===false/);
  assert.match(source["bhw-crewcare-portal.html"], /patient\.bhwId/);
});
