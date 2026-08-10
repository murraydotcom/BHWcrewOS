// netlify/functions/patients.js — Master Patient List lookup for the
// Paperwork / Care Plan Studio patient picker. Read-only, session-gated.
//
//   POST { action:"list" }  → [{ id, name, bhwId, dob, chart, insurance,
//                                memberId, icds:[{code,label}] }]
//
// Source of truth: the "🧑🏽‍⚕️ Patients Master List" (the same DB Front Desk
// reads, via MASTER_DB_ID) — NOT the lean "Patient Index — Ops Hub". Field
// names below map onto that Master List schema (Patient Ctl No, Payer,
// Insurance Member ID, MRN). Falls back to the confirmed DB id if the env
// var isn't set, so the picker and Front Desk always show the same roster.
//
// ICD-10: the Master List stores diagnoses as *relations* (Diagnoses /
// Diagnoses 1), which icdFor() can't expand without extra lookups, so icds
// comes back empty for now. If a plain text/select ICD field is ever added
// under one of the names below, it lights up automatically.

const { queryDb, httpJson, P, getSession, json } = require("./_lib");

// The authoritative Patients Master List (front-desk MASTER_DB_ID). The
// literal is the confirmed database id, used only when the env var is unset.
const MASTER_DB = process.env.MASTER_DB_ID || "2cf580758d3080f0825de4bbfb6c7528";

// Map a Master-List payer/plan onto the register form's Insurance options
// (NP_INS in index.html). Unknown → "" (left blank; the raw payer is shown).
function mapInsurance(payer, plan) {
  const s = `${payer || ""} ${plan || ""}`.toLowerCase();
  if (/dual|qmb|medicare.*medicaid|medicaid.*medicare/.test(s)) return "Medicare + Medicaid";
  if (/cigna/.test(s)) return "Cigna";
  if (/aetna/.test(s)) return "Aetna";
  if (/united|uhc|optum/.test(s)) return "UnitedHealthcare";
  if (/tricare/.test(s)) return "Tricare";
  if (/hopkins|ehp|priority partners/.test(s)) return "Johns Hopkins EHP";
  if (/carefirst|bcbs|blue\s*cross|bluechoice/.test(s)) return "CareFirst BCBS";
  if (/medicaid|physicians care|amerigroup|molina/.test(s)) return "Medicaid";
  if (/medicare/.test(s)) return "Medicare";
  if (/self.?pay|cash/.test(s)) return "Self-Pay";
  return "";
}

// Search the Patients Master List by name or BHW control number and return a
// small, register-form-shaped list so front desk can pull an existing patient
// in without retyping. One row per patient (this DB is already deduped).
async function masterSearch(q) {
  const res = await httpJson("POST", `https://api.notion.com/v1/databases/${MASTER_DB}/query`, {
    filter: {
      or: [
        { property: "Patient Name", title: { contains: q } },
        { property: "Patient Ctl No", rich_text: { contains: q } },
      ],
    },
    page_size: 25,
  });
  if (!res.ok) throw new Error(`Notion ${res.status}`);
  return (res.data.results || [])
    .map((pg) => {
      const p = pg.properties;
      return {
        id: pg.id,
        name: P.title(p["Patient Name"]),
        bhwId: P.text(p["Patient Ctl No"]),
        dob: (P.date(p["DOB"]) || "").slice(0, 10),
        payer: P.sel(p["Payer"]) || P.text(p["Payer Name"]),
        insurance: mapInsurance(P.sel(p["Payer"]), P.text(p["Insurance Plan Name"])),
        memberId: P.text(p["Insurance Member ID"]),
        mbi: P.text(p["Medicare MBI"]),
        email: p["Email"]?.email || "",
        chart: P.text(p["MRN"]),
      };
    })
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);
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
    bhwId: P.text(p["Patient Ctl No"]),                 // e.g. BHW0613
    dob: P.date(p["DOB"]),
    chart: P.text(p["MRN"]),                            // Master List has MRN, not a Charm chart #
    insurance: P.text(p["Insurance Plan Name"]) || P.sel(p["Payer"]) || P.text(p["Payer Name"]),
    memberId: P.text(p["Insurance Member ID"]),
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
      return json(200, { patients: await masterSearch(q) });
    }

    if (body.action === "list") {
      const patients = (await queryDb(MASTER_DB))
        .map(shape)
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { patients });
    }
    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
