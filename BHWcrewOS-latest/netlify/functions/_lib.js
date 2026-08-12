// netlify/functions/_lib.js — shared helpers for BHWcrewOS
const crypto = require("crypto");
const https = require("https");
 
// Works on every Node runtime (no fetch dependency)
function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(out || "{}"); } catch { parsed = { raw: out }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
 
 
 
const NOTION = "https://api.notion.com/v1";
 
// Notion database IDs (created 7/4/2026 under "BHW Operations Hub — Data Layer")
const DB = {
  staff: "23241ce30cba4b01adb858afbe95d11f",
  patients: "f9a0291f34aa4d559fbc920c79d219b4",
  rooms: "1686d78712c7437dbb09fb01281e32e2",
  availability: "f5594085117d442e9f90f5ea0f31e509",
  schedule: "318c41c02c4248f99fce30b35172f785",
  referrals: "38d1e95e77944d4c9e9fd9a656bc3f70",
  handoffs: "cef65566ce924b56a01961eb66b15161",
  minutes: "818f2fa362aa40fc9032d1388a047a3f",
  meetings: "f498ac069a0447e78d3aa0763bf81827",
  porterhouse: "d5d6639fe9464c56b48b42d2a8ed9fac",
  resources: "96dd6b0fd4f9423e849df6e540caed94",
  awv: "fea583fc6c6d4541a99dfc4c49469f4d",
  charmed: "7d354239e401481f8ff7668724be08cd",
  charmedAdult: "efafeeef51bf4cc89b4b18f612d72401",
  charmedProgram: "465a58c082e7433394799aef8a38357f",
  phplans: "2951cddee95649e7b0c28e47d29f270f",
  screenerLinks: "279d0105ebe24629a2d0c1c82cc8b5e6",
  screeners: "c63580758d3082a1811701c33683dd0d", // Condition Screeners — Data (scored responses)
  referralTemplates: "ca79d3c1d889463cacf01168d413712f", // Referral Templates — by Destination
  carePlans: "ad8bcdfb4bd94385b39c67ef972d1fad", // Care Plans — Data (annual, per program)
  questionnaires: "eb20fcd416df4956b2a88e35de008410", // Questionnaires — Data (patient intake)
  careGaps: "32e580758d30806bac67e7deff25bc3c", // Medicare Wellness Report (payer gaps, monthly CSV uploads)
  crewProjects: "386e620a9df545209a02207c4554c75b",
  careLog: "a839f769a04e461a8e1c495073a22b87", // Care Management Log — one row / patient / month (CCM/APCM) or episode (TCM)
};

const DIVISIONS = ["Primary Care", "CharmEd Minds", "Mind & Mood Recovery", "The Porter House", "Care Management", "Flow"];

// ---------- Notion ----------
async function queryDb(dbId, filter, sorts) {
  const results = [];
  let cursor;
  do {
    const res = await httpJson("POST", `${NOTION}/databases/${dbId}/query`,
      { start_cursor: cursor, ...(filter ? { filter } : {}), ...(sorts ? { sorts } : {}) });
    if (!res.ok) throw new Error(`Notion ${res.status} querying ${dbId}: ${JSON.stringify(res.data).slice(0, 300)}`);
    results.push(...res.data.results);
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor);
  return results;
}
 
async function createPage(dbId, properties) {
  const res = await httpJson("POST", `${NOTION}/pages`, { parent: { database_id: dbId }, properties });
  if (!res.ok) throw new Error(`Notion create ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  return res.data;
}
 
async function updatePage(pageId, properties) {
  const res = await httpJson("PATCH", `${NOTION}/pages/${pageId}`, { properties });
  if (!res.ok) throw new Error(`Notion update ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  return res.data;
}
 
// ---------- Property readers ----------
const P = {
  title: (p) => p?.title?.map((t) => t.plain_text).join("") || "",
  text: (p) => p?.rich_text?.map((t) => t.plain_text).join("") || "",
  sel: (p) => p?.select?.name || "",
  multi: (p) => (p?.multi_select || []).map((o) => o.name),
  check: (p) => !!p?.checkbox,
  num: (p) => (typeof p?.number === "number" ? p.number : null),
  date: (p) => p?.date?.start || "",
  rel: (p) => (p?.relation || []).map((r) => r.id),
  uid: (p) => (p?.unique_id ? `${p.unique_id.prefix}-${p.unique_id.number}` : ""),
};
 
// ---------- Property writers ----------
const W = {
  title: (v) => ({ title: [{ text: { content: String(v).slice(0, 200) } }] }),
  text: (v) => ({ rich_text: v ? [{ text: { content: String(v).slice(0, 1900) } }] : [] }),
  sel: (v) => (v ? { select: { name: v } } : { select: null }),
  date: (v) => (v ? { date: { start: v } } : { date: null }),
  num: (v) => ({ number: v === null || v === undefined || v === "" ? null : Number(v) }),
  rel: (ids) => ({ relation: (ids || []).filter(Boolean).map((id) => ({ id })) }),
  check: (v) => ({ checkbox: !!v }),
  status: (v) => (v ? { status: { name: v } } : { status: null }),
};
 
// ---------- Sessions (HMAC-signed, no server-side store needed) ----------
function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
 
function verify(token) {
  try {
    const secret = process.env.SESSION_SECRET;
    const [body, sig] = String(token || "").split(".");
    const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { staffId, name, divisions, access, landing, canSchedule, exp }
  } catch {
    return null;
  }
}
 
function getSession(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  return verify(auth.replace(/^Bearer\s+/i, ""));
}
 
// Division wall removed by request: every signed-in staff member sees and can act on
// every division, regardless of their assigned position. Kept as a function (rather than
// inlining DIVISIONS everywhere) so this is the one place to revert if that ever changes.
function visibleDivisions(session) {
  return DIVISIONS;
}
 
function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}
 
module.exports = { DB, DIVISIONS, httpJson, queryDb, createPage, updatePage, P, W, sign, verify, getSession, visibleDivisions, json };
 
