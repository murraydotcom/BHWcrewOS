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
// iFax encodes the fax's metadata in the OPEN FAX/FILE link:
//   https://web.ifaxapp.com/open-fax/<base64 JSON><"iFaxapp"+sig>?utm=...
// Decoding it is the authoritative direction signal ("type":"inbound"|"outbound",
// "status":"Sent"|"Received"|…) plus any sender/fax-number fields — far more
// reliable than subject-line keywords. Returns the parsed object or null.
const decodeIfaxLink = (url) => {
  try {
    const m = String(url || "").match(/open-fax\/([A-Za-z0-9\-_%+/=]+)/i);
    if (!m) return null;
    const seg = decodeURIComponent(m[1]);
    const decoded = Buffer.from(seg, "base64").toString("utf8");
    const cut = decoded.indexOf("iFaxapp");
    const jsonStr = cut > -1 ? decoded.slice(0, cut) : decoded;
    const start = jsonStr.indexOf("{"), end = jsonStr.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(jsonStr.slice(start, end + 1));
  } catch { return null; }
};
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
    const html = String(body.html || "");
    // Provider detection (real senders: no-reply@ifaxapp.com, voicemail@dialpad.com).
    const provider = /ifaxapp\.com|ifax/i.test(sender) || /ifax|new fax|fax received|fax was just received/i.test(hay) ? "ifax"
      : /dialpad\.com/i.test(sender) || /dialpad|voicemail|missed a? ?call/i.test(hay) ? "dialpad"
      : String(body.provider || "").toLowerCase();

    let source, summary, link, from = "";

    if (provider === "ifax") {
      // Direction from the OPEN FAX link payload is authoritative; subject/body
      // keywords are only a fallback when the link can't be decoded.
      const openLink = firstUrl(html + "\n" + hay, /https?:\/\/[^\s>"']*ifaxapp\.com\/open-fax\/[^\s>"')]*/i)
        || firstUrl(html + "\n" + hay, /https?:\/\/[^\s>"']*ifaxapp\.com[^\s>"']*/i);
      const meta = decodeIfaxLink(openLink);
      const metaType = String(meta?.type || "").toLowerCase();
      const metaStatus = String(meta?.status || "").toLowerCase();
      const kwInbound = /a new fax was just received|new fax|fax received|you (?:have )?received a fax|incoming fax|received on/i.test(hay);
      const kwOutbound = /\b(ocr complete|successfully sent|delivery (?:confirmation|report)|your fax to|fax sent)\b/i.test(hay);
      let isInbound;
      if (metaType === "inbound" || metaType === "outbound") isInbound = metaType === "inbound";
      else if (/received|incoming/.test(metaStatus)) isInbound = true;
      else if (/^(sent|delivered)$/.test(metaStatus)) isInbound = false;
      else isInbound = kwInbound || !kwOutbound; // no link meta: inbound unless it's clearly a send confirmation
      if (!isInbound) return { statusCode: 200, body: "ignored: outbound iFax confirmation" };
      // Sender fax number: prefer the link metadata, else the body's "From: <phone>"
      // line (NOT the "received on" line, which is BHW's own number).
      const metaFrom = meta?.callerId || meta?.caller_id || meta?.from || meta?.senderNumber || meta?.faxNumber || meta?.sender || "";
      const caller = (text.match(/From:\s*(\+?1?[\s().\-]*\d{3}[\s().\-]*\d{3}[\s.\-]*\d{4})/i) || [])[1] || "";
      const pages = (text.match(/Pages?:\s*(\d+)/i) || [])[1] || (meta?.pages != null ? String(meta.pages) : "");
      from = firstPhone(String(metaFrom)) || (caller || "").trim();
      source = "Fax";
      summary = `Inbound fax${from ? ` from ${from}` : ""}${pages ? ` · ${pages} page(s)` : ""} (PDF in the source email / open in iFax)`;
      link = openLink ? `Open fax: ${openLink}` : undefined;
    } else if (provider === "dialpad") {
      if (/voicemail/i.test(hay)) {
        source = "Voicemail";
        // Subject: "…has a new voicemail from <Caller> - 0:53"; transcript is inline in the body.
        const caller = (subject.match(/voicemail from\s+(.+?)\s*(?:[-–]\s*\d+:\d+\s*)?$/i) || [])[1] || "";
        const dur = (subject.match(/(\d+:\d+)\s*$/) || [])[1] || "";
        const beforeFooter = text.split(/Listen to voicemail|You are receiving this email/i)[0] || text;
        let tr = beforeFooter.replace(/^[\s\S]*?\d{1,2}:\d{2}\s*(?:AM|PM)/i, "").replace(/\s+/g, " ").trim();
        if (tr.length < 8) tr = "";
        from = firstPhone(beforeFooter); // caller's number appears in the header before the transcript
        summary = `Voicemail from ${caller || "caller"}${dur ? ` (${dur})` : ""}${tr ? `: ${tr}` : ""}`;
        const rec = firstUrl(html + "\n" + hay, /https?:\/\/[^\s>"']*dialpad[^\s>"']*/i);
        link = rec ? `Recording: ${rec}` : undefined;
      } else if (/missed call|missed a call|no answer/i.test(hay)) {
        source = "Missed Call (Phone)";
        from = firstPhone(text) || firstPhone(hay);
        summary = "Missed call — no message left";
      } else {
        return { statusCode: 200, body: "ignored: non-actionable Dialpad email" };
      }
    } else {
      return { statusCode: 200, body: "ignored: unrecognized sender" };
    }

    const { patientId, patientName } = await matchPatientByPhone(from);
    // Prefer a direct PDF/recording URL the forwarder saved (e.g. the fax PDF in
    // Drive) for Source Link; otherwise createQueueEntry pulls it from `link`.
    const sourceUrl = String(body.attachmentUrl || "").trim();
    if (sourceUrl && /fax/i.test(source)) summary = `${summary} · PDF: ${body.attachmentName || "attachment"}`;
    const r = await createQueueEntry({ patientId, patientName, from, summary, source, link, sourceUrl, receivedISO: body.receivedISO || new Date().toISOString() });
    if (!r.ok) return { statusCode: 502, body: `operations intake error: ${r.error}` };
    return { statusCode: 200, body: JSON.stringify({ ok: true, source, matched: r.matched }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
