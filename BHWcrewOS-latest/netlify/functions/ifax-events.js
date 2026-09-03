// netlify/functions/ifax-events.js
// Receives inbound-fax webhooks from iFax (or a compatible fax provider) and
// drops a matched entry into the Patient Request Triage Queue — the Front Desk
// OS inbox shows it under "Faxes & other". Part of the Keragon replacement:
// a direct webhook, no middleware.
//
// Env: OPERATIONS_CLOUD_API_URL, FRONT_DESK_INTAKE_SECRET, FRONT_DESK_CLIENT_ID,
// CREWHQ_CLOUD_TOKEN_SECRET, RCM_CLOUD_API_URL, and IFAX_WEBHOOK_SECRET.
// The webhook must present the iFax secret as
//   ?token=<secret> or an x-ifax-secret / x-webhook-secret header.
//
// Field names differ across fax providers, so every field is read defensively.

const { matchPatientByPhone, createQueueEntry } = require("./lib/triage");

const pick = (o, keys) => { for (const k of keys) { if (o[k] != null && o[k] !== "") return o[k]; } return ""; };

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "method not allowed" };

    // Fail closed: the shared secret is required so this is never an open write.
    const secret = process.env.IFAX_WEBHOOK_SECRET;
    if (!secret) return { statusCode: 503, body: "IFAX_WEBHOOK_SECRET not set" };
    {
      const hdrs = event.headers || {};
      const given = (event.queryStringParameters || {}).token || hdrs["x-ifax-secret"] || hdrs["x-webhook-secret"] || "";
      if (given !== secret) return { statusCode: 401, body: "bad secret" };
    }

    let p;
    try { p = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "bad JSON" }; }
    // Some providers wrap the fax in a data/payload/fax envelope.
    const fax = p.fax || p.data || p.payload || p;

    // Received faxes only (accept when direction/type is absent — most inbound hooks omit it).
    const dir = String(pick(fax, ["direction", "type", "event", "status"]) || "").toLowerCase();
    if (dir && !/inbound|received|incoming|receive|delivered_to_you/.test(dir)) {
      return { statusCode: 200, body: "ignored: not an inbound fax" };
    }

    const from = pick(fax, ["from", "caller_id", "callerId", "sender", "fromNumber", "from_number", "source", "ani"]);
    const pages = pick(fax, ["pages", "numPages", "num_pages", "page_count", "pageCount"]);
    const link = pick(fax, ["url", "fileUrl", "file_url", "downloadUrl", "download_url", "pdf", "pdfUrl", "file", "documentUrl", "document_url", "media_url"]);
    const subject = pick(fax, ["subject", "caption", "comment", "note", "title"]);

    const summary = `Inbound fax · ${pages ? `${pages} page(s)` : "received"}${subject ? ` — ${subject}` : ""}`;

    const { patientId, patientName } = await matchPatientByPhone(from);
    const r = await createQueueEntry({
      patientId, patientName, from, summary, source: "Fax",
      link: link ? `Fax: ${link}` : undefined, receivedISO: new Date().toISOString(),
    });
    if (!r.ok) return { statusCode: 502, body: `operations intake error: ${r.error}` };
    return { statusCode: 200, body: JSON.stringify({ ok: true, source: "Fax", matched: r.matched }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
