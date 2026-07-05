// netlify/functions/action.js — all writes for BHWcrewOS.
// Every action validates the session and enforces division rules server-side.
//
// Actions:
//   referral-create, referral-status
//   handoff-create, handoff-status (acknowledge/schedule/complete)
//   minutes-log, minutes-charm (toggle In CharmHealth)
//   availability-submit
//   booking-create (requires Can Schedule; enforces room rules + conflicts)

const { DB, DIVISIONS, queryDb, createPage, updatePage, P, W, getSession, visibleDivisions, json } = require("./_lib");

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

      default:
        return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    return json(500, { error: err.message });
  }
};
