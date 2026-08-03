// netlify/functions/dpc.js — CMS Data at the Point of Care (DPC) integration.
// Pulls Medicare fee-for-service claims for your attributed patients and, most
// usefully for BHW, computes each patient's last Annual Wellness Visit (AWV)
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
// Env (Netlify), all required to arm:
//   DPC_CLIENT_TOKEN  — the client token ("golden macaroon") from the DPC portal
//   DPC_PRIVATE_KEY   — PEM private key whose public key is registered with DPC
//   DPC_PUBLIC_KEY_ID — the key id (kid) DPC assigned to that public key
//   DPC_GROUP_ID      — your attribution Group (roster) id
//   DPC_BASE          — optional; defaults to the production base URL

const crypto = require("crypto");
const https = require("https");
const { getSession, json } = require("./_lib");

const DPC_BASE = (process.env.DPC_BASE || "https://api.dpc.cms.gov/api/v1").replace(/\/+$/, "");
const AWV_CODES = new Set(["G0438", "G0439", "G0468", "99387", "99397", "99385", "99386", "99395", "99396"]);

const configured = () =>
  !!(process.env.DPC_CLIENT_TOKEN && process.env.DPC_PRIVATE_KEY && process.env.DPC_PUBLIC_KEY_ID);

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
function clientAssertion() {
  const clientToken = process.env.DPC_CLIENT_TOKEN;
  const tokenUrl = `${DPC_BASE}/Token/auth`;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS384", kid: process.env.DPC_PUBLIC_KEY_ID, typ: "JWT" };
  const payload = { iss: clientToken, sub: clientToken, aud: tokenUrl, jti: crypto.randomUUID(), iat: now, exp: now + 290 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign("RSA-SHA384", Buffer.from(signingInput), process.env.DPC_PRIVATE_KEY);
  return `${signingInput}.${b64url(sig)}`;
}

async function accessToken() {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "system/*.*",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion(),
  }).toString();
  const res = await httpReq("POST", `${DPC_BASE}/Token/auth`,
    { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, params);
  if (res.status < 200 || res.status >= 300) throw new Error(`DPC token ${res.status}: ${res.text.slice(0, 200)}`);
  const tok = JSON.parse(res.text || "{}").access_token;
  if (!tok) throw new Error("DPC token: no access_token in response");
  return tok;
}

const authHeaders = (token, extra) => ({ Authorization: `Bearer ${token}`, Accept: "application/fhir+json", ...extra });

// Parse EOB NDJSON → { "<patientRef>": "<latest AWV date>" }.
function parseAwvFromNdjson(ndjson) {
  const out = {};
  for (const line of ndjson.split(/\n+/)) {
    if (!line.trim()) continue;
    let eob; try { eob = JSON.parse(line); } catch { continue; }
    if (eob.resourceType !== "ExplanationOfBenefit") continue;
    const patient = eob.patient?.reference || "unknown";
    for (const item of eob.item || []) {
      const codes = (item.productOrService?.coding || []).map((c) => (c.code || "").toUpperCase());
      if (!codes.some((c) => AWV_CODES.has(c))) continue;
      const date = item.servicedDate || item.servicedPeriod?.start || eob.billablePeriod?.end || eob.created || "";
      if (date && (!out[patient] || date > out[patient])) out[patient] = date.slice(0, 10);
    }
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to crewOS again." });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action || "status";

  if (action === "status") return json(200, { configured: configured(), base: DPC_BASE, groupSet: !!process.env.DPC_GROUP_ID });
  if (!configured()) return json(503, { error: "DPC isn't configured yet — set DPC_CLIENT_TOKEN, DPC_PRIVATE_KEY, DPC_PUBLIC_KEY_ID (and DPC_GROUP_ID) in Netlify after completing DPC onboarding." });

  try {
    if (action === "start") {
      const groupId = body.groupId || process.env.DPC_GROUP_ID;
      if (!groupId) return json(400, { error: "No DPC_GROUP_ID (attribution roster) set." });
      const token = await accessToken();
      const res = await httpReq("GET",
        `${DPC_BASE}/Group/${encodeURIComponent(groupId)}/$export?_type=ExplanationOfBenefit`,
        authHeaders(token, { Prefer: "respond-async" }));
      if (res.status !== 202) return json(502, { error: `DPC $export ${res.status}: ${res.text.slice(0, 200)}` });
      return json(200, { ok: true, job: res.headers["content-location"] || res.headers["Content-Location"] });
    }

    if (action === "poll") {
      if (!body.job) return json(400, { error: "Missing job URL" });
      const token = await accessToken();
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
      const token = await accessToken();
      const res = await httpReq("GET", body.file, authHeaders(token, { Accept: "application/fhir+ndjson" }));
      if (res.status < 200 || res.status >= 300) return json(502, { error: `DPC file ${res.status}` });
      return json(200, { awvByPatient: parseAwvFromNdjson(res.text) });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
