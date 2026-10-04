import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const helpers = require("../netlify/functions/care-program-enrollment.js")._test;

test("direct enrollment carries approved evidence into an active monthly row without declaring the month complete", () => {
  const evidence = helpers.enrollmentEvidence({
    id: "BHW0557:APCM",
    status: "active",
    practitionerReview: { status: "approved", reviewedAt: "2026-09-30" },
    consent: { status: "current", date: "2026-09-30", reviewDue: "2027-09-30" },
    intake: {
      coverageDuplication: { verificationStatus: "verified", checkedAt: "2026-09-30" },
      participationEducation: { patientInstructionsProvided: true },
    },
    initiatingVisit: { status: "not-required" },
    carePlan: { status: "active", shared: true },
    assignment: { assignedPerson: "Synthetic Care Manager" },
    risk: { score: 50, state: "Calculated", suggestedCadence: "Approximately every 2 weeks" },
  });
  assert.equal(evidence.enrollmentStatus, "active");
  assert.equal(evidence.intakeStatus, "accepted");
  assert.equal(evidence.eligibilityStatus, "confirmed");
  assert.equal(evidence.monthlyRequirementsMet, false);
  assert.equal(evidence.operationalRiskScore, 50);
  assert.equal(helpers.monthStart(new Date("2026-09-30T12:00:00Z")), "2026-09-01");
});

test("care-management enrollment workspace contains the complete SOP workflow and compiles", async () => {
  const [careManagement, enrollment, endpoint] = await Promise.all([
    readFile(new URL("../bhw-care-management.html", import.meta.url), "utf8"),
    readFile(new URL("../bhw-care-enrollment.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/care-program-enrollment.js", import.meta.url), "utf8"),
  ]);
  assert.match(careManagement, /\+ Intake &amp; enroll/);
  assert.match(careManagement, /Care Program Intake &amp; Enrollment/);
  assert.match(careManagement, /Prospective, active, declined, paused, and ended program records stay reviewable/);
  assert.match(careManagement, /patient-360-data\.html\?patient=/);
  assert.match(enrollment, /One Registry patient, one cumulative record per program/);
  assert.match(enrollment, /Signed-in support and care-management staff may maintain it/);
  for (const marker of [
    "Identity, referral, and communication",
    "Coverage and duplicate-service review",
    "Common intake assessment",
    "Program-specific screening branches",
    "Practitioner decision, initiating visit, and annual consent",
    "Care plan, assigned team, education, and combination review",
    "Six-domain operational risk score",
  ]) assert.match(enrollment, new RegExp(marker));
  for (const program of ["APCM", "CCM", "PCM", "BHI", "COCM", "CHI", "PIN", "PIN-PS", "RPM", "RTM"])
    assert.match(enrollment, new RegExp(`\\b${program.replace("-", "\\-")}\\b`));
  assert.match(enrollment, /Unknown stays blank and makes the score incomplete/);
  assert.match(enrollment, /Saved to BHW Cloud and read back/);
  assert.match(endpoint, /care-program-enrollments/);
  assert.match(endpoint, /if \(enrollment\.status !== "active"\) return null/);
  for (const html of [careManagement, enrollment]) {
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    scripts.forEach((source, index) => assert.doesNotThrow(() => new vm.Script(source), `inline script ${index + 1}`));
  }
});

test("program identifiers are normalized and unsupported programs fail closed", () => {
  assert.equal(helpers.normalizeProgram("cocm"), "COCM");
  assert.throws(() => helpers.normalizeProgram("TCM"), /supported care-management program/);
});

test("reserved synthetic enrollment is admin-only, explicit, and cannot activate", () => {
  assert.equal(helpers.syntheticAcceptanceAllowed({
    bhwPatientId: "BHW0000",
    record: { status: "potential" },
    session: { access: "Admin" },
    requested: true,
  }), true);
  assert.equal(helpers.syntheticAcceptanceAllowed({
    bhwPatientId: "BHW0000",
    record: { status: "active" },
    session: { access: "Admin" },
    requested: true,
  }), false);
  assert.equal(helpers.syntheticAcceptanceAllowed({
    bhwPatientId: "BHW0000",
    record: { status: "potential" },
    session: { access: "Staff" },
    requested: true,
  }), false);
});

test("synthetic patient is absent from ordinary enrollment pickers and explicit for Admin acceptance", () => {
  const careLog = require("../netlify/functions/care-log-data.js")._test;
  const roster = [{ bhwPatientId: "BHW0557", name: "Registry Patient", selectable: true }];
  assert.deepEqual(careLog.careEnrollmentPatients(roster).map((patient) => patient.bhwPatientId), ["BHW0557"]);
  assert.deepEqual(
    careLog.careEnrollmentPatients(roster, { includeSynthetic: true, access: "Admin" }).map((patient) => patient.bhwPatientId),
    ["BHW0000", "BHW0557"],
  );
  assert.deepEqual(
    careLog.careEnrollmentPatients(roster, { includeSynthetic: true, access: "Staff" }).map((patient) => patient.bhwPatientId),
    ["BHW0557"],
  );
});
