const crypto = require("crypto");
const { getSession, json } = require("./_lib");

const AUDIENCE = "bhw-operations-cloud";

function operationsRole(session) {
  return String(session?.access || "").trim().toLowerCase() === "admin"
    ? "operations-manager"
    : session?.role || "staff";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again." });
  const secret = process.env.CREWOS_OPERATIONS_TOKEN_SECRET;
  if (!secret) return json(503, { ok: false, error: "CrewOS operations access is not configured" });

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: `crew:${session.staffId}`,
    staffId: session.staffId,
    name: session.name || "CrewOS staff",
    role: operationsRole(session),
    iss: "bhw-crewhq",
    aud: AUDIENCE,
    iat: now,
    exp: now + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return json(200, { ok: true, token: `${payload}.${signature}`, expiresIn: 300 });
};

exports._test = { operationsRole };
