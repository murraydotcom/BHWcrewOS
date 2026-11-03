import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resource = path.join(root, "patient-resources", "charmed-minds", "neurodivergence-workbook");
const ageFiles = ["0-5", "6-7", "8-12", "13-18", "19-29", "30-54", "55plus"].map(band => `Workbook App ${band}.dc.html`);
const require = createRequire(import.meta.url);
const assignment = require(path.join(root, "assets", "bhw-neurodivergence-assignment.js"));

test("CrewOS publishes the complete CharmEd Minds workbook bundle", () => {
  for (const file of ["index.html", ...ageFiles, "Neurodivergence Self-Reflection Workbook.dc.html", "support.js", "workbook-data.js", "workbook-bands.js", "workbook-choices.js", "workbook-icons.js", "doc-page.js", "vendor/react.production.min.js", "vendor/react-dom.production.min.js"]) {
    assert.equal(fs.existsSync(path.join(resource, file)), true, `${file} is missing`);
  }
});

test("workbook keeps all seven age bands, local autosave, and PDF export", () => {
  const index = fs.readFileSync(path.join(resource, "index.html"), "utf8");
  for (const file of ageFiles) assert.match(index, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const file of ageFiles) {
    const page = fs.readFileSync(path.join(resource, file), "utf8");
    assert.match(page, /localStorage\.setItem/);
    assert.match(page, /ndwb-v2-/);
    assert.match(page, /new URLSearchParams\(location\.hash\.slice\(1\)\)/);
    assert.match(page, /Preview only — entries are not saved/);
    assert.match(page, /if \(this\.key\).*localStorage\.setItem/);
    assert.doesNotMatch(page, /this\.key = 'ndwb-' \+ BAND/);
    assert.match(page, /doPrint: \(\) => window\.print\(\)/);
  }
  const printable = fs.readFileSync(path.join(resource, "Neurodivergence Self-Reflection Workbook.dc.html"), "utf8");
  assert.match(printable, /Print \/ Save PDF/);
  const support = fs.readFileSync(path.join(resource, "support.js"), "utf8");
  assert.match(support, /\.\/vendor\/react\.production\.min\.js/);
  assert.match(support, /remote JSX imports are disabled/);
  assert.doesNotMatch(support, /unpkg\.com/);
});

test("all age-specific workbook scripts compile after private-resume isolation", () => {
  for (const file of ageFiles) {
    const page = fs.readFileSync(path.join(resource, file), "utf8");
    const match = page.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/i);
    assert.ok(match, `${file} data script is missing`);
    assert.doesNotThrow(() => new vm.Script(match[1]), `${file} data script must compile`);
  }
});

test("private resume storage is deterministic per assignment and never exposes its capability to the iframe", async () => {
  const first = await assignment.privateResumeScope("synthetic-assignment-a", "synthetic-capability-a", webcrypto);
  const repeated = await assignment.privateResumeScope("synthetic-assignment-a", "synthetic-capability-a", webcrypto);
  const anotherAssignment = await assignment.privateResumeScope("synthetic-assignment-b", "synthetic-capability-a", webcrypto);
  const anotherCapability = await assignment.privateResumeScope("synthetic-assignment-a", "synthetic-capability-b", webcrypto);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, anotherAssignment);
  assert.notEqual(first, anotherCapability);

  const workbook = assignment.workbookUrl("8-12", first);
  const index = assignment.workbookIndexUrl(first);
  assert.equal(new URL(workbook, "https://crewhq.bhwmedical.org").hash, `#resume=${first}`);
  assert.equal(new URL(index, "https://crewhq.bhwmedical.org").hash, `#resume=${first}`);
  assert.doesNotMatch(workbook, /synthetic-assignment|synthetic-capability/);
  assert.doesNotMatch(index, /synthetic-assignment|synthetic-capability/);
  assert.throws(() => assignment.workbookUrl("8-12", "not-a-safe-scope"), /resume scope is invalid/);
});

test("assignment helper supports every exact workbook age band and existing file", () => {
  assert.deepEqual(assignment.AGE_BANDS.map(({ id }) => id), ["0-5", "6-7", "8-12", "13-18", "19-29", "30-54", "55+"]);
  for (const band of assignment.AGE_BANDS) {
    assert.equal(fs.existsSync(path.join(resource, band.file)), true, `${band.id} workbook file is missing`);
    assert.equal(assignment.getAgeBand(band.id)?.label, band.label);
    assert.match(assignment.workbookUrl(band.id), /^\/patient-resources\/charmed-minds\/neurodivergence-workbook\/Workbook%20App%20/);
  }
});

test("private assignment link opens the selected version and records optional adjustment", () => {
  const base = "https://crewhq.bhwmedical.org/bhw-neurodivergence-workbook.html?assignment=synthetic-assignment&token=synthetic-token";
  const adjusted = new URL(assignment.addSelectionToPatientLink(base, "8-12", true));
  assert.equal(adjusted.searchParams.get("assignment"), "synthetic-assignment");
  assert.equal(adjusted.searchParams.get("token"), "synthetic-token");
  assert.equal(adjusted.searchParams.get("ageBand"), "8-12");
  assert.equal(adjusted.searchParams.get("adjustAge"), "1");
  assert.equal(assignment.selectionFromSearch(adjusted.search).band.id, "8-12");
  assert.equal(assignment.selectionFromSearch(adjusted.search).allowAdjustment, true);

  const fixed = new URL(assignment.addSelectionToPatientLink(base, "55+", false));
  assert.equal(fixed.searchParams.get("ageBand"), "55+");
  assert.equal(fixed.searchParams.get("adjustAge"), "0");
  assert.equal(assignment.assignedTitle("Reflection workbook", "55+"), "Reflection workbook — Ages 55+");
  assert.throws(() => assignment.addSelectionToPatientLink(base, "adult", true), /supported workbook age band/);
  assert.throws(() => assignment.addSelectionToPatientLink("http://example.test/private", "19-29", true), /must use HTTPS/);
  assert.throws(() => assignment.addSelectionToPatientLink("https://example.test/private", "19-29", true), /approved CrewHQ origin/);
  assert.throws(() => assignment.assignedTitle("x".repeat(200), "0-5"), /Shorten the workbook assignment title/);
});
