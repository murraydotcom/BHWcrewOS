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

const { sign, json } = require("./_lib");

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

      if (!HAS_STYTCH) {
        // DEMO mode — accept any 6-digit code so the mockup is usable without keys.
        const patient = { name: "Demo patient", email };
        if (!process.env.SESSION_SECRET) return json(200, { ok: true, demo: true, patient });
        const token = sign({ kind: "patient", email, demo: true, exp: Date.now() + TTL_MS });
        return json(200, { ok: true, demo: true, token, patient });
      }

      if (!body.methodId) return json(400, { error: "Start again — request a new code." });
      const r = await stytch("/otps/authenticate", { method_id: body.methodId, code });
      if (!r.ok)
        return json(401, { error: r.data.error_message || "That code didn't match or has expired." });

      if (!process.env.SESSION_SECRET)
        return json(500, { error: "SESSION_SECRET is not set on this site." });
      const token = sign({
        kind: "patient",
        email,
        stytchUserId: r.data.user_id,
        exp: Date.now() + TTL_MS,
      });
      return json(200, { ok: true, token, patient: { name: email.split("@")[0], email } });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
