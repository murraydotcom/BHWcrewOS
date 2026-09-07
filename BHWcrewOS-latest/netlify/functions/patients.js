// netlify/functions/patients.js — Master Patient List lookup for the
// Paperwork / Care Plan Studio patient picker. Read-only, session-gated.
//
//   POST { action:"list" }  → [{ id, name, bhwId, dob, chart, insurance,
//                                memberId, icds:[{code,label}] }]
//
// Source of truth: the Google Cloud patient registry. The server-side adapter
// preserves the legacy picker field names while the browser never receives the
// Cloud signing secret.

const { getSession, json } = require("./_lib");
const { listCloudPatients, searchCloudPatients } = require("./lib/cloud-patients");

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

const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// A human insurance label that combines the specific plan / Medicaid MCO name
// with the payer program — e.g. "Maryland Physicians Care Medicaid", "CareFirst
// Community Medicaid", "United Healthcare Medicare", "Aetna". Medicaid MCO codes
// expand to their plan name; a real Insurance Plan Name wins over a generic one.
const MCO_PLAN = {
  "MPC": "Maryland Physicians Care",
  "UHC Medicaid": "United Healthcare",
  "CareFirst Community": "CareFirst Community",
  "United Healthcare Medicare": "United Healthcare",
  "FFS": "Fee-for-Service",
};
function insuranceLabel(payer, mco, plan) {
  const type = /carefirst/i.test(payer || "") ? "CareFirst" : (payer ? titleCase(payer) : "");
  const planClean = String(plan || "").trim();
  let name = "";
  if (planClean && !/^(medicaid|medicare|commercial|self.?pay)$/i.test(planClean)) name = titleCase(planClean);
  else if (mco && MCO_PLAN[mco]) name = MCO_PLAN[mco];
  if (name) {
    const flat = name.toLowerCase().replace(/[^a-z]/g, "");
    const tflat = type.toLowerCase().replace(/[^a-z]/g, "");
    // Append the program only for Medicaid/Medicare, and only if not already in the name.
    if (/^(medicaid|medicare)$/i.test(type) && !flat.includes(tflat)) return `${name} ${type}`;
    return name;
  }
  return type;
}

// Search the Cloud registry by name or BHW control number and return a
// small, register-form-shaped list so front desk can pull an existing patient
// in without retyping. One row per patient (this DB is already deduped).
async function masterSearch(q, session) {
  return searchCloudPatients(await listCloudPatients(session), q, 12).map((p) => ({
    ...p,
    insuranceLabel: insuranceLabel(p.payer, p.medicaidMco, p.insurancePlanName),
    insurance: mapInsurance(p.payer, p.insurancePlanName),
    mbi: p.medicareMbi || "",
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Signed out — sign in to crewOS again." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    if (body.action === "master-search") {
      const q = String(body.q || "").trim();
      if (q.length < 2) return json(200, { patients: [] });
      return json(200, { patients: await masterSearch(q, session) });
    }

    if (body.action === "list") {
      const patients = (await listCloudPatients(session))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { patients });
    }
    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
