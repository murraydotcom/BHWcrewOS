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

const { DB, queryDb, httpJson, P, getSession, json } = require("./_lib");

// ---- Master Patient Insurance List (the full billing roster) ----------------
// A different DB from the Ops-Hub patient index, with a billing-shaped schema:
// the title is "First Last [BHWxxxx]" and demographics live on insurance rows
// (one row per payer). We search it server-side by name/BHW ID and dedupe to one
// record per patient so registration can pull a patient in without retyping.
const MASTER_TITLE = "Patient First Name Last Name [Patient ID]";
const bhwFromTitle = (t) => (String(t).match(/\[([^\]]+)\]\s*$/) || [])[1]?.trim() || "";
const nameFromTitle = (t) => String(t).replace(/\s*\[[^\]]*\]\s*$/, "").trim();

// "Oct 28, 1986" (or already-ISO) → "1986-10-28"; "" if unparseable.
function isoDob(s) {
  s = String(s || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Best-effort map of a free-text payer to the registration form's Insurance
// options. Unknown payers return "" (left blank; the raw payer is shown instead).
function mapInsurance(payer, type) {
  const s = `${payer || ""} ${type || ""}`.toLowerCase();
  if (/cigna/.test(s)) return "Cigna";
  if (/aetna/.test(s)) return "Aetna";
  if (/united|uhc|optum/.test(s)) return "UnitedHealthcare";
  if (/tricare/.test(s)) return "Tricare";
  if (/hopkins|ehp|priority partners/.test(s)) return "Johns Hopkins EHP";
  if (/carefirst|bcbs|blue\s*cross|bluechoice/.test(s)) return "CareFirst BCBS";
  if (/(medicare.*medicaid|dual)/.test(s)) return "Medicare + Medicaid";
  if (/medicaid|physicians care|amerigroup|molina/.test(s)) return "Medicaid";
  if (/medicare/.test(s)) return "Medicare";
  if (/self.?pay|cash/.test(s)) return "Self-Pay";
  return "";
}

async function masterSearch(q) {
  const res = await httpJson("POST", `https://api.notion.com/v1/databases/${DB.masterPatients}/query`, {
    filter: { property: MASTER_TITLE, title: { contains: q } },
    page_size: 80,
  });
  if (!res.ok) {
    const hint = res.status === 404
      ? 'Share "Master Patient Insurance List" with the crewOS Notion integration.'
      : `Notion ${res.status}`;
    const err = new Error(hint); err.status = res.status; throw err;
  }
  // Dedupe to one record per patient (by BHW ID), preferring the PRIMARY payer row.
  const byKey = new Map();
  for (const pg of res.data.results || []) {
    const p = pg.properties;
    const title = P.title(p[MASTER_TITLE]);
    const bhwId = bhwFromTitle(title);
    const key = bhwId || pg.id;
    const category = P.sel(p["Insurance Category"]); // PRIMARY / SECONDARY
    const self = P.sel(p["Patient Relationship"]) === "Self";
    // Contact details are a single text blob, e.g.
    //   "Mobile Phone : 4436836209, Email : amarism.np@gmail.com"
    const contact = P.text(p["Patient Contact Details"]);
    const rec = {
      bhwId,
      name: nameFromTitle(title),
      // Insured DOB is the patient's only when they are the insured (Self).
      dob: self ? isoDob(P.text(p["Insured Date of Birth"])) : "",
      payer: P.text(p["Payer Name"]),
      insurance: mapInsurance(P.text(p["Payer Name"]), P.sel(p["Insurance Type"])),
      memberId: P.text(p["Insurance ID"]),
      mbi: P.text(p["MBI"]),
      email: (contact.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || "",
    };
    const prev = byKey.get(key);
    if (!prev || (category === "PRIMARY")) byKey.set(key, rec);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
}

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
    if (body.action === "master-search") {
      const q = String(body.q || "").trim();
      if (q.length < 2) return json(200, { patients: [] });
      try {
        return json(200, { patients: await masterSearch(q) });
      } catch (e) {
        return json(e.status === 404 ? 403 : 502, { error: String(e.message || e) });
      }
    }

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
