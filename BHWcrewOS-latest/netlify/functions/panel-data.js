// BHW Panel Performance — Notion bridge
// Netlify Function: /.netlify/functions/panel-data
//
// Env vars required (Netlify → Site settings → Environment variables):
//   NOTION_TOKEN     — secret from your internal Notion integration
//   PATIENTS_DB_ID   — 7bd06869c78d45bd91bbc221a8200a01
//   EVENTS_DB_ID     — 7405a6b176ee4b9a98548e377b4f43e4
//   DASH_KEY         — optional shared passphrase; if set, requests must
//                      send it in the "x-dash-key" header

const NOTION = "https://api.notion.com/v1";
const HEADERS = () => ({
  "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
});

const HEDIS_PROPS = {
  bp: "BP Control", a1c: "A1c Control", bcs: "Breast Cancer Screening",
  col: "Colorectal Screening", dep: "Depression Screening",
  adh: "Med Adherence", fuh: "7-Day Follow-Up", awv: "AWV",
};
const HEDIS_VAL = { met: "Met", open: "Gap", na: "N/A" };
const HEDIS_VAL_R = { "Met": "met", "Gap": "open", "N/A": "na" };
const TYPE_VAL = { ed: "ED visit", uc: "Urgent care", admit: "Admission", readmit: "Readmission", obs: "Observation" };
const TYPE_VAL_R = Object.fromEntries(Object.entries(TYPE_VAL).map(([k, v]) => [v, k]));

async function notion(path, method = "GET", body) {
  const res = await fetch(NOTION + path, {
    method,
    headers: HEADERS(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Notion ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function queryAll(dbId) {
  const pages = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notion(`/databases/${dbId}/query`, "POST", body);
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

const text = (rt) => (rt || []).map((r) => r.plain_text).join("");
const sel = (p) => (p && p.select ? p.select.name : null);
const rtProp = (s) => ({ rich_text: s ? [{ text: { content: s } }] : [] });
const dateProp = (start, end) => (start ? { date: end && end !== start ? { start, end } : { start } } : { date: null });

function mapPatient(pg) {
  const p = pg.properties;
  if (p["Archived"]?.checkbox) return null;
  const hedis = {};
  for (const [k, name] of Object.entries(HEDIS_PROPS)) {
    const v = sel(p[name]);
    if (v && HEDIS_VAL_R[v] && HEDIS_VAL_R[v] !== "na") hedis[k] = HEDIS_VAL_R[v];
  }
  const program = sel(p["Program"]) || "None";
  return {
    id: pg.id,
    label: text(p["MRN / Initials"]?.title),
    payer: sel(p["Payer"]) || "Other",
    program: program === "None" ? "none" : program,
    enrollDate: p["Enrollment Date"]?.date?.start || null,
    hedis,
  };
}

function mapEvent(pg) {
  const p = pg.properties;
  if (p["Archived"]?.checkbox) return null;
  const rel = p["Patient"]?.relation || [];
  if (!rel.length) return null;
  const d = p["Date"]?.date || {};
  return {
    id: pg.id,
    patientId: rel[0].id,
    type: TYPE_VAL_R[sel(p["Type"])] || "ed",
    date: d.start || pg.created_time.slice(0, 10),
    dateTo: d.end || d.start || pg.created_time.slice(0, 10),
    facility: text(p["Facility"]?.rich_text),
    reason: text(p["Reason"]?.rich_text),
    discharge: !!p["Discharge Info in Chart"]?.checkbox,
    outreach1: p["Outreach 1"]?.date?.start || null,
    outreach2: p["Outreach 2"]?.date?.start || null,
    outreach3: p["Outreach 3"]?.date?.start || null,
    appointment: text(p["Follow-Up Appointment"]?.rich_text),
    historical: !!p["Historical Backfill"]?.checkbox,
  };
}

function eventProps(x) {
  const props = {};
  if (x.type !== undefined) props["Type"] = { select: { name: TYPE_VAL[x.type] || "ED visit" } };
  if (x.date !== undefined) props["Date"] = dateProp(x.date, x.dateTo);
  if (x.facility !== undefined) props["Facility"] = rtProp(x.facility);
  if (x.reason !== undefined) props["Reason"] = rtProp(x.reason);
  if (x.discharge !== undefined) props["Discharge Info in Chart"] = { checkbox: !!x.discharge };
  if (x.outreach1 !== undefined) props["Outreach 1"] = dateProp(x.outreach1);
  if (x.outreach2 !== undefined) props["Outreach 2"] = dateProp(x.outreach2);
  if (x.outreach3 !== undefined) props["Outreach 3"] = dateProp(x.outreach3);
  if (x.appointment !== undefined) props["Follow-Up Appointment"] = rtProp(x.appointment);
  if (x.historical !== undefined) props["Historical Backfill"] = { checkbox: !!x.historical };
  return props;
}

function patientProps({ label, payer, program, enrollDate, hedis }) {
  const props = {};
  if (label !== undefined) props["MRN / Initials"] = { title: [{ text: { content: label } }] };
  if (payer !== undefined) props["Payer"] = { select: { name: payer } };
  if (program !== undefined) props["Program"] = { select: { name: program === "none" ? "None" : program } };
  if (enrollDate !== undefined) props["Enrollment Date"] = enrollDate ? { date: { start: enrollDate } } : { date: null };
  if (hedis) {
    for (const [k, v] of Object.entries(hedis)) {
      if (HEDIS_PROPS[k]) props[HEDIS_PROPS[k]] = { select: { name: HEDIS_VAL[v] || "N/A" } };
    }
  }
  return props;
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-dash-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  if (process.env.DASH_KEY && event.headers["x-dash-key"] !== process.env.DASH_KEY) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Bad or missing key" }) };
  }

  const PDB = process.env.PATIENTS_DB_ID, EDB = process.env.EVENTS_DB_ID;
  try {
    if (event.httpMethod === "GET") {
      const [pp, ee] = await Promise.all([queryAll(PDB), queryAll(EDB)]);
      const patients = pp.map(mapPatient).filter(Boolean);
      const ids = new Set(patients.map((p) => p.id));
      const events = ee.map(mapEvent).filter((e) => e && ids.has(e.patientId));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ patients, events }) };
    }

    if (event.httpMethod === "POST") {
      const { action, payload } = JSON.parse(event.body || "{}");

      if (action === "addPatient") {
        const pg = await notion("/pages", "POST", {
          parent: { database_id: PDB },
          properties: patientProps(payload),
        });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ id: pg.id }) };
      }

      if (action === "updatePatient") {
        await notion(`/pages/${payload.id}`, "PATCH", { properties: patientProps(payload) });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      if (action === "deletePatient") {
        await notion(`/pages/${payload.id}`, "PATCH", { archived: true });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      if (action === "addEvent") {
        const props = eventProps(payload);
        props["Event"] = { title: [{ text: { content: `${TYPE_VAL[payload.type] || "Event"} — ${payload.facility || payload.date}` } }] };
        props["Patient"] = { relation: [{ id: payload.patientId }] };
        const pg = await notion("/pages", "POST", { parent: { database_id: EDB }, properties: props });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ id: pg.id }) };
      }

      if (action === "updateEvent") {
        await notion(`/pages/${payload.id}`, "PATCH", { properties: eventProps(payload) });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      if (action === "deleteEvent") {
        await notion(`/pages/${payload.id}`, "PATCH", { archived: true });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Unknown action" }) };
    }

    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
