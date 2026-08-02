// netlify/functions/note-extract.js — Phase 2 AI prefill for the Paperwork
// Studio. Sends a pasted note to OpenAI and returns structured fields the
// front-end uses to prefill the paperwork form.
//
//   POST { note }  → { fields:{…}, icds:[{code,label}] }
//
// PHI handling: the note is held only in memory for the request and is NEVER
// logged. It travels browser → this function → OpenAI. Real-patient use
// requires a BAA covering the OpenAI *API* (not just the ChatGPT app) with
// zero data retention, and a Netlify BAA for the compute layer.
//
// Config (Netlify env): OPENAI_API_KEY (required), OPENAI_MODEL (optional,
// default "gpt-4o-mini").

const https = require("https");
const { getSession, json } = require("./_lib");

function openai(path, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.openai.com",
      path,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        let parsed; try { parsed = JSON.parse(out || "{}"); } catch { parsed = { raw: out }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const SYSTEM = `You extract structured data from a clinical note or medical-records request so a staff member can pre-fill a paperwork form. Rules:
- Only include information explicitly present in the text. Never invent or infer values that are not stated.
- Output ONLY a JSON object with these exact keys:
  patient (full name), dob (YYYY-MM-DD), mrn (chart/record number), insurer, memberId,
  dateFrom (YYYY-MM-DD, earliest date of the requested/records span), dateTo (YYYY-MM-DD, latest),
  medication (drug/service requested, if any), triedFailed (prior/failed therapies, if any),
  limitations (functional limitations, if any),
  icd10 (array of objects: {"code": "<ICD-10 code>", "label": "<short description as written>"}).
- Use "" for any string not found and [] for icd10 when none are found.
- Normalize all dates to YYYY-MM-DD. Keep ICD-10 codes in standard format (e.g. E11.9).`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Signed out — sign in to crewOS again." });

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return json(503, { needsKey: true, error: "AI prefill isn't configured yet — set OPENAI_API_KEY in Netlify (under a BAA that covers the API). The local scan still works." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const note = String(body.note || "").slice(0, 12000).trim(); // bound token usage
  if (!note) return json(400, { error: "Paste a note first." });

  try {
    const res = await openai("/v1/chat/completions", {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: note },
      ],
    }, apiKey);

    if (!res.ok) {
      // Do not echo the note or full payload back.
      const msg = res.data?.error?.message || `OpenAI error ${res.status}`;
      return json(502, { error: `AI prefill failed: ${msg}` });
    }

    let parsed = {};
    try { parsed = JSON.parse(res.data.choices?.[0]?.message?.content || "{}"); } catch { parsed = {}; }

    const fields = {};
    for (const k of ["patient", "dob", "mrn", "insurer", "memberId", "dateFrom", "dateTo", "medication", "triedFailed", "limitations"]) {
      if (parsed[k]) fields[k] = String(parsed[k]).trim();
    }
    const icds = Array.isArray(parsed.icd10)
      ? parsed.icd10
          .filter((x) => x && x.code)
          .map((x) => ({ code: String(x.code).toUpperCase().trim(), label: String(x.label || "").trim() }))
      : [];

    return json(200, { fields, icds });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
