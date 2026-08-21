(function guardCrewProviderWorkspace() {
  let token = "";
  let session = null;
  try {
    token = sessionStorage.getItem("crewos_token") || "";
    if (token) {
      const [body, signature] = token.split(".");
      if (body && signature) {
        const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
        const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
        session = JSON.parse(atob(normalized + padding));
      }
    }
  } catch { /* invalid or unavailable session */ }

  if (session?.exp && Date.now() < Number(session.exp)) return;
  try { sessionStorage.removeItem("crewos_token"); } catch { /* storage unavailable */ }
  const next = `${location.pathname}${location.search}${location.hash}`;
  location.replace(`/crewos?next=${encodeURIComponent(next)}`);
})();

