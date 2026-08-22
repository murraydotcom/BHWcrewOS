// netlify/functions/portal-message.js — public endpoint for a patient sending
// a message to the office from a Care Connect patient page ("Message the
// office"). Writes ONE row into the Patient Request Triage Queue with
// Source "Portal Message", which Front Desk OS and the Patient Requests board
// render in the "Texts & portal" bucket / New column.
//
//   POST { name, phone, message, hp }  → { ok }
//
// Like screener-submit this is intentionally PUBLIC (patients have no crewOS
// login) and hardened rather than gated: a hidden honeypot rejects bots,
// fields are length-bounded, a message is required, and it only ever creates
// one queue row. The sender is matched to a patient by phone when possible so
// the request lands attached to the right chart.
//
// CORS: the Care Connect dashboards are a separate deploy, so cross-origin
// POSTs are allowed from *.netlify.app and the BHW domains (reflected origin).

const { matchPatientByPhone, createQueueEntry, digits } = require("./lib/triage");

const ORIGIN_OK = /^(https?:\/\/localhost(:\d+)?|https:\/\/([a-z0-9-]+\.)*netlify\.app|https:\/\/([a-z0-9-]+\.)*(bhwmedical\.org|mybhw\.(com|org)))$/i;

function cors(origin) {
  const h = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin && ORIGIN_OK.test(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return h;
}
const res = (status, body, origin) => ({ statusCode: status, headers: cors(origin), body: JSON.stringify(body) });

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(origin), body: "" };
  if (event.httpMethod !== "POST") return res(405, { error: "POST only" }, origin);
  if (!process.env.NOTION_TOKEN || !process.env.QUEUE_DB_ID)
    return res(503, { error: "Messaging isn't connected yet — please call the office." }, origin);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return res(400, { error: "Bad JSON" }, origin); }

  // Honeypot: real patients never fill this hidden field.
  if (body.hp) return res(200, { ok: true }, origin);

  const name = String(body.name || "").trim().slice(0, 120);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const message = String(body.message || "").trim().slice(0, 1900);

  if (!message) return res(400, { error: "Please enter a message." }, origin);
  if (!name && digits(phone).length < 7)
    return res(400, { error: "Please include your name or phone number so we can reach you." }, origin);

  // Best-effort match to a chart by phone.
  let match = { patientId: null, patientName: "" };
  if (digits(phone).length >= 7) {
    try { match = await matchPatientByPhone(phone); } catch { /* leave unmatched */ }
  }

  const patientName = match.patientName || name || "Patient (portal)";
  // When we couldn't match, keep the typed name visible in the summary too.
  const summary = match.patientId || !name ? message : `${name}: ${message}`;

  const out = await createQueueEntry({
    patientId: match.patientId,
    patientName,
    from: phone,
    summary,
    source: "Portal Message",
    receivedISO: new Date().toISOString(),
  });

  if (!out.ok) return res(502, { error: "Couldn't send right now — please call the office." }, origin);
  return res(200, { ok: true, matched: !!match.patientId, reference: out.reference }, origin);
};
