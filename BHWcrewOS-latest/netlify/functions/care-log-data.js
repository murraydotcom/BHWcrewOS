// Protected read side for the Care Management board. The Google Cloud Patient
// Registry owns patient identity; the RCM Cloud API owns care-management logs.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const { operationsRequest } = require("./lib/operations-cloud");

function isoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function shiftDate(value, days) {
  const date = new Date(`${isoDate(value)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthOf(value) { return isoDate(value).slice(0, 7); }

function previousMonth(value) {
  const date = new Date(`${monthOf(value)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthEnd(month) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function monthsInWindow(start, end) {
  const months = [];
  const cursor = new Date(`${monthOf(start)}-01T12:00:00Z`);
  const last = monthOf(end);
  while (Number.isFinite(cursor.getTime())) {
    const month = cursor.toISOString().slice(0, 7);
    months.push(month);
    if (month === last || months.length >= 3) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function careEnrollmentPatients(roster = [], { includeSynthetic = false, access = "" } = {}) {
  const patients = roster.filter((patient) => (
    patient.selectable
      && /^BHW\d{4}$/.test(patient.bhwPatientId)
      && patient.bhwPatientId !== "BHW0000"
  ));
  if (includeSynthetic === true && String(access || "").toLowerCase() === "admin") {
    patients.unshift({
      bhwPatientId: "BHW0000",
      name: "Synthetic Patient",
      dob: "",
      preferredName: "Synthetic",
      payer: "Synthetic coverage",
      insurance: "Synthetic coverage",
      memberId: "",
      hasMbi: false,
      medicareCoverageOrder: "",
      programs: [],
      selectable: true,
    });
  }
  return patients.map((patient) => ({
    bhwPatientId: patient.bhwPatientId,
    name: patient.name,
    dob: patient.dob,
    preferredName: patient.preferredName || "",
    payer: patient.payer || "",
    insurance: patient.insurance || "",
    memberId: patient.memberId || "",
    hasMbi: Boolean(patient.hasMbi || patient.medicareMbi),
    medicareCoverageOrder: patient.medicareCoverageOrder || "",
    programs: patient.programs || [],
  }));
}

const ENROLLMENT_PROGRAMS = new Set(["APCM", "CCM", "PCM", "BHI", "COCM", "CHI", "PIN", "PIN-PS", "RPM", "RTM"]);
const TIME_PROGRAMS = new Set(["CCM", "PCM", "BHI", "COCM", "CHI", "PIN", "PIN-PS"]);
const REMOTE_PROGRAMS = new Set(["RPM", "RTM"]);
const CODE_REQUIREMENTS = Object.freeze({
  "99490": { minutes: 20 }, "99491": { minutes: 30 }, "99487": { minutes: 60 },
  "99424": { minutes: 30 }, "99426": { minutes: 30 }, "99484": { minutes: 20 },
  "99492": { minutes: 70 }, "99493": { minutes: 60 }, "G2214": { minutes: 30 },
  "G0019": { minutes: 60 }, "G0023": { minutes: 60 }, "G0140": { minutes: 60 },
  "99445": { deviceDays: 2 }, "99454": { deviceDays: 16 }, "99470": { minutes: 10, interactive: true },
  "99457": { minutes: 20, interactive: true }, "98984": { deviceDays: 2 }, "98985": { deviceDays: 2 },
  "98986": { deviceDays: 2 }, "98976": { deviceDays: 16 }, "98977": { deviceDays: 16 },
  "98978": { deviceDays: 16 }, "98979": { minutes: 10, interactive: true }, "98980": { minutes: 20, interactive: true },
});

function codeRequirement(path) {
  const code = String(path || "").toUpperCase().match(/\b(?:G\d{4}|\d{5})\b/)?.[0] || "";
  return { code, ...(CODE_REQUIREMENTS[code] || {}) };
}

function currentRosterObservation(log = {}, program = "") {
  const serviceMonth = String(log.serviceMonth || "").slice(0, 10);
  const observations = (Array.isArray(log.rosterHistory) ? log.rosterHistory : []).filter((item) =>
    String(item?.program || "").toUpperCase() === program
      && String(item?.effectiveMonth || "").slice(0, 10) === serviceMonth);
  return observations.length ? observations[observations.length - 1] : null;
}

function documentationGaps(log = {}) {
  const gaps = [];
  const program = String(log.program || "").toUpperCase();
  const status = String(log.status || "Open").toLowerCase();
  const evidence = log.billingReadinessEvidence || {};
  if (!String(log.activities || "").trim()) gaps.push("activity/documentation");
  if (ENROLLMENT_PROGRAMS.has(program)) {
    if (evidence.intakeStatus !== "accepted") gaps.push("governed intake decision");
    if (evidence.intakeStatus === "accepted" && (!isoDate(evidence.intakeReviewedAt) || !String(evidence.intakeReviewedBy || "").trim())) gaps.push("intake review audit");
    const rosterObservation = currentRosterObservation(log, program);
    if (!rosterObservation || rosterObservation.status !== "active") gaps.push("current roster evidence");
    if (evidence.eligibilityStatus !== "confirmed") gaps.push("eligibility confirmation");
    if (evidence.consentStatus !== "current") gaps.push("consent");
    if (evidence.consentStatus === "current" && !isoDate(evidence.consentDate)) gaps.push("consent date");
    if (evidence.consentStatus === "current" && !isoDate(evidence.consentReviewDue)) gaps.push("consent review due");
    if (evidence.consentStatus === "current" && isoDate(evidence.consentReviewDue) && isoDate(evidence.consentReviewDue) < new Date().toISOString().slice(0, 10)) gaps.push("consent renewal");
    if (evidence.coverageStatus !== "verified") gaps.push("coverage verification");
    if (evidence.coverageStatus === "verified" && !isoDate(evidence.coverageCheckedAt)) gaps.push("coverage check date");
    if (["", "missing"].includes(evidence.initiatingVisitStatus || "missing")) gaps.push("initiating visit decision");
    if (evidence.initiatingVisitStatus === "complete" && !isoDate(evidence.initiatingVisitDate)) gaps.push("initiating visit date");
    if (evidence.carePlanStatus !== "active") gaps.push("active care plan");
    if (evidence.carePlanShared !== true) gaps.push("care plan shared");
    if (!String(evidence.assignedPerson || "").trim()) gaps.push("assigned person");
    if (evidence.patientInstructionsProvided !== true) gaps.push("patient instructions");
    if (evidence.monthlyRequirementsMet !== true) gaps.push("monthly requirements");
    if (evidence.providerReviewStatus !== "approved") gaps.push("provider review");
    if (evidence.providerReviewStatus === "approved" && !isoDate(evidence.providerReviewedAt)) gaps.push("provider review date");
  }
  if (TIME_PROGRAMS.has(program) || REMOTE_PROGRAMS.has(program)) {
    if (!String(evidence.billingPath || "").trim()) gaps.push("billing code/path");
    const requirement = codeRequirement(evidence.billingPath);
    const requiredMinutes = Number(evidence.requiredMinutes) || Number(requirement.minutes) || 0;
    const requiredDeviceDays = Number(evidence.requiredDeviceDays) || Number(requirement.deviceDays) || 0;
    if (TIME_PROGRAMS.has(program) && !(requiredMinutes > 0)) gaps.push("minute threshold selection");
    if (requiredMinutes > 0 && Number(log.minutes) < requiredMinutes) gaps.push(`${requiredMinutes}-minute threshold`);
    if (requiredDeviceDays > 0 && Number(evidence.deviceDataDays) < requiredDeviceDays) gaps.push(`${requiredDeviceDays} device-data days`);
    if ((requirement.interactive || (requiredMinutes > 0 && REMOTE_PROGRAMS.has(program))) && evidence.interactiveCommunicationCompleted !== true) {
      gaps.push("interactive communication");
    }
    if (REMOTE_PROGRAMS.has(program) && String(evidence.billingPath || "").trim() && !requiredMinutes && !requiredDeviceDays && !["99453", "98975"].includes(requirement.code)) {
      gaps.push("code requirements");
    }
  }
  if (program === "APCM" && !String(evidence.billingPath || "").trim()) gaps.push("APCM level/code");
  if (program === "TCM") {
    if (!String(evidence.billingPath || "").trim()) gaps.push("TCM code/MDM level");
    if (!isoDate(log.lastContact)) gaps.push("first contact");
    if (!isoDate(log.nextFollowUp)) gaps.push("visit date");
    if (evidence.coverageStatus !== "verified") gaps.push("coverage verification");
    if (evidence.coverageStatus === "verified" && !isoDate(evidence.coverageCheckedAt)) gaps.push("coverage check date");
    if (evidence.providerReviewStatus !== "approved") gaps.push("provider review");
    if (evidence.providerReviewStatus === "approved" && !isoDate(evidence.providerReviewedAt)) gaps.push("provider review date");
  }
  if (!["complete", "billed"].includes(status) && !isoDate(log.nextFollowUp)) gaps.push("next follow-up");
  if (status !== "billed" && evidence.billingHoldStatus !== "ready-for-rcm-review") gaps.push("billing hold / RCM review route");
  if (status === "complete") gaps.push("claim processing");
  return [...new Set(gaps)];
}

function billingReadiness(log = {}, patient = null) {
  const evidence = log.billingReadinessEvidence || {};
  const missing = documentationGaps(log);
  const blockers = [];
  const patientStatus = String(patient?.patientStatus || patient?.status || "").toLowerCase();
  if (!patient) blockers.push("Patient Registry connection");
  else if (patient.selectable === false || ["inactive", "prospective", "transferred", "deceased", "test"].includes(patientStatus)) {
    blockers.push(`Active Patient Registry status (${patientStatus || "not selectable"})`);
  }
  if (evidence.eligibilityStatus === "not-eligible") blockers.push("Program eligibility");
  if (["declined", "revoked"].includes(evidence.consentStatus)) blockers.push(`Program consent (${evidence.consentStatus})`);
  if (evidence.coverageStatus === "inactive") blockers.push("Active payer coverage");
  if (evidence.providerReviewStatus === "held") blockers.push("Provider placed billing on hold");
  if (String(log.status || "").toLowerCase() === "billed" && missing.length) {
    blockers.push("Billed status conflicts with incomplete evidence");
  }
  const state = blockers.length ? "blocked" : missing.length ? "incomplete" : "ready";
  return {
    state,
    label: state === "ready" ? "Ready for RCM review" : state === "blocked" ? "Blocked" : `${missing.length} missing`,
    blockers: [...new Set(blockers)],
    missing,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if ((body.action || "list") !== "list") return json(400, { error: "Unknown action" });

  try {
    const program = String(body.program || "").trim();
    const month = String(body.month || "").trim();
    const requestedEnd = isoDate(body.windowEnd) || new Date().toISOString().slice(0, 10);
    const windowEnd = /^\d{4}-\d{2}$/.test(month) ? monthEnd(month) : requestedEnd;
    const windowStart = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : shiftDate(windowEnd, -29);
    const windowMonths = /^\d{4}-\d{2}$/.test(month) ? [month] : monthsInWindow(windowStart, windowEnd);
    const closeMonth = previousMonth(windowEnd);
    const requestedMonths = [...new Set([...windowMonths, closeMonth])];
    const logRequests = requestedMonths.map((requestedMonth) => {
      const params = new URLSearchParams({ month: requestedMonth });
      if (program && program !== "All") params.set("program", program);
      return cloudRequest(`/v1/care-management/logs?${params}`, { actor: session })
        .then((result) => [requestedMonth, Array.isArray(result.logs) ? result.logs : []]);
    });
    const [logResults, roster, activityResult, enrollmentResult] = await Promise.all([
      Promise.all(logRequests),
      listCloudPatients(session),
      Promise.all([
        operationsRequest("/v1/patient-requests?source=care-connect&limit=100", { actor: session }),
        operationsRequest("/v1/patient-requests?source=patient-medication-html&limit=100", { actor: session }),
        operationsRequest("/v1/patient-requests?source=patient-content-html&limit=100", { actor: session }),
      ]).then((responses) => ({
        requests: responses.flatMap((response) => response.requests || response.patientRequests || []),
        warning: "",
      })).catch((error) => ({ requests: [], warning: String(error.message || error) })),
      cloudRequest("/v1/care-program-enrollments", { actor: session })
        .then((result) => ({ enrollments: result.enrollments || [], warning: "" }))
        .catch((error) => ({ enrollments: [], warning: String(error.message || error) })),
    ]);
    const logsByMonth = new Map(logResults);
    const resultLogs = [...new Map(windowMonths.flatMap((value) => logsByMonth.get(value) || [])
      .map((log) => [log.id, log])).values()];
    const byId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
    const includeSynthetic = body.includeSynthetic === true && session.access === "Admin";
    const enrollments = enrollmentResult.enrollments.filter((enrollment) => (
      enrollment.bhwPatientId !== "BHW0000" || includeSynthetic
    )).map((enrollment) => {
      const patient = byId.get(enrollment.bhwPatientId);
      return {
        ...enrollment,
        patientName: patient?.name || (enrollment.bhwPatientId === "BHW0000" ? "Synthetic Patient" : enrollment.bhwPatientId),
        payer: patient?.payer || enrollment.intake?.coverageDuplication?.payer || "",
        hasMbi: Boolean(patient?.hasMbi || patient?.medicareMbi),
        medicareCoverageOrder: patient?.medicareCoverageOrder || "",
      };
    });
    const entries = resultLogs.map((log) => {
      const patient = byId.get(log.bhwPatientId);
      const entry = {
        ...log,
        month: log.serviceMonth || "",
        ctlNo: log.bhwPatientId,
        patientId: log.bhwPatientId,
        entry: log.entry || patient?.name || log.bhwPatientId,
        memberId: patient?.memberId || log.memberId || "",
        payer: patient?.payer || "",
        hasMbi: Boolean(patient?.hasMbi || patient?.medicareMbi),
        medicareCoverageOrder: patient?.medicareCoverageOrder || "",
        rosterLinked: Boolean(patient),
        edited: log.updatedAt || "",
        gaps: documentationGaps(log),
      };
      entry.billingReadiness = billingReadiness(entry, patient);
      return entry;
    });
    const activityById = new Map();
    for (const request of activityResult.requests) {
      if (request.source === "care-connect" && request.requestType !== "clinical_review") continue;
      const occurredAt = request.receivedAt || request.createdAt || request.updatedAt || "";
      const activityDate = isoDate(occurredAt);
      if (activityDate && (activityDate < windowStart || activityDate > windowEnd)) continue;
      const patient = byId.get(request.bhwPatientId);
      activityById.set(request.id, {
        id: request.id,
        bhwPatientId: request.bhwPatientId,
        patientName: patient?.name || request.patientName || request.bhwPatientId,
        source: request.source,
        sourceLabel: request.source === "patient-medication-html" ? "Medication request"
          : request.source === "care-connect" ? "Patient check-in" : "Patient form response",
        status: request.statusLabel || String(request.status || "received").replaceAll("_", " "),
        statusCategory: request.statusCategory || "received",
        priority: request.priority || "routine",
        summary: request.summary || "Protected patient activity",
        sourceReference: request.sourceReference || "",
        occurredAt,
        updatedAt: request.updatedAt || occurredAt,
        requestsUrl: `/bhw-requests.html?request=${encodeURIComponent(request.id)}`,
      });
    }
    const activity = [...activityById.values()].sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
    const updated = [...entries.map((entry) => entry.edited), ...activity.map((item) => item.updatedAt)]
      .reduce((latest, value) => value > latest ? value : latest, "");
    const closeEntries = [...new Map((logsByMonth.get(closeMonth) || []).map((log) => [log.id, log])).values()].map((log) => {
      const patient = byId.get(log.bhwPatientId);
      const entry = {
        ...log,
        ctlNo: log.bhwPatientId,
        entry: log.entry || patient?.name || log.bhwPatientId,
        hasMbi: Boolean(patient?.hasMbi || patient?.medicareMbi),
        medicareCoverageOrder: patient?.medicareCoverageOrder || "",
        gaps: documentationGaps(log),
      };
      entry.billingReadiness = billingReadiness(entry, patient);
      return entry;
    });
    return json(200, {
      entries,
      enrollments,
      patients: careEnrollmentPatients(roster, { includeSynthetic: body.includeSynthetic === true, access: session.access }),
      activity,
      count: entries.length,
      activityCount: activity.length,
      updated,
      window: { start: windowStart, end: windowEnd, days: 30 },
      monthClose: {
        month: closeMonth,
        start: `${closeMonth}-01`,
        end: monthEnd(closeMonth),
        generatedAt: new Date().toISOString(),
        entries: closeEntries,
        counts: {
          tracked: closeEntries.length,
          complete: closeEntries.filter((entry) => ["complete", "billed"].includes(String(entry.status || "").toLowerCase())).length,
          missing: closeEntries.filter((entry) => entry.gaps.length).length,
          claimPending: closeEntries.filter((entry) => String(entry.status || "").toLowerCase() === "complete").length,
        },
      },
      activityWarning: activityResult.warning,
      enrollmentWarning: enrollmentResult.warning,
      storage: "BHW Cloud",
    });
  } catch (error) {
    return json(500, { error: String(error.message || error) });
  }
};

exports._test = { billingReadiness, careEnrollmentPatients, codeRequirement, currentRosterObservation, documentationGaps, isoDate, monthEnd, monthsInWindow, previousMonth, shiftDate };
