import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CrewOS expands embedded pages inside the signed-in tab", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /function toggleEmbedExpanded/);
  assert.match(html, /view\.embed-expanded/);
  assert.match(html, /Expand stays in this signed-in CrewOS tab/);
  assert.match(html, /Exit expanded view/);
  assert.match(html, /event\.key==="Escape"/);
});

test("BHW Capture PWA no longer claims the whole CrewOS origin", async () => {
  const manifest = JSON.parse(await readFile(new URL("../bhw-capture.webmanifest", import.meta.url), "utf8"));
  const capture = await readFile(new URL("../bhw-capture.js", import.meta.url), "utf8");
  assert.equal(manifest.id, "/bhw-capture.html");
  assert.equal(manifest.scope, "/bhw-capture");
  assert.notEqual(manifest.scope, "/");
  assert.match(capture, /scope: "\/bhw-capture"/);
  assert.match(capture, /legacyRootScope && captureWorker \? registration\.unregister\(\)/);
});

test("Care Management exposes the protected vitals review path without duplicating clinical values", async () => {
  const html = await readFile(new URL("../bhw-care-management.html", import.meta.url), "utf8");
  assert.match(html, /Vital signs &amp; Care Connect/);
  assert.match(html, /Open clinical vitals/);
  assert.match(html, /patient-360-data\.html\?patient=/);
  assert.match(html, /Care Connect readings stay in Health Core and Patient 360/);
  assert.match(html, /should not be entered as care-log notes/);
});
