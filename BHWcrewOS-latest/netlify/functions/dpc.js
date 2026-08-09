// netlify/functions/dpc.js — CMS Data at the Point of Care (DPC) integration.
// Pulls Medicare fee-for-service claims for your attributed patients and, most
// usefully for BHW, computes each patient's last Annual Wellness Visit (AWV)
// AND their open gaps in care (preventive/quality services overdue by claims)
// from the claims — something HETS eligibility (Stedi 270/271) cannot return.
//
// Reference implementation: github.com/CMSgov/dpc-app. Production API docs:
// dpc.cms.gov. This is a SCAFFOLD — it fails safe (503) until you finish DPC
// onboarding and set the env vars below. It is session-gated (crewOS PIN).
//
// Flow (FHIR Bulk Data):
//   1. Build a signed-JWT client assertion (RS384) from your registered key.
//   2. POST it to {DPC_BASE}/Token/auth (client_credentials) → access token.
//   3. GET {DPC_BASE}/Group/{DPC_GROUP_ID}/$export?_type=ExplanationOfBenefit
//      with Accept: application/fhir+json, Prefer: respond-async → Content-Location job URL.
//   4. Poll the job URL until complete → list of NDJSON output file URLs.
//   5. Download the EOB NDJSON and read AWV HCPCS (G0438 initial / G0439 subsequent;
//      99387/99397 for preventive) → most recent service date per patient.
//
// Because bulk export is async and Netlify functions are short-lived, the work
// is split into actions the front-end drives: status → start → poll → awv.
//
// Credentials (private key, client token, key id, group id, base) can come from
// EITHER Netlify env vars OR a Netlify Blob — the Blob wins when both are set.
// This matters because a DPC private key is a 4096-bit RSA PEM (~3.2 KB): with
// the client token it fills AWS Lambda's hard 4 KB env-var budget by itself and
// breaks every function's deploy. So the private key (and, if you like, the rest)
// lives in a Blob, seeded once via the session-gated "install" action below —
// never in an env var, never in git.
//
//   DPC_CLIENT_TOKEN  — the client token ("golden macaroon") from the DPC portal
//   DPC_PRIVATE_KEY   — PEM private key whose public key is registered with DPC (keep in the Blob)
//   DPC_PUBLIC_KEY_ID — the key id (kid) DPC assigned to that public key
//   DPC_GROUP_ID      — your attribution Group (roster) id
//   DPC_BASE          — optional; defaults to the production base URL

const crypto = require("crypto");
const https = require("https");
const { getStore } = require("@netlify/blobs");
const { getSession, json } = require("./_lib");

const BLOB_STORE = "dpc-config";
const BLOB_KEY = "secrets";
const PROD_BASE = "https://api.dpc.cms.gov/api/v1";

// Merge Blob-stored secrets over the env-var defaults. The Blob is the source of
// truth for anything set there; env fills the gaps. Degrades to env-only if Blobs
// aren't reachable (e.g. local `netlify dev` without blob context).
async function loadConfig() {
  const cfg = {
    clientToken: process.env.DPC_CLIENT_TOKEN || "",
    privateKey: (process.env.DPC_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    publicKeyId: process.env.DPC_PUBLIC_KEY_ID || "",
    base: (process.env.DPC_BASE || "").replace(/\/+$/, ""),
    groupId: process.env.DPC_GROUP_ID || "",
  };
  try {
    const stored = await getStore(BLOB_STORE).get(BLOB_KEY, { type: "json" });
    if (stored && typeof stored === "object") {
      if (stored.clientToken) cfg.clientToken = String(stored.clientToken);
      if (stored.privateKey) cfg.privateKey = String(stored.privateKey).replace(/\\n/g, "\n");
      if (stored.publicKeyId) cfg.publicKeyId = String(stored.publicKeyId);
      if (stored.base) cfg.base = String(stored.base).replace(/\/+$/, "");
      if (stored.groupId) cfg.groupId = String(stored.groupId);
    }
  } catch { /* env-only fallback */ }
  if (!cfg.base) cfg.base = PROD_BASE;
  return cfg;
}

// Claims-based gaps-in-care. Each measure = the billing codes that satisfy it +
// how recently one must appear (months). This is a screening aid derived from
// Medicare FFS claims — NOT a substitute for the chart. Services done elsewhere
// (or outside Medicare) won't appear, and windows are simplified to the dominant
// modality. Edit this table to match BHW's quality program.
const MEASURES = [
  { name: "Annual Wellness Visit", awv: true, codes: ["G0438", "G0439", "G0468", "99387", "99397", "99385", "99386", "99395", "99396"], months: 12 },
  { name: "Colorectal cancer screening", codes: ["45378", "45380", "45381", "45384", "45385", "45388", "G0105", "G0121", "82270", "G0328", "81528"], months: 120 },
  { name: "Mammogram (breast)", codes: ["77065", "77066", "77067", "G0202"], months: 27 },
  { name: "Bone density (DEXA)", codes: ["77080", "77081", "G0130"], months: 24 },
  { name: "AAA screening (one-time)", codes: ["76706"], months: 1200 },
  { name: "Cervical cancer screening", codes: ["88141", "88142", "88143", "88147", "88148", "88150", "88164", "88165", "88166", "88174", "88175", "87624", "87625"], months: 60 },
  { name: "HbA1c (if diabetic)", codes: ["83036", "83037"], months: 12 },
  { name: "Diabetic retinal eye exam", codes: ["92227", "92228", "92229", "92250", "2022F", "2023F", "2024F", "2026F", "2033F"], months: 12 },
  { name: "Kidney (urine albumin)", codes: ["82043", "82044", "84156"], months: 12 },
  { name: "Lipid panel", codes: ["80061", "83721", "82465", "84478"], months: 12 },
  { name: "Influenza vaccine", codes: ["90630", "90653", "90654", "90655", "90656", "90658", "90661", "90662", "90672", "90673", "90674", "90682", "90685", "90686", "90687", "90688", "G0008"], months: 12 },
  { name: "Pneumococcal vaccine (one-time)", codes: ["90670", "90671", "90732", "G0009"], months: 1200 },
  { name: "Depression screening", codes: ["G0444", "96127"], months: 12 },
];
const CODE_TO_MEASURE = (() => { const m = {}; for (const meas of MEASURES) for (const c of meas.codes) m[c] = meas.name; return m; })();

const isConfigured = (cfg) => !!(cfg.clientToken && cfg.privateKey && cfg.publicKeyId);

const b64url = (x) => Buffer.from(x).toString("base64url");

// Raw https helper → { status, headers, text }.
function httpReq(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: out }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Signed-JWT client assertion (RS384) per the DPC auth flow.
function clientAssertion(cfg) {
  const tokenUrl = `${cfg.base}/Token/auth`;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS384", kid: cfg.publicKeyId, typ: "JWT" };
  const payload = { iss: cfg.clientToken, sub: cfg.clientToken, aud: tokenUrl, jti: crypto.randomUUID(), iat: now, exp: now + 290 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign("RSA-SHA384", Buffer.from(signingInput), cfg.privateKey);
  return `${signingInput}.${b64url(sig)}`;
}

async function accessToken(cfg) {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "system/*.*",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion(cfg),
  }).toString();
  const res = await httpReq("POST", `${cfg.base}/Token/auth`,
    { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, params);
  if (res.status < 200 || res.status >= 300) throw new Error(`DPC token ${res.status}: ${res.text.slice(0, 200)}`);
  const tok = JSON.parse(res.text || "{}").access_token;
  if (!tok) throw new Error("DPC token: no access_token in response");
  return tok;
}

const authHeaders = (token, extra) => ({ Authorization: `Bearer ${token}`, Accept: "application/fhir+json", ...extra });

// Parse EOB NDJSON → per patient, the latest service date for each measure.
//   { "<patientRef>": { "<measure name>": "YYYY-MM-DD", ... } }
function parseClaims(ndjson) {
  const byPatient = {};
  for (const line of ndjson.split(/\n+/)) {
    if (!line.trim()) continue;
    let eob; try { eob = JSON.parse(line); } catch { continue; }
    if (eob.resourceType !== "ExplanationOfBenefit") continue;
    const patient = eob.patient?.reference || "unknown";
    for (const item of eob.item || []) {
      const date = (item.servicedDate || item.servicedPeriod?.start || eob.billablePeriod?.end || eob.created || "").slice(0, 10);
      if (!date) continue;
      for (const c of item.productOrService?.coding || []) {
        const meas = CODE_TO_MEASURE[(c.code || "").toUpperCase()];
        if (!meas) continue;
        byPatient[patient] = byPatient[patient] || {};
        if (!byPatient[patient][meas] || date > byPatient[patient][meas]) byPatient[patient][meas] = date;
      }
    }
  }
  return byPatient;
}

const monthsSince = (dateStr, now) => (now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24 * 30.44);

// From per-measure latest dates → last AWV + the list of OPEN care gaps.
function summarize(byPatient) {
  const now = Date.now();
  const awvByPatient = {}, gapsByPatient = {};
  for (const [ref, m] of Object.entries(byPatient)) {
    awvByPatient[ref] = m["Annual Wellness Visit"] || null;
    gapsByPatient[ref] = MEASURES.filter((meas) => !meas.awv).map((meas) => {
      const last = m[meas.name];
      const met = last && monthsSince(last, now) <= meas.months;
      return met ? null : { measure: meas.name, lastDone: last || null };
    }).filter(Boolean);
  }
  return { awvByPatient, gapsByPatient };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to crewOS again." });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action || "status";

  const cfg = await loadConfig();

  if (action === "status") {
    return json(200, {
      configured: isConfigured(cfg),
      base: cfg.base,
      groupSet: !!cfg.groupId,
      // booleans only — never echo the secrets back
      stored: { clientToken: !!cfg.clientToken, privateKey: !!cfg.privateKey, publicKeyId: !!cfg.publicKeyId, groupId: !!cfg.groupId },
    });
  }

  // One-time (repeatable) install of DPC credentials into the Blob. Session-gated
  // like everything else here. Merges over whatever is already stored, so you can
  // set the private key now and add the group id later. Never returns the values.
  if (action === "install") {
    const store = getStore(BLOB_STORE);
    const cur = (await store.get(BLOB_KEY, { type: "json" })) || {};
    const next = { ...cur };
    const set = [];
    for (const k of ["clientToken", "privateKey", "publicKeyId", "base", "groupId"]) {
      if (typeof body[k] === "string" && body[k].trim()) { next[k] = body[k].trim(); set.push(k); }
    }
    if (!set.length) return json(400, { error: "Nothing to install — send at least one of: privateKey, clientToken, publicKeyId, base, groupId." });
    if (next.privateKey && !/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(next.privateKey))
      return json(400, { error: "privateKey doesn't look like a PEM (missing a -----BEGIN … PRIVATE KEY----- line)." });
    await store.setJSON(BLOB_KEY, next);
    return json(200, { ok: true, installed: set });
  }

  if (!isConfigured(cfg)) return json(503, { error: "DPC isn't configured yet — install the private key (and client token / key id) via the credentials panel, or set the DPC_* env vars." });

  try {
    if (action === "start") {
      const groupId = body.groupId || cfg.groupId;
      if (!groupId) return json(400, { error: "No DPC group (attribution roster) id set." });
      const token = await accessToken(cfg);
      const res = await httpReq("GET",
        `${cfg.base}/Group/${encodeURIComponent(groupId)}/$export?_type=ExplanationOfBenefit`,
        authHeaders(token, { Prefer: "respond-async" }));
      if (res.status !== 202) return json(502, { error: `DPC $export ${res.status}: ${res.text.slice(0, 200)}` });
      return json(200, { ok: true, job: res.headers["content-location"] || res.headers["Content-Location"] });
    }

    if (action === "poll") {
      if (!body.job) return json(400, { error: "Missing job URL" });
      const token = await accessToken(cfg);
      const res = await httpReq("GET", body.job, authHeaders(token));
      if (res.status === 202) return json(200, { done: false, progress: res.headers["x-progress"] || "in progress" });
      if (res.status === 200) {
        const out = JSON.parse(res.text || "{}");
        const files = (out.output || []).filter((o) => o.type === "ExplanationOfBenefit").map((o) => o.url);
        return json(200, { done: true, files });
      }
      return json(502, { error: `DPC job ${res.status}: ${res.text.slice(0, 200)}` });
    }

    if (action === "awv") {
      if (!body.file) return json(400, { error: "Missing file URL" });
      const token = await accessToken(cfg);
      const res = await httpReq("GET", body.file, authHeaders(token, { Accept: "application/fhir+ndjson" }));
      if (res.status < 200 || res.status >= 300) return json(502, { error: `DPC file ${res.status}` });
      return json(200, summarize(parseClaims(res.text)));
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
