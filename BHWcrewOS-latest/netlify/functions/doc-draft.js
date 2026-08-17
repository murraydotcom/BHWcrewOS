// netlify/functions/doc-draft.js — "Draft with AI" for the Document Builder.
// A staff member describes the document they need in plain English; this sends
// the request (plus optional patient context) to OpenAI and returns the
// document body in the Builder's paste-mode markup, which the page renders live
// for the clinician to review, edit, and print/save.
//
//   POST { docType, request, patient? }  (+ ?key=DASH_KEY)
//        -> { rawText }
//
// PHI handling: the request + patient context are held only in memory for the
// request and are NEVER logged. They travel browser -> this function -> OpenAI.
// Real-patient use requires a BAA covering the OpenAI *API* (zero retention) and
// a Netlify BAA for compute. The output is a DRAFT for a licensed clinician to
// review before use.
//
// Config (Netlify env): OPENAI_API_KEY (required), OPENAI_MODEL_DOCS (optional,
// default "gpt-4o"), DASH_KEY (optional gate, matches the rest of the app).

const https = require("https");

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

const DOC_PURPOSE = {
  patient_education: "a patient education handout that explains a condition or topic in plain language",
  avs: "an after-visit summary recapping today's visit and what the patient should do next",
  care_plan: "a patient-facing care plan: goals, the plan, and what the patient does at home",
  patient_letter: "a letter written to the patient",
  specialist_letter: "a referral/consultation letter written to a specialist about the patient",
  medication_list: "a medication list (use MED: lines)",
};

const MARKUP = `Output ONLY the document body in this exact plain-text markup — no code fences, no preamble, no closing commentary:
- "## Heading" begins a section heading.
- "- text" is a bullet; **bold** works inline.
- A line starting with "TIP:", "INFO:", or "WARN:" becomes a highlighted callout box — use it for the single most important reminder or a safety warning.
- "a | b | c" on its own line is a table row; put a header row first.
- "MED: Name | Dose | schedule | with food (y/n) | purpose | instructions" adds a medication (schedule = any of morning,afternoon,evening,bedtime,asneeded, comma-separated).
- Any other line is a paragraph.`;

function systemPrompt(docType) {
  const purpose = DOC_PURPOSE[docType] || "a patient document";
  const patientFacing = docType !== "specialist_letter";
  return [
    "You are a clinical documentation assistant for BHW Medical Group, a primary care practice. A staff member describes the document they need and you draft it.",
    `The document is ${purpose}.`,
    MARKUP,
    "Rules:",
    patientFacing
      ? "- Write for the patient at about a 6th-grade reading level: warm, plain language, second person (\"you\"), short sentences."
      : "- Write professionally, physician-to-physician, concise and clinical.",
    "- Be clinically sound and specific to the request. Organize with clear headings, short bullets, and a callout for the most important guidance.",
    "- NEVER invent patient-specific facts (names, dates, doses, lab values) that were not given. Where a specific is needed but unknown, leave a clearly-marked blank like \"[date]\" or \"[dose]\".",
    "- Do not add your own disclaimer line — the template already prints one.",
    "- This is a DRAFT a licensed clinician will review and edit before use.",
  ].join("\n");
}

function patientBlock(p) {
  if (!p || typeof p !== "object") return "";
  const bits = [];
  if (p.name) bits.push(`Name: ${p.name}`);
  if (p.dob) bits.push(`DOB: ${p.dob}`);
  if (p.allergies) bits.push(`Allergies: ${p.allergies}`);
  if (p.meds) bits.push(`Current medications: ${p.meds}`);
  if (p.payer || p.mco) bits.push(`Insurance: ${[p.payer, p.mco].filter(Boolean).join(" / ")}`);
  if (p.status) bits.push(`Programs/status: ${p.status}`);
  if (!bits.length) return "";
  return `\n\nPatient context (use only what's relevant; do not restate insurance in a patient-facing document):\n${bits.join("\n")}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "POST only" }) };
  if (process.env.DASH_KEY && (event.queryStringParameters?.key !== process.env.DASH_KEY))
    return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { statusCode: 503, body: JSON.stringify({ error: "AI drafting isn't configured yet — set OPENAI_API_KEY in Netlify (under a BAA that covers the API)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }
  const docType = String(body.docType || "patient_education");
  const request = String(body.request || "").slice(0, 4000).trim();
  if (!request) return { statusCode: 400, body: JSON.stringify({ error: "Describe the document you want." }) };

  const userMsg = `Please draft this document.\n\nRequest: ${request}${patientBlock(body.patient)}`;

  try {
    const res = await openai("/v1/chat/completions", {
      model: process.env.OPENAI_MODEL_DOCS || "gpt-4o",
      temperature: 0.4,
      max_tokens: 1800,
      messages: [
        { role: "system", content: systemPrompt(docType) },
        { role: "user", content: userMsg },
      ],
    }, apiKey);

    if (!res.ok) {
      const msg = res.data?.error?.message || `OpenAI error ${res.status}`;
      return { statusCode: 502, body: JSON.stringify({ error: `AI drafting failed: ${msg}` }) };
    }

    let rawText = String(res.data.choices?.[0]?.message?.content || "").trim();
    // Strip an accidental ``` fence if the model wraps the output.
    rawText = rawText.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    if (!rawText) return { statusCode: 502, body: JSON.stringify({ error: "The model returned nothing — try rephrasing." }) };

    return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ rawText }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
