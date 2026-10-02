import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CrewOS expands embedded pages inside the signed-in tab", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /function toggleEmbedExpanded/);
  assert.match(html, /view\.embed-expanded/);
  assert.match(html, /Expand stays in this signed-in CrewOS tab/);
  assert.match(html, /Condense view/);
  assert.match(html, /event\.key==="Escape"/);
});

test("CrewOS gives long charts an accessible expand and condense control", async () => {
  const [html, controls, careManagement] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../assets/bhw-long-chart-controls.js", import.meta.url), "utf8"),
    readFile(new URL("../bhw-care-management.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /bhw-long-chart-controls\.js/);
  assert.match(html, /BHWLongCharts\?\.install\(document\)/);
  assert.match(html, /BHWLongCharts\?\.install\(f\.contentDocument\)/);
  assert.match(controls, /const MIN_ROWS = 8/);
  assert.match(controls, /const MIN_COLUMNS = 7/);
  assert.match(controls, /table,\[data-long-chart\]/);
  assert.match(controls, /Expand chart/);
  assert.match(controls, /Condense chart/);
  assert.match(controls, /aria-expanded/);
  assert.match(controls, /aria-controls/);
  assert.match(controls, /MutationObserver/);
  assert.match(controls, /event\.key!=="Escape"/);
  assert.match(controls, /thead th/);
  assert.match(careManagement, /class="days" data-long-chart/);
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
