// netlify/functions/ops-data.js — dashboard payload, division walls enforced HERE.
// Returns only what the signed-in person's divisions permit. Admins see all.
 
const { DB, queryDb, P, getSession, visibleDivisions, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const { buildPatientDirectory } = require("./lib/crew-patient-directory");
const { operationsRequest } = require("./lib/operations-cloud");
 
function shapeReferral(request) {
  const context = request.workflowContext || {};
  const terminal = request.statusCategory === "completed";
  return {
    id: request.id || request.patientRequestId,
    title: `${context.referralType || "Referral"} → ${context.toDivision || "Referral team"}`,
    patient: request.bhwPatientId,
    from: context.fromDivision || "Primary Care",
    to: context.toDivision || "Care Management",
    sentBy: request.createdBy || "",
    type: context.referralType || "Division Referral",
    device: context.device || "",
    details: context.details || request.summary || "",
    status: terminal ? (request.status === "closed_without_scheduling" ? "Declined/Redirect" : "Completed")
      : request.statusCategory === "received" ? "Sent" : "In Progress",
    completionNote: context.completionNote || "",
    sentDate: String(context.historicalReceivedAt || request.createdAt || "").slice(0, 10),
    completedDate: terminal ? String(request.resolvedAt || request.updatedAt || "").slice(0, 10) : "",
    priority: request.priority === "urgent" ? "Urgent" : "Routine",
  };
}
 
function shapeHandoff(request) {
  const context = request.workflowContext || {};
  return {
    id: request.id || request.patientRequestId,
    title: `${context.fromDivision || "BHW"} → ${context.toDivision || "Front Desk"}`,
    patient: request.bhwPatientId,
    from: context.fromDivision || "Primary Care",
    to: context.toDivision || "Front Desk",
    fromStaff: request.createdBy || "",
    summary: context.details || request.summary || "",
    needs: context.needs || [],
    scheduledDate: context.scheduledDate || "",
    status: request.statusCategory === "completed" ? "Completed"
      : request.statusCategory === "waiting" ? "Scheduled"
        : request.statusCategory === "received" ? "New" : "Acknowledged",
  };
}
 
function shapeBooking(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    title: P.title(p["Booking"]),
    staff: P.rel(p["Staff"]),
    service: P.sel(p["Service Type"]),
    room: P.rel(p["Room"])[0] || null,
    date: P.date(p["Date"]),
    start: P.text(p["Start Time"]),
    end: P.text(p["End Time"]),
    division: P.sel(p["Division"]),
    status: P.sel(p["Status"]),
    notes: P.text(p["Notes"]),
  };
}
 
exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in again" });
 
  const vis = visibleDivisions(session);
  const isAdmin = session.access === "Admin";
  const inVis = (d) => vis.includes(d);
 
  try {
    const [staffPages, roomPages, schedulePages, resourcePages, patientRegistry, operationsRows, careLogRows, wellnessRows, programPlanRows, panelRows] =
      await Promise.all([
        queryDb(DB.staff),
        queryDb(DB.rooms),
        queryDb(DB.schedule),
        queryDb(DB.resources),
        listCloudPatients(session),
        operationsRequest("/v1/patient-requests?limit=500", { actor: session }),
        cloudRequest("/v1/care-management/logs", { actor: session }),
        cloudRequest("/v1/wellness-visits", { actor: session }),
        cloudRequest("/v1/program-care-plans", { actor: session }),
        cloudRequest("/v1/panel", { actor: session }),
      ]);
 
    const staff = staffPages.map((pg) => ({
      id: pg.id,
      name: P.title(pg.properties["Name"]),
      role: P.sel(pg.properties["Role"]),
      divisions: P.multi(pg.properties["Divisions"]),
      active: P.check(pg.properties["Active"]),
    }));
    const staffName = Object.fromEntries(staff.map((s) => [s.id, s.name]));
 
    const directory = buildPatientDirectory(patientRegistry);
    const { patients, patientLabel } = directory;
 
    const rooms = roomPages.map((pg) => ({
      id: pg.id,
      name: P.title(pg.properties["Room"]),
      allowed: P.multi(pg.properties["Allowed Services"]),
      capacity: P.num(pg.properties["Capacity"]),
      active: P.check(pg.properties["Active"]),
    }));
 
    // Division workflows are records in the one Google Operations Patient
    // Requests queue, with their display context attached to the same record.
    const operationRequests = operationsRows.requests || operationsRows.patientRequests || [];
    const referrals = operationRequests
      .filter((request) => request.workflowContext?.kind === "referral")
      .map(shapeReferral).filter((r) => inVis(r.from) || inVis(r.to));
    const handoffs = operationRequests
      .filter((request) => request.workflowContext?.kind === "handoff")
      .map(shapeHandoff).filter((h) => inVis(h.from) || inVis(h.to));
 
    // Schedule: your divisions' bookings + Shared; admins see everything.
    const schedule = schedulePages
      .map(shapeBooking)
      .filter((b) => isAdmin || inVis(b.division) || b.division === "Shared")
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
 
    const monthKey = new Date().toISOString().slice(0, 7);
    const minuteRows = careLogRows.logs || [];
 
    // Crew Projects: posted by team leads in Notion, shown to assigned staff in My Space.
    let crewProjects = [];
    if (DB.crewProjects) {
      const cpPages = await queryDb(DB.crewProjects);
      crewProjects = cpPages.map((pg) => {
        const p = pg.properties;
        return {
          id: pg.id,
          title: P.title(p["Project"]),
          staff: P.rel(p["Staff"]),
          status: P.sel(p["Status"]),
          due: P.date(p["Due Date"]),
          summary: P.text(p["Summary"]),
        };
      });
    }
 
    let awv = null;
    if (isAdmin || vis.includes("Care Management") || vis.includes("Primary Care")) {
      awv = (wellnessRows.visits || []).map((visit) => ({
        id: visit.id,
        patient: visit.bhwPatientId,
        date: visit.date,
        status: visit.status,
        steps: visit.steps || Array(5).fill("Not Started"),
        flags: visit.flags || [],
        review: visit.review || "",
        signedBy: visit.signedBy || "",
        signedDate: visit.signedDate || "",
        miniCog: visit.miniCog,
        answers: visit.answers || Array.from({ length: 5 }, () => ({})),
      })).sort((a,b) => (b.date||"").localeCompare(a.date||""));
    }
 
    let charmed = null;
    let charmedAdult = null;
    let charmedProgram = null;
    if (isAdmin || vis.includes("CharmEd Minds")) {
      const [assessmentResult, enrollmentResult, responseResult] = await Promise.all([
        cloudRequest("/v1/charmed/assessments", { actor: session }),
        cloudRequest("/v1/charmed/program-enrollments", { actor: session }),
        cloudRequest("/v1/charmed/responses", { actor: session }),
      ]);
      const shapeAssessment = (assessment) => ({
        ...assessment,
        patient: assessment.bhwPatientId,
        patientBhwId: assessment.bhwPatientId,
        steps: assessment.steps || [],
        flags: assessment.flags || [],
        screeners: assessment.screeners || [],
        answers: assessment.answers || [],
      });
      const responsesByAssessment = new Map();
      for (const response of responseResult.responses || []) {
        if (!responsesByAssessment.has(response.assessmentId)) responsesByAssessment.set(response.assessmentId, []);
        responsesByAssessment.get(response.assessmentId).push(response);
      }
      const assessments = (assessmentResult.assessments || []).map((assessment) => ({
        ...shapeAssessment(assessment),
        responses: responsesByAssessment.get(assessment.id) || [],
      }));
      charmed = assessments.filter((assessment) => assessment.kind === "peds");
      charmedAdult = assessments.filter((assessment) => assessment.kind === "adult");
      charmedProgram = (enrollmentResult.enrollments || []).map((enrollment) => ({
        ...enrollment,
        patient: enrollment.bhwPatientId,
      }));
    }
 
    let phPlans = null;
    if (isAdmin || vis.includes("The Porter House")) {
      phPlans = (programPlanRows.plans || []).filter((plan) => plan.program === "The Porter House").map((plan) => ({
        id: plan.id,
        patient: plan.bhwPatientId,
        moveIn: plan.moveInDate || "",
        stage: plan.stage || "",
        basePct: plan.readinessBaselinePercent || 0,
        latestPct: plan.readinessLatestPercent || 0,
        baseline: plan.readinessBaseline || null,
        latest: plan.readinessLatest || null,
        lrLatestDate: plan.readinessLatestDate || "",
        drivers: plan.symptomDrivers || [],
        screens: plan.behavioralHealthScreens || [],
        phq: plan.latestPhq9,
        gad: plan.latestGad7,
        screenDate: plan.latestScreenDate || "",
        goals: plan.growthGoals || [],
      })).sort((a,b) => (a.moveIn||"").localeCompare(b.moveIn||""));
    }
 
    let prevention = null;
    if (isAdmin || vis.includes("Primary Care") || vis.includes("Care Management")) {
      prevention = (panelRows.profiles || []).filter((profile) => (
        profile.coverage || profile.planType || profile.awvLastDate || profile.awvNextEligibleDate
      )).map((profile) => ({
        id: profile.id || profile.bhwPatientId,
        patient: profile.bhwPatientId,
        lastChecked: String(profile.updatedAt || "").slice(0, 10),
        coverage: profile.coverage || "",
        planType: profile.planType || "",
        maName: profile.medicareAdvantagePlanName || "",
        awvLast: profile.awvLastDate || "",
        awvNext: profile.awvNextEligibleDate || "",
        awvStatus: profile.awvStatus || "Unknown",
      }));
    }
 
    // Admin Master stays admin-only. Porter House census opens to everyone naturally,
    // via the "vis" division wall above (now unrestricted) — no special case needed here.
    let adminRollup = null;
    let porterhouse = null;
    if (isAdmin || vis.includes("The Porter House")) {
      porterhouse = (programPlanRows.plans || []).filter((plan) => plan.program === "The Porter House").map((plan) => ({
        id: plan.id,
        resident: patientLabel[plan.bhwPatientId] || plan.bhwPatientId,
        phId: plan.programPatientId || "",
        unit: plan.roomUnit || "",
        alsoReceives: plan.alsoReceives || [],
        status: plan.residentStatus || plan.stage || "Active",
        admit: plan.moveInDate || "",
      }));
    }
    if (isAdmin) {
      adminRollup = {};
      for (const log of minuteRows) {
        const d = log.serviceMonth || log.episodeDate || "";
        if (!d.startsWith(monthKey)) continue;
        const prog = log.program || "—";
        adminRollup[prog] = (adminRollup[prog] || 0) + (Number(log.minutes) || 0);
      }
    }
 
    const resources = resourcePages
      .map((pg) => ({
        title: P.title(pg.properties["Resource"]),
        division: P.sel(pg.properties["Division"]),
        category: P.sel(pg.properties["Category"]) || "Documentation",
        link: pg.properties["Link"]?.url || "",
        notes: P.text(pg.properties["Notes"]),
        pinned: P.check(pg.properties["Pinned"]),
      }))
      .filter((r) => r.link && (r.division === "All Divisions" || inVis(r.division)))
      .sort((a, b) => (b.pinned - a.pinned) || a.title.localeCompare(b.title));
 
    return json(200, {
      user: { name: session.name, divisions: session.divisions, access: session.access, landing: session.landing, canSchedule: session.canSchedule, staffId: session.staffId },
      visibleDivisions: vis,
      staff: staff.filter((s) => s.active).map(({ id, name, role, divisions }) => ({ id, name, role, divisions })),
      staffName,
      patients,
      patientLabel,
      patientRegistryReady: true,
      patientRegistryError: "",
      rooms: rooms.filter((r) => r.active),
      referrals,
      handoffs,
      schedule,
      adminRollup,
      porterhouse,
      resources,
      awv,
      charmed,
      charmedAdult,
      charmedProgram,
      phPlans,
      prevention,
      crewProjects,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
 
