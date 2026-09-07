// netlify/functions/action.js — all writes for BHWcrewOS.
// Every action validates the session and enforces division rules server-side.
//
// Actions:
//   referral-create, referral-status
//   handoff-create, handoff-status (acknowledge/schedule/complete)
//   minutes-log, minutes-charm (toggle In CharmHealth)
//   availability-submit
//   booking-create (requires Can Schedule; enforces room rules + conflicts)
//   patient-select, patient-create (protected Cloud Registry only)

const crypto = require("crypto");
const { DB, DIVISIONS, queryDb, createPage, updatePage, P, W, getSession, visibleDivisions, json } = require("./_lib");
const { cloudRequest, listCloudPatients, parsePatientName } = require("./lib/cloud-patients");
const { operationsRequest } = require("./lib/operations-cloud");

function actionError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function saveCloudCharmedAssessment(body, kind, session) {
  let current = null;
  if (body.id) {
    const result = await cloudRequest(`/v1/charmed/assessments?kind=${encodeURIComponent(kind)}`, { actor: session });
    current = (result.assessments || []).find((assessment) => assessment.id === body.id) || null;
    if (!current) throw actionError(404, "That CharmEd assessment is no longer available. Refresh and try again.");
  }
  const answerCount = kind === "adult" ? 6 : 7;
  const answers = Array.from({ length: answerCount }, (_, index) => current?.answers?.[index] || {});
  const steps = Array.from({ length: answerCount }, (_, index) => current?.steps?.[index] || "Not Started");
  const step = Number(body.step) || 0;
  if (step >= 1 && step <= answerCount) {
    answers[step - 1] = body.answers || {};
    steps[step - 1] = body.stepStatus || "Complete";
  }
  if (kind === "peds" && (step === 6 || step === 7)) {
    const workflowAnswers = body.workflowAnswers || {};
    const workflowStepStatus = body.workflowStepStatus || {};
    answers[5] = workflowAnswers.inPerson || answers[5] || {};
    answers[6] = workflowAnswers.results || answers[6] || {};
    steps[5] = workflowStepStatus.inPerson || steps[5];
    steps[6] = workflowStepStatus.results || steps[6];
  }
  const payload = {
    kind,
    date: current?.date || today(),
    status: body.status || current?.status || "Intake",
    ageGroup: body.ageGroup || current?.ageGroup || "",
    flags: body.flags || current?.flags || [],
    screeners: body.screeners || current?.screeners || [],
    notes: body.notes !== undefined ? body.notes : current?.notes || "",
    steps,
    answers,
  };
  if (current) {
    const result = await cloudRequest(`/v1/charmed/assessments/${encodeURIComponent(current.id)}`, {
      actor: session,
      method: "PUT",
      body: payload,
    });
    return result.assessment;
  }
  const bhwPatientId = String(body.patientId || "").trim().toUpperCase();
  if (!/^BHW\d{4}$/.test(bhwPatientId)) throw actionError(400, "Pick a patient from the protected Patient Registry.");
  const result = await cloudRequest(`/v1/patients/${encodeURIComponent(bhwPatientId)}/charmed/assessments`, {
    actor: session,
    method: "POST",
    body: payload,
  });
  return result.assessment;
}

const today = () => new Date().toISOString().slice(0, 10);
const actionKey = (prefix) => `${prefix}:${crypto.randomUUID()}`;

async function requireCloudPatient(patientId, session) {
  const bhwPatientId = String(patientId || "").trim().toUpperCase();
  if (!/^BHW\d{4}$/.test(bhwPatientId)) throw actionError(400, "Pick a patient from the protected Patient Registry.");
  const patient = (await listCloudPatients(session)).find((item) => item.bhwPatientId === bhwPatientId);
  if (!patient) throw actionError(404, "That patient is no longer available in the Patient Registry. Search again.");
  return patient;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in again" });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const vis = visibleDivisions(session);

  try {
    switch (b.action) {
      /* ---------------- Referrals ---------------- */
      case "referral-create": {
        if (!b.to || !DIVISIONS.includes(b.to)) return json(400, { error: "Pick a receiving division" });
        if (!b.from || !vis.includes(b.from)) return json(403, { error: "You can only send from your own division" });
        if (!b.patientId) return json(400, { error: "Pick a patient" });
        const patient = await requireCloudPatient(b.patientId, session);
        const result = await operationsRequest("/v1/patient-requests", {
          actor: session,
          method: "POST",
          body: {
            id: actionKey("crew-referral"),
            bhwPatientId: patient.bhwPatientId,
            requestType: "referral",
            priority: String(b.priority || "routine").toLowerCase() === "urgent" ? "urgent" : "routine",
            source: "crewos",
            sourceReference: "CrewOS division referral",
            summary: `${b.type || "Referral"}: ${b.from} to ${b.to}${b.details ? ` — ${b.details}` : ""}`,
            notificationMode: "none",
            manualNotifyOnly: true,
            workflowContext: {
              kind: "referral",
              fromDivision: b.from,
              toDivision: b.to,
              referralType: b.type || "Division Referral",
              device: b.device || "",
              details: b.details || "",
            },
          },
        });
        const request = result.request || result.patientRequest;
        return json(200, { ok: true, id: request.id || request.patientRequestId, savedAt: request.updatedAt, storage: "BHW Cloud" });
      }
      case "referral-status": {
        const allowed = ["Received", "In Progress", "Completed", "Declined/Redirect"];
        if (!allowed.includes(b.status)) return json(400, { error: "Bad status" });
        const body = b.status === "Completed"
          ? { action: "resolve", outcome: "referral_completed" }
          : b.status === "Declined/Redirect"
            ? { action: "resolve", outcome: "closed_without_scheduling" }
            : { action: "start" };
        body.idempotencyKey = actionKey("crew-referral-status");
        if (b.note) body.workflowContext = { completionNote: b.note };
        const result = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(b.id)}/actions`, { actor: session, method: "POST", body });
        return json(200, { ok: true, savedAt: result.request?.updatedAt, storage: "BHW Cloud" });
      }
      case "request-status": {
        if (!b.id) return json(400, { error: "Missing request id" });
        const allowed = ["Not started", "Acknowledged", "In progress", "Done"];
        if (!allowed.includes(b.status)) return json(400, { error: "Bad status" });
        const action = b.status === "Done" ? "resolve" : "start";
        const current = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(b.id)}`, { actor: session });
        const request = current.request || current.patientRequest;
        const result = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(b.id)}/actions`, {
          actor: session,
          method: "POST",
          body: {
            action,
            ...(action === "resolve" ? { outcome: request.requestType === "referral" ? "referral_completed" : "completed" } : {}),
            idempotencyKey: actionKey("crew-request-status"),
          },
        });
        return json(200, { ok: true, assignedTo: result.request?.assignedToName || session.name, savedAt: result.request?.updatedAt, storage: "BHW Cloud" });
      }
      case "referral-template-save": {
        // Save the current referral wording as a reusable template in Notion.
        if (!b.destination || !DIVISIONS.includes(b.destination)) return json(400, { error: "Pick a destination program" });
        if (!b.name) return json(400, { error: "Give the template a short name" });
        if (!b.body) return json(400, { error: "The template needs some referral text" });
        const props = {
          "Name": W.title(b.name),
          "Destination": W.sel(b.destination),
          "Body": W.text(b.body),
          "Active": W.check(true),
        };
        if (b.type) props["Type"] = W.sel(b.type);
        if (b.priority) props["Priority"] = W.sel(b.priority);
        if (b.neededBy) props["Needed By"] = W.sel(b.neededBy);
        const page = await createPage(DB.referralTemplates, props);
        return json(200, { ok: true, id: page.id });
      }

      /* ---------------- Warm handoffs ---------------- */
      case "handoff-create": {
        if (!b.to || !DIVISIONS.includes(b.to)) return json(400, { error: "Pick a receiving division" });
        if (!b.from || !vis.includes(b.from)) return json(403, { error: "You can only hand off from your own division" });
        if (!b.patientId) return json(400, { error: "Pick a patient" });
        if (!b.summary) return json(400, { error: "A warm handoff needs a summary" });
        const patient = await requireCloudPatient(b.patientId, session);
        const result = await operationsRequest("/v1/patient-requests", {
          actor: session,
          method: "POST",
          body: {
            id: actionKey("crew-handoff"),
            bhwPatientId: patient.bhwPatientId,
            requestType: "general",
            priority: "routine",
            source: "crewos",
            sourceReference: "CrewOS warm handoff",
            summary: b.summary,
            notificationMode: "none",
            manualNotifyOnly: true,
            workflowContext: {
              kind: "handoff",
              fromDivision: b.from,
              toDivision: b.to,
              details: b.summary,
              needs: b.needs || [],
              scheduledDate: b.scheduledDate || "",
            },
          },
        });
        const request = result.request || result.patientRequest;
        return json(200, { ok: true, id: request.id || request.patientRequestId, savedAt: request.updatedAt, storage: "BHW Cloud" });
      }
      case "handoff-status": {
        const allowed = ["Acknowledged", "Scheduled", "Completed"];
        if (!allowed.includes(b.status)) return json(400, { error: "Bad status" });
        const body = b.status === "Completed"
          ? { action: "resolve", outcome: "completed" }
          : b.status === "Scheduled"
            ? { action: "milestone", status: "waiting", workflowContext: { scheduledDate: b.scheduledDate || "" } }
            : { action: "start" };
        body.idempotencyKey = actionKey("crew-handoff-status");
        const result = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(b.id)}/actions`, { actor: session, method: "POST", body });
        return json(200, { ok: true, savedAt: result.request?.updatedAt, storage: "BHW Cloud" });
      }

      /* ---------------- Minutes ---------------- */
      case "minutes-log": {
        if (!b.program || !b.minutes) return json(400, { error: "Program and minutes required" });
        const patient = await requireCloudPatient(b.patientId, session);
        const date = b.date || today();
        const result = await cloudRequest("/v1/care-management/logs", {
          actor: session,
          method: "POST",
          body: {
            bhwPatientId: patient.bhwPatientId,
            entry: `${b.program} · ${b.minutes} min · ${date}`,
            program: b.program,
            type: "Staff activity",
            serviceMonth: date,
            minutes: b.minutes,
            activities: b.activity || "Coordination",
            notes: b.note || "",
            coordinator: session.name,
            inCharmHealth: false,
          },
        });
        return json(200, { ok: true, id: result.log.id, savedAt: result.log.updatedAt, storage: "BHW Cloud" });
      }
      case "minutes-charm": {
        const result = await cloudRequest(`/v1/care-management/logs/${encodeURIComponent(b.id)}`, {
          actor: session,
          method: "PUT",
          body: { inCharmHealth: true },
        });
        return json(200, { ok: true, savedAt: result.log.updatedAt, storage: "BHW Cloud" });
      }

      /* ---------------- Availability ---------------- */
      case "availability-submit": {
        if (!b.date || !b.start || !b.end) return json(400, { error: "Date, start, and end required" });
        const page = await createPage(DB.availability, {
          "Entry": W.title(`${session.name} · ${b.date} · ${b.start}–${b.end}`),
          "Staff": W.rel([session.staffId]),
          "Date": W.date(b.date),
          "Start Time": W.text(b.start),
          "End Time": W.text(b.end),
          "Recurring": W.sel(b.recurring || "One-time"),
          "Notes": W.text(b.notes || ""),
          "Status": W.sel("Submitted"),
        });
        return json(200, { ok: true, id: page.id });
      }

      /* ---------------- Bookings (rule-checked) ---------------- */
      case "booking-create": {
        if (!session.canSchedule) return json(403, { error: "You don't have scheduling permission" });
        const { roomId, staffIds, service, date, start, end, division } = b;
        if (!roomId || !service || !date || !start || !end) return json(400, { error: "Room, service, date, start, and end required" });

        // Rule 1: service must be allowed in the room.
        const roomPages = await queryDb(DB.rooms);
        const room = roomPages.find((r) => r.id === roomId);
        if (!room) return json(400, { error: "Room not found" });
        const allowed = P.multi(room.properties["Allowed Services"]);
        const roomName = P.title(room.properties["Room"]);
        if (!allowed.includes(service)) {
          return json(409, { error: `${service} isn't allowed in ${roomName}. Allowed: ${allowed.join(", ")}` });
        }

        // Rule 2: no room or staff double-booking (same date, overlapping times).
        const sameDay = await queryDb(DB.schedule, {
          and: [
            { property: "Date", date: { equals: date } },
            { property: "Status", select: { equals: "Scheduled" } },
          ],
        });
        const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
        for (const pg of sameDay) {
          const p = pg.properties;
          const s = P.text(p["Start Time"]), e = P.text(p["End Time"]);
          if (!overlaps(start, end, s, e)) continue;
          if (P.rel(p["Room"]).includes(roomId)) {
            return json(409, { error: `${roomName} is already booked ${s}–${e} (${P.title(p["Booking"])})` });
          }
          const bookedStaff = P.rel(p["Staff"]);
          const clash = (staffIds || []).find((id) => bookedStaff.includes(id));
          if (clash) return json(409, { error: `A selected staff member is already booked ${s}–${e}` });
        }

        const page = await createPage(DB.schedule, {
          "Booking": W.title(`${service} · ${roomName} · ${date} ${start}`),
          "Staff": W.rel(staffIds || []),
          "Service Type": W.sel(service),
          "Room": W.rel([roomId]),
          "Date": W.date(date),
          "Start Time": W.text(start),
          "End Time": W.text(end),
          "Division": W.sel(division || "Shared"),
          "Notes": W.text(b.notes || ""),
          "Status": W.sel("Scheduled"),
        });
        return json(200, { ok: true, id: page.id });
      }
      case "booking-status": {
        if (!session.canSchedule) return json(403, { error: "You don't have scheduling permission" });
        if (!["Completed", "Cancelled"].includes(b.status)) return json(400, { error: "Bad status" });
        await updatePage(b.id, { "Status": W.sel(b.status) });
        return json(200, { ok: true });
      }

      case "awv-save": {
        let current = null;
        if (b.id) {
          const list = await cloudRequest("/v1/wellness-visits", { actor: session });
          current = (list.visits || []).find((visit) => visit.id === b.id) || null;
          if (!current) return json(404, { error: "That AWV is no longer available. Refresh and try again." });
        }
        const payload = {};
        if (b.step >= 1 && b.step <= 5) {
          const steps = [...(current?.steps || Array(5).fill("Not Started"))];
          const answers = [...(current?.answers || Array.from({ length: 5 }, () => ({})))];
          steps[b.step - 1] = b.stepStatus || "Complete";
          answers[b.step - 1] = b.answers || {};
          payload.steps = steps;
          payload.answers = answers;
        }
        if (b.flags) payload.flags = b.flags;
        if (b.computed) {
          if (b.computed.miniCog !== undefined) payload.miniCog = b.computed.miniCog;
          if (b.computed.diet !== undefined) payload.diet = b.computed.diet;
          if (b.computed.exercise !== undefined) payload.exercise = b.computed.exercise;
        }
        if (b.status) {
          payload.status = b.status;
          if (b.status === "Completed") payload.review = "Pending Review";
        }
        if (b.notes !== undefined) payload.providerNote = b.notes;
        if (current) {
          const result = await cloudRequest(`/v1/wellness-visits/${encodeURIComponent(current.id)}`, {
            actor: session,
            method: "PUT",
            body: payload,
          });
          return json(200, { ok: true, id: current.id, savedAt: result.visit.updatedAt, storage: "BHW Cloud" });
        }
        if (!b.patientId) return json(400, { error: "Pick a patient to start an AWV" });
        const patient = await requireCloudPatient(b.patientId, session);
        const result = await cloudRequest(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}/wellness-visits`, {
          actor: session,
          method: "POST",
          body: { date: today(), status: "In Progress", conductedBy: session.name, ...payload },
        });
        return json(200, { ok: true, id: result.visit.id, savedAt: result.visit.updatedAt, storage: "BHW Cloud" });
      }

      case "cm-save": {
        const assessment = await saveCloudCharmedAssessment(b, "peds", session);
        return json(200, { ok: true, id: assessment.id, savedAt: assessment.updatedAt, storage: "BHW Cloud" });
      }

      case "cma-save": {
        const assessment = await saveCloudCharmedAssessment(b, "adult", session);
        return json(200, { ok: true, id: assessment.id, savedAt: assessment.updatedAt, storage: "BHW Cloud" });
      }

      case "patient-select": {
        const bhwPatientId = String(b.bhwPatientId || "").trim().toUpperCase();
        const patient = await requireCloudPatient(bhwPatientId, session);

        return json(200, {
          ok: true,
          id: patient.bhwPatientId,
          name: patient.name,
          bhwId: patient.bhwPatientId,
          dob: patient.dob,
          chart: patient.mrn || "",
          insurance: patient.insurancePlanName || patient.primaryPayer || "",
          memberId: patient.memberId || "",
          savedAt: new Date().toISOString(),
          storage: "BHW Cloud",
        });
      }

      case "patient-create": {
        const parsedName = parsePatientName(b.name, b.nameSuffix);
        const name = parsedName.name;
        if (!name) return json(400, { error: "Patient name is required" });
        if (!b.dob) return json(400, { error: "Date of birth is required" });
        const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
        const lastTok = (s) => { const t = (s || "").trim().toLowerCase().split(/\s+/); return t[t.length - 1] || ""; };
        const dist = (x, y) => { // small edit-distance for near-miss names
          if (Math.abs(x.length - y.length) > 2) return 99;
          const m = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
          for (let j = 0; j <= y.length; j++) m[0][j] = j;
          for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
            m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (x[i-1] === y[j-1] ? 0 : 1));
          return m[x.length][y.length];
        };
        // Search the one protected registry. A newly entered person receives a
        // temporary holding ID until CharmHealth assigns the canonical BHW ID.
        const cloudPatients = await listCloudPatients(session);
        const existing = cloudPatients.map((patient) => ({
          id: patient.bhwPatientId,
          name: patient.name,
          bhwId: patient.bhwPatientId,
          dob: patient.dob,
          chart: patient.mrn,
        }));
        const n = norm(name);
        const isDupe = (p) => {
          const pn = norm(p.name);
          if (pn === n) return true;                                   // same name (spacing/case-proof)
          if (p.dob && p.dob === b.dob && lastTok(p.name) === lastTok(name)) return true; // same DOB + last name
          if (dist(pn, n) <= 2) return true;                           // near-miss spelling
          if (b.chart && p.chart && p.chart.trim() === b.chart.trim()) return true;       // same chart #
          return false;
        };
        const dupes = existing.filter(isDupe);
        const exact = dupes.find((p) => norm(p.name) === n && p.dob === b.dob);
        if (exact) return json(409, { error: `${exact.name} (${exact.bhwId}) already exists with this exact name and birthday — use the existing record.`, duplicates: dupes.map(({ id, name, bhwId, dob }) => ({ id, name, bhwId, dob })) });
        if (dupes.length && !b.force) return json(200, { duplicates: dupes.map(({ id, name, bhwId, dob }) => ({ id, name, bhwId, dob })) });

        const mbi = b.mbi ? String(b.mbi).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";
        const result = await cloudRequest("/v1/prospective-patients", {
          actor: session,
          method: "POST",
          body: {
            legalFirstName: parsedName.legalFirstName,
            legalLastName: parsedName.legalLastName,
            nameSuffix: parsedName.nameSuffix,
            dateOfBirth: b.dob,
            email: b.email || "",
            guardianEmail: b.guardianEmail || "",
            primaryPayer: b.insurance || "",
            insurancePlanName: b.insurance || "",
            memberId: b.memberId || "",
            medicareMbi: mbi,
            mrn: b.chart || "",
            programEnrollment: Array.isArray(b.programs) ? b.programs : [],
            intakeSource: "crewhq-registration",
            source: { system: "crewhq-registration", importedAt: new Date().toISOString() },
          },
        });
        const patient = result.patient;
        return json(200, {
          ok: true,
          id: patient.bhwPatientId,
          bhwId: patient.bhwPatientId,
          name,
          prospective: true,
          requiresReenrollment: true,
          savedAt: patient.updatedAt || new Date().toISOString(),
          storage: "BHW Cloud",
        });
      }

      case "care-log-save": {
        if (!b.id) return json(400, { error: "Missing entry id" });
        const updates = {};
        for (const key of ["minutes", "activities", "referrals", "nextFollowUp", "followUpStage", "status", "lastContact", "notes"]) {
          if (b[key] !== undefined) updates[key] = b[key];
        }
        if (!Object.keys(updates).length) return json(400, { error: "Nothing to update" });
        const result = await cloudRequest(`/v1/care-management/logs/${encodeURIComponent(b.id)}`, {
          actor: session,
          method: "PUT",
          body: updates,
        });
        return json(200, { ok: true, id: b.id, savedAt: result.log?.updatedAt || new Date().toISOString(), storage: "BHW Cloud" });
      }

      case "care-log-create": {
        const name = (b.name || "").trim();
        if (!name) return json(400, { error: "Patient name required" });
        const program = b.program || "TCM";
        const requestedPatientId = String(b.bhwPatientId || b.ctlNo || b.patientId || "").trim().toUpperCase();
        if (!/^BHW\d{4}$/.test(requestedPatientId)) {
          return json(400, { error: "Choose the patient from the protected Patient Registry before creating a care log." });
        }
        const result = await cloudRequest("/v1/care-management/logs", {
          actor: session,
          method: "POST",
          body: {
            bhwPatientId: requestedPatientId,
            entry: `${name} — ${program}${b.month ? ` · ${b.month}` : ""}`,
            program,
            type: b.type || (program === "TCM" ? "Episode" : "Monthly"),
            status: b.status || "Open",
            serviceMonth: b.month ? `${b.month}-01` : "",
            episodeDate: b.episodeDate || "",
            icd: b.icd || "",
            primaryDx: b.primaryDx || "",
            memberId: b.memberId || "",
            notes: b.notes || "",
            minutes: b.minutes,
            nextFollowUp: b.nextFollowUp || "",
            followUpStage: b.followUpStage || "",
          },
        });
        return json(200, { ok: true, id: result.log.id, savedAt: result.log.updatedAt, storage: "BHW Cloud" });
      }

      case "prog-save": {
        const payload = {};
        for (const key of ["track", "stage", "startDate", "battery", "baselineDate", "baselineSummary", "retestDate", "retestSummary", "progressNote"]) {
          if (b[key] !== undefined) payload[key] = b[key];
        }
        if (b.id) {
          const result = await cloudRequest(`/v1/charmed/program-enrollments/${encodeURIComponent(b.id)}`, {
            actor: session,
            method: "PUT",
            body: payload,
          });
          return json(200, { ok: true, id: b.id, savedAt: result.enrollment.updatedAt, storage: "BHW Cloud" });
        }
        if (!b.patientId) return json(400, { error: "Pick a patient to enroll" });
        const bhwPatientId = String(b.patientId || "").trim().toUpperCase();
        if (!/^BHW\d{4}$/.test(bhwPatientId)) return json(400, { error: "Pick a patient from the protected Patient Registry." });
        const result = await cloudRequest(`/v1/patients/${encodeURIComponent(bhwPatientId)}/charmed/program-enrollments`, {
          actor: session,
          method: "POST",
          body: {
            ...payload,
            startDate: b.startDate || today(),
            baselineDate: b.baselineDate || today(),
            stage: b.stage || "Enrolled",
          },
        });
        return json(200, { ok: true, id: result.enrollment.id, savedAt: result.enrollment.updatedAt, storage: "BHW Cloud" });
      }

      case "ph-plan-save": {
        const payload = { program: "The Porter House" };
        if (b.lrKind === "baseline" && b.lr) {
          payload.readinessBaseline = b.lr;
          payload.readinessBaselinePercent = b.lrPct;
        }
        if (b.lrKind === "latest" && b.lr) {
          payload.readinessLatest = b.lr;
          payload.readinessLatestPercent = b.lrPct;
          payload.readinessLatestDate = today();
        }
        if (b.drivers) payload.symptomDrivers = b.drivers;
        if (b.screens) {
          payload.behavioralHealthScreens = b.screens;
          const last = b.screens[b.screens.length - 1] || {};
          if (last.phq9 !== undefined && last.phq9 !== "") payload.latestPhq9 = +last.phq9;
          if (last.gad7 !== undefined && last.gad7 !== "") payload.latestGad7 = +last.gad7;
          if (last.date) payload.latestScreenDate = last.date;
        }
        if (b.goals) payload.growthGoals = b.goals;
        if (b.stage) payload.stage = b.stage;
        if (b.notes !== undefined) payload.notes = b.notes;
        if (b.id) {
          const result = await cloudRequest(`/v1/program-care-plans/${encodeURIComponent(b.id)}`, {
            actor: session,
            method: "PUT",
            body: payload,
          });
          return json(200, { ok: true, id: b.id, savedAt: result.plan.updatedAt, storage: "BHW Cloud" });
        }
        if (!b.patientId) return json(400, { error: "Pick a resident to start a growth plan" });
        const patient = await requireCloudPatient(b.patientId, session);
        const result = await cloudRequest(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}/program-care-plans`, {
          actor: session,
          method: "POST",
          body: {
            ...payload,
            moveInDate: b.moveIn || today(),
            stage: b.stage || "Month 1 — Stabilize & Assess",
            caseLead: session.name,
          },
        });
        return json(200, { ok: true, id: result.plan.id, savedAt: result.plan.updatedAt, storage: "BHW Cloud" });
      }

      case "cm-screening-link-patient": {
        if (!b.assessmentId || !b.patientId || !["peds", "adult"].includes(b.kind)) {
          return json(400, { error: "Choose a Patient Registry record for this assessment." });
        }
        if (session.access !== "Admin" && !vis.includes("CharmEd Minds")) {
          return json(403, { error: "CharmEd Minds access is required to link this assessment." });
        }
        const result = await cloudRequest(`/v1/charmed/assessments?kind=${encodeURIComponent(b.kind)}`, { actor: session });
        const assessment = (result.assessments || []).find((item) => item.id === b.assessmentId);
        if (!assessment) {
          return json(404, { error: "That CharmEd assessment is no longer available. Refresh and try again." });
        }
        const bhwPatientId = String(b.patientId || "").trim().toUpperCase();
        if (assessment.bhwPatientId !== bhwPatientId) {
          return json(409, { error: "This assessment is already linked to a different Patient Registry record. Review the identity before continuing." });
        }
        return json(200, {
          ok: true,
          indexId: bhwPatientId,
          bhwPatientId,
        });
      }

      case "cm-screening-readiness": {
        if (!b.patientId) return json(400, { error: "This assessment is not linked to a patient." });
        if (session.access !== "Admin" && !vis.includes("CharmEd Minds")) {
          return json(403, { error: "CharmEd Minds access is required to verify this screening patient." });
        }
        const patientId = String(b.patientId || "").trim().toUpperCase();
        const patients = await listCloudPatients(session);
        const patient = patients.find((item) => item.bhwPatientId === patientId);
        if (!patient) return json(404, { error: "This assessment is not linked to an active Patient Registry record." });
        return json(200, { ok: true, ready: true, bhwPatientId: patient.bhwPatientId });
      }

      case "cm-send-screeners": {
        // Store the assignment in Patient 360 and let the protected Cloud Run
        // service send one PHI-free portal invitation through Google Workspace.
        const { assessmentId, patientId, kind, screeners, audience } = b;
        const nowMs = Date.now();
        const authTime = Number(session.authTime) || 0;
        if (session.scope !== "clinical" || !authTime || authTime > nowMs + 60_000 || nowMs - authTime > 15 * 60 * 1000) {
          return json(403, { error: "Clinical mode is locked. Verify your CrewOS PIN again." });
        }
        if (!assessmentId || !patientId || !screeners || !screeners.length) {
          return json(400, { error: "Need the assessment, Patient 360 record, and at least one screener" });
        }
        if (kind === "peds") {
          const supervised = screeners.filter((name) => /DIAL-4|Shaywitz|DIBELS|Acadience|\bRAN\b|\bRAS\b|CTOPP|FAW|Handwriting|Nessy|Dynamo|NIH Toolbox|THS-R|ETCH|DASH|Beery|WIAT|KTEA|Woodcock-Johnson/i.test(String(name)));
          if (supervised.length) {
            return json(400, { error: `In-person or performance measures cannot be emailed: ${supervised.join(", ")}` });
          }
        }
        const assessmentResult = await cloudRequest(`/v1/charmed/assessments?kind=${encodeURIComponent(kind)}`, { actor: session });
        const assessment = (assessmentResult.assessments || []).find((item) => item.id === assessmentId);
        if (!assessment) return json(404, { error: "That CharmEd assessment is no longer available. Refresh and try again." });
        const patients = await listCloudPatients(session);
        const patient = patients.find((item) => item.bhwPatientId === assessment.bhwPatientId);
        if (!patient || (String(patientId).toUpperCase() !== patient.bhwPatientId)) {
          return json(409, { error: "The assessment and selected Patient Registry record do not match." });
        }
        const result = await cloudRequest(`/v1/patients/${encodeURIComponent(patient.bhwPatientId)}/charmed/screening-invitations`, {
          actor: session,
          method: "POST",
          body: {
            assessmentId,
            kind,
            audience: audience || (kind === "adult" ? "Self" : "Parent"),
            screenings: screeners,
            staffApprovalAttestation: true,
          },
        });
        return json(200, { ok: true, sent: screeners, eventId: result.eventId, destination: result.destination });
      }

      case "awv-sign": {
        const isProvider = /CRNP|PMHNP|MD|DO/i.test(session.role || "") || session.access === "Admin";
        if (!isProvider) return json(403, { error: "Only a provider can review and sign an AWV" });
        if (!b.id) return json(400, { error: "Missing encounter" });
        const result = await cloudRequest(`/v1/wellness-visits/${encodeURIComponent(b.id)}`, {
          actor: session,
          method: "PUT",
          body: {
            review: "Reviewed & Signed",
            signedBy: `${session.name} · electronically signed via BHWcrewOS`,
            signedDate: today(),
            providerNote: b.note || "",
          },
        });
        return json(200, { ok: true, savedAt: result.visit.updatedAt, storage: "BHW Cloud" });
      }

      default:
        return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    return json(err.status || 500, { error: err.message });
  }
};
