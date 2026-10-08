// netlify/functions/referral-templates.js — the pre-written warm-referral
// templates, grouped by destination program. Read-only, session-gated.
//
//   GET  → { templates: [{ id, name, destination, type, body, priority,
//                          neededBy, sort }] }   (Active only, sorted)
//
// The referral form in crewOS filters these by the selected destination and
// fills Type / Details / Priority / Needed-by. Templates are owned by the
// CrewOS operational store after the verified Notion exit.

const { DB, P, getSession, json } = require("./_lib");
const { queryOperational } = require("./lib/operational-store");

function shape(pg) {
  const p = pg.properties;
  return {
    id: pg.id,
    name: P.title(p["Name"]),
    destination: P.sel(p["Destination"]),
    type: P.sel(p["Type"]),
    body: P.text(p["Body"]),
    priority: P.sel(p["Priority"]),
    neededBy: P.sel(p["Needed By"]),
    sort: P.num(p["Sort"]),
    active: P.check(p["Active"]),
  };
}

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: "Signed out — sign in to crewOS again." });
  try {
    const templates = (await queryOperational("referralTemplates", DB.referralTemplates))
      .map(shape)
      .filter((t) => t.name && t.active)
      .sort((a, b) =>
        a.destination.localeCompare(b.destination) ||
        (a.sort ?? 999) - (b.sort ?? 999) ||
        a.name.localeCompare(b.name))
      .map(({ active, ...rest }) => rest);
    return json(200, { templates });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
