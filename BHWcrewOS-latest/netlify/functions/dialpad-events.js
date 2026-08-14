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

    // Fail closed: require the signing secret so this is never an open write.
    if (!process.env.DIALPAD_WEBHOOK_SECRET) return { statusCode: 503, body: "DIALPAD_WEBHOOK_SECRET not set" };

    // Netlify may base64-encode the request body (depends on content-type);
    // decode so the raw JWT reaches the verifier intact.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    let payload;
    try { payload = parseDialpadBody(rawBody, process.env.DIALPAD_WEBHOOK_SECRET); }
    catch (e) { console.log("dialpad-events parse error:", e.message); return { statusCode: 400, body: "bad payload" }; }
    if (payload === null) {
      // PHI-safe diagnostic: structure only, no message content.
      console.log("dialpad-events reject:", JSON.stringify({
        b64: !!event.isBase64Encoded,
        ct: event.headers?.["content-type"] || event.headers?.["Content-Type"] || "",
        len: rawBody.length,
        dots: (rawBody.match(/\./g) || []).length,
        head: rawBody.slice(0, 12),
      }));
      return { statusCode: 401, body: "bad signature or unrecognized payload" };
    }

    // Trace the parsed event (PHI-safe: field names + scalars only, no content)
    // so we can see Dialpad's real payload shape.
    console.log("dialpad-events parsed:", JSON.stringify({
      keys: Object.keys(payload || {}),
      direction: payload.direction || null,
      state: payload.state || payload.call_state || payload.event_type || payload.event || null,
      hasText: !!(payload.text || payload.text_content || payload.message?.text),
      fromLast4: String(payload.from_number || payload.external_number || payload.contact?.phone || payload.from?.phone_number || "").slice(-4),
    }));

    // Inbound only.
    const dir = (payload.direction || "").toLowerCase();
    if (dir && dir !== "inbound") { console.log("dialpad-events ignored: not inbound;", dir); return { statusCode: 200, body: "ignored: not inbound" }; }

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

      // Dialpad Ai recap / action items (fires after a call is processed).
      // We surface the ACTION ITEMS — the follow-ups a call generates — not the
      // raw transcript, so answered calls that need work reach the desk without
      // dumping full transcripts. Requires the call subscription to include the
      // recap_summary state. Field names are matched defensively because the
      // exact recap payload varies; tune once a real recap is seen in the logs.
      const rawItems = payload.action_items || payload.recap?.action_items || payload.call_recap?.action_items || payload.recap_summary?.action_items || [];
      const actionItems = (Array.isArray(rawItems) ? rawItems : [])
        .map((a) => (typeof a === "string" ? a : a?.text || a?.content || a?.name || a?.summary || "")).filter(Boolean);
      const recapText = (typeof payload.recap_summary === "string" ? payload.recap_summary : payload.recap_summary?.text || payload.recap_summary?.summary) ||
        payload.recap?.summary || payload.call_recap?.summary || "";
      const isRecap = /recap|action[_\s-]?item|call[_\s-]?transcription/.test(state) || actionItems.length > 0;

      const isVoicemail = /voicemail|voice_?mail/.test(state) || (!isRecap && (!!vmLink || !!transcript));
      const isMissed = /missed|no[_\s-]?answer|abandon|hangup|unanswered/.test(state) && !connected;

      if (isRecap && (actionItems.length || recapText)) {
        source = "Phone Call"; // buckets into "Calls & voicemails" on Front Desk
        summary = actionItems.length
          ? `☎️ Call action items:\n${actionItems.map((i) => `• ${i}`).join("\n")}${recapText ? `\n\nRecap: ${recapText}` : ""}`
          : `☎️ Call recap: ${recapText}`;
        link = payload.recording_url || payload.call_recording_url || payload.recording?.url || undefined;
      } else if (isVoicemail) {
        source = "Voicemail";
        summary = transcript ? `Voicemail: ${transcript}` : "New voicemail";
        link = vmLink || undefined;
      } else if (isMissed) {
        source = "Missed Call (Phone)";
        summary = "Missed call — no message left";
      } else {
        console.log("dialpad-events ignored: unclassified call/other; state=", state);
        return { statusCode: 200, body: "ignored: answered/other call event" };
      }
    }

    if (!from && !summary) { console.log("dialpad-events ignored: no content"); return { statusCode: 200, body: "ignored: no content" }; }

    const { patientId, patientName } = await matchPatientByPhone(from);
    const r = await createQueueEntry({ patientId, patientName, from, summary, source, link, receivedISO: new Date().toISOString() });
    console.log("dialpad-events write:", JSON.stringify({ source, created: r.ok, matched: r.matched, error: r.error || null }));
    if (!r.ok) return { statusCode: 502, body: `notion error: ${r.error}` };
    return { statusCode: 200, body: JSON.stringify({ ok: true, source, matched: r.matched }) };
  } catch (e) {
    console.log("dialpad-events error:", String((e && e.message) || e));
    return { statusCode: 500, body: String(e) };
  }
};
