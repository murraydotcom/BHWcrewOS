// netlify/functions/patient-auth.js — passwordless patient sign-in via Stytch Email OTP.
//
// PHI note: this authenticates identity only. The 6-digit code, the email and
// the session token must never be written to logs, analytics, or an error
// tracker. Patient data itself lives in Notion (BAA-covered).
//
// Environment variables (set in Netlify → Site settings → Environment):
//   STYTCH_PROJECT_ID   from the Stytch dashboard (API keys)
//   STYTCH_SECRET       from the Stytch dashboard (API keys) — server-side only
//   STYTCH_ENV          "test" | "live"  (default "test")
//   SESSION_SECRET      HMAC key for our own session token (already used by staff auth)
//
// If STYTCH_PROJECT_ID / STYTCH_SECRET are absent the function runs in DEMO mode
// so the mockup still works end to end: nothing is emailed and any 6-digit code
// is accepted. Add the two keys and it becomes a real passwordless login with
// no other change.
//
// Actions (POST JSON):
//   { action:"send",   email }                 -> { ok, methodId?, demo? }
//   { action:"verify", methodId, code, email } -> { ok, token, patient:{ name, email }, demo? }

const { sign, json, verify, queryDb, DB, P } = require("./_lib");

// ---- Patient Index helpers (guardian / dependent resolution) -----------------
// A child is linked to a parent by the child's "Guardian Email" (an existing
// field on the Patient Index) matching the parent's login email — no separate
// relation needed.
function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
  return a;
}
function readEmail(pg, prop) {
  const e = (pg.properties || {})[prop || "Email"];
  if (!e) return "";
  return String(e.email || P.text(e) || "").trim().toLowerCase();
}
function shapePatient(pg) {
  const p = pg.properties || {};
  const dob = p["DOB"]?.date?.start || "";
  return {
    id: pg.id,
    name: P.title(p["Patient Name"]) || "Patient",
    dob,
    age: ageFromDob(dob),
    divisions: P.multi(p["Active Divisions"]),
    status: P.sel(p["Status"]),
  };
}
function shapeMed(pg) {
  const p = pg.properties || {};
  return {
    name: P.title(p["Medication"]),
    dose: P.text(p["Dose"]),
    schedule: P.text(p["Schedule"]),
    route: P.sel(p["Route"]),
    status: P.sel(p["Status"]) || "Active",
    prescriber: P.text(p["Prescriber"]),
  };
}
// Match login email to the Patient Index; dependents = records whose Guardian
// Email is this email. Returns null only when neither self nor dependents exist.
async function loadFamily(email) {
  try {
    const all = await queryDb(DB.patients);
    const self = all.find((pg) => readEmail(pg, "Email") === email);
    const deps = all.filter((pg) => readEmail(pg, "Guardian Email") === email);
    if (!self && !deps.length) return null;
    return {
      patient: self ? shapePatient(self) : { name: email.split("@")[0], email },
      dependents: deps.map(shapePatient),
    };
  } catch {
    return null;
  }
}
async function loadMeds(patientId) {
  const rows = await queryDb(DB.medications, { property: "Patient", relation: { contains: patientId } });
  return rows.map(shapeMed).filter((m) => m.status !== "Stopped");
}
// Shown on the preview (and any time the Patient Index has no match) so the
// guardian switcher and medications section are demonstrable without live data.
function demoFamily(email) {
  return {
    patient: { name: "Amaris (Am) Murray", relationship: "Self", email },
    dependents: [{ name: "Amari Murray", age: 9, relationship: "Child" }],
    demo: true,
  };
}
function demoMeds() {
  return [
    { name: "Iron bisglycinate", dose: "25 mg", schedule: "Every other morning with vitamin C", status: "Active" },
    { name: "Vitamin D3", dose: "2,000 IU", schedule: "Daily with your largest meal", status: "Active" },
  ];
}

const HAS_STYTCH = !!(process.env.STYTCH_PROJECT_ID && process.env.STYTCH_SECRET);
const STYTCH_BASE =
  (process.env.STYTCH_ENV === "live" ? "https://api.stytch.com" : "https://test.stytch.com") + "/v1";

function stytchAuthHeader() {
  const basic = Buffer.from(
    `${process.env.STYTCH_PROJECT_ID}:${process.env.STYTCH_SECRET}`
  ).toString("base64");
  return `Basic ${basic}`;
}

async function stytch(path, payload) {
  const res = await fetch(`${STYTCH_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: stytchAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
const TTL_MS = 12 * 60 * 60 * 1000; // 12h session

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }
  const email = String(body.email || "").trim().toLowerCase();

  try {
    // ---- send a code -------------------------------------------------------
    if (body.action === "send") {
      if (!isEmail(email)) return json(400, { error: "Enter a valid email." });
      if (!HAS_STYTCH) return json(200, { ok: true, demo: true });
      const r = await stytch("/otps/email/login_or_create", { email });
      if (!r.ok)
        return json(502, { error: r.data.error_message || "Could not send the code — try again." });
      return json(200, { ok: true, methodId: r.data.email_id });
    }

    // ---- verify the code ---------------------------------------------------
    if (body.action === "verify") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return json(400, { error: "Enter the 6-digit code." });

      if (HAS_STYTCH) {
        if (!body.methodId) return json(400, { error: "Start again — request a new code." });
        const r = await stytch("/otps/authenticate", { method_id: body.methodId, code });
        if (!r.ok)
          return json(401, { error: r.data.error_message || "That code didn't match or has expired." });
      }
      // (DEMO mode — no Stytch keys — accepts any 6-digit code above.)

      // Resolve the family (self + dependents) from the Patients Master List.
      let family = await loadFamily(email);
      if (!family) {
        family = HAS_STYTCH
          ? { patient: { name: email.split("@")[0], email }, dependents: [] }
          : demoFamily(email);
      }
      const demo = !HAS_STYTCH || !!family.demo;
      const dependentIds = (family.dependents || []).map((d) => d.id).filter(Boolean);

      let token = null;
      if (process.env.SESSION_SECRET) {
        token = sign({
          kind: "patient",
          email,
          patientId: family.patient.id || null,
          dependentIds,
          demo,
          exp: Date.now() + TTL_MS,
        });
      }
      return json(200, { ok: true, token, patient: family.patient, dependents: family.dependents || [], demo });
    }

    // ---- medications for a patient (self or a linked dependent) -------------
    if (body.action === "meds") {
      const sess = body.token ? verify(body.token) : null;
      const pid = body.patientId || (sess && sess.patientId) || null;
      if (sess && pid && sess.patientId !== pid && !(sess.dependentIds || []).includes(pid)) {
        return json(403, { error: "Not authorized for that record." });
      }
      if (!pid) return json(200, { ok: true, meds: demoMeds(), demo: true });
      try {
        return json(200, { ok: true, meds: await loadMeds(pid) });
      } catch {
        return json(200, { ok: true, meds: [] });
      }
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
