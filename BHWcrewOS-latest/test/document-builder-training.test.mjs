import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = fs.readFileSync(path.join(root, "bhw-documents.html"), "utf8");
const guide = fs.readFileSync(path.join(root, "bhw-staff-guide.html"), "utf8");

function compileInlineScripts(html, fileName) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim()).filter(Boolean);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source), `${fileName} inline script ${index + 1}`);
  });
}

test("Document Builder exposes the template library and role-based practice guide", () => {
  assert.match(builder, /id="templateLibraryBtn"/);
  assert.match(builder, /id="guidePracticeBtn"/);
  assert.match(builder, /id="templateRoleFilter"/);
  assert.match(builder, /id="trainingRoleSelect"/);
  assert.match(builder, /synthetic patient <strong>BHW0000<\/strong>/);
  assert.match(builder, /Using a template never sends or saves a document/i);
  assert.match(builder, /This creates a local file only/i);
});

test("template library covers the requested BHW document scenarios", () => {
  for (const id of [
    "weekly_checkin_medication",
    "mental_health_checkin",
    "after_visit_summary",
    "home_vitals_tracker",
    "care_team_questions",
    "symptom_trigger_tracker",
    "care_coordination_followup",
    "appointment_preparation"
  ]) {
    assert.match(builder, new RegExp(`id: "${id}"`));
  }
  assert.match(builder, /\[PASTE THE EXPIRING PRIVATE LINK HERE\]/);
  assert.match(builder, /does not create, renew, or guarantee a prescription/i);
  assert.match(builder, /not a diagnostic or validated screening instrument/i);
  assert.match(builder, /Do not invent alert thresholds/i);
  assert.match(builder, /https:\\\/\\\//);
  assert.doesNotMatch(builder, /Private medication-request link:\s*https:\/\/[^\[]/i);
});

test("all six BHW roles have a bounded synthetic assignment and pass criteria", () => {
  for (const role of ["front_desk", "medical_assistant", "care_coordination", "behavioral_health", "provider", "billing_operations"]) {
    assert.match(builder, new RegExp(`${role}: \\{[\\s\\S]*?boundary:[\\s\\S]*?assignment:[\\s\\S]*?pass:`));
  }
  assert.match(builder, /Pass only when every item is correct/);
  assert.match(builder, /Do not use a real name, birth date, diagnosis, medication, contact detail, or private patient link/);
});

test("staff guide is the printable authoritative SOP for document creation", () => {
  assert.match(guide, /id="document-builder-training"/);
  assert.match(guide, /Process flow:/);
  assert.match(guide, /Who owns each step/);
  assert.match(guide, /Role-specialized synthetic practice/);
  assert.match(guide, /Trainer sign-off:/);
  assert.match(guide, /Generated means not yet recorded as sent/);
  assert.match(guide, /Pass only when every safety item is correct/);
});

test("Document Builder inline scripts compile", () => {
  compileInlineScripts(builder, "bhw-documents.html");
});
