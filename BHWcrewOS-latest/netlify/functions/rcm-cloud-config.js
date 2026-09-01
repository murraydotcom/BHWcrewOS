const { json } = require("./_lib");
// Deploy-preview context supplies the isolated Patient 360 RCM route.

function safeApiBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { ok: false, error: "GET only" });
  const apiBase = safeApiBase(process.env.RCM_CLOUD_API_URL);
  return json(200, { ok: true, enabled: Boolean(apiBase), apiBase });
};
