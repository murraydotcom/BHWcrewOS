// netlify/functions/email-ingest.js
// Bridges the reality that iFax (ifaxapp.com) and some Dialpad notifications
// are DELIVERED BY EMAIL to info@bhwmedical.org rather than by webhook. A tiny
// Google Apps Script in the Workspace (see docs/gmail-ingest.gs) forwards
// matching notification emails here; this parses them and drops a row in the
// Patient Request Triage Queue — same destination as the direct webhooks, so
// they land in the Front Desk OS inbox. Still no Keragon.
//
//   POST { from, subject, text, html, receivedISO }  (+ secret)
//        → { ok, source } | { ok:true, ignored } | 401/503
//
// Auth: EMAIL_INGEST_SECRET must be set (otherwise 503 — we never accept open
// email ingestion). The script presents it as ?token=, an x-ingest-secret
// header, or body.secret.

const { matchPatientByPhone, createQueueEntry } = require("./lib/triage");

const stripHtml = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const firstUrl = (s, re) => { const m = String(s || "").match(re); return m ? m[0] : ""; };
// A US phone number appearing in the text (skips obvious non-phone digit runs).
const firstPhone = (s) => {
  const m = String(s || "").match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/);
  return m ? m[0].trim() : "";
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "method not allowed" };

    const secret = process.env.EMAIL_INGEST_SECRET;
    if (!secret) return { statusCode: 503, body: "email ingest not configured (set EMAIL_INGEST_SECRET)" };
    const hdrs = event.headers || {};
    let body; try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "bad JSON" }; }
    const given = (event.queryStringParameters || {}).token || hdrs["x-ingest-secret"] || body.secret || "";
    if (given !== secret) return { statusCode: 401, body: "bad secret" };

    const sender = String(body.from || "").toLowerCase();
    const subject = String(body.subject || "");
    const text = String(body.text || "") || stripHtml(body.html);
    const hay = `${subject}\n${text}`;
    const provider = /ifaxapp\.com|ifax/.test(sender) || /ifax/i.test(subject) ? "ifax"
      : /dialpad\.com/.test(sender) || /dialpad/i.test(subject) ? "dialpad"
      : String(body.provider || "").toLowerCase();

    let source, summary, link, from = firstPhone(hay);

    if (provider === "ifax") {
      const inbound = /received|incoming|new fax|you.?ve got a fax|inbound/i.test(hay);
      const outboundConfirm = /\b(sent|delivered|ocr complete|fax confirmation|transmission)\b/i.test(hay);
      if (!inbound && outboundConfirm) return { statusCode: 200, body: "ignored: outbound iFax confirmation" };
      link = firstUrl(hay, /https?:\/\/[^\s>"]*ifaxapp\.com\/open-fax\/[^\s>"]+/);
      const pages = (hay.match(/(\d+)\s*page/i) || [])[1];
      source = "Fax";
      summary = `Inbound fax${pages ? ` · ${pages} page(s)` : " received"}`;
      link = link ? `Fax: ${link}` : undefined;
    } else if (provider === "dialpad") {
      if (/voicemail/i.test(hay)) {
        source = "Voicemail";
        // iFax/Dialpad voicemail emails usually include a transcript block.
        const t = (hay.match(/transcript(?:ion)?[:\s]+([\s\S]{0,600})/i) || [])[1];
        summary = t ? `Voicemail: ${t.trim().replace(/\s+/g, " ").slice(0, 400)}` : "New voicemail";
        link = firstUrl(hay, /https?:\/\/[^\s>"]+/) ? `Recording: ${firstUrl(hay, /https?:\/\/[^\s>"]+/)}` : undefined;
      } else if (/missed call|missed a call|no answer/i.test(hay)) {
        source = "Missed Call (Phone)";
        summary = "Missed call — no message left";
      } else {
        return { statusCode: 200, body: "ignored: non-actionable Dialpad email" };
      }
    } else {
      return { statusCode: 200, body: "ignored: unrecognized sender" };
    }

    const { patientId, patientName } = await matchPatientByPhone(from);
    const r = await createQueueEntry({ patientId, patientName, from, summary, source, link, receivedISO: body.receivedISO || new Date().toISOString() });
    if (!r.ok) return { statusCode: 502, body: `notion error: ${r.error}` };
    return { statusCode: 200, body: JSON.stringify({ ok: true, source, matched: r.matched }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
