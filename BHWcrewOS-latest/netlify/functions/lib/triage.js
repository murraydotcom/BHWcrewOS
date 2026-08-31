// netlify/functions/lib/triage.js — shared ingestion for inbound patient
// communications. This is the "Keragon replacement": webhook → match the
// patient by phone → drop a row in the Patient Request Triage Queue, which the
// Front Desk OS inbox already renders (Calls & voicemails / Texts & portal /
// Faxes) by the row's Source.
//
// Env: Cloud patient registry settings, NOTION_TOKEN, QUEUE_DB_ID (triage queue).
//
// Source strings are chosen so Front Desk OS buckets them correctly — its
// bucket() sorts /voicemail|phone/ → voice, /text|sms|portal/ → text, else fax:
//   "Text / SMS"  "Voicemail"  "Missed Call (Phone)"  "Phone Call"  "Fax"

const NOTION = "https://api.notion.com/v1";
const H = () => ({
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
});
const digits = (s) => (s || "").replace(/\D/g, "");
const { listCloudPatients } = require("./cloud-patients");

// Match a sender phone number to one patient on the Master Patient List.
// Returns { patientId, patientName, bhwPatientId } — nulls when there's no
// confident match. `patientId` is the legacy Notion relation ID;
// `bhwPatientId` is the migrated Google registry ID when present on that row.
async function matchPatientByPhone(from) {
  const out = { patientId: null, patientName: "", bhwPatientId: "" };
  const d = digits(from);
  const last10 = d.slice(-10);
  const last7 = d.slice(-7);
  if (last7.length !== 7) return out;
  try {
    const hits = (await listCloudPatients()).filter((p) => digits(p.phone).endsWith(last10));
    if (hits.length === 1) {
      out.patientId = hits[0].notionPageId || null;
      out.bhwPatientId = hits[0].bhwPatientId || "";
      out.patientName = hits[0].name || "";
    } else if (hits.length > 1) {
      // Shared/family number — don't guess one patient (and don't link the wrong
      // relation). Surface the candidate names in the row so the desk can pick.
      const names = [...new Set(hits.map((p) => p.name).filter(Boolean))];
      out.patientName = (names.slice(0, 4).join(" / ") + (names.length > 4 ? " / …" : "") + " (shared number)").slice(0, 200);
    }
  } catch { /* matching is best-effort — never block ingestion */ }
  return out;
}

// Create one triage-queue row. The DB's title is "Request ID" (REQ-…) and
// "Patient Name" is a text field. The original's URL — fax PDF, call recording,
// or portal/Charm message — goes in the "Source Link" property (pass an explicit
// `sourceUrl`, else it's pulled from `link`).
async function createQueueEntry({ patientId, patientName, from, summary, source, receivedISO, link, sourceUrl }) {
  if (!process.env.QUEUE_DB_ID) return { ok: false, error: "QUEUE_DB_ID not set" };
  const when = receivedISO || new Date().toISOString();
  const reqId = `REQ-${when.slice(0, 10).replace(/-/g, "")}-${when.slice(11, 19).replace(/:/g, "")}`;
  const url = sourceUrl || (String(link || "").match(/https?:\/\/[^\s)]+/) || [])[0] || "";
  const body = `${summary || ""}`.trim().slice(0, 1900);
  const props = {
    "Request ID": { title: [{ text: { content: reqId } }] },
    "Patient Name": { rich_text: [{ text: { content: String(patientName || "").slice(0, 200) } }] },
    "Callback Number": { phone_number: from || null },
    "Summary": { rich_text: [{ text: { content: body || "(no content)" } }] },
    "Source": { select: { name: source } },
    "Received": { date: { start: when } },
    "Status": { status: { name: "Not started" } },
  };
  if (url) props["Source Link"] = { url };
  if (patientId) props["Patient"] = { relation: [{ id: patientId }] };

  const res = await fetch(`${NOTION}/pages`, {
    method: "POST", headers: H(),
    body: JSON.stringify({ parent: { database_id: process.env.QUEUE_DB_ID }, properties: props }),
  });
  if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300) };
  // Return the Request ID so public callers (e.g. Care Connect) can show the
  // patient a reference they can quote when they phone in.
  return { ok: true, matched: !!patientId, reference: reqId };
}

// Verify a Dialpad webhook body. Requires an HS256 JWT signed with the shared
// secret — a raw unsigned JSON body is REJECTED so the endpoint can't be spoofed
// by anyone who knows the URL. Returns the decoded payload, or null when the
// secret is missing or the signature is absent/invalid. (The handler 503s before
// calling this when no secret is configured.)
function parseDialpadBody(raw, secret) {
  const s = (raw || "").trim();
  if (!secret) return null;
  const [h, p, sig] = s.split(".");
  if (!h || !p || !sig) return null; // not a signed JWT (e.g. raw JSON) → reject
  const crypto = require("crypto");
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
}

module.exports = { digits, matchPatientByPhone, createQueueEntry, parseDialpadBody };
