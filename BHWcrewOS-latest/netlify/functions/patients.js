// netlify/functions/patients.js — Master Patient List lookup for the
// Paperwork Studio patient picker. Read-only, session-gated.
//
//   POST { action:"list" }  → [{ id, name, bhwId, dob, chart, insurance, memberId }]
//                             (active patients only; deceased excluded)
//
// Note: the patients database holds demographics + insurance, NOT ICD-10
// diagnoses — those still come from the note (AI/regex prefill) or manual entry.

const { DB, queryDb, P, getSession, json } = require("./_lib");

function shape(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    name: P.title(p["Patient Name"]),
    bhwId: P.uid(p["BHW ID"]),
    dob: P.date(p["DOB"]),
    chart: P.text(p["CharmHealth Chart #"]),
    insurance: P.sel(p["Insurance"]),
    memberId: P.text(p["Insurance Member ID"]),
    status: P.sel(p["Status"]),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Signed out — sign in to crewOS again." });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN is not set on this site" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    if (body.action === "list") {
      const patients = (await queryDb(DB.patients))
        .map(shape)
        .filter((p) => p.name && p.status !== "Deceased")
        .map(({ status, ...rest }) => rest)
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { patients });
    }
    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
