// netlify/functions/careplan-save.js — save a generated care plan to Notion.
// Session-gated. Writes one row to "Care Plans — Data"; the Snapshot field
// holds the full plain-text of the plan as the patient received it.
//
//   POST { program, patientName, bhwId, dob, planYear, planDate, reviewDate,
//          focus, goals, interventions, patientRole, careTeam, preparedBy,
//          snapshot, status }
//        → { ok, id }

const { DB, DIVISIONS, createPage, W, getSession, json } = require("./_lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Signed out — sign in to crewOS again." });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN is not set on this site" });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  if (!b.program || !DIVISIONS.includes(b.program)) return json(400, { error: "Pick a program" });
  const patientName = String(b.patientName || "").trim();
  if (!patientName) return json(400, { error: "A care plan needs a patient name" });

  const year = Number(b.planYear) || new Date(b.planDate || Date.now()).getFullYear();
  const title = `Care Plan — ${patientName} — ${b.program}${year ? ` — ${year}` : ""}`;

  const props = {
    "Name": W.title(title),
    "Program": W.sel(b.program),
    "Patient Name": W.text(patientName),
    "BHW ID": W.text(b.bhwId || ""),
    "DOB": W.date(b.dob || null),
    "Plan Year": W.num(year || null),
    "Plan Date": W.date(b.planDate || null),
    "Review Date": W.date(b.reviewDate || null),
    "Focus / Diagnoses": W.text(b.focus || ""),
    "Goals": W.text(b.goals || ""),
    "Interventions": W.text(b.interventions || ""),
    "Patient Role": W.text(b.patientRole || ""),
    "Care Team": W.text(b.careTeam || ""),
    "Prepared By": W.text(b.preparedBy || session.name || ""),
    "Status": W.sel(["Draft", "Active", "Completed", "Archived"].includes(b.status) ? b.status : "Active"),
    "Snapshot": W.text(b.snapshot || ""),
  };

  try {
    const page = await createPage(DB.carePlans, props);
    return json(200, { ok: true, id: page.id });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
