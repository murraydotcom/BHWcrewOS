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
  const d = digits(from);
  const last10 = d.slice(-10);
  const last7 = d.slice(-7);
  if (last7.length !== 7) return out;
  const dashed = last7.replace(/(\d{3})(\d{4})/, "$1-$2");
  const nameOf = (r) => r.properties?.["Patient Name"]?.title?.[0]?.plain_text || "";

  try {
    // Master List phones may be stored raw ("4436836209") OR formatted
    // ("(443) 683-6209"), so match on both the raw last-7 and the dashed form in
    // one query, then confirm each candidate on the full last-10 to rule out
    // last-4/last-7 collisions. Larger page_size so a common number's real match
    // isn't paged out.
    const res = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
      method: "POST", headers: H(),
      body: JSON.stringify({
        filter: { or: [
          { property: "Phone", phone_number: { contains: last7 } },
          { property: "Phone", phone_number: { contains: dashed } },
        ] },
        page_size: 50,
      }),
    });
    const data = await res.json();
    const seen = new Set();
    const hits = (data.results || []).filter((r) => {
      if (!digits(r.properties?.Phone?.phone_number || "").endsWith(last10)) return false;
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    if (hits.length === 1) {
      out.patientId = hits[0].id;
      out.patientName = nameOf(hits[0]);
    } else if (hits.length > 1) {
      // Shared/family number — don't guess one patient (and don't link the wrong
      // relation). Surface the candidate names in the row so the desk can pick.
      const names = [...new Set(hits.map(nameOf).filter(Boolean))];
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
