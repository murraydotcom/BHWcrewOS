const crypto = require("crypto");
const { getSession, json } = require("./_lib");

const AUDIENCE = "bhw-rcm-cloud";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  const nowMs = Date.now();
  const authTime = Number(session?.authTime) || 0;
  if (!session || session.scope !== "clinical" || !session.staffId || !authTime
      || nowMs - authTime > 15 * 60 * 1000 || authTime > nowMs + 60_000) {
    return json(401, { ok: false, error: "Clinical mode is locked. Verify your CrewOS PIN again." });
  }
  const secret = process.env.CREWHQ_CLOUD_TOKEN_SECRET;
  if (!secret) return json(503, { ok: false, error: "Clinical cloud access is not configured" });

  const now = Math.floor(nowMs / 1000);
  const sessionExpiry = Math.floor(Number(session.exp) / 1000);
  const exp = Math.min(now + 300, sessionExpiry);
  if (exp <= now) return json(401, { ok: false, error: "Clinical mode is locked. Verify your CrewOS PIN again." });
  const claims = {
    sub: `crew:${session.staffId}`,
    staffId: session.staffId,
    name: session.name || "CrewOS staff",
    role: session.role || "staff",
    access: session.access || "",
    scope: "clinical",
    authTime,
    iss: "bhw-crewhq",
    aud: AUDIENCE,
    iat: now,
    exp,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return json(200, { ok: true, token: `${payload}.${signature}`, expiresIn: exp - now });
};

