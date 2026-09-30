import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const careImport = require("../netlify/functions/care-log-import.js")._test;
const careDue = require("../netlify/functions/care-due-data.js")._test;
const careLogData = require("../netlify/functions/care-log-data.js")._test;

test("monthly care-log preparation recognizes every care-management program shown in CrewOS", () => {
  assert.deepEqual(careImport.normalizedPrograms([
    "Chronic Care Management", "APCM", "Principal Care Management", "Remote Patient Monitoring", "RTM",
    "Behavioral Health Integration", "Collaborative Care", "Community Health Integration",
    "Principal Illness Navigation", "Principal Illness Navigation Peer Support", "CharmEd Minds",
  ]), ["CCM", "APCM", "PCM", "RPM", "RTM", "BHI", "COCM", "CHI", "PIN-PS", "PIN", "CHARMED MINDS"]);
});

test("recent monthly enrollment is recovered for no more than two months", () => {
  const recent = careImport.recentPrograms([
    { bhwPatientId: "BHW0001", program: "BHI", type: "Monthly", serviceMonth: "2026-08-01" },
    { bhwPatientId: "BHW0002", program: "RPM", type: "Monthly", serviceMonth: "2026-07-01" },
    { bhwPatientId: "BHW0003", program: "CCM", type: "Monthly", serviceMonth: "2026-06-01" },
    { bhwPatientId: "BHW0004", program: "TCM", type: "Episode", serviceMonth: "2026-08-01" },
  ], "2026-09");
  assert.deepEqual([...recent.get("BHW0001")], ["BHI"]);
  assert.deepEqual([...recent.get("BHW0002")], ["RPM"]);
  assert.equal(recent.has("BHW0003"), false);
  assert.equal(recent.has("BHW0004"), false);
});

test("monthly preparation records governed roster evidence without treating recovered history as current enrollment", () => {
  assert.deepEqual(careImport.rosterEvidence(new Set(["CCM"]), new Set(), "CCM", "2026-09-01"), {
    source: "patient-registry", program: "CCM", effectiveMonth: "2026-09-01", status: "active",
  });
  assert.deepEqual(careImport.rosterEvidence(new Set(), new Set(["RPM"]), "RPM", "2026-09-01"), {
    source: "population-health", program: "RPM", effectiveMonth: "2026-09-01", status: "active",
  });
  assert.equal(careImport.rosterEvidence(new Set(), new Set(), "BHI", "2026-09-01").status, "needs-review");
});

test("CM Due excludes fax rows without changing the shared Front Desk queue", () => {
  assert.equal(careDue.isFaxRequest({ requestType: "fax", source: "iFax" }), true);
  assert.equal(careDue.isFaxRequest({ requestType: "referral", source: "phone" }), false);
});

test("Care Management uses a rolling 30-day window and builds prior-month close gaps", async () => {
  assert.deepEqual(careLogData.monthsInWindow("2026-08-30", "2026-09-28"), ["2026-08", "2026-09"]);
  assert.equal(careLogData.previousMonth("2026-09-28"), "2026-08");
  assert.equal(careLogData.monthEnd("2026-02"), "2026-02-28");
  assert.deepEqual(careLogData.documentationGaps({ program: "TCM", status: "Open" }), [
    "activity/documentation", "TCM code/MDM level", "first contact", "visit date",
    "coverage verification", "provider review", "next follow-up", "billing hold / RCM review route",
  ]);
  const apcmGaps = careLogData.documentationGaps({
    program: "APCM", status: "Open", activities: "Monthly review",
    billingReadinessEvidence: {
      eligibilityStatus: "confirmed", consentStatus: "current", coverageStatus: "verified",
      initiatingVisitStatus: "not-required", carePlanStatus: "active", carePlanShared: true,
      assignedPerson: "Synthetic Coordinator", patientInstructionsProvided: true,
      monthlyRequirementsMet: true, providerReviewStatus: "approved", billingPath: "G0556",
    },
  });
  assert.doesNotMatch(apcmGaps.join(" "), /minute|time/);
  const ccmGaps = careLogData.documentationGaps({
    program: "CCM", minutes: 12, activities: "Synthetic coordination", nextFollowUp: "2026-09-30",
    billingReadinessEvidence: {
      eligibilityStatus: "confirmed", consentStatus: "current", coverageStatus: "verified",
      initiatingVisitStatus: "complete", carePlanStatus: "active", carePlanShared: true,
      assignedPerson: "Synthetic Coordinator", patientInstructionsProvided: true,
      monthlyRequirementsMet: true, providerReviewStatus: "approved", billingPath: "99490",
    },
  });
  assert.ok(ccmGaps.includes("20-minute threshold"));
  const rpmGaps = careLogData.documentationGaps({
    program: "RPM", minutes: 10, activities: "Synthetic device review", nextFollowUp: "2026-09-30",
    billingReadinessEvidence: {
      eligibilityStatus: "confirmed", consentStatus: "current", coverageStatus: "verified",
      initiatingVisitStatus: "not-required", carePlanStatus: "active", carePlanShared: true,
      assignedPerson: "Synthetic Coordinator", patientInstructionsProvided: true,
      monthlyRequirementsMet: true, providerReviewStatus: "approved", billingPath: "99470",
      interactiveCommunicationCompleted: false,
    },
  });
  assert.ok(rpmGaps.includes("interactive communication"));
  const governedGaps = careLogData.documentationGaps({
    program: "CCM", serviceMonth: "2026-09-01", minutes: 20, activities: "Synthetic coordination",
    nextFollowUp: "2099-10-01",
    rosterHistory: [{ program: "CCM", effectiveMonth: "2026-09-01", status: "active" }],
    billingReadinessEvidence: {
      intakeStatus: "accepted", intakeReviewedAt: "2026-09-30", intakeReviewedBy: "synthetic-care-manager",
      eligibilityStatus: "confirmed", consentStatus: "current", consentDate: "2026-01-15", consentReviewDue: "2099-01-15",
      coverageStatus: "verified", coverageCheckedAt: "2026-09-30", initiatingVisitStatus: "not-required",
      carePlanStatus: "active", carePlanShared: true, assignedPerson: "Synthetic Coordinator",
      patientInstructionsProvided: true, monthlyRequirementsMet: true, providerReviewStatus: "approved",
      providerReviewedAt: "2026-09-30", billingPath: "99490", billingHoldStatus: "ready-for-rcm-review",
    },
  });
  assert.deepEqual(governedGaps, []);
  const [page, actionSource] = await Promise.all([
    readFile(new URL("../bhw-care-management.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/action.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Rolling day-to-day tracking/);
  assert.match(page, /documentation &amp; claim close/);
  assert.match(page, /First \/ last contact/);
  assert.match(page, /Update missing items/);
  assert.match(page, /No minute threshold/);
  assert.match(page, /Code-specific device \+ time/);
  assert.match(page, /billingReadinessEvidence/);
  assert.match(page, /Governed intake and roster evidence/);
  assert.match(page, /Ready for BHW RCM review/);
  assert.doesNotMatch(page, /value="released"/);
  assert.match(actionSource, /"billingReadinessEvidence"/);
  const scripts = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});

test("Population Health and Hospital Visits share Registry identity, contact details, and TCM status", async () => {
  const [population, discharges, shell] = await Promise.all([
    readFile(new URL("../bhw-panel-performance.html", import.meta.url), "utf8"),
    readFile(new URL("../bhw-discharges.html", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /Population Health/);
  assert.doesNotMatch(shell, /Panel &amp; Discharges/);
  assert.match(population, /registryMatchForRow/);
  assert.match(population, /First Contact At/);
  assert.match(population, /Discharge Details Obtained/);
  assert.match(population, /TCM Log ID/);
  assert.match(population, /Object\.assign\(existingEvent,cloudFields\)/);
  assert.match(population, /dischargeAt:row\['Discharge Date \/ Time'\]/);
  assert.match(discharges, /registryMatch/);
  assert.match(discharges, /Connect existing patient/);
  assert.match(discharges, /TCM care-log connection/);
  assert.match(discharges, /read back from BHW Cloud/);
  for (const [name, html] of [["Population Health", population], ["Hospital Visits", discharges]]) {
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script), `${name} inline script should compile`);
  }
});
