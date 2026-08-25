const crypto = require("crypto");
const { getSession, json } = require("./_lib");

const AUDIENCE = "bhw-rcm-cloud";

function healthRoleFor(session = {}) {
  const role = String(session.role || "").trim().toLowerCase();
  if (["admin", "executive", "provider", "physician", "pmhnp", "crnp", "ma-bha", "care-manager"].includes(role)) return role;
  if (/medical director|nurse practitioner|family nurse practitioner|\bfnp\b|\bcrnp\b|\bpmhnp\b|physician|provider/.test(role)) return "provider";
  if (/care manager|care coordinator/.test(role)) return "care-manager";
  if (/medical assistant|behavioral health assistant|\bbha\b/.test(role)) return "ma-bha";
  if (/owner|chief executive|\bceo\b|executive/.test(role)) return "executive";
  return "staff";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again." });
  const secret = process.env.CREWHQ_CLOUD_TOKEN_SECRET;
  if (!secret) return json(503, { ok: false, error: "CrewHQ cloud access is not configured" });

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: `crew:${session.staffId}`,
    staffId: session.staffId,
    name: session.name || "CrewOS staff",
    role: session.role || "staff",
    healthRole: healthRoleFor(session),
    iss: "bhw-crewhq",
    aud: AUDIENCE,
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return json(200, { ok: true, token: `${payload}.${signature}`, expiresIn: 300 });
};
