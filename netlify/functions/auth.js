// netlify/functions/auth.js — BHWcrewOS login
// PINs are scrypt-hashed in Netlify Blobs (store: "crewos-auth"), same pattern
// as the welcometobhw onboarding portal. Staff identity/roles come from the
// Staff & Roles database in Notion, so access changes are a Notion edit.
//
// Actions:
//   POST { action:"login", staffId, pin }             → { token, user }
//   POST { action:"set-pin", setupSecret, staffId, pin } → sets/resets a PIN (admin, via SETUP_SECRET env)
//   POST { action:"roster" }                          → { staff:[{id,name,role}] } for the login picker (names only)

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const { DB, queryDb, P, sign, json } = require("./_lib");

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString("hex");
}

async function loadStaff() {
  const pages = await queryDb(DB.staff);
  return pages.map((pg) => {
    const p = pg.properties;
    return {
      id: pg.id,
      name: P.title(p["Name"]),
      role: P.sel(p["Role"]),
      divisions: P.multi(p["Divisions"]),
      landing: P.sel(p["Landing Page"]),
      access: P.sel(p["Access Level"]),
      canSchedule: P.check(p["Can Schedule"]),
      active: P.check(p["Active"]),
    };
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const store = getStore("crewos-auth");

  if (body.action === "roster") {
    const staff = (await loadStaff()).filter((s) => s.active);
    return json(200, { staff: staff.map(({ id, name, role }) => ({ id, name, role })) });
  }

  if (body.action === "set-pin") {
    if (!process.env.SETUP_SECRET || body.setupSecret !== process.env.SETUP_SECRET) {
      return json(403, { error: "Invalid setup secret" });
    }
    if (!body.staffId || !body.pin || String(body.pin).length < 4) {
      return json(400, { error: "staffId and a PIN of 4+ digits required" });
    }
    const salt = crypto.randomBytes(16).toString("hex");
    await store.setJSON(`pin:${body.staffId}`, { salt, hash: hashPin(body.pin, salt), updated: Date.now() });
    return json(200, { ok: true });
  }

  if (body.action === "login") {
    const { staffId, pin } = body;
    if (!staffId || !pin) return json(400, { error: "Select your name and enter your PIN" });
    const rec = await store.get(`pin:${staffId}`, { type: "json" });
    if (!rec) return json(403, { error: "No PIN set for this account yet — ask Amaris or Shadé" });
    const attempt = hashPin(pin, rec.salt);
    if (!crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(rec.hash))) {
      return json(403, { error: "That PIN didn't match" });
    }
    const staff = await loadStaff();
    const user = staff.find((s) => s.id === staffId);
    if (!user || !user.active) return json(403, { error: "Account inactive" });
    const token = sign({
      staffId: user.id,
      name: user.name,
      divisions: user.divisions,
      access: user.access,
      landing: user.landing,
      canSchedule: user.canSchedule,
      exp: Date.now() + 12 * 60 * 60 * 1000, // 12h shift-length session
    });
    return json(200, { token, user });
  }

  return json(400, { error: "Unknown action" });
};
