import crypto from "node:crypto";
import { inspectCrispPreventiveColumns, sanitizeCrispPreventiveRows } from "../../engine/crisp-preventive-upload.mjs";
import { readSpreadsheet } from "../../engine/xlsx-lite.mjs";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 5_800_000;
const MAX_ROWS = 250;
const CLINICAL_SESSION_MS = 15 * 60 * 1000;
const PROVIDER_ROLES = new Set(["provider", "physician", "pmhnp", "crnp"]);

function response(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || "");
}

function safeApiBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function verifyCrewSession(request) {
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [payload, suppliedSignature, extra] = token.split(".");
  const secret = env("SESSION_SECRET");
  if (!payload || !suppliedSignature || extra || !secret) return null;
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || Date.now() > Number(session.exp)) return null;
    return session;
  } catch {
    return null;
  }
}

function healthRoleFor(session = {}) {
  const role = String(session.role || "").trim().toLowerCase();
  if (["provider", "physician", "pmhnp", "crnp"].includes(role)) return role;
  if (/medical director|nurse practitioner|family nurse practitioner|\bfnp\b|\bcrnp\b|\bpmhnp\b|physician|provider/.test(role)) return "provider";
  return "staff";
}

function currentClinicalProvider(session) {
  const authTime = Number(session?.authTime) || 0;
  const age = Date.now() - authTime;
  return session?.scope === "clinical" && authTime > 0 && age >= 0 && age <= CLINICAL_SESSION_MS
    && PROVIDER_ROLES.has(healthRoleFor(session));
}

function healthCoreToken(session) {
  const secret = env("CREWHQ_CLOUD_TOKEN_SECRET");
  if (!secret) throw Object.assign(new Error("Health Core authorization is not configured"), { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: `crew:${session.staffId}`,
    staffId: session.staffId,
    name: session.name || "CrewOS provider",
    role: session.role || "provider",
    healthRole: healthRoleFor(session),
    scope: "clinical",
    authTime: Number(session.authTime),
    iss: "bhw-crewhq",
    aud: "bhw-rcm-cloud",
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function protectedCloudRequest(path, session, body) {
  const base = safeApiBase(env("RCM_CLOUD_API_URL"));
  if (!base) throw Object.assign(new Error("The protected BHW clinical connection is not configured"), { status: 503 });
  const result = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${healthCoreToken(session)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(data.error || `Health Core returned ${result.status}`), { status: result.status });
  return data;
}

function decodeFile(fileBase64) {
  const supplied = String(fileBase64 || "").replace(/^data:.*?;base64,/, "");
  if (!supplied || supplied.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) {
    throw Object.assign(new Error("Choose a CRISP export smaller than 4 MB"), { status: 413 });
  }
  const bytes = Buffer.from(supplied, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error("Choose a CRISP export smaller than 4 MB"), { status: 413 });
  }
  return bytes;
}

export default async function crispPreventiveImport(request) {
  if (request.method !== "POST") return response(405, { ok: false, error: "POST only" });
  const session = verifyCrewSession(request);
  if (!session) return response(401, { ok: false, error: "Signed out — sign in to CrewOS again." });
  if (!currentClinicalProvider(session)) {
    return response(403, {
      ok: false,
      error: "A BHW provider must re-enter their CrewOS PIN before reviewing CRISP preventive evidence.",
      clinicalReauthenticationRequired: true,
    });
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return response(413, { ok: false, error: "CRISP import request is too large" });
    }
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { return response(400, { ok: false, error: "Bad JSON" }); }

    if (body.action === "preview") {
      const fileName = String(body.fileName || "").split(/[\\/]/).at(-1).slice(0, 160);
      if (!/\.(xlsx|csv|tsv|txt)$/i.test(fileName)) {
        return response(400, { ok: false, error: "Choose a CRISP .xlsx, .csv, .tsv, or .txt export" });
      }
      const bytes = decodeFile(body.fileBase64);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const parsed = await readSpreadsheet({ name: fileName, async arrayBuffer() { return buffer; } });
      if (!parsed.rows.length) return response(400, { ok: false, error: "No preventive-service rows were found in that export" });
      if (parsed.rows.length > MAX_ROWS) {
        return response(413, { ok: false, error: `This protected pilot accepts up to ${MAX_ROWS} rows per reviewed import` });
      }
      const columns = inspectCrispPreventiveColumns(parsed.rows);
      if (columns.missing.length) {
        return response(400, { ok: false, error: `This is not a usable Preventive Services export. Missing: ${columns.missing.join(", ")}` });
      }
      const preview = await protectedCloudRequest("/v1/crisp/preventive-services/preview", session, {
        sourceFile: fileName,
        sourceUpdatedAt: body.sourceUpdatedAt,
        rows: sanitizeCrispPreventiveRows(parsed.rows, MAX_ROWS),
      });
      return response(200, { ...preview, rawFileRetained: false, parsedSheet: String(parsed.sheet || "").slice(0, 120) });
    }

    if (body.action === "commit") {
      if (body.reviewAttestation?.reviewed !== true) {
        return response(409, { ok: false, error: "Provider review is required before saving CRISP evidence" });
      }
      const records = Array.isArray(body.records) ? body.records.slice(0, MAX_ROWS) : [];
      const saved = await protectedCloudRequest("/v1/crisp/preventive-services/commit", session, {
        records,
        previewToken: body.previewToken,
        sourceFile: String(body.sourceFile || "").split(/[\\/]/).at(-1).slice(0, 160),
        reviewAttestation: { reviewed: true, note: String(body.reviewAttestation.note || "").slice(0, 500) },
      });
      return response(200, { ...saved, rawFileRetained: false });
    }
    return response(400, { ok: false, error: "Unknown CRISP preventive import action" });
  } catch (error) {
    return response(Number(error.status) || 500, { ok: false, error: error.message || "CRISP preventive import failed" });
  }
}

export const config = { path: "/api/crisp-preventive-import" };
