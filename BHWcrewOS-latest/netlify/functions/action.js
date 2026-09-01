// netlify/functions/action.js — all writes for BHWcrewOS.
// Every action validates the session and enforces division rules server-side.
//
// Actions:
//   referral-create, referral-status
//   handoff-create, handoff-status (acknowledge/schedule/complete)
//   minutes-log, minutes-charm (toggle In CharmHealth)
//   availability-submit
//   booking-create (requires Can Schedule; enforces room rules + conflicts)
//   patient-select (link an existing Cloud patient to the transitional Index)

const { DB, DIVISIONS, httpJson, queryDb, createPage, updatePage, P, W, getSession, visibleDivisions, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const zlib = require("zlib");

// Google Cloud is the authoritative patient list. During migration, new
// registrations are also mirrored to the Notion master and lean Patient Index
// so existing operational relations continue to work.
const MASTER_DB = process.env.MASTER_DB_ID || "2cf580758d3080f0825de4bbfb6c7528";

function encodeCmWorkflow(value) {
  const encoded = `gz:${zlib.gzipSync(JSON.stringify(value)).toString("base64")}`;
  if (encoded.length > 1850) {
    throw Object.assign(new Error("The in-person screening record is too long to save safely. Shorten the free-text notes, then try again."), { status: 400 });
  }
  return encoded;
}

const normalizePatientName = (value) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");

function indexInsurance(patient) {
  const value = `${patient.primaryPayer || patient.payer || ""} ${patient.insurancePlanName || patient.insurance || ""}`.toLowerCase();
  if (/dual|qmb|medicare.*medicaid|medicaid.*medicare/.test(value)) return "Medicare + Medicaid";
  if (/cigna/.test(value)) return "Cigna";
  if (/aetna/.test(value)) return "Aetna";
  if (/united|uhc|optum/.test(value)) return "UnitedHealthcare";
  if (/tricare/.test(value)) return "Tricare";
  if (/hopkins|ehp|priority partners/.test(value)) return "Johns Hopkins EHP";
  if (/carefirst|bcbs|blue\s*cross|bluechoice/.test(value)) return "CareFirst BCBS";
  if (/medicaid|physicians care|amerigroup|molina/.test(value)) return "Medicaid";
  if (/medicare/.test(value)) return "Medicare";
  if (/self.?pay|cash/.test(value)) return "Self-Pay";
  return "";
}

function patientIndexProperties(patient) {
  // This row exists only so the remaining Notion-backed CrewOS workflows can
  // hold a relation to the authoritative Cloud patient. Keep the mirror
  // deliberately minimal: optional Index columns have changed over time and a
  // removed column must never prevent staff from selecting an existing patient.
  return {
    "Patient Name": W.title(patient.name),
    "DOB": W.date(patient.dob),
    // The Index's auto-number is only a local CrewOS relation number. Keep the
    // authoritative RCM patient ID in the existing writable text property.
    "Patient ID #": W.text(patient.bhwPatientId),
  };
}

function actionError(status, message) {
  return Object.assign(new Error(message), { status });
}

// CrewOS forms may submit either an existing relation-page id or an
// authoritative BHW Patient ID from the Cloud Registry. Resolve Cloud IDs only
// when a legacy workflow actually needs a Notion relation; staff never have to
// pre-link a patient before using a dropdown.
async function resolvePatientIndex(patientId, session) {
  const requestedId = String(patientId || "").trim();
  if (!requestedId) throw actionError(400, "Pick a patient");
  if (!/^BHW\d+$/i.test(requestedId)) {
    return { indexId: requestedId, patient: null, linked: false, backfilled: false };
  }

  const bhwPatientId = requestedId.toUpperCase();
  const [idxPages, cloudPatients] = await Promise.all([queryDb(DB.patients), listCloudPatients(session)]);
  const patient = cloudPatients.find((item) => String(item.bhwPatientId || "").toUpperCase() === bhwPatientId);
  if (!patient) throw actionError(404, "That patient is no longer available in the Patient Registry. Search again.");
  if (!patient.name || !patient.dob) throw actionError(409, "This Patient Registry record needs a name and birthday before CrewOS can use it safely.");

  const storedMasterId = (page) => P.text(page.properties["Patient ID #"]).trim().toUpperCase();
  const idMatches = idxPages.filter((page) => storedMasterId(page) === bhwPatientId);
  if (idMatches.length > 1) throw actionError(409, "CrewOS has more than one link for this Master Patient ID. Resolve the duplicate links before continuing.");

  let index = idMatches[0] || null;
  let backfilled = false;
  if (!index) {
    const blankIdentityMatches = idxPages.filter((page) =>
      !storedMasterId(page)
      && normalizePatientName(P.title(page.properties["Patient Name"])) === normalizePatientName(patient.name)
      && P.date(page.properties["DOB"]) === patient.dob
    );
    const cloudIdentityMatches = cloudPatients.filter((item) =>
      normalizePatientName(item.name) === normalizePatientName(patient.name)
      && item.dob === patient.dob
    );
    if (blankIdentityMatches.length > 1 || (blankIdentityMatches.length && cloudIdentityMatches.length > 1)) {
      throw actionError(409, "This name and birthday are not unique enough to link automatically. Review the Patient Registry identities first.");
    }
    index = blankIdentityMatches[0] || null;
    if (index) {
      await updatePage(index.id, { "Patient ID #": W.text(patient.bhwPatientId) });
      backfilled = true;
    }
  }

  let linked = false;
  if (!index) {
    index = await createPage(DB.patients, patientIndexProperties(patient));
    linked = true;
  }
  return { indexId: index.id, patient, linked, backfilled };
}

// CharmEd assessments still hold a relation to the transitional CrewOS Patient
// Index. Resolve that relation to the authoritative Cloud/Patient 360 identity
// before sending anything. A blank legacy ID may be backfilled only when exact
// name + DOB identifies one Cloud patient and no duplicate Index link exists.
async function resolvePatient360Patient(patientId, session, { backfill = true } = {}) {
  const requestedId = String(patientId || "").trim();
  if (!requestedId) throw actionError(400, "This assessment is not linked to a patient.");

  const cloudPatients = await listCloudPatients(session);
  const normalizedRequestedId = requestedId.toUpperCase();
  const directMatches = cloudPatients.filter((patient) =>
    String(patient.bhwPatientId || "").trim().toUpperCase() === normalizedRequestedId
    || String(patient.notionPageId || "").trim() === requestedId
  );
  if (directMatches.length > 1) {
    throw actionError(409, "CrewOS found more than one Patient Registry record for this identifier. Review the patient identities before sending.");
  }
  if (directMatches.length === 1) return { patient: directMatches[0], backfilled: false };

  let indexResponse;
  try {
    indexResponse = await httpJson("GET", `https://api.notion.com/v1/pages/${encodeURIComponent(requestedId)}`, null, { timeoutMs: 12_000 });
  } catch (error) {
    throw actionError(503, "Patient Registry check timed out. Close this window and try again.");
  }
  if (!indexResponse.ok || !indexResponse.data?.properties) {
    throw actionError(409, "CrewOS could not match this assessment to the Patient Registry. Open Patient Registry and verify the patient's BHW ID.");
  }
  const index = indexResponse.data;

  const storedMasterId = P.text(index.properties["Patient ID #"]).trim().toUpperCase();
  if (storedMasterId) {
    const masterMatches = cloudPatients.filter((patient) =>
      String(patient.bhwPatientId || "").trim().toUpperCase() === storedMasterId
    );
    if (masterMatches.length === 1) return { patient: masterMatches[0], backfilled: false };
    if (masterMatches.length > 1) {
      throw actionError(409, "CrewOS found more than one Patient Registry record for this BHW ID. Review the patient identities before sending.");
    }
    throw actionError(409, "This assessment's saved BHW ID no longer matches the Patient Registry. Review the patient identity before sending.");
  }

  const indexName = P.title(index.properties["Patient Name"]);
  const indexDob = P.date(index.properties["DOB"]);
  if (!indexName || !indexDob) {
    throw actionError(409, "This assessment needs a verified BHW ID before screening links can be sent.");
  }
  const identityMatches = cloudPatients.filter((patient) =>
    normalizePatientName(patient.name) === normalizePatientName(indexName)
    && patient.dob === indexDob
  );
  if (identityMatches.length !== 1) {
    throw actionError(409, identityMatches.length
      ? "This name and birthday match more than one Patient Registry record. Review the patient identities before sending."
      : "CrewOS could not match this assessment to the Patient Registry. Open Patient Registry and verify the patient's BHW ID.");
  }

  const patient = identityMatches[0];
  if (!backfill) return { patient, backfilled: false };

  const idxPages = await queryDb(DB.patients);
  const duplicateLinks = idxPages.filter((page) =>
    page.id !== index.id
    && P.text(page.properties["Patient ID #"]).trim().toUpperCase() === String(patient.bhwPatientId || "").trim().toUpperCase()
  );
  if (duplicateLinks.length) {
    throw actionError(409, "CrewOS has more than one Patient Index record for this BHW ID. Review the duplicate patient links before sending.");
  }

  await updatePage(index.id, { "Patient ID #": W.text(patient.bhwPatientId) });
  return { patient, backfilled: true };
}

let awvPropsEnsured = false;
async function ensureAwvReviewProps() {
  if (awvPropsEnsured) return;
  const res = await httpJson("PATCH", `https://api.notion.com/v1/databases/${DB.awv}`, {
    properties: {
      "Provider Review": { select: { options: [
        { name: "Pending Review", color: "orange" },
        { name: "Reviewed & Signed", color: "green" },
      ] } },
      "Signed By": { rich_text: {} },
      "Signed Date": { date: {} },
      "Provider Note": { rich_text: {} },
    },
  });
  if (res.ok) awvPropsEnsured = true;
}

const today = () => new Date().toISOString().slice(0, 10);

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
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.referrals, {
          "Referral": W.title(`${b.type || "Referral"} → ${b.to}`),
          "Patient": W.rel([patientId]),
          "From Division": W.sel(b.from),
          "To Division": W.sel(b.to),
          "Sent By": W.rel([session.staffId]),
          "Referral Type": W.sel(b.type || "Division Referral"),
          "Device": W.sel(b.device || null),
          "Details": W.text(b.details || ""),
          "Status": W.sel("Sent"),
          "Sent Date": W.date(today()),
          "Priority": W.sel(b.priority || "Routine"),
        });
        return json(200, { ok: true, id: page.id });
      }
      case "referral-status": {
        const allowed = ["Received", "In Progress", "Completed", "Declined/Redirect"];
        if (!allowed.includes(b.status)) return json(400, { error: "Bad status" });
        const props = { "Status": W.sel(b.status) };
        if (b.status === "Received" || b.status === "In Progress") props["Assigned To"] = W.rel([session.staffId]);
        if (b.status === "Completed") {
          props["Completed Date"] = W.date(today());
          props["Completion Note"] = W.text(b.note || "Completed");
        } else if (b.note) {
          props["Completion Note"] = W.text(b.note);
        }
        await updatePage(b.id, props);
        return json(200, { ok: true });
      }
      case "request-status": {
        // Patient Request Triage Queue — journey status + ownership.
        // Status is a Notion status-type property; Assigned To is read as a
        // select by frontdesk-data, so we write the staff's display name.
        if (!b.id) return json(400, { error: "Missing request id" });
        const allowed = ["Not started", "Acknowledged", "In progress", "Done"];
        if (!allowed.includes(b.status)) return json(400, { error: "Bad status" });
        const props = { "Status": W.status(b.status) };
        // Take ownership when claiming or moving into an active stage.
        if (b.claim || b.status === "Acknowledged" || b.status === "In progress") {
          props["Assigned To"] = W.sel(session.name);
        }
        await updatePage(b.id, props);
        return json(200, { ok: true, assignedTo: session.name });
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
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.handoffs, {
          "Handoff": W.title(`${b.from} → ${b.to}`),
          "Patient": W.rel([patientId]),
          "From Division": W.sel(b.from),
          "To Division": W.sel(b.to),
          "From Staff": W.rel([session.staffId]),
          "Summary": W.text(b.summary),
          "Needs": { multi_select: (b.needs || []).map((n) => ({ name: n })) },
          "Scheduled Date": W.date(b.scheduledDate || null),
          "Status": W.sel("New"),
        });
        return json(200, { ok: true, id: page.id });
      }
      case "handoff-status": {
        const allowed = ["Acknowledged", "Scheduled", "Completed"];
        if (!allowed.includes(b.status)) return json(400, { error: "Bad status" });
        const props = { "Status": W.sel(b.status) };
        if (b.status === "Acknowledged") {
          props["Acknowledged By"] = W.rel([session.staffId]);
          props["Acknowledged At"] = W.date(today());
        }
        if (b.status === "Scheduled" && b.scheduledDate) props["Scheduled Date"] = W.date(b.scheduledDate);
        await updatePage(b.id, props);
        return json(200, { ok: true });
      }

      /* ---------------- Minutes ---------------- */
      case "minutes-log": {
        if (!b.program || !b.minutes) return json(400, { error: "Program and minutes required" });
        const patientId = b.patientId ? (await resolvePatientIndex(b.patientId, session)).indexId : "";
        const page = await createPage(DB.minutes, {
          "Entry": W.title(`${b.program} · ${b.minutes} min · ${today()}`),
          "Staff": W.rel([session.staffId]),
          "Program": W.sel(b.program),
          "Patient": W.rel(patientId ? [patientId] : []),
          "Date": W.date(b.date || today()),
          "Minutes": W.num(b.minutes),
          "Activity": W.sel(b.activity || "Coordination"),
          "Note": W.text(b.note || ""),
          "In CharmHealth": W.check(false),
        });
        return json(200, { ok: true, id: page.id });
      }
      case "minutes-charm": {
        await updatePage(b.id, { "In CharmHealth": W.check(true) });
        return json(200, { ok: true });
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
        const stepProp = { 1: "S1 HRA", 2: "S2 Office Tests", 3: "S3 Prevention Plan", 4: "S4 Nutrition & Activity", 5: "S5 ACP" }[b.step];
        const props = {};
        if (stepProp) {
          props[stepProp] = W.sel(b.stepStatus || "Complete");
          props[`Answers S${b.step}`] = W.text(JSON.stringify(b.answers || {}));
        }
        if (b.flags) props["Flags"] = { multi_select: b.flags.map((n) => ({ name: n })) };
        if (b.computed) {
          if (b.computed.miniCog !== undefined) props["Mini-Cog Score"] = W.num(b.computed.miniCog);
          if (b.computed.diet !== undefined) props["Diet Score"] = W.num(b.computed.diet);
          if (b.computed.exercise !== undefined) props["Exercise Min/Week"] = W.num(b.computed.exercise);
        }
        if (b.status) {
          props["Status"] = W.sel(b.status);
          if (b.status === "Completed") {
            await ensureAwvReviewProps();
            props["Provider Review"] = W.sel("Pending Review");
          }
        }
        if (b.notes !== undefined) props["Notes"] = W.text(b.notes);
        if (b.id) {
          await updatePage(b.id, props);
          return json(200, { ok: true, id: b.id });
        }
        if (!b.patientId) return json(400, { error: "Pick a patient to start an AWV" });
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.awv, {
          "Encounter": W.title(`AWV · ${today()}`),
          "Patient": W.rel([patientId]),
          "Conducted By": W.rel([session.staffId]),
          "Date": W.date(today()),
          "Status": W.sel("In Progress"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "cm-save": {
        // The legacy assessment store has six answer slots. Keep the new
        // in-person visit and results as a versioned pair in slot six until
        // the protected Google Cloud assessment endpoint is available.
        const cmProp = { 1:"S1 Intake", 2:"S2 School & Attention", 3:"S3 Social & Sensory", 4:"S4 Wellbeing & Context", 5:"S5 Screeners" }[b.step];
        const props = {};
        if (cmProp) {
          props[cmProp] = W.sel(b.stepStatus || "Complete");
          props[`Answers S${b.step}`] = W.text(JSON.stringify(b.answers || {}));
        }
        if (b.step === 6 || b.step === 7) {
          const workflowAnswers = b.workflowAnswers || {};
          const workflowStepStatus = b.workflowStepStatus || {};
          props["S6 Results & Recs"] = W.sel(workflowStepStatus.results === "Complete" ? "Complete" : "In Progress");
          props["Answers S6"] = W.text(encodeCmWorkflow({
            __cmWorkflowV2: 1,
            inPerson: workflowAnswers.inPerson || {},
            results: workflowAnswers.results || {},
            stepStatus: {
              inPerson: workflowStepStatus.inPerson || "Not Started",
              results: workflowStepStatus.results || "Not Started",
            },
          }));
        }
        if (b.ageGroup) props["Age Group"] = W.sel(b.ageGroup);
        if (b.flags) props["Flags"] = { multi_select: b.flags.map((n) => ({ name: n })) };
        if (b.screeners) props["Suggested Screeners"] = { multi_select: b.screeners.map((n) => ({ name: n })) };
        if (b.status) props["Status"] = W.sel(b.status);
        if (b.notes !== undefined) props["Notes"] = W.text(b.notes);
        if (b.id) {
          await updatePage(b.id, props);
          return json(200, { ok: true, id: b.id });
        }
        if (!b.patientId) return json(400, { error: "Pick a patient to start an assessment" });
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.charmed, {
          "Assessment": W.title(`CharmEd Assessment · ${today()}`),
          "Patient": W.rel([patientId]),
          "Clinician": W.rel([session.staffId]),
          "Date": W.date(today()),
          "Status": W.sel("Intake"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "cma-save": {
        const cmaProp = { 1:"S1 Concerns & Function", 2:"S2 EF, Social & Sensory", 3:"S3 Mental Health & Cognition", 4:"S4 Substance, Injury & Trauma", 5:"S5 Vascular, Sleep & Change", 6:"S6 Screeners" }[b.step];
        const props = {};
        if (cmaProp) {
          props[cmaProp] = W.sel(b.stepStatus || "Complete");
          props[`Answers S${b.step}`] = W.text(JSON.stringify(b.answers || {}));
        }
        if (b.flags) props["Flags"] = { multi_select: b.flags.map((n) => ({ name: n })) };
        if (b.screeners) props["Suggested Screeners"] = { multi_select: b.screeners.map((n) => ({ name: n })) };
        if (b.status) props["Status"] = W.sel(b.status);
        if (b.notes !== undefined) props["Notes"] = W.text(b.notes);
        if (b.id) {
          await updatePage(b.id, props);
          return json(200, { ok: true, id: b.id });
        }
        if (!b.patientId) return json(400, { error: "Pick a patient to start an assessment" });
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.charmedAdult, {
          "Assessment": W.title(`Adult Assessment · ${today()}`),
          "Patient": W.rel([patientId]),
          "Clinician": W.rel([session.staffId]),
          "Date": W.date(today()),
          "Status": W.sel("Intake"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "patient-select": {
        const bhwPatientId = String(b.bhwPatientId || "").trim().toUpperCase();
        if (!/^BHW\d+$/i.test(bhwPatientId)) return json(400, { error: "Choose a patient from the Patient Registry" });
        const { indexId, patient, linked, backfilled } = await resolvePatientIndex(bhwPatientId, session);

        return json(200, {
          ok: true,
          id: indexId,
          name: patient.name,
          bhwId: patient.bhwPatientId,
          dob: patient.dob,
          chart: patient.mrn || "",
          insurance: indexInsurance(patient),
          memberId: patient.memberId || "",
          linked,
          backfilled,
        });
      }

      case "patient-create": {
        const name = (b.name || "").trim();
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
        // Dedup against BOTH lists (property names differ per DB), so we never
        // create a duplicate in either the Master List or the Index.
        const [idxPages, cloudPatients] = await Promise.all([queryDb(DB.patients), listCloudPatients(session)]);
        const existingIdx = idxPages.map((pg) => ({
          id: pg.id,
          name: P.title(pg.properties["Patient Name"]),
          bhwId: P.uid(pg.properties["BHW ID"]),
          dob: P.date(pg.properties["DOB"]),
          chart: P.text(pg.properties["CharmHealth Chart #"]),
        }));
        const existingMaster = cloudPatients.map((patient) => ({
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
        // Prefer Index dupes for returned ids (crewOS relations reference the
        // Index); include Master-only dupes so we don't silently double-create.
        const dupes = existingIdx.filter(isDupe)
          .concat(existingMaster.filter((m) => isDupe(m) && !existingIdx.some((i) => norm(i.name) === norm(m.name) && i.dob === m.dob)));
        const exact = dupes.find((p) => norm(p.name) === n && p.dob === b.dob);
        if (exact) return json(409, { error: `${exact.name} (${exact.bhwId}) already exists with this exact name and birthday — use the existing record.`, duplicates: dupes.map(({ id, name, bhwId, dob }) => ({ id, name, bhwId, dob })) });
        if (dupes.length && !b.force) return json(200, { duplicates: dupes.map(({ id, name, bhwId, dob }) => ({ id, name, bhwId, dob })) });

        // Next BHW#### control number (the Master List's Patient Ctl No is a
        // manual text field, so we derive the next number from both lists).
        const maxNum = existingMaster.concat(existingIdx).reduce((mx, p) => {
          const m = /BHW0*(\d+)/i.exec(p.bhwId || "");
          return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
        }, 0);
        const ctlNo = "BHW" + String(maxNum + 1).padStart(4, "0");
        const mbi = b.mbi ? String(b.mbi).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";
        const nameParts = name.split(/\s+/).filter(Boolean);
        const cloudPatient = {
          bhwPatientId: ctlNo,
          legalFirstName: nameParts.slice(0, -1).join(" ") || nameParts[0],
          legalLastName: nameParts.length > 1 ? nameParts.at(-1) : "Unknown",
          dateOfBirth: b.dob,
          email: b.email || "",
          guardianEmail: b.guardianEmail || "",
          patientStatus: "active",
          primaryPayer: b.insurance || "",
          insurancePlanName: b.insurance || "",
          memberId: b.memberId || "",
          medicareMbi: mbi,
          mrn: b.chart || "",
          programEnrollment: Array.isArray(b.programs) ? b.programs : [],
          source: { system: "crewhq-registration", importedAt: new Date().toISOString() },
        };
        // Write the authoritative Cloud record first. Transitional Notion rows
        // below keep existing operational relations working during migration.
        await cloudRequest(`/v1/patients/${encodeURIComponent(ctlNo)}`, {
          actor: session, method: "PUT", body: cloudPatient,
        });

        // 1) Transitional master-row mirror. Insurance goes to the free-text
        //    Insurance Plan Name, never the controlled Payer select.
        const masterProps = {
          "Patient Name": W.title(name),
          "Patient Ctl No": W.text(ctlNo),
          "DOB": W.date(b.dob),
        };
        if (b.insurance) masterProps["Insurance Plan Name"] = W.text(b.insurance);
        if (b.memberId) masterProps["Insurance Member ID"] = W.text(b.memberId);
        if (b.chart) masterProps["MRN"] = W.text(b.chart);
        if (mbi) masterProps["Medicare MBI"] = W.text(mbi);
        if (b.email) masterProps["Email"] = { email: b.email };
        if (b.guardianEmail) masterProps["Guardian Email"] = { email: b.guardianEmail };
        const master = await createPage(MASTER_DB, masterProps);
        await cloudRequest(`/v1/patients/${encodeURIComponent(ctlNo)}`, {
          actor: session, method: "PUT",
          body: { ...cloudPatient, source: { ...cloudPatient.source, recordId: master.id, recordUrl: master.url || "" } },
        });

        // 2) Mirror into the Patient Index so crewOS ops-data + the "Patient"
        //    relations keep working. crewOS references the Index id, so that's
        //    what we return as `id`.
        const indexProps = {
          ...patientIndexProperties({ name, dob: b.dob, bhwPatientId: ctlNo }),
          "Status": W.sel("Active"),
        };
        if (b.insurance) indexProps["Insurance"] = W.sel(b.insurance);
        if (b.memberId) indexProps["Insurance Member ID"] = W.text(b.memberId);
        if (mbi) indexProps["Medicare MBI"] = W.text(mbi);
        if (b.email) indexProps["Email"] = { email: b.email };
        if (b.guardianEmail) indexProps["Guardian Email"] = { email: b.guardianEmail };
        if (b.programs && b.programs.length) indexProps["Active Divisions"] = { multi_select: b.programs.map((x) => ({ name: x })) };
        const index = await createPage(DB.patients, indexProps);

        return json(200, { ok: true, id: index.id, masterId: master.id, bhwId: ctlNo, name });
      }

      case "care-log-save": {
        if (!b.id) return json(400, { error: "Missing entry id" });
        const props = {};
        if (b.minutes !== undefined) props["Minutes Logged"] = W.num(b.minutes);
        if (b.activities !== undefined) props["Activities Done"] = W.text(b.activities);
        if (b.referrals !== undefined) props["Referrals Completed"] = W.text(b.referrals);
        if (b.nextFollowUp !== undefined) props["Next Follow-up"] = W.date(b.nextFollowUp || null);
        if (b.followUpStage !== undefined) props["Follow-up Stage"] = W.sel(b.followUpStage);
        if (b.status !== undefined) props["Status"] = W.sel(b.status);
        if (b.lastContact !== undefined) props["Last Contact"] = W.date(b.lastContact || null);
        if (!Object.keys(props).length) return json(400, { error: "Nothing to update" });
        await updatePage(b.id, props);
        return json(200, { ok: true, id: b.id });
      }

      case "care-log-create": {
        const name = (b.name || "").trim();
        if (!name) return json(400, { error: "Patient name required" });
        const program = b.program || "TCM";
        const props = {
          "Entry": W.title(`${name} — ${program}${b.month ? " · " + b.month : ""}`),
          "Program": W.sel(program),
          "Type": W.sel(b.type || (program === "TCM" ? "Episode" : "Monthly")),
          "Status": W.sel(b.status || "Open"),
        };
        if (b.patientId) props["Patient"] = W.rel([(await resolvePatientIndex(b.patientId, session)).indexId]);
        if (b.ctlNo) props["Patient Ctl No"] = W.text(b.ctlNo);
        if (b.month) props["Service Month"] = W.date(b.month + "-01");
        if (b.episodeDate) props["Episode / Discharge Date"] = W.date(b.episodeDate);
        if (b.icd) props["ICD-10 Codes"] = W.text(b.icd);
        if (b.primaryDx) props["Primary Diagnosis"] = W.text(b.primaryDx);
        if (b.memberId) props["Member ID"] = W.text(b.memberId);
        if (b.notes) props["Notes"] = W.text(b.notes);
        if (b.minutes !== undefined) props["Minutes Logged"] = W.num(b.minutes);
        if (b.nextFollowUp) props["Next Follow-up"] = W.date(b.nextFollowUp);
        if (b.followUpStage) props["Follow-up Stage"] = W.sel(b.followUpStage);
        const page = await createPage(DB.careLog, props);
        return json(200, { ok: true, id: page.id });
      }

      case "prog-save": {
        const props = {};
        if (b.track) props["Track"] = W.sel(b.track);
        if (b.stage) props["Stage"] = W.sel(b.stage);
        if (b.startDate) props["Start Date"] = W.date(b.startDate);
        if (b.battery) props["Baseline Battery"] = { multi_select: b.battery.map((n) => ({ name: n })) };
        if (b.baselineDate) props["Baseline Date"] = W.date(b.baselineDate);
        if (b.baselineSummary !== undefined) props["Baseline Summary"] = W.text(b.baselineSummary);
        if (b.retestDate) props["Retest Date"] = W.date(b.retestDate);
        if (b.retestSummary !== undefined) props["Retest Summary"] = W.text(b.retestSummary);
        if (b.progressNote !== undefined) props["Progress Notes"] = W.text(b.progressNote);
        if (b.id) {
          await updatePage(b.id, props);
          return json(200, { ok: true, id: b.id });
        }
        if (!b.patientId) return json(400, { error: "Pick a patient to enroll" });
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.charmedProgram, {
          "Enrollment": W.title(`12-Week Program · ${today()}`),
          "Patient": W.rel([patientId]),
          "Clinician": W.rel([session.staffId]),
          "Start Date": W.date(b.startDate || today()),
          "Baseline Date": W.date(b.baselineDate || today()),
          "Stage": W.sel("Enrolled"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "ph-plan-save": {
        const props = {};
        if (b.lrKind === "baseline" && b.lr) {
          props["LR Baseline"] = W.text(JSON.stringify(b.lr));
          props["Readiness Baseline %"] = W.num(b.lrPct);
        }
        if (b.lrKind === "latest" && b.lr) {
          props["LR Latest"] = W.text(JSON.stringify(b.lr));
          props["Readiness Latest %"] = W.num(b.lrPct);
          props["LR Latest Date"] = W.date(today());
        }
        if (b.drivers) props["Symptom Drivers"] = { multi_select: b.drivers.map((n) => ({ name: n })) };
        if (b.screens) {
          props["BH Screen Log"] = W.text(JSON.stringify(b.screens));
          const last = b.screens[b.screens.length - 1] || {};
          if (last.phq9 !== undefined && last.phq9 !== "") props["Latest PHQ-9"] = W.num(+last.phq9);
          if (last.gad7 !== undefined && last.gad7 !== "") props["Latest GAD-7"] = W.num(+last.gad7);
          if (last.date) props["Latest Screen Date"] = W.date(last.date);
        }
        if (b.goals) props["Growth Goals"] = W.text(JSON.stringify(b.goals));
        if (b.stage) props["Stage"] = W.sel(b.stage);
        if (b.notes !== undefined) props["Notes"] = W.text(b.notes);
        if (b.id) {
          await updatePage(b.id, props);
          return json(200, { ok: true, id: b.id });
        }
        if (!b.patientId) return json(400, { error: "Pick a resident to start a growth plan" });
        const patientId = (await resolvePatientIndex(b.patientId, session)).indexId;
        const page = await createPage(DB.phplans, {
          "Plan": W.title(`Growth Plan · ${today()}`),
          "Resident": W.rel([patientId]),
          "Case Lead": W.rel([session.staffId]),
          "Move-In Date": W.date(b.moveIn || today()),
          "Stage": W.sel("Month 1 — Stabilize & Assess"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "cm-screening-readiness": {
        if (!b.patientId) return json(400, { error: "This assessment is not linked to a patient." });
        if (session.access !== "Admin" && !vis.includes("CharmEd Minds")) {
          return json(403, { error: "CharmEd Minds access is required to verify this screening patient." });
        }
        const { patient } = await resolvePatient360Patient(b.patientId, session, { backfill: false });
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
        const { patient } = await resolvePatient360Patient(patientId, session);
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
        await ensureAwvReviewProps();
        await updatePage(b.id, {
          "Provider Review": W.sel("Reviewed & Signed"),
          "Signed By": W.text(`${session.name} · electronically signed via BHWcrewOS`),
          "Signed Date": W.date(today()),
          "Provider Note": W.text(b.note || ""),
        });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    return json(err.status || 500, { error: err.message });
  }
};
