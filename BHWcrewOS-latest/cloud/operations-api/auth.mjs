import crypto from "node:crypto";
import { apiError, cleanText } from "./schema.mjs";

const STAFF_AUDIENCE = "bhw-operations-cloud";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearer(header) {
  const value = String(header || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export function verifyCrewToken(header, secret, { now = Date.now() } = {}) {
  if (!secret) throw apiError(503, "auth_not_configured", "CrewOS operations access is not configured");
  const token = bearer(header);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw apiError(401, "unauthorized", "valid CrewOS authorization is required");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) throw apiError(401, "unauthorized", "valid CrewOS authorization is required");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw apiError(401, "unauthorized", "valid CrewOS authorization is required");
  }
  const nowSeconds = Math.floor(now / 1000);
  if (claims.iss !== "bhw-crewhq" || claims.aud !== STAFF_AUDIENCE || !claims.staffId || !claims.sub) {
    throw apiError(401, "unauthorized", "CrewOS token claims are invalid");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds || claims.iat > nowSeconds + 60) {
    throw apiError(401, "token_expired", "CrewOS authorization expired");
  }
  return {
    type: "staff",
    id: cleanText(claims.sub, 160),
    staffId: cleanText(claims.staffId, 160),
    name: cleanText(claims.name, 120),
    role: cleanText(claims.role || "staff", 80).toLowerCase(),
  };
}

export function verifyIntakeClient(header, expectedSecret, clientHeader, expectedClientId = "care-connect") {
  if (!expectedSecret) throw apiError(503, "intake_not_configured", "Care Connect intake is not configured");
  const supplied = bearer(header);
  if (!safeEqual(supplied, expectedSecret)) throw apiError(401, "unauthorized", "valid intake authorization is required");
  const clientId = cleanText(clientHeader, 80, { required: true, field: "X-BHW-Client-Id" }).toLowerCase();
  if (clientId !== String(expectedClientId || "care-connect").toLowerCase()) {
    throw apiError(403, "client_not_allowed", "intake client is not allowed");
  }
  return { type: "integration", id: clientId, role: "intake" };
}

export { STAFF_AUDIENCE };
