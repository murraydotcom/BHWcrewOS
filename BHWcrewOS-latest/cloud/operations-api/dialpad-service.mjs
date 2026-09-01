import crypto from "node:crypto";

const cleanText = (value, max = 4000) => String(value ?? "").trim().slice(0, max);

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : "";
}

export function verifyDialpadWebhook(rawBody, secret) {
  const raw = cleanText(rawBody, 2 * 1024 * 1024);
  if (!secret) throw Object.assign(new Error("Dialpad webhook verification is not configured"), { status: 503 });
  const [header, payload, signature] = raw.split(".");
  if (!header || !payload || !signature) throw Object.assign(new Error("signed Dialpad JWT is required"), { status: 401 });
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(receivedBytes, expectedBytes)) {
    throw Object.assign(new Error("Dialpad webhook signature is invalid"), { status: 401 });
  }
  let value;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw Object.assign(new Error("Dialpad webhook payload is invalid"), { status: 400 }); }
  return value;
}

function eventIdentifier(payload = {}) {
  return cleanText(
    payload.event_id || payload.id || payload.message_id || payload.sms_id || payload.call_id
      || payload.target?.id || payload.created_date || payload.date_created,
    200,
  );
}

export function normalizeDialpadEvent(payload = {}, now = new Date()) {
  const direction = cleanText(payload.direction, 40).toLowerCase();
  const from = normalizePhone(payload.from_number || payload.external_number || payload.contact?.phone || payload.from?.phone_number);
  const to = normalizePhone(payload.to_number || payload.internal_number || payload.target?.phone || payload.to?.phone_number);
  const text = cleanText(payload.text || payload.text_content || payload.message?.text, 4000);
  const state = cleanText(payload.state || payload.call_state || payload.event_type || payload.event, 120).toLowerCase();
  const providerMessageId = eventIdentifier(payload);
  const occurredAtValue = payload.created_date || payload.date_created || payload.timestamp || payload.event_timestamp;
  const occurredAtDate = new Date(occurredAtValue || now);
  const occurredAt = Number.isFinite(occurredAtDate.getTime()) ? occurredAtDate.toISOString() : new Date(now).toISOString();

  if (text) {
    return {
      kind: "sms",
      direction: direction || "inbound",
      from,
      to,
      text,
      source: "dialpad-sms",
      providerMessageId,
      providerStatus: cleanText(payload.status || state || "received", 80).toLowerCase(),
      occurredAt,
      rawEventType: state,
    };
  }

  if (direction === "outbound" && providerMessageId) {
    return {
      kind: "delivery-status",
      direction,
      from,
      to,
      text: "",
      source: "dialpad-sms",
      providerMessageId,
      providerStatus: cleanText(payload.status || state || "unknown", 80).toLowerCase(),
      occurredAt,
      rawEventType: state,
    };
  }

  const voicemailLink = cleanText(payload.voicemail_link || payload.recording_url || payload.voicemail?.link || payload.voicemail?.recording_url, 1200);
  const transcript = cleanText(payload.transcription || payload.voicemail?.transcription || payload.transcript, 4000);
  const connected = Boolean(payload.was_connected || payload.answered) || Number(payload.duration) > 0 || /connected|answered/.test(state);
  const rawItems = payload.action_items || payload.recap?.action_items || payload.call_recap?.action_items || payload.recap_summary?.action_items || [];
  const actionItems = (Array.isArray(rawItems) ? rawItems : []).slice(0, 20)
    .map((item) => cleanText(typeof item === "string" ? item : item?.text || item?.content || item?.name || item?.summary, 500))
    .filter(Boolean);
  const recapText = cleanText(
    (typeof payload.recap_summary === "string" ? payload.recap_summary : payload.recap_summary?.text || payload.recap_summary?.summary)
      || payload.recap?.summary || payload.call_recap?.summary,
    4000,
  );
  const isRecap = /recap|action[_\s-]?item|call[_\s-]?transcription/.test(state) || actionItems.length > 0;
  const isVoicemail = /voicemail|voice_?mail/.test(state) || (!isRecap && Boolean(voicemailLink || transcript));
  const isMissed = /missed|no[_\s-]?answer|abandon|hangup|unanswered/.test(state) && !connected;
  if (isRecap && (actionItems.length || recapText)) {
    return {
      kind: "call-recap",
      direction: direction || "inbound",
      from,
      to,
      text: actionItems.length ? actionItems.join("\n") : recapText,
      source: "dialpad-call",
      providerMessageId,
      providerStatus: state || "recap",
      occurredAt,
      link: voicemailLink,
      rawEventType: state,
    };
  }
  if (isVoicemail) {
    return {
      kind: "voicemail",
      direction: direction || "inbound",
      from,
      to,
      text: transcript || "New voicemail",
      source: "dialpad-voicemail",
      providerMessageId,
      providerStatus: state || "received",
      occurredAt,
      link: voicemailLink,
      rawEventType: state,
    };
  }
  if (isMissed) {
    return {
      kind: "missed-call",
      direction: direction || "inbound",
      from,
      to,
      text: "Missed call — no message left",
      source: "dialpad-call",
      providerMessageId,
      providerStatus: state || "missed",
      occurredAt,
      rawEventType: state,
    };
  }
  return null;
}

export function createDialpadService(environment = process.env, fetchImpl = fetch) {
  const token = cleanText(environment.DIALPAD_TOKEN, 2000);
  const fromNumber = normalizePhone(environment.DIALPAD_FROM);
  const webhookSecret = cleanText(environment.DIALPAD_WEBHOOK_SECRET, 2000);
  const apiBase = cleanText(environment.DIALPAD_API_BASE || "https://dialpad.com/api/v2", 500).replace(/\/$/, "");
  const configured = Boolean(token && fromNumber && /^https:\/\//.test(apiBase));

  return {
    configured,
    webhookConfigured: Boolean(webhookSecret),
    verifyWebhook(rawBody) {
      return verifyDialpadWebhook(rawBody, webhookSecret);
    },
    async sendSms({ to, text, idempotencyKey = "" } = {}) {
      if (!configured) throw Object.assign(new Error("Dialpad SMS is not configured"), { status: 503, code: "messaging-not-configured" });
      const destination = normalizePhone(to);
      const message = cleanText(text, 480);
      if (!destination || !message) throw Object.assign(new Error("valid SMS destination and message are required"), { status: 400 });
      const response = await fetchImpl(`${apiBase}/sms?apikey=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "X-BHW-Idempotency-Key": cleanText(idempotencyKey, 160) } : {}),
        },
        body: JSON.stringify({ from_number: fromNumber, to_numbers: [destination], text: message }),
      });
      const raw = await response.text();
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
      if (!response.ok) {
        const error = new Error(`Dialpad SMS failed (${response.status})`);
        error.status = 502;
        error.providerStatus = response.status;
        error.providerDetail = cleanText(body.message || body.error || raw, 240);
        throw error;
      }
      return {
        provider: "dialpad",
        providerMessageId: cleanText(body.id || body.message_id || body.sms_id || body.request_id, 200),
        providerStatus: cleanText(body.status || "accepted", 80),
        providerResponseCode: response.status,
      };
    },
  };
}

