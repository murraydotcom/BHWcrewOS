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
const patientRegistryApp = fs.readFileSync(path.join(root, "provider", "patient-registry-app.mjs"), "utf8");
const patientRegistryPage = fs.readFileSync(path.join(root, "provider", "patient-registry.html"), "utf8");

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

test("staff page selects a verified Patient 360 record", () => {
  assert.match(staffPage, /id="patientSearch"/);
  assert.match(staffPage, /id="patientId" required/);
  assert.match(staffPage, /rcm-cloud-config/);
  assert.match(staffPage, /\/v1\/patients/);
  assert.doesNotMatch(staffPage, /value="BHW0000"/);
});

test("staff page records sent communication, supports revocation, and offers longer links", () => {
  assert.match(staffPage, /Record as sent/);
  assert.match(staffPage, /staffAttestation:true/);
  assert.match(staffPage, /\/sent`/);
  assert.match(staffPage, /\/revoke`/);
  assert.match(staffPage, /value="2160">3 months/);
  assert.match(staffPage, /value="4320">6 months/);
  assert.match(staffPage, /Carrier delivery is not yet confirmed/);
});

test("Patient 360 displays Education and Interactive Communication history", () => {
  assert.match(patientRegistryApp, /Education &amp; Interactive Communication/);
  assert.match(patientRegistryApp, /\/v1\/staff\/content-assignments\?patientId=/);
  assert.match(patientRegistryApp, /Recorded sent means a staff member attested/);
  assert.match(patientRegistryApp, /Opened and submitted are system-recorded/);
  assert.match(patientRegistryPage, /communication-panel/);
});
