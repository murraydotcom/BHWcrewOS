const AUTOMATED_PROGRAMS = new Set(["APCM", "CCM", "PCM", "BHI", "COCM", "CHI", "PIN", "RPM", "RTM"]);

const BASE_MINUTES = Object.freeze({
  CCM: 20,
  PCM: 30,
  BHI: 20,
  CHI: 60,
  PIN: 60,
});

function normalizedProgram(value) {
  return String(value || "").trim().toUpperCase();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function evaluateCareBillingReadiness(log = {}, patient = null) {
  const program = normalizedProgram(log.program);
  const evidence = log.billingReadinessEvidence || {};
  const blockers = [];
  const missing = [];
  const passed = [];
  const pass = (label) => passed.push(label);
  const miss = (label) => missing.push(label);
  const block = (label) => blockers.push(label);

  if (!patient) block("Patient Registry connection");
  else {
    const patientStatus = String(patient.patientStatus || patient.status || "").toLowerCase();
    if (patient.selectable === false || ["inactive", "prospective", "transferred", "deceased", "test"].includes(patientStatus)) {
      block(`Active Patient Registry status (${patientStatus || "not selectable"})`);
    } else pass("Patient Registry connection");
  }

  const recordedCoverageStatus = String(evidence.coverageStatus || "").toLowerCase();
  const coverageStatus = recordedCoverageStatus && recordedCoverageStatus !== "unknown"
    ? recordedCoverageStatus
    : String(patient?.coverageStatus || "unknown").toLowerCase();
  if (coverageStatus === "verified") pass("Coverage verified");
  else if (coverageStatus === "inactive") block("Active payer coverage");
  else miss("Verified payer coverage");

  const eligibility = String(evidence.eligibilityStatus || "potential").toLowerCase();
  if (eligibility === "confirmed") pass("Program eligibility confirmed");
  else if (eligibility === "not-eligible") block("Program eligibility");
  else miss("Program eligibility confirmation");

  const consent = String(evidence.consentStatus || "missing").toLowerCase();
  if (consent === "current" && evidence.consentDate) pass("Program consent on record");
  else if (["declined", "revoked"].includes(consent)) block(`Program consent (${consent})`);
  else miss("Current program consent and date");

  if (["complete", "not-required"].includes(String(evidence.initiatingVisitStatus || "").toLowerCase())) pass("Initiating visit requirement");
  else miss("Initiating visit or not-required determination");

  if (String(evidence.carePlanStatus || "").toLowerCase() === "active") pass("Active care plan");
  else miss("Active program care plan");
  if (evidence.carePlanShared === true) pass("Care plan shared with patient/caregiver");
  else miss("Care-plan copy shared with patient/caregiver");

  if (String(evidence.assignedPerson || "").trim()) pass("Assigned care-team person");
  else miss("Assigned care-team person");
  if (evidence.patientInstructionsProvided === true) pass("Program and urgent-contact instructions reviewed");
  else miss("Program and urgent-contact instructions");

  if (!AUTOMATED_PROGRAMS.has(program)) {
    miss("Program-specific manual billing review");
  } else {
    if (String(log.activities || "").trim()) pass("Patient-specific activity documentation");
    else miss("Patient-specific activity documentation");
    if (evidence.monthlyRequirementsMet === true) pass("Monthly program elements confirmed");
    else miss("Monthly program elements confirmation");

    let requiredMinutes = number(evidence.requiredMinutes);
    let timeBased = program !== "APCM";
    const billingPath = String(evidence.billingPath || "").toLowerCase();
    if (["BHI", "COCM"].includes(program) && billingPath === "apcm-addon") timeBased = false;
    if (program === "COCM" && billingPath !== "apcm-addon") {
      if (billingPath === "cocm-initial") requiredMinutes = Math.max(requiredMinutes, 70);
      else if (billingPath === "cocm-subsequent") requiredMinutes = Math.max(requiredMinutes, 60);
      else if (billingPath === "cocm-30") requiredMinutes = Math.max(requiredMinutes, 30);
      else miss("CoCM monthly billing pathway");
    } else if (timeBased && BASE_MINUTES[program]) {
      requiredMinutes = Math.max(requiredMinutes, BASE_MINUTES[program]);
    }

    if (!timeBased) pass("No monthly minute threshold for selected pathway");
    else if (!requiredMinutes && ["RPM", "RTM"].includes(program)) miss("Payer/code minute requirement");
    else if (number(log.minutes) >= requiredMinutes) pass(`${requiredMinutes} qualifying minutes`);
    else miss(`${requiredMinutes} qualifying minutes (${number(log.minutes)} recorded)`);

    if (["RPM", "RTM"].includes(program)) {
      const requiredDeviceDays = number(evidence.requiredDeviceDays);
      if (!requiredDeviceDays) miss("Payer/code device-data-day requirement");
      else if (number(evidence.deviceDataDays) >= requiredDeviceDays) pass(`${requiredDeviceDays} device-data days`);
      else miss(`${requiredDeviceDays} device-data days (${number(evidence.deviceDataDays)} recorded)`);
      if (evidence.interactiveCommunicationCompleted === true) pass("Required interactive communication");
      else miss("Required interactive communication");
    }
  }

  const providerReview = String(evidence.providerReviewStatus || "pending").toLowerCase();
  if (providerReview === "approved" && evidence.providerReviewedAt) pass("Provider monthly review");
  else if (providerReview === "held") block("Provider placed billing on hold");
  else miss("Provider monthly review and date");

  if (String(log.status || "").toLowerCase() === "billed" && (blockers.length || missing.length)) {
    block("Billed status conflicts with incomplete evidence");
  }

  const state = blockers.length ? "blocked" : missing.length ? "incomplete" : "ready";
  return {
    state,
    label: state === "ready" ? "Billing ready" : state === "blocked" ? "Blocked" : `${missing.length} missing`,
    blockers,
    missing,
    passed,
    timeBased: program === "APCM" ? false : !(["BHI", "COCM"].includes(program) && String(evidence.billingPath || "").toLowerCase() === "apcm-addon"),
  };
}

module.exports = { AUTOMATED_PROGRAMS, BASE_MINUTES, evaluateCareBillingReadiness, normalizedProgram };
