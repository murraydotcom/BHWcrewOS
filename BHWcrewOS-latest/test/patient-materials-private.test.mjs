import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staffPage = fs.readFileSync(path.join(root, "bhw-patient-materials.html"), "utf8");
const patientPage = fs.readFileSync(path.join(root, "bhw-patient-material-viewer.html"), "utf8");
const workbookPage = fs.readFileSync(path.join(root, "bhw-neurodivergence-workbook.html"), "utf8");
const previsitPage = fs.readFileSync(path.join(root, "bhw-previsit-questionnaire.html"), "utf8");
const workbookAssignment = fs.readFileSync(path.join(root, "assets", "bhw-neurodivergence-assignment.js"), "utf8");
const checkinLauncher = fs.readFileSync(path.join(root, "assets", "bhw-checkin-launcher.js"), "utf8");
const checkinPages = [
  ["primary", "/bhw-primary-care-checkin.html", "bhw-primary-care-checkin.html"],
  ["mind", "/bhw-mind-mood-checkin.html", "bhw-mind-mood-checkin.html"],
  ["charmed", "/bhw-charmed-minds-checkin.html", "bhw-charmed-minds-checkin.html"],
  ["flow", "/bhw-flow-checkin.html", "bhw-flow-checkin.html"],
].map(([program, contentPath, file]) => ({ program, contentPath, file, source: fs.readFileSync(path.join(root, file), "utf8") }));
const hqPage = fs.readFileSync(path.join(root, "hq-home.mjs"), "utf8");
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
  assert.match(patientPage, /id="ogTitle"/);
  assert.match(patientPage, /pageTitle/);
});

test("CrewHQ has a direct patient materials directory entry", () => {
  assert.match(hqPage, /Patient Materials & Feedback/);
  assert.match(hqPage, /'\/bhw-patient-materials\.html'/);
});

test("patient materials inline scripts compile", () => {
  assertInlineScriptsCompile(staffPage, "bhw-patient-materials.html");
  assertInlineScriptsCompile(patientPage, "bhw-patient-material-viewer.html");
  assertInlineScriptsCompile(workbookPage, "bhw-neurodivergence-workbook.html");
  assertInlineScriptsCompile(previsitPage, "bhw-previsit-questionnaire.html");
});

test("reviewed HTML library includes the four secure myBHW check-ins", () => {
  for (const { program, contentPath, source } of checkinPages) {
    assert.match(staffPage, new RegExp(`value="${contentPath.replaceAll(".", "\\.")}"`));
    assert.match(staffPage, new RegExp(`data-program="${program}"`));
    assert.match(source, new RegExp(`data-checkin-program="${program}"`));
    assert.match(source, new RegExp(`data-content-path="${contentPath.replaceAll(".", "\\.")}"`));
    assert.match(source, /noindex,nofollow,noarchive/);
  }
  assert.match(staffPage, /patient_checkin_\$\{libraryResource\.program\}/);
  assert.match(staffPage, /The patient must sign in/);
  assert.match(staffPage, /generating this link does not save a check-in/i);
});

test("private check-in launcher validates the assignment and never forwards its token", () => {
  assert.doesNotThrow(() => new vm.Script(checkinLauncher));
  assert.match(checkinLauncher, /\/v1\/public\/content-assignments/);
  assert.match(checkinLauncher, /data\.contentPath !== expectedPath/);
  assert.match(checkinLauncher, /https:\/\/mybhw\.com\/bhw-checkin\.html/);
  assert.match(checkinLauncher, /target\.searchParams\.set\("program", program\)/);
  assert.match(checkinLauncher, /Nothing has been submitted yet/);
  assert.doesNotMatch(checkinLauncher, /target\.searchParams\.set\((?:"|')token/);
  assert.doesNotMatch(checkinLauncher, /target\.searchParams\.set\((?:"|')assignment/);
});

test("reviewed HTML library includes the private pre-visit questionnaire", () => {
  assert.match(staffPage, /value="\/bhw-previsit-questionnaire\.html"/);
  assert.match(staffPage, /data-kind="previsit"/);
  assert.match(staffPage, /previsit_questionnaire/);
  assert.match(staffPage, /PREVISIT_QUESTIONS/);
  assert.match(staffPage, /Send 1(?:&ndash;|–)2 days before the appointment/);
  assert.match(staffPage, /document\.getElementById\('expiry'\)\.value='72'/);
  assert.match(previsitPage, /CONTENT_PATH='\/bhw-previsit-questionnaire\.html'/);
  assert.match(previsitPage, /\/v1\/public\/content-assignments/);
  assert.match(previsitPage, /\/v1\/public\/content-submissions/);
  assert.match(previsitPage, /Most people finish in about five minutes/);
  assert.match(previsitPage, /Do not wait on this form for urgent help/);
  assert.match(previsitPage, /urgentConcern/);
  assert.match(previsitPage, /patientReviewed:true/);
  assert.match(previsitPage, /preview=params\.get\('preview'\)==='1'/);
  assert.match(previsitPage, /Preview only/);
  assert.doesNotMatch(previsitPage, /recording|AI[- ]assisted transcription/i);
});

test("staff can select the reviewed CharmEd Minds workbook from the HTML library", () => {
  assert.match(staffPage, /value="library">\s*Use the reviewed HTML library/);
  assert.match(staffPage, /id="libraryMaterial"/);
  assert.match(staffPage, /value="\/bhw-neurodivergence-workbook\.html"/);
  assert.match(staffPage, /assignment\.contentPath=contentPath/);
  assert.match(staffPage, /charmed_minds_neurodivergence_workbook/);
  assert.match(staffPage, /answers remain on the patient device/i);
  assert.match(staffPage, /does not send entries back to CrewOS/i);
  assert.match(staffPage, /id="workbookAgeBand"/);
  assert.match(staffPage, /id="allowAgeAdjustment"/);
  assert.match(staffPage, /BHWNeuroWorkbook\.addSelectionToPatientLink/);
  assert.match(staffPage, /BHWNeuroWorkbook\.assignedTitle/);
  assert.match(staffPage, /id="assignmentSummary"/);
  assert.match(workbookPage, /\/v1\/public\/content-assignments/);
  assert.match(workbookPage, /data\.contentPath!==CONTENT_PATH/);
  assert.match(`${workbookPage}\n${workbookAssignment}`, /patient-resources\/charmed-minds\/neurodivergence-workbook/);
  assert.match(workbookPage, /Nothing is sent to BHW automatically/i);
  assert.match(workbookPage, /selection\.allowAdjustment/);
  assert.match(workbookPage, /BHWNeuroWorkbook\.workbookUrl/);
  assert.match(workbookPage, /BHWNeuroWorkbook\.privateResumeScope\(assignmentId,token\)/);
  assert.match(workbookPage, /same link and browser to continue/i);
  assert.match(staffPage, /another assignment link cannot load those entries/i);
});

test("workbook remains voluntary and does not expose an unverified PHI upload", () => {
  assert.match(staffPage, /optional personal journaling, not a formal intake or assessment/i);
  assert.match(staffPage, /Voluntary PDF return is not enabled online/i);
  assert.match(workbookPage, /Optional personal journaling — not a clinical intake or assessment/i);
  assert.match(workbookPage, /Secure online PDF return is not enabled through this link/i);
  assert.doesNotMatch(workbookPage, /type=["']file["']/i);
  assert.doesNotMatch(workbookPage, /content-submissions/);
});

test("staff page selects a verified Patient 360 record", () => {
  assert.match(staffPage, /id="patientSearch"/);
  assert.match(staffPage, /id="patientId" required/);
  assert.match(staffPage, /\/\.netlify\/functions\/patient-registry/);
  assert.match(staffPage, /JSON\.stringify\(\{action:'list'\}\)/);
  assert.doesNotMatch(staffPage, /rcm-cloud-config/);
  assert.doesNotMatch(staffPage, /value="BHW0000"/);
  assert.match(staffPage, /assignment=\{patientId,title:storedTitle/);
  assert.match(staffPage, /Bound to verified Patient 360 ID/);
});

test("existing response routing remains in Patient Materials & Feedback staff review", () => {
  assert.match(staffPage, /\/v1\/staff\/content-submissions\?limit=50/);
  assert.match(staffPage, /\/v1\/staff\/content-submissions\/\$\{encodeURIComponent\(id\)\}\/review/);
  assert.match(staffPage, /Mark reviewed/);
  assert.doesNotMatch(workbookPage, /chart|formal assessment completed/i);
});

test("staff page records sent communication, supports revocation, and offers longer links", () => {
  assert.match(staffPage, /Record as sent/);
  assert.match(staffPage, /staffAttestation:true/);
  assert.match(staffPage, /\/sent`/);
  assert.match(staffPage, /\/revoke`/);
  assert.match(staffPage, /value="2160">3 months/);
  assert.match(staffPage, /value="4320">6 months/);
  assert.match(staffPage, /Carrier delivery is not yet confirmed/);
  assert.match(staffPage, /id="patientMessage"/);
  assert.match(staffPage, /buildPatientMessage/);
  assert.match(staffPage, /Copy message with link/);
});

test("Patient 360 displays Education and Interactive Communication history", () => {
  assert.match(patientRegistryApp, /Education &amp; Interactive Communication/);
  assert.match(patientRegistryApp, /\/v1\/staff\/content-assignments\?patientId=/);
  assert.match(patientRegistryApp, /Recorded sent means a staff member attested/);
  assert.match(patientRegistryApp, /Opened and submitted are system-recorded/);
  assert.match(patientRegistryPage, /communication-panel/);
});
