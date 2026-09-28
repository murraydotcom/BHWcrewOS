import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { evaluateCareBillingReadiness } = require("../netlify/functions/lib/care-billing-readiness.js");

const patient = { bhwPatientId: "BHW0000", patientStatus: "active", selectable: true, coverageStatus: "verified" };
const completeEvidence = {
  eligibilityStatus: "confirmed",
  consentStatus: "current",
  consentDate: "2026-01-15",
  coverageStatus: "verified",
  initiatingVisitStatus: "complete",
  carePlanStatus: "active",
  carePlanShared: true,
  assignedPerson: "Synthetic Care Manager",
  patientInstructionsProvided: true,
  monthlyRequirementsMet: true,
  providerReviewStatus: "approved",
  providerReviewedAt: "2026-09-30",
};

test("APCM readiness is not blocked by a minute threshold", () => {
  const result = evaluateCareBillingReadiness({
    program: "APCM", minutes: 0, activities: "Synthetic coordination", status: "Open",
    billingReadinessEvidence: { ...completeEvidence, coverageStatus: "unknown" },
  }, patient);
  assert.equal(result.state, "ready");
  assert.equal(result.timeBased, false);
  assert.ok(result.passed.includes("Coverage verified"));
  assert.doesNotMatch(result.passed.join(" "), /20 qualifying minutes/);
});

test("missing evidence lights a row as incomplete with exact reasons", () => {
  const result = evaluateCareBillingReadiness({
    program: "CCM", minutes: 5, activities: "", status: "Open",
    billingReadinessEvidence: { requiredMinutes: 1 },
  }, patient);
  assert.equal(result.state, "incomplete");
  assert.ok(result.missing.includes("Program eligibility confirmation"));
  assert.ok(result.missing.includes("20 qualifying minutes (5 recorded)"));
  assert.ok(result.missing.includes("Active program care plan"));
});

test("declined consent and inactive coverage block billing", () => {
  const result = evaluateCareBillingReadiness({
    program: "BHI", minutes: 20, activities: "Synthetic follow-up", status: "Open",
    billingReadinessEvidence: { ...completeEvidence, consentStatus: "declined", coverageStatus: "inactive" },
  }, patient);
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.some((item) => item.includes("consent")));
  assert.ok(result.blockers.includes("Active payer coverage"));
});

test("RPM requires explicit code thresholds, device data, and interaction evidence", () => {
  const result = evaluateCareBillingReadiness({
    program: "RPM", minutes: 10, activities: "Reviewed synthetic data", status: "Open",
    billingReadinessEvidence: { ...completeEvidence, requiredMinutes: 10, requiredDeviceDays: 2, deviceDataDays: 1 },
  }, patient);
  assert.equal(result.state, "incomplete");
  assert.ok(result.missing.includes("2 device-data days (1 recorded)"));
  assert.ok(result.missing.includes("Required interactive communication"));
});

test("Care Management renders readiness colors and no APCM minute warning", async () => {
  const html = await readFile(new URL("../bhw-care-management.html", import.meta.url), "utf8");
  assert.match(html, /amber rows are missing information/);
  assert.match(html, /readiness-incomplete/);
  assert.match(html, /Save requirements to BHW Cloud/);
  assert.match(html, /APCM is evaluated without a minute threshold/);
  assert.doesNotMatch(html, /under 20 min/i);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});
