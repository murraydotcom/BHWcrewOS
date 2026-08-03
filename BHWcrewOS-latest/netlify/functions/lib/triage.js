// netlify/functions/lib/triage.js — shared ingestion for inbound patient
// communications. This is the "Keragon replacement": webhook → match the
// patient by phone → drop a row in the Patient Request Triage Queue, which the
// Front Desk OS inbox already renders (Calls & voicemails / Texts & portal /
// Faxes) by the row's Source.
//
// Env: NOTION_TOKEN, MASTER_DB_ID (patient list), QUEUE_DB_ID (triage queue).
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

// Match a sender phone number to one patient on the Master Patient List.
// Returns { patientId, patientName } — nulls when there's no confident match.
async function matchPatientByPhone(from) {
  const out = { patientId: null, patientName: "" };
  if (!process.env.MASTER_DB_ID) return out;
  const last7 = digits(from).slice(-7);
  if (last7.length !== 7) return out;

  try {
    let res = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
      method: "POST", headers: H(),
      body: JSON.stringify({
        filter: { property: "Phone", phone_number: { contains: last7.replace(/(\d{3})(\d{4})/, "$1-$2") } },
        page_size: 5,
      }),
    });
    let data = await res.json();
    let hits = data.results || [];
    if (!hits.length) {
      const res2 = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
        method: "POST", headers: H(),
        body: JSON.stringify({ filter: { property: "Phone", phone_number: { contains: last7.slice(-4) } }, page_size: 10 }),
      });
      const d2 = await res2.json();
      hits = (d2.results || []).filter((r) =>
        digits(r.properties?.Phone?.phone_number || "").endsWith(digits(from).slice(-10)));
    }
    if (hits.length === 1) {
      out.patientId = hits[0].id;
      out.patientName = hits[0].properties?.["Patient Name"]?.title?.[0]?.plain_text || "";
    }
  } catch { /* matching is best-effort — never block ingestion */ }
  return out;
}

// Create one triage-queue row. `link` (fax/recording URL) is appended to the
// summary so we never depend on a column that might not exist in the DB.
async function createQueueEntry({ patientId, patientName, from, summary, source, receivedISO, link }) {
  if (!process.env.QUEUE_DB_ID) return { ok: false, error: "QUEUE_DB_ID not set" };
  const body = `${summary || ""}${link ? `\n${link}` : ""}`.trim().slice(0, 1900);
  const props = {
    "Patient Name": { title: [{ text: { content: (patientName || `${source} from ${from || "unknown number"}`).slice(0, 200) } }] },
    "Callback Number": { phone_number: from || null },
    "Summary": { rich_text: [{ text: { content: body || "(no content)" } }] },
    "Source": { select: { name: source } },
    "Received": { date: { start: receivedISO || new Date().toISOString() } },
    "Status": { status: { name: "Not started" } },
  };
  if (patientId) props["Patient"] = { relation: [{ id: patientId }] };

  const res = await fetch(`${NOTION}/pages`, {
    method: "POST", headers: H(),
    body: JSON.stringify({ parent: { database_id: process.env.QUEUE_DB_ID }, properties: props }),
  });
  if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300) };
  return { ok: true, matched: !!patientId };
}

// Verify a Dialpad webhook body: raw JSON, or an HS256 JWT when a secret is set.
// Returns the decoded payload, or null on a bad signature.
function parseDialpadBody(raw, secret) {
  const s = (raw || "").trim();
  if (s.startsWith("{")) return JSON.parse(s);
  if (secret) {
    const crypto = require("crypto");
    const [h, p, sig] = s.split(".");
    if (!h || !p || !sig) return null;
    const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  }
  return null;
}

module.exports = { digits, matchPatientByPhone, createQueueEntry, parseDialpadBody };
