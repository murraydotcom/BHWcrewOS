// Morning huddle · JS
// netlify/functions/morning-huddle.js — The Morning Huddle
// A daily announcement feed on everyone's first page. Amaris or Shadé (Admin
// access) post the day's huddle message; every signed-in staff member reads
// it. Stored in Netlify Blobs (no Notion database needed for this one).
//
// GET  (any signed-in user)                      -> { current, history }
// POST { message }  (Admin access only)           -> { ok, current }
 
const { getStore } = require("@netlify/blobs");
const { getSession, json } = require("./_lib");
 
const KEY = "state";
const MAX_HISTORY = 30;
const MAX_LEN = 2000;
 
function store() {
  return getStore("morning-huddle");
}
 
exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in again" });
 
  try {
    if (event.httpMethod === "GET") {
      const state = (await store().get(KEY, { type: "json" })) || { current: null, history: [] };
      return json(200, state);
    }
 
    if (event.httpMethod === "POST") {
      if (session.access !== "Admin") {
        return json(403, { error: "Only Amaris or Shadé can post to the Morning Huddle" });
      }
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
      const message = String(body.message || "").trim().slice(0, MAX_LEN);
      if (!message) return json(400, { error: "Write something for the team first" });
 
      const entry = { message, postedBy: session.name, postedAt: new Date().toISOString() };
      const s = store();
      const state = (await s.get(KEY, { type: "json" })) || { current: null, history: [] };
      const history = [entry, ...(state.history || [])].slice(0, MAX_HISTORY);
      const next = { current: entry, history };
      await s.setJSON(KEY, next);
      return json(200, { ok: true, current: entry });
    }
 
    return json(405, { error: "GET or POST only" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
 
