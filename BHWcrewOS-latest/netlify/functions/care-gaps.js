// netlify/functions/care-gaps.js — Gaps in Care, from the payer Wellness Report.
//
// BHW uploads each month's Medicare "Wellness Report" (HETS-derived preventive
// eligibility) into ONE persistent Notion DB — "Medicare Wellness Report" under
// the Gaps in Care Management page — via Notion's "Merge with CSV" (append). This
// function is the read side: crewOS calls it to surface each patient's open
// preventive gaps right in the AWV flow, matched by their Insurance Member ID
// (falling back to a normalized name match).
//
// Read-only, session-gated (crewOS PIN). Source of truth stays in Notion; this
// never writes. Each row is one (patient, preventive code) eligibility line.
//
//   POST { action:"for", memberId, name }
//        → { matched:true|false, patient:{name,memberId,payer}, gaps:[…] }
//        Matches by Member ID first (exact, then case-insensitive), else by
//        normalized name. Returns only that patient's rows.
//
//   POST { action:"list" }
//        → { patients:[ {name, memberId, payer, gaps:[…]} ], rows, updated }
//        Every patient in the report, each with their gap lines. For the board.
//
// A "gap" line: { code, label, hcpcs, state, open, eligibleProf, eligibleTech }.
//   code    — the full "Preventative Code" text (e.g. "Glaucoma Screening (GLAU) - G0117")
//   label   — the human name only ("Glaucoma Screening")
//   hcpcs   — the billing code parsed off the end ("G0117"), if present
//   state   — "Eligibility State" verbatim ("Active Coverage", "Missing Request
//             Information", "Review: Other Plan Detected", …)
//   open    — true when the state indicates the service is still eligible/needed
//             (i.e. "Active Coverage"); informational states are surfaced but not
//             counted as an open gap.

const { DB, queryDb, P, getSession, json } = require("./_lib");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// "Lastname, Firstname" and "Firstname Lastname" normalize to the same key so a
// report name ("Doe, Jane") still matches the Master Patient List ("Jane Doe").
const nameKey = (s) => norm(String(s || "").split(",").reverse().join(" "));

// "Glaucoma Screening (GLAU) - G0117" → { label:"Glaucoma Screening", hcpcs:"G0117" }
function parseCode(raw) {
  const text = String(raw || "").trim();
  const hcpcs = (text.match(/\b([A-Z]?\d{4,5}[A-Z]?|[A-Z]\d{4})\b\s*$/) || [])[1] || "";
  const label = text
    .replace(/\s*[-–—]\s*[A-Z]?\d{3,5}[A-Z]?\s*$/, "") // trailing " - G0117"
    .replace(/\s*\([^)]*\)\s*$/, "")                    // trailing " (GLAU)"
    .trim();
  return { label: label || text, hcpcs };
}

// "Active Coverage" is the only state that means the service is genuinely still
// open. The others are administrative notes we surface but don't count as a gap.
const isOpen = (state) => /active\s*coverage/i.test(String(state || ""));

function shape(pg) {
  const p = pg.properties;
  const codeText = P.text(p["Preventative Code"]);
  const { label, hcpcs } = parseCode(codeText);
  const state = P.text(p["Eligibility State"]);
  return {
    name: P.title(p["Patient Name"]),
    memberId: P.text(p["Member ID"]),
    payer: P.text(p["Payer"]),
    code: codeText,
    label,
    hcpcs,
    state,
    open: isOpen(state),
    eligibleProf: P.date(p["Eligible Date Prof:"]),
    eligibleTech: P.date(p["Eligible Date Tech:"]),
    created: pg.created_time || "",
  };
}

// Collapse per-row records into one entry per patient (keyed by Member ID when
// present, else by normalized name), carrying that patient's gap lines.
function groupByPatient(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.name && !r.memberId) continue;
    const key = r.memberId ? `id:${r.memberId.toLowerCase()}` : `nm:${nameKey(r.name)}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { name: r.name, memberId: r.memberId, payer: r.payer, gaps: [] };
      map.set(key, entry);
    }
    if (!entry.name && r.name) entry.name = r.name;
    if (!entry.memberId && r.memberId) entry.memberId = r.memberId;
    if (!entry.payer && r.payer) entry.payer = r.payer;
    entry.gaps.push(gapLine(r));
  }
  return [...map.values()];
}

const gapLine = (r) => ({
  code: r.code, label: r.label, hcpcs: r.hcpcs, state: r.state, open: r.open,
  eligibleProf: r.eligibleProf, eligibleTech: r.eligibleTech,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to crewOS again." });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN is not set on this site" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action || "list";

  try {
    const rows = (await queryDb(DB.careGaps)).map(shape).filter((r) => r.name || r.memberId);

    if (action === "for") {
      const memberId = String(body.memberId || "").trim();
      const name = String(body.name || "").trim();
      let hits = [];
      if (memberId) {
        hits = rows.filter((r) => r.memberId && r.memberId === memberId);
        if (!hits.length) {
          const m = memberId.toLowerCase();
          hits = rows.filter((r) => r.memberId && r.memberId.toLowerCase() === m);
        }
      }
      if (!hits.length && name) {
        const k = nameKey(name);
        hits = rows.filter((r) => nameKey(r.name) === k);
      }
      if (!hits.length) return json(200, { matched: false, gaps: [] });
      const patient = { name: hits[0].name, memberId: hits[0].memberId, payer: hits[0].payer };
      const gaps = hits.map(gapLine).sort((a, b) => Number(b.open) - Number(a.open) || a.label.localeCompare(b.label));
      return json(200, { matched: true, patient, gaps, openCount: gaps.filter((g) => g.open).length });
    }

    if (action === "list") {
      const patients = groupByPatient(rows).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      const updated = rows.reduce((m, r) => (r.created > m ? r.created : m), "");
      return json(200, { patients, rows: rows.length, updated });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
