import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staffPage = fs.readFileSync(path.join(root, "bhw-patient-materials.html"), "utf8");
const patientPage = fs.readFileSync(path.join(root, "bhw-patient-material-viewer.html"), "utf8");
const hqPage = fs.readFileSync(path.join(root, "hq.html"), "utf8");

function assertInlineScriptsCompile(html, fileName) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim()).filter(Boolean);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script), `${fileName} inline script ${index + 1}`));
}

test("staff page uploads private PDF or HTML materials instead of accepting a public path", () => {
  assert.match(staffPage, /id="materialFile"/);
  assert.match(staffPage, /\.pdf,\.html/);
  assert.match(staffPage, /\/v1\/materials/);
  assert.doesNotMatch(staffPage, /id="contentPath"/);
});

test("patient viewer loads the assigned document and material-specific questions", () => {
  assert.match(patientPage, /\/material\?token=/);
  assert.match(patientPage, /assignment\.questions/);
  assert.match(patientPage, /content-submissions/);
  assert.match(patientPage, /noindex,nofollow,noarchive/);
});

test("CrewHQ has a direct patient materials tile", () => {
  assert.match(hqPage, /Patient Materials & Feedback/);
  assert.match(hqPage, /href:'\/bhw-patient-materials\.html'/);
});

test("patient materials inline scripts compile", () => {
  assertInlineScriptsCompile(staffPage, "bhw-patient-materials.html");
  assertInlineScriptsCompile(patientPage, "bhw-patient-material-viewer.html");
});
