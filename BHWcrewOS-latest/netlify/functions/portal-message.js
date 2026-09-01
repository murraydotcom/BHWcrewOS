// netlify/functions/portal-message.js — public endpoint for a patient sending
// a message to the office from a Care Connect patient page ("Message the
// office"). Writes ONE record to the Google Operations patientRequests queue.
// It never falls back to the legacy Notion queue.
//
//   POST { name, phone, message, hp }  → { ok }
//
// Like screener-submit this browser-facing bridge is intentionally PUBLIC
// (patients have no crewOS login) and hardened rather than gated: a hidden
// honeypot rejects bots,
// fields are length-bounded, a message is required, and it only ever creates
// one queue record. Patient identity remains unmatched unless a trusted,
// authenticated patient context supplies it elsewhere in the workflow.
//
// CORS: the Care Connect dashboards are a separate deploy, so cross-origin
// POSTs are allowed from *.netlify.app and the BHW domains (reflected origin).

const { intakeConfigured, createCloudIntake } = require("./lib/operations-cloud");

const digits = (value) => String(value || "").replace(/\D/g, "");

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
  if (!intakeConfigured())
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

  const patientName = name || "Patient (portal)";
  const summary = name ? `${name}: ${message}` : message;
  try {
    const out = await createCloudIntake({
      submissionId: body.submissionId,
      body: {
        bhwPatientId: "",
        patientMatchStatus: "unmatched",
        requestType: "general",
        priority: "routine",
        summary,
        message,
        requester: { displayName: patientName, callbackPhone: phone, preferredChannel: "portal" },
        routing: { targetSystem: "crewos", assignedTeam: "front-desk" },
        sourceMetadata: { sourceRecordId: String(body.submissionId || "").slice(0, 160), sourcePage: "care-connect-patient-page" },
      },
    });
    return res(200, { ok: true, matched: false, requestId: out?.patientRequest?.patientRequestId || out?.patientRequest?.id || "" }, origin);
  } catch {
    return res(502, { error: "Couldn't send right now — please call the office." }, origin);
  }
};
