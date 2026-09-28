const { getSession, json } = require("./_lib");
const { careCloudToken } = require("./lib/care-cloud-auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again." });
  try {
    return json(200, { ok: true, token: careCloudToken(session), expiresIn: 300 });
  } catch (error) {
    return json(503, { ok: false, error: String(error.message || error) });
  }
};
