// netlify/functions/dialpad-events.js
// Receives Dialpad Event Subscription webhooks and drops matched entries into
// the Patient Request Triage Queue, which the Front Desk OS inbox renders.
// Handles inbound SMS, missed calls, and voicemails (answered/outbound are
// ignored). This is part of the Keragon replacement — a direct webhook, no
// middleware.
//
// Env: NOTION_TOKEN, MASTER_DB_ID, QUEUE_DB_ID
// Optional: DIALPAD_WEBHOOK_SECRET (set the same value on the Dialpad webhook)

const { matchPatientByPhone, createQueueEntry, parseDialpadBody } = require("./lib/triage");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "method not allowed" };

    let payload;
    try { payload = parseDialpadBody(event.body || "", process.env.DIALPAD_WEBHOOK_SECRET); }
    catch { return { statusCode: 400, body: "bad payload" }; }
    if (payload === null) return { statusCode: 401, body: "bad signature or unrecognized payload" };

    // Inbound only.
    const dir = (payload.direction || "").toLowerCase();
    if (dir && dir !== "inbound") return { statusCode: 200, body: "ignored: not inbound" };

    const from = payload.from_number || payload.external_number || payload.contact?.phone || payload.from?.phone_number || "";

    // Classify the event.
    const text = payload.text || payload.text_content || payload.message?.text || "";
    let source, summary, link;
    if (text) {
      source = "Text / SMS";
      summary = text;
    } else {
      const state = String(payload.state || payload.call_state || payload.event_type || payload.event || "").toLowerCase();
      const vmLink = payload.voicemail_link || payload.recording_url || payload.voicemail?.link || payload.voicemail?.recording_url || "";
      const transcript = payload.transcription || payload.voicemail?.transcription || payload.transcript || "";
      const connected = !!(payload.was_connected || payload.answered) || Number(payload.duration) > 0 || /connected|answered/.test(state);
      const isVoicemail = /voicemail|voice_?mail/.test(state) || !!vmLink || !!transcript;
      const isMissed = /missed|no[_\s-]?answer|abandon|hangup|unanswered/.test(state) && !connected;

      if (isVoicemail) {
        source = "Voicemail";
        summary = transcript ? `Voicemail: ${transcript}` : "New voicemail";
        link = vmLink || undefined;
      } else if (isMissed) {
        source = "Missed Call (Phone)";
        summary = "Missed call — no message left";
      } else {
        return { statusCode: 200, body: "ignored: answered/other call event" };
      }
    }

    if (!from && !summary) return { statusCode: 200, body: "ignored: no content" };

    const { patientId, patientName } = await matchPatientByPhone(from);
    const r = await createQueueEntry({ patientId, patientName, from, summary, source, link, receivedISO: new Date().toISOString() });
    if (!r.ok) return { statusCode: 502, body: `notion error: ${r.error}` };
    return { statusCode: 200, body: JSON.stringify({ ok: true, source, matched: r.matched }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
