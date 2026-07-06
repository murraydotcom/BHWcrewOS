// netlify/functions/ops-data.js — dashboard payload, division walls enforced HERE.
// Returns only what the signed-in person's divisions permit. Admins see all.

const { DB, queryDb, P, getSession, visibleDivisions, json } = require("./_lib");

function shapeReferral(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    title: P.title(p["Referral"]),
    patient: P.rel(p["Patient"])[0] || null,
    from: P.sel(p["From Division"]),
    to: P.sel(p["To Division"]),
    sentBy: P.rel(p["Sent By"])[0] || null,
    type: P.sel(p["Referral Type"]),
    device: P.sel(p["Device"]),
    details: P.text(p["Details"]),
    status: P.sel(p["Status"]),
    completionNote: P.text(p["Completion Note"]),
    sentDate: P.date(p["Sent Date"]),
    completedDate: P.date(p["Completed Date"]),
    priority: P.sel(p["Priority"]),
  };
}

function shapeHandoff(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    title: P.title(p["Handoff"]),
    patient: P.rel(p["Patient"])[0] || null,
    from: P.sel(p["From Division"]),
    to: P.sel(p["To Division"]),
    fromStaff: P.rel(p["From Staff"])[0] || null,
    summary: P.text(p["Summary"]),
    needs: P.multi(p["Needs"]),
    scheduledDate: P.date(p["Scheduled Date"]),
    status: P.sel(p["Status"]),
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
    const [staffPages, patientPages, roomPages, referralPages, handoffPages, schedulePages, minutePages, resourcePages] =
      await Promise.all([
        queryDb(DB.staff),
        queryDb(DB.patients),
        queryDb(DB.rooms),
        queryDb(DB.referrals),
        queryDb(DB.handoffs),
        queryDb(DB.schedule),
        queryDb(DB.minutes),
        queryDb(DB.resources),
      ]);

    const staff = staffPages.map((pg) => ({
      id: pg.id,
      name: P.title(pg.properties["Name"]),
      role: P.sel(pg.properties["Role"]),
      divisions: P.multi(pg.properties["Divisions"]),
      active: P.check(pg.properties["Active"]),
    }));
    const staffName = Object.fromEntries(staff.map((s) => [s.id, s.name]));

    // Patient directory: id + name + BHW ID, for pickers and display.
    const patients = patientPages.map((pg) => ({
      id: pg.id,
      name: P.title(pg.properties["Patient Name"]),
      bhwId: P.uid(pg.properties["BHW ID"]),
      chart: P.text(pg.properties["CharmHealth Chart #"]),
    }));
    const patientLabel = Object.fromEntries(patients.map((p) => [p.id, `${p.name} (${p.bhwId})`]));

    const rooms = roomPages.map((pg) => ({
      id: pg.id,
      name: P.title(pg.properties["Room"]),
      allowed: P.multi(pg.properties["Allowed Services"]),
      capacity: P.num(pg.properties["Capacity"]),
      active: P.check(pg.properties["Active"]),
    }));

    // Division walls: a referral/handoff is visible if either end is in your divisions.
    const referrals = referralPages.map(shapeReferral).filter((r) => inVis(r.from) || inVis(r.to));
    const handoffs = handoffPages.map(shapeHandoff).filter((h) => inVis(h.from) || inVis(h.to));

    // Schedule: your divisions' bookings + Shared; admins see everything.
    const schedule = schedulePages
      .map(shapeBooking)
      .filter((b) => isAdmin || inVis(b.division) || b.division === "Shared")
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

    // Minutes: your own entries; admins get a program rollup for the current month.
    const monthKey = new Date().toISOString().slice(0, 7);
    const myMinutes = minutePages
      .filter((pg) => P.rel(pg.properties["Staff"]).includes(session.staffId))
      .map((pg) => ({
        id: pg.id,
        program: P.sel(pg.properties["Program"]),
        patient: P.rel(pg.properties["Patient"])[0] || null,
        date: P.date(pg.properties["Date"]),
        minutes: P.num(pg.properties["Minutes"]) || 0,
        activity: P.sel(pg.properties["Activity"]),
        inCharm: P.check(pg.properties["In CharmHealth"]),
      }));
    const myMonthMinutes = myMinutes.filter((m) => (m.date || "").startsWith(monthKey));
    const notInCharm = myMinutes.filter((m) => !m.inCharm).length;

    let adminRollup = null;
    let porterhouse = null;
    if (isAdmin || vis.includes("The Porter House")) {
      const phPages = await queryDb(DB.porterhouse);
      porterhouse = phPages.map((pg) => ({
        id: pg.id,
        resident: P.title(pg.properties["Resident"]),
        phId: P.uid(pg.properties["PH ID"]),
        unit: P.text(pg.properties["Room/Unit"]),
        alsoReceives: P.multi(pg.properties["Also Receives"]),
        status: P.sel(pg.properties["Status"]),
        admit: P.date(pg.properties["Admit Date"]),
      }));
    }
    if (isAdmin) {
      adminRollup = {};
      for (const pg of minutePages) {
        const d = P.date(pg.properties["Date"]) || "";
        if (!d.startsWith(monthKey)) continue;
        const prog = P.sel(pg.properties["Program"]) || "—";
        adminRollup[prog] = (adminRollup[prog] || 0) + (P.num(pg.properties["Minutes"]) || 0);
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
      rooms: rooms.filter((r) => r.active),
      referrals,
      handoffs,
      schedule,
      minutes: { mine: myMinutes.slice(-100), monthTotal: myMonthMinutes.reduce((a, m) => a + m.minutes, 0), notInCharm },
      adminRollup,
      porterhouse,
      resources,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
