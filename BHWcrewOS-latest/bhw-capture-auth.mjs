const TOKEN_KEY = "crewos_token";

function defaultStorage() {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function crewosSigninUrl(nextPath = "/bhw-capture.html") {
  return "/crewos?next=" + encodeURIComponent(nextPath);
}

export function clearCrewSession(storage = defaultStorage()) {
  try { storage?.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export async function validateCrewSession(options = {}) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const fetchImpl = options.fetchImpl || fetch;
  const endpoint = options.endpoint || "/.netlify/functions/auth";
  let token = "";
  try { token = storage?.getItem(TOKEN_KEY) || ""; } catch { /* storage unavailable */ }
  if (!token) return { authenticated: false, reason: "missing" };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ action: "session" }),
      cache: "no-store",
    });
  } catch (error) {
    return { authenticated: false, reason: "unavailable", message: error?.message || "Network unavailable" };
  }

  let payload = {};
  try { payload = await response.json(); } catch { /* invalid response handled below */ }
  if (response.status === 401 || response.status === 403) {
    clearCrewSession(storage);
    return { authenticated: false, reason: "expired", message: payload.error || "CrewOS session expired" };
  }
  if (!response.ok) {
    return { authenticated: false, reason: "unavailable", message: payload.error || "CrewOS verification unavailable" };
  }
  if (!payload.user?.staffId || !payload.user?.name) {
    return { authenticated: false, reason: "unavailable", message: "CrewOS returned an incomplete identity" };
  }
  return { authenticated: true, user: payload.user, token };
}

