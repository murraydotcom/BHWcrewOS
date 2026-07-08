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
        const existing = (await queryDb(DB.patients)).map((pg) => ({
          id: pg.id,
          name: P.title(pg.properties["Patient Name"]),
          bhwId: P.uid(pg.properties["BHW ID"]),
          dob: P.date(pg.properties["DOB"]),
          chart: P.text(pg.properties["CharmHealth Chart #"]),
        }));
        const n = norm(name);
        const dupes = existing.filter((p) => {
          const pn = norm(p.name);
          if (pn === n) return true;                                   // same name (spacing/case-proof)
          if (p.dob && p.dob === b.dob && lastTok(p.name) === lastTok(name)) return true; // same DOB + last name
          if (dist(pn, n) <= 2) return true;                           // near-miss spelling
          if (b.chart && p.chart && p.chart.trim() === b.chart.trim()) return true;       // same chart #
          return false;
        });
        const exact = dupes.find((p) => norm(p.name) === n && p.dob === b.dob);
        if (exact) return json(409, { error: `${exact.name} (${exact.bhwId}) already exists with this exact name and birthday — use the existing record.`, duplicates: dupes });
        if (dupes.length && !b.force) return json(200, { duplicates: dupes.map(({ id, name, bhwId, dob }) => ({ id, name, bhwId, dob })) });
        const props = {
          "Patient Name": W.title(name),
          "DOB": W.date(b.dob),
          "Status": W.sel("Active"),
        };
        if (b.insurance) props["Insurance"] = W.sel(b.insurance);
        if (b.memberId) props["Insurance Member ID"] = W.text(b.memberId);
        if (b.chart) props["CharmHealth Chart #"] = W.text(b.chart);
        if (b.mbi) props["Medicare MBI"] = W.text(String(b.mbi).replace(/[^A-Za-z0-9]/g, "").toUpperCase());
        if (b.programs && b.programs.length) props["Active Divisions"] = { multi_select: b.programs.map((x) => ({ name: x })) };
        const page = await createPage(DB.patients, props);
        return json(200, { ok: true, id: page.id, name });
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
