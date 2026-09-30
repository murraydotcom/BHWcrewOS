// Registry-linked Care Management intake and enrollment workflow.
// Prospective records remain non-billable; activation is validated by RCM Cloud
// and then prepares the current monthly work row without duplicating it.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

const PROGRAMS = new Set(["APCM", "CCM", "PCM", "BHI", "COCM", "CHI", "PIN", "PIN-PS", "RPM", "RTM"]);

function normalizeProgram(value) {
  const program = String(value || "").trim().toUpperCase();
  if (!PROGRAMS.has(program)) throw Object.assign(new Error("Choose a supported care-management program."), { status: 400 });
  return program;
}

function monthStart(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 7)}-01` : "";
}

function enrollmentEvidence(enrollment = {}) {
  return {
    enrollmentStatus: enrollment.status || "potential",
    enrollmentRecordId: enrollment.id || "",
    workflowVersion: enrollment.workflowVersion || "",
    eligibilityStatus: enrollment.practitionerReview?.status === "approved" ? "confirmed" : "potential",
    consentStatus: enrollment.consent?.status || "missing",
    consentDate: enrollment.consent?.date || "",
    consentReviewDue: enrollment.consent?.reviewDue || "",
    coverageStatus: enrollment.intake?.coverageDuplication?.verificationStatus || "unknown",
    coverageCheckedAt: enrollment.intake?.coverageDuplication?.checkedAt || "",
    initiatingVisitStatus: enrollment.initiatingVisit?.status || "missing",
    initiatingVisitDate: enrollment.initiatingVisit?.date || "",
    carePlanStatus: enrollment.carePlan?.status || "missing",
    carePlanShared: enrollment.carePlan?.shared === true,
    assignedPerson: enrollment.assignment?.assignedPerson || "",
    patientInstructionsProvided: enrollment.intake?.participationEducation?.patientInstructionsProvided === true,
    monthlyRequirementsMet: false,
    providerReviewStatus: enrollment.practitionerReview?.status === "approved" ? "approved" : "pending",
    providerReviewedAt: enrollment.practitionerReview?.reviewedAt || "",
    operationalRiskScore: enrollment.risk?.score,
    operationalRiskState: enrollment.risk?.state || "Incomplete",
    suggestedContactCadence: enrollment.risk?.override?.cadence || enrollment.risk?.suggestedCadence || "",
  };
}

async function ensureMonthlyLog(enrollment, patient, actor, now = new Date()) {
  if (enrollment.status !== "active") return null;
  const serviceMonth = monthStart(now);
  const month = serviceMonth.slice(0, 7);
  const program = normalizeProgram(enrollment.program);
  const result = await cloudRequest(`/v1/care-management/logs?month=${encodeURIComponent(month)}&program=${encodeURIComponent(program)}&bhwPatientId=${encodeURIComponent(enrollment.bhwPatientId)}`, { actor });
  const current = (result.logs || []).find((log) => (
    log.bhwPatientId === enrollment.bhwPatientId && String(log.program || "").toUpperCase() === program
  ));
  const source = {
    entry: `${patient.name || enrollment.bhwPatientId} — ${program} · ${month}`,
    program,
    type: "Monthly",
    serviceMonth,
    memberId: patient.memberId || "",
    icd: (patient.icds || []).join(", "),
    nextFollowUp: enrollment.assignment?.nextContact || "",
    notes: `Source: Registry care-program enrollment · ${enrollment.id}`,
    billingReadinessEvidence: {
      ...(current?.billingReadinessEvidence || {}),
      ...enrollmentEvidence(enrollment),
    },
  };
  if (current) {
    const updated = await cloudRequest(`/v1/care-management/logs/${encodeURIComponent(current.id)}`, {
      actor, method: "PUT", body: source,
    });
    return updated.log || { ...current, ...source };
  }
  const created = await cloudRequest("/v1/care-management/logs", {
    actor, method: "POST", body: { ...source, bhwPatientId: enrollment.bhwPatientId, status: "Open" },
  });
  return created.log;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    if (body.action === "list") {
      const params = new URLSearchParams();
      if (body.bhwPatientId) params.set("bhwPatientId", String(body.bhwPatientId));
      if (body.program) params.set("program", normalizeProgram(body.program));
      if (body.status) params.set("status", String(body.status));
      const result = await cloudRequest(`/v1/care-program-enrollments${params.size ? `?${params}` : ""}`, { actor: session });
      return json(200, { ok: true, enrollments: result.enrollments || [], storage: "BHW Cloud" });
    }

    if (body.action !== "save") return json(400, { error: "Unknown action" });
    const bhwPatientId = String(body.bhwPatientId || "").trim().toUpperCase();
    if (!/^BHW\d{4}$/.test(bhwPatientId) || bhwPatientId === "BHW0000") {
      return json(400, { error: "Choose a real patient from the protected Patient Registry." });
    }
    const program = normalizeProgram(body.program);
    const patients = await listCloudPatients(session);
    const patient = patients.find((item) => item.bhwPatientId === bhwPatientId && item.selectable);
    if (!patient) return json(404, { error: "The patient is not available for enrollment in the protected Patient Registry." });

    const result = await cloudRequest(`/v1/patients/${encodeURIComponent(bhwPatientId)}/care-program-enrollments/${encodeURIComponent(program)}`, {
      actor: session,
      method: "PUT",
      body: { ...(body.record || {}), bhwPatientId, program },
    });
    const enrollment = result.enrollment;
    if (!result.verified || !enrollment?.id) throw Object.assign(new Error("Enrollment was not verified after the BHW Cloud save."), { status: 502 });
    const monthlyLog = await ensureMonthlyLog(enrollment, patient, session);
    return json(200, {
      ok: true,
      verified: true,
      enrollment,
      monthlyLogId: monthlyLog?.id || "",
      savedAt: enrollment.updatedAt || result.savedAt || new Date().toISOString(),
      storage: "BHW Cloud",
    });
  } catch (error) {
    return json(Number(error.status) || 500, {
      error: String(error.message || error),
      ...(Array.isArray(error.gaps) ? { gaps: error.gaps } : {}),
    });
  }
};

exports._test = { enrollmentEvidence, ensureMonthlyLog, monthStart, normalizeProgram };
