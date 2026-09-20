import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staff = fs.readFileSync(path.join(root, "bhw-medication-request-links.html"), "utf8");
const patient = fs.readFileSync(path.join(root, "bhw-medication-request.html"), "utf8");
const hq = fs.readFileSync(path.join(root, "hq.html"), "utf8");

function compileInline(html, name) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1].trim()).filter(Boolean);
  scripts.forEach((source, index) => assert.doesNotThrow(() => new vm.Script(source), `${name} inline script ${index + 1}`));
}

test("CrewHQ exposes the dedicated medication request link workflow", () => {
  assert.match(hq, /Medication Request Links/);
  assert.match(hq, /href:'\/bhw-medication-request-links\.html'/);
  assert.match(staff, /\.netlify\/functions\/patient-registry/);
  assert.match(staff, /bhwPatientId:'BHW0000'/);
  assert.match(staff, /TEST ONLY/);
  assert.match(staff, /contentPath:'\/bhw-medication-request\.html'/);
  assert.match(staff, /workflowType:'medication_request'/);
});

test("patient medication intake captures the minimum refill and safety context", () => {
  for (const id of ["requestType", "serviceLine", "medicationName", "strength", "directions", "pillsRemaining", "lastDose", "pharmacy", "pharmacyMessage", "sideEffects", "sameDay", "attestation"]) {
    assert.match(patient, new RegExp(`id="${id}"`));
  }
  assert.match(patient, /does not create or guarantee a prescription/i);
  assert.match(staff, /Controlled medications require prescriber review and EPCS/);
  assert.match(staff, /Carrier delivery is not confirmed/);
});

test("medication request pages use only opaque assignment links and protected Cloud routes", () => {
  assert.match(patient, /assignmentId=params\.get\('assignment'\)/);
  assert.match(patient, /token=params\.get\('token'\)/);
  assert.match(patient, /\/v1\/public\/content-submissions/);
  assert.doesNotMatch(patient, /patientName=params|get\('patient'\)|medication=params/);
  assert.match(patient, /noindex,nofollow,noarchive/);
  compileInline(staff, "bhw-medication-request-links.html");
  compileInline(patient, "bhw-medication-request.html");
});
