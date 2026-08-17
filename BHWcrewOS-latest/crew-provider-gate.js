(function guardCrewProviderWorkspace() {
  let token = "";
  try { token = sessionStorage.getItem("crewos_token") || ""; } catch { /* storage unavailable */ }
  if (token) return;
  const next = `${location.pathname}${location.search}${location.hash}`;
  location.replace(`/crewos?next=${encodeURIComponent(next)}`);
})();
