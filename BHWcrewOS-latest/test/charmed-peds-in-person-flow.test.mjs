import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const action = fs.readFileSync(path.join(root, "netlify", "functions", "action.js"), "utf8");
const opsData = fs.readFileSync(path.join(root, "netlify", "functions", "ops-data.js"), "utf8");

test("CharmEd pediatric workflow has a separate seventh in-person step", () => {
  assert.match(html, /CharmEd Minds Peds Assessment Wizard \(7 steps/);
  assert.match(html, /Step \$\{CM\.step\+1\} of 7/);
  assert.match(html, /\{t:"Send Before Visit"/);
  assert.match(html, /\{t:"In-Person Screening Visit"/);
  assert.match(html, /\{t:"Results & Recommendations"/);
});
test("send-before-visit list excludes supervised performance measures", () => {
  const remoteStart = html.indexOf('{t:"Send Before Visit"');
  const inPersonStart = html.indexOf('{t:"In-Person Screening Visit"');
  assert.ok(remoteStart > -1 && inPersonStart > remoteStart);
  const remoteStep = html.slice(remoteStart, inPersonStart);
  for (const tool of ["DIAL-4", "RAN / RAS", "CTOPP-2", "FAW Screening Form", "Handwriting sample", "NIH Toolbox"]) {
    assert.doesNotMatch(remoteStep, new RegExp(tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(remoteStep, /CLDQ Parent/);
  assert.match(remoteStep, /HPSQ Teacher/);
});

test("in-person step covers learning, dyslexia, dysgraphia, math, and referral routes", () => {
  for (const expected of [
    "Shaywitz DyslexiaScreen",
    "FAW Screening Form",
    "Nessy Number Sense",
    "Dynamo Maths",
    "THS-R handwriting evaluation",
    "DASH-2 handwriting-speed evaluation",
    "Psychoeducational / neuropsychological evaluation",
  ]) assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /screening risk, not a learning-disorder diagnosis/);
});

test("server refuses to email pediatric supervised measures", () => {
  assert.match(action, /kind === "peds"/);
  assert.match(action, /In-person or performance measures cannot be emailed/);
  assert.match(action, /DIAL-4\|Shaywitz\|DIBELS/);
  assert.match(action, /charmed\/screening-invitations/);
  assert.match(action, /Patient 360/);
  assert.match(action, /screenings:\s*screeners/);
  assert.doesNotMatch(action, /RESEND_API_KEY|api\.resend\.com/);
});

test("screening need queues are created before the send step and remain staff approved", () => {
  assert.match(html, /CM\.step===3 && !CM\.answers\[4\]\.screeners/);
  assert.match(html, /CMA\.step===4 && !CMA\.answers\[5\]\.screeners/);
  assert.match(html, /const statusByStep = \{4:"Screeners Pending"/);
  assert.match(html, /Why this review was triggered/);
  assert.match(html, /Approve & send selected links/);
  assert.match(html, /Verify your CrewOS PIN to send/);
  assert.match(html, /const CM_REMOTE_SCREENERS = new Set\(\["AQ-10", "RAADS-14", "ASRS", "PHQ-9", "GAD-7"\]\)/);
  assert.match(html, /Not available for remote send/);
  assert.match(html, /Licensed, provider-administered, or unavailable tools stay blocked/);
  assert.doesNotMatch(html, /auto(?:matically)?[^\n]{0,40}send/i);
});

test("save adapter stores all seven steps in the protected Cloud assessment", () => {
  assert.match(action, /saveCloudCharmedAssessment/);
  assert.match(action, /const answerCount = kind === "adult" \? 6 : 7/);
  assert.match(action, /answers\[5\] = workflowAnswers\.inPerson/);
  assert.match(action, /answers\[6\] = workflowAnswers\.results/);
  assert.match(action, /\/v1\/charmed\/assessments/);
  assert.match(opsData, /cloudRequest\("\/v1\/charmed\/assessments"/);
  assert.doesNotMatch(opsData, /queryDb\(DB\.charmed\)/);
});
