// netlify/functions/action.js — all writes for BHWcrewOS.
// Every action validates the session and enforces division rules server-side.
//
// Actions:
//   referral-create, referral-status
//   handoff-create, handoff-status (acknowledge/schedule/complete)
//   minutes-log, minutes-charm (toggle In CharmHealth)
//   availability-submit
//   booking-create (requires Can Schedule; enforces room rules + conflicts)

const { DB, DIVISIONS, httpJson, queryDb, createPage, updatePage, P, W, getSession, visibleDivisions, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

// Google Cloud is the authoritative patient list. During migration, new
// registrations are also mirrored to the Notion master and lean Patient Index
// so existing operational relations continue to work.
const MASTER_DB = process.env.MASTER_DB_ID || "2cf580758d3080f0825de4bbfb6c7528";

function sendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const key = (process.env.RESEND_API_KEY || "").trim();
    if (!key) return reject(new Error("RESEND_API_KEY is not set in Netlify environment variables"));
    const from = (process.env.RESEND_FROM || "").trim();
    if (!from) return reject(new Error("RESEND_FROM is not set (e.g. BHW Medical Group <care@yourdomain.com>)"));
    const https = require("https");
    const data = JSON.stringify({ from, to: [to], subject, html });
    const req = https.request({
      hostname: "api.resend.com", path: "/emails", method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let out = ""; res.on("data", (ch) => (out += ch));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(out || "{}"));
        else reject(new Error(`Email service ${res.statusCode}: ${out.slice(0, 300)}`));
      });
    });
    req.on("error", reject); req.write(data); req.end();
  });
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
        const page = await createPage(DB.referrals, {
          "Referral": W.title(`${b.type || "Referral"} → ${b.to}`),
          "Patient": W.rel([b.patientId]),
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
        const page = await createPage(DB.handoffs, {
          "Handoff": W.title(`${b.from} → ${b.to}`),
          "Patient": W.rel([b.patientId]),
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
        const page = await createPage(DB.minutes, {
          "Entry": W.title(`${b.program} · ${b.minutes} min · ${today()}`),
          "Staff": W.rel([session.staffId]),
          "Program": W.sel(b.program),
          "Patient": W.rel(b.patientId ? [b.patientId] : []),
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
        const page = await createPage(DB.awv, {
          "Encounter": W.title(`AWV · ${today()}`),
          "Patient": W.rel([b.patientId]),
          "Conducted By": W.rel([session.staffId]),
          "Date": W.date(today()),
          "Status": W.sel("In Progress"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "cm-save": {
        const cmProp = { 1:"S1 Intake", 2:"S2 School & Attention", 3:"S3 Social & Sensory", 4:"S4 Wellbeing & Context", 5:"S5 Screeners", 6:"S6 Results & Recs" }[b.step];
        const props = {};
        if (cmProp) {
          props[cmProp] = W.sel(b.stepStatus || "Complete");
          props[`Answers S${b.step}`] = W.text(JSON.stringify(b.answers || {}));
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
        const page = await createPage(DB.charmed, {
          "Assessment": W.title(`CharmEd Assessment · ${today()}`),
          "Patient": W.rel([b.patientId]),
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
        const page = await createPage(DB.charmedAdult, {
          "Assessment": W.title(`Adult Assessment · ${today()}`),
          "Patient": W.rel([b.patientId]),
          "Clinician": W.rel([session.staffId]),
          "Date": W.date(today()),
          "Status": W.sel("Intake"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
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
          "Patient Name": W.title(name),
          "DOB": W.date(b.dob),
          "Status": W.sel("Active"),
        };
        if (b.insurance) indexProps["Insurance"] = W.sel(b.insurance);
        if (b.memberId) indexProps["Insurance Member ID"] = W.text(b.memberId);
        if (b.chart) indexProps["CharmHealth Chart #"] = W.text(b.chart);
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
        if (b.patientId) props["Patient"] = W.rel([b.patientId]);
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
        const page = await createPage(DB.charmedProgram, {
          "Enrollment": W.title(`12-Week Program · ${today()}`),
          "Patient": W.rel([b.patientId]),
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
        const page = await createPage(DB.phplans, {
          "Plan": W.title(`Growth Plan · ${today()}`),
          "Resident": W.rel([b.patientId]),
          "Case Lead": W.rel([session.staffId]),
          "Move-In Date": W.date(b.moveIn || today()),
          "Stage": W.sel("Month 1 — Stabilize & Assess"),
          ...props,
        });
        return json(200, { ok: true, id: page.id });
      }

      case "cm-send-screeners": {
        // Email the selected screener form links, log it, advance the flow.
        const { assessmentId, kind, to, screeners, audience } = b;
        if (!assessmentId || !to || !screeners || !screeners.length) {
          return json(400, { error: "Need the assessment, a recipient email, and at least one screener" });
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(400, { error: "That email address doesn't look right" });
        const linkRows = await queryDb(DB.screenerLinks);
        const links = linkRows.map((pg) => ({
          name: P.title(pg.properties["Screener"]),
          url: pg.properties["Form URL"]?.url || "",
          audience: P.sel(pg.properties["Audience"]) || "Any",
          active: P.check(pg.properties["Active"]),
        })).filter((l) => l.active && l.url);
        const matched = [], missing = [];
        for (const s of screeners) {
          const nameMatch = (l) =>
            l.name.toLowerCase().includes(s.toLowerCase().split("/")[0].trim()) ||
            s.toLowerCase().includes(l.name.toLowerCase().replace(/\s*\((parent|teacher|self)\)\s*/i, "").trim());
          const candidates = links.filter(nameMatch);
          // Prefer the version built for this recipient (Parent/Teacher/Self), then Any, then whatever exists
          const hit = candidates.find((l) => l.audience === (audience || "Any"))
                   || candidates.find((l) => l.audience === "Any")
                   || candidates[0];
          if (hit) matched.push({ screener: s, url: hit.url });
          else missing.push(s);
        }
        if (!matched.length) {
          return json(400, { error: `No form links found for: ${missing.join(", ")}. Add them to the Screener Form Links database in Notion first.` });
        }
        const audienceWord = audience === "Teacher" ? "the student's teacher" : audience === "Self" ? "you" : "your child";
        const html = `
          <div style="font-family:Lora,Georgia,serif;max-width:560px;margin:0 auto;color:#0B1228">
            <div style="background:#0B1228;color:#FAF7F2;padding:24px 26px;border-radius:14px 14px 0 0;text-align:center">
              <img src="https://bhwcrewos.netlify.app/assets/charmed-minds-logo.png" alt="CharmEd Minds" width="84" height="84" style="border-radius:50%;display:block;margin:0 auto 10px">
              <div style="font-family:Montserrat,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:1px">CHARMED MINDS</div>
              <div style="font-family:Lora,Georgia,serif;font-style:italic;font-size:13px;color:#F2B134;margin-top:4px">Bright minds supported with strategy.</div>
            </div>
            <div style="border:1px solid #E9E2D6;border-top:none;padding:24px 26px;border-radius:0 0 14px 14px;background:#FAF7F2">
              <p>Hello,</p>
              <p>As part of the CharmEd Minds assessment, we're asking ${audienceWord} to complete the following questionnaire${matched.length > 1 ? "s" : ""}. Each takes just a few minutes, and your answers help us build the clearest picture:</p>
              ${matched.map((m) => `<p style="margin:14px 0"><a href="${m.url}" style="background:#F2B134;color:#0B1228;text-decoration:none;padding:11px 22px;border-radius:24px;font-family:Montserrat,Arial,sans-serif;font-size:14px;font-weight:700">Complete: ${m.screener}</a></p>`).join("")}
              <p>Please complete ${matched.length > 1 ? "these" : "this"} within the next few days. If anything is unclear, just reply or call the office — we're happy to help.</p>
              <p style="color:#114766;font-size:13px">— The CharmEd Minds team at BHW Medical Group<br>2131 Maryland Ave, Baltimore, MD 21218</p>
              <p style="font-family:Montserrat,Arial,sans-serif;font-size:10px;letter-spacing:2px;color:#2CA7A6;text-align:center;margin-top:18px">COGNITION · CONFIDENCE · STRATEGY · GROWTH</p>
            </div>
          </div>`;
        await sendEmail(to, `CharmEd Minds — ${matched.length} questionnaire${matched.length > 1 ? "s" : ""} to complete`, html);
        // Log + advance the assessment
        const dbId = kind === "adult" ? DB.charmedAdult : DB.charmed;
        const pages = await queryDb(dbId);
        const pg = pages.find((x) => x.id === assessmentId);
        const prevNotes = pg ? P.text(pg.properties["Notes"]) : "";
        const stamp = `📤 ${today()}: emailed ${matched.map((m) => m.screener).join(", ")} to ${to}${missing.length ? ` (no link on file for: ${missing.join(", ")})` : ""}`;
        await updatePage(assessmentId, {
          "Status": W.sel("Screeners Pending"),
          "Notes": W.text(`${prevNotes ? prevNotes + "\n" : ""}${stamp}`.slice(0, 1900)),
        });
        return json(200, { ok: true, sent: matched.map((m) => m.screener), missing });
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
    return json(500, { error: err.message });
  }
};
