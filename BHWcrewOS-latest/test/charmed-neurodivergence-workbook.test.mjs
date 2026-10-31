import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resource = path.join(root, "patient-resources", "charmed-minds", "neurodivergence-workbook");
const ageFiles = ["0-5", "6-7", "8-12", "13-18", "19-29", "30-54", "55plus"].map(band => `Workbook App ${band}.dc.html`);

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
    assert.match(page, /doPrint: \(\) => window\.print\(\)/);
  }
  const printable = fs.readFileSync(path.join(resource, "Neurodivergence Self-Reflection Workbook.dc.html"), "utf8");
  assert.match(printable, /Print \/ Save PDF/);
  const support = fs.readFileSync(path.join(resource, "support.js"), "utf8");
  assert.match(support, /\.\/vendor\/react\.production\.min\.js/);
  assert.match(support, /remote JSX imports are disabled/);
  assert.doesNotMatch(support, /unpkg\.com/);
});
