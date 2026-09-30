import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const sop = read("bhw-care-program-sop.html");
const index = read("index.html");
const hq = read("hq.html");
const guide = read("bhw-staff-guide.html");
const careLog = read("bhw-care-management.html");

test("care-program SOP is protected, searchable, printable, and downloadable", () => {
  assert.match(sop, /<script src="\/crew-provider-gate\.js"><\/script>/);
  assert.match(sop, /id="sopSearch"/);
  assert.match(sop, /Print \/ Save PDF/);
  assert.match(sop, /BHW_Care_Program_Intake_Enrollment_SOP_2026\.docx/);
  assert.match(sop, /Current CMS and payer rules, the treating practitioner, and BHW RCM remain controlling/);
  assert.doesNotMatch(sop, /file:\/\//i);
  assert.ok(fs.statSync(path.join(root, "docs", "BHW_Care_Program_Intake_Enrollment_SOP_2026.docx")).size > 4_000_000);
});

test("SOP contains the full intake, care-plan, readiness, risk, and fee reference", () => {
  for (const marker of [
    "Care Program Intake and Enrollment Workflow",
    "Required patient program record",
    "Whole Person Care Plan standard",
    "Monthly activity documentation and status lights",
    "Program combinations and duplicate billing safeguards",
    "Program Readiness Checklist",
    "2026 Medicare Fee Schedule Reference",
    "Operational Risk Score and CrewOS Implementation"
  ]) assert.match(sop, new RegExp(marker, "i"));

  for (const program of ["APCM", "CCM", "PCM", "General BHI", "CoCM", "CHI", "PIN", "RPM", "RTM", "TCM"])
    assert.match(sop, new RegExp(program));

  assert.match(sop, /G0556/);
  assert.match(sop, /99490/);
  assert.match(sop, /99495/);
  assert.match(sop, /Codes 98978 and 98986 do not appear with a standard amount/);
  assert.match(sop, /https:\/\/www\.cms\.gov\/medicare\/payment\/fee-schedules\/physician\/care-management/);
});

test("CrewOS exposes the SOP from the rail, HQ, Staff Guide, and Care Management Log", () => {
  assert.match(index, /data-view="pg-care-sop"/);
  assert.match(index, /src:"\/bhw-care-program-sop\.html"/);
  assert.match(hq, /name:'Care Program SOP'[\s\S]*?href:'\/bhw-care-program-sop\.html'/);
  assert.match(guide, /id="care-program-sop"/);
  assert.match(guide, /Closed work stays reviewable/);
  assert.match(careLog, /href="\/bhw-care-program-sop\.html"/);
});

test("care-program SOP inline scripts compile", () => {
  const scripts = [...sop.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim()).filter(Boolean);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source), `inline script ${index + 1}`);
  });
});
