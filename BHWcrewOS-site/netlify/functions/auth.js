// netlify/functions/auth.js — BHWcrewOS login (zero dependencies)
// PINs are scrypt-hashed and stored in the "PIN Hash" property of the
// Staff & Roles database in Notion (hash only — the PIN itself is never
// stored anywhere). The property is created automatically on first use.
//
// Actions:
//   POST { action:"roster" }                              → names for the pickers
//   POST { action:"set-pin", setupSecret, staffId, pin }  → set/reset a PIN (needs SETUP_SECRET)
//   POST { action:"login", staffId, pin }                 → { token, user }

const crypto = require("crypto");
const { DB, queryDb, updatePage, P, W, sign, json } = require("./_lib");

const NOTION = "https://api.notion.com/v1";
const PIN_PROP = "PIN Hash";

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString("hex");
}

async function ensurePinProperty() {
  // Idempotent: adds the PIN Hash rich_text property to Staff & Roles if missing.
  const res = await fetch(`${NOTION}/databases/${DB.staff}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: { [PIN_PROP]: { rich_text: {} } } }),
  });
  if (!res.ok) throw new Error(`Couldn't ensure PIN property: ${res.status} ${await res.text()}`);
}

function shapeStaff(pg) {
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
    pinHash: P.text(p[PIN_PROP]),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.NOTION_TOKEN) return json(503, { error: "NOTION_TOKEN environment variable is not set on this site" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    if (body.action === "roster") {
      const staff = (await queryDb(DB.staff)).map(shapeStaff).filter((s) => s.active);
      return json(200, { staff: staff.map(({ id, name, role }) => ({ id, name, role })) });
    }

    if (body.action === "set-pin") {
      if (!process.env.SETUP_SECRET) return json(503, { error: "SETUP_SECRET environment variable is not set on this site" });
      if (body.setupSecret !== process.env.SETUP_SECRET) return json(403, { error: "That setup key didn't match" });
      if (!body.staffId || !body.pin || !/^\d{4,8}$/.test(String(body.pin))) {
        return json(400, { error: "Pick a person and use a 4–8 digit PIN" });
      }
      await ensurePinProperty();
      const salt = crypto.randomBytes(16).toString("hex");
      await updatePage(body.staffId, { [PIN_PROP]: W.text(`${salt}:${hashPin(body.pin, salt)}`) });
      return json(200, { ok: true });
    }

    if (body.action === "login") {
      const { staffId, pin } = body;
      if (!staffId || !pin) return json(400, { error: "Select your name and enter your PIN" });
      const staff = (await queryDb(DB.staff)).map(shapeStaff);
      const user = staff.find((s) => s.id === staffId);
      if (!user || !user.active) return json(403, { error: "Account inactive" });
      if (!user.pinHash || !user.pinHash.includes(":")) {
        return json(403, { error: "No PIN set for this account yet — ask Amaris or Shadé" });
      }
      const [salt, storedHash] = user.pinHash.split(":");
      const attempt = hashPin(pin, salt);
      const a = Buffer.from(attempt), b = Buffer.from(storedHash);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return json(403, { error: "That PIN didn't match" });
      }
      const token = sign({
        staffId: user.id,
        name: user.name,
        divisions: user.divisions,
        access: user.access,
        landing: user.landing,
        canSchedule: user.canSchedule,
        exp: Date.now() + 12 * 60 * 60 * 1000,
      });
      return json(200, { token, user: { name: user.name, access: user.access, landing: user.landing } });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
