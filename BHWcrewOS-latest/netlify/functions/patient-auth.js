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

const { sign, json, queryDb, DB, P } = require("./_lib");

// ---- Patients Master List helpers (guardian / dependent resolution) ----------
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
function readEmail(pg) {
  const p = pg.properties || {};
  const e = p["Email"];
  if (!e) return "";
  return String(e.email || P.text(e) || "").trim().toLowerCase();
}
function shapePatient(pg) {
  const p = pg.properties || {};
  const dob = p["DOB"]?.date?.start || p["Insured Date of Birth"]?.date?.start || "";
  return {
    id: pg.id,
    name: P.title(p["Name"]) || P.title(p["Patient"]) || "Patient",
    ctl: P.text(p["Patient Ctl No"]) || P.uid(p["Patient Ctl No"]) || "",
    dob,
    age: ageFromDob(dob),
    relationship: P.sel(p["Patient Relationship"]) || "",
  };
}
// Best-effort: match the login email to the Master List, resolve dependents from
// a guardian relation (guardian→dependents or dependent→guardian). null on any miss.
async function loadFamily(email) {
  try {
    const all = await queryDb(DB.patients);
    const self = all.find((pg) => readEmail(pg) === email);
    if (!self) return null;
    const sp = self.properties || {};
    let depIds = [];
    for (const key of ["Guardian Of", "Dependents", "Children"]) {
      if (sp[key]?.relation?.length) { depIds = sp[key].relation.map((r) => r.id); break; }
    }
    if (!depIds.length) {
      for (const pg of all) {
        const pp = pg.properties || {};
        for (const key of ["Guardian", "Parent/Guardian", "Parent"]) {
          if (pp[key]?.relation?.some((r) => r.id === self.id)) { depIds.push(pg.id); break; }
        }
      }
    }
    const dependents = all.filter((pg) => depIds.includes(pg.id)).map(shapePatient);
    return { patient: shapePatient(self), dependents };
  } catch {
    return null;
  }
}
// Shown on the preview (and any time the Master List has no match) so the
// guardian switcher is demonstrable without live data.
function demoFamily(email) {
  return {
    patient: { name: "Amaris (Am) Murray", ctl: "BHW0001", relationship: "Self", email },
    dependents: [{ name: "Amari Murray", age: 9, relationship: "Child" }],
    demo: true,
  };
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

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
