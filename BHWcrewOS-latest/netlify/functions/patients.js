// netlify/functions/patients.js — Master Patient List lookup for the
// Paperwork Studio patient picker. Read-only, session-gated.
//
//   POST { action:"list" }  → [{ id, name, bhwId, dob, chart, insurance,
//                                memberId, icds:[{code,label}] }]
//                             (active patients only; deceased excluded)
//
// ICD-10: patient-specific diagnoses are being added to the Master Patient
// List. This auto-detects the field by any of the common names below and
// parses the codes out — so it lights up the moment the property exists,
// whatever it's reasonably called (rich text, multi-select, or select). To
// pin it to one exact name, put that name first in ICD_PROP_CANDIDATES.

const { DB, queryDb, P, getSession, json } = require("./_lib");

const ICD_PROP_CANDIDATES = [
  "ICD-10 Codes", "ICD-10", "ICD10 Codes", "ICD10", "ICD Codes",
  "Diagnoses", "Diagnosis", "Active Diagnoses", "Dx Codes", "Dx",
];
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const WANTED = new Set(ICD_PROP_CANDIDATES.map(norm));
const ICD_RE = /\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\b/;

function parseIcds(raw) {
  const chunks = Array.isArray(raw) ? raw : String(raw || "").split(/[;\n]+/);
  const out = [], seen = new Set();
  const add = (code, label) => {
    code = (code || "").toUpperCase();
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push({ code, label: label || "" });
  };
  const GLOBAL = new RegExp(ICD_RE.source, "g");
  for (const ch of chunks) {
    const s = String(ch).trim();
    if (!s) continue;
    const codes = s.match(GLOBAL) || [];
    if (codes.length > 1) {
      // A code list in one chunk (e.g. "E11.9, I10, G47.33") — take each code.
      codes.forEach((c) => add(c, ""));
    } else if (codes.length === 1) {
      // One code + its description (label may itself contain commas).
      add(codes[0], s.replace(codes[0], "").replace(/^[\s—:.\-,]+/, "").trim());
    }
    // chunks with no recognizable ICD-10 code are skipped (no fabrication)
  }
  return out;
}

// Pull ICD-10 from whichever diagnoses property exists (any supported type).
function icdFor(props) {
  for (const [name, prop] of Object.entries(props)) {
    if (!WANTED.has(norm(name))) continue;
    let raw = "";
    if (prop.type === "rich_text") raw = P.text(prop);
    else if (prop.type === "multi_select") raw = P.multi(prop);
    else if (prop.type === "select") raw = P.sel(prop);
    else if (prop.type === "title") raw = P.title(prop);
    else if (prop.type === "formula") raw = prop.formula?.string || "";
    else if (prop.type === "rollup") raw = (prop.rollup?.array || []).map((x) => x?.select?.name || x?.rich_text?.map?.((t) => t.plain_text).join("") || "").filter(Boolean);
    const parsed = parseIcds(raw);
    if (parsed.length) return parsed;
  }
  return [];
}

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
    hasMbi: !!P.text(p["Medicare MBI"]),
    email: p["Email"]?.email || "",
    guardianEmail: p["Guardian Email"]?.email || "",
    status: P.sel(p["Status"]),
    icds: icdFor(p),
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
