// netlify/functions/submit-triage.js
// Receives a "Just Ask" submission from BHW Care Connect and creates a row in
// the 📥 Patient Request Triage Queue in Notion, so web messages land in the
// same inbox the front desk and CrewCare console already read.
//
// The queue's title is "Request ID" (REQ-YYYYMMDD-HHMMSS); "Patient Name" is a
// text field (full names OK — workspace is BAA-covered); Source has a
// "Website Form" option. When the name matches a single Master List record we
// link it and copy their phone into Callback Number.
//
// Env: NOTION_TOKEN (shared), QUEUE_DB_ID (falls back to DB.queue), MASTER_DB_ID
//
// POST { route, routeLabel, freeText, name, dob, summary } -> { ok, reference }

const { json, createPage, queryDb, DB } = require("./_lib");

const QUEUE_DB = process.env.QUEUE_DB_ID || DB.queue;
const MASTER_DB = process.env.MASTER_DB_ID || DB.masterList;

// App route -> queue Request Type (must match existing select options).
const REQUEST_TYPE = {
  refill: "Refill / Rx",
  clinical: "Other",
  scheduling: "Reschedule",
  billing: "Billing Question",
  portal: "Other",
  general: "Other",
};
// App route -> queue Priority (from each route's stated SLA).
const PRIORITY = {
  refill: "High — 48 hr",
  clinical: "Urgent — same day",
  scheduling: "Routine — 1 week",
  billing: "Routine — 1 week",
  portal: "High — 48 hr",
  general: "Routine — 1 week",
};

function reqId(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `REQ-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// Best-effort single match on the Master List by name; returns {id, phone} or null.
async function matchPatient(name) {
  const n = String(name || "").trim();
  if (n.length < 3) return null;
  try {
    const rows = await queryDb(MASTER_DB, { property: "Patient Name", title: { contains: n } });
    if (rows.length !== 1) return null; // only auto-link an unambiguous match
    const p = rows[0].properties || {};
    return { id: rows[0].id, phone: p["Phone"]?.phone_number || "" };
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const route = String(body.route || "general");
  const name = String(body.name || "").trim();
  const summary = String(body.summary || body.freeText || "").trim();
  if (!summary && !name) return json(400, { error: "Nothing to send." });

  const now = new Date();
  const match = await matchPatient(name);

  const props = {
    "Request ID": { title: [{ text: { content: reqId(now) } }] },
    "Patient Name": { rich_text: name ? [{ text: { content: name.slice(0, 200) } }] : [] },
    "Summary": { rich_text: summary ? [{ text: { content: summary.slice(0, 1900) } }] : [] },
    "Source": { select: { name: "Website Form" } },
    "Request Type": { select: { name: REQUEST_TYPE[route] || "Other" } },
    "Priority": { select: { name: PRIORITY[route] || "Routine — 1 week" } },
    "Status": { status: { name: "Not started" } },
    "Received": { date: { start: now.toISOString() } },
  };
  if (match?.phone) props["Callback Number"] = { phone_number: match.phone };
  if (match?.id) props["Patient"] = { relation: [{ id: match.id }] };

  try {
    await createPage(QUEUE_DB, props);
  } catch (err) {
    return json(502, { error: "Could not send your message — please try again or call the office.", detail: String(err).slice(0, 200) });
  }

  return json(200, { ok: true, reference: reqId(now) });
};
