// netlify/functions/care-log-data.js — read side for the Care Management board
// (bhw-care-management.html). Session-gated (crewOS PIN). Read-only.
//
//   POST { action:"list", program?, month? }
//        → { entries:[ {id, entry, program, type, month, episodeDate, minutes,
//                       activities, referrals, nextFollowUp, followUpStage,
//                       status, primaryDx, icd, coordinator, memberId, ctlNo,
//                       lastContact, notes, patientId} ], updated }
//
// One row per patient per month (CCM/APCM) or per episode (TCM). The board
// filters client-side too, but program/month narrow the payload when given.

const { DB, queryDb, P, getSession, json } = require("./_lib");

const people = (p) => (p?.people || []).map((u) => u.name).filter(Boolean).join(", ");

function shape(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    entry: P.title(p["Entry"]),
    program: P.sel(p["Program"]),
    type: P.sel(p["Type"]),
    month: P.date(p["Service Month"]),
    episodeDate: P.date(p["Episode / Discharge Date"]),
    minutes: P.num(p["Minutes Logged"]),
    activities: P.text(p["Activities Done"]),
    referrals: P.text(p["Referrals Completed"]),
    nextFollowUp: P.date(p["Next Follow-up"]),
    followUpStage: P.sel(p["Follow-up Stage"]),
    status: P.sel(p["Status"]),
    primaryDx: P.text(p["Primary Diagnosis"]),
    icd: P.text(p["ICD-10 Codes"]),
    coordinator: people(p["Care Coordinator"]),
    memberId: P.text(p["Member ID"]),
    ctlNo: P.text(p["Patient Ctl No"]),
    lastContact: P.date(p["Last Contact"]),
    notes: P.text(p["Notes"]),
    patientId: P.rel(p["Patient"])[0] || "",
    edited: pg.last_edited_time || "",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to crewOS again." });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN is not set on this site" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    if ((body.action || "list") === "list") {
      let entries = (await queryDb(DB.careLog)).map(shape);
      const program = String(body.program || "").trim();
      const month = String(body.month || "").trim(); // YYYY-MM
      if (program && program !== "All") entries = entries.filter((e) => e.program === program);
      if (month) entries = entries.filter((e) => (e.month || "").slice(0, 7) === month);
      entries.sort((a, b) =>
        (a.nextFollowUp || "9999").localeCompare(b.nextFollowUp || "9999") ||
        a.entry.localeCompare(b.entry));
      const updated = entries.reduce((m, e) => (e.edited > m ? e.edited : m), "");
      return json(200, { entries, count: entries.length, updated });
    }
    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
