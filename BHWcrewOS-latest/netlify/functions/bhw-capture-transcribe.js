"use strict";

const https = require("https");

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"],
  ["audio/aac", "aac"],
  ["audio/x-m4a", "m4a"],
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

function header(event, name) {
  const headers = event.headers || {};
  return String(headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "");
}

function cleanOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

function originAllowed(event) {
  const origin = cleanOrigin(header(event, "origin"));
  if (!origin) return true;
  const allowed = [process.env.URL, process.env.DEPLOY_URL, process.env.DEPLOY_PRIME_URL]
    .map(cleanOrigin)
    .filter(Boolean);
  return !allowed.length || allowed.includes(origin);
}

function decodeAudio(event) {
  const body = event.body || "";
  return event.isBase64Encoded ? Buffer.from(body, "base64") : Buffer.from(body, "binary");
}

function multipartAudio(audio, type, extension, model) {
  const boundary = `----BHWCapture${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const prompt = "BHW work note. Proper nouns may include BHW, CrewOS, PSCM, PREVENT-ND, IgA, CharmEd Minds, Mind & Mood, Flow, and EduMedia.";
  const before = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capture.${extension}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`
  );
  const after = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([before, audio, after]) };
}

function openaiTranscription(payload, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/audio/transcriptions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${payload.boundary}`,
        "Content-Length": payload.body.length,
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      res.on("end", () => {
        if (size > MAX_RESPONSE_BYTES) return reject(new Error("Transcription response was too large"));
        const out = Buffer.concat(chunks).toString("utf8");
        let data;
        try { data = JSON.parse(out || "{}"); } catch { data = {}; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });
    req.setTimeout(25000, () => req.destroy(new Error("Transcription timed out")));
    req.on("error", reject);
    req.end(payload.body);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!originAllowed(event)) return json(403, { error: "Same-origin requests only" });
  if (header(event, "x-bhw-capture-non-phi").toLowerCase() !== "true") {
    return json(400, { error: "Confirm this recording contains no PHI before transcription." });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return json(503, { needsKey: true, error: "Automatic transcription is not configured yet." });

  const type = header(event, "content-type").split(";")[0].trim().toLowerCase();
  const extension = ALLOWED_AUDIO_TYPES.get(type);
  if (!extension) return json(415, { error: "Unsupported audio format." });

  let audio;
  try { audio = decodeAudio(event); } catch { return json(400, { error: "The audio body could not be read." }); }
  if (!audio.length) return json(400, { error: "The recording was empty." });
  if (audio.length > MAX_AUDIO_BYTES) return json(413, { error: "Recording exceeds the 4 MB transcription limit." });

  const configuredModel = String(process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe").trim();
  const model = /^[A-Za-z0-9._-]{1,100}$/.test(configuredModel) ? configuredModel : "gpt-4o-mini-transcribe";

  try {
    const result = await openaiTranscription(multipartAudio(audio, type, extension, model), apiKey);
    if (!result.ok) {
      const upstream = String(result.data?.error?.message || `OpenAI error ${result.status}`)
        .replace(/\s+/g, " ")
        .slice(0, 220);
      return json(502, { error: `Automatic transcription failed: ${upstream}` });
    }

    const transcript = String(result.data?.text || "").trim();
    if (!transcript) return json(422, { error: "No speech was detected in this recording." });
    return json(200, { transcript });
  } catch (err) {
    const message = String(err?.message || err || "service unavailable").replace(/\s+/g, " ").slice(0, 220);
    return json(502, { error: `Automatic transcription failed: ${message}` });
  }
};
