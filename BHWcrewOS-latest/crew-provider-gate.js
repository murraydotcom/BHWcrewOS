(function guardCrewProviderWorkspace() {
  function installSystemNavigation() {
    const mount = () => {
      if (document.querySelector("[data-bhw-system-navigation]")) return;
      const navigation = document.createElement("nav");
      navigation.className = "bhw-system-navigation bhw-system-navigation-fallback";
      navigation.dataset.bhwSystemNavigation = "";
      navigation.setAttribute("aria-label", "Page navigation");
      navigation.innerHTML = '<button type="button" data-system-nav="back">← Back</button><a href="/crewos" data-system-nav="home">⌂ CrewOS Home</a>';

      const style = document.createElement("style");
      style.textContent = ".bhw-system-navigation{display:flex;align-items:center;gap:8px}.bhw-system-navigation button,.bhw-system-navigation a{box-sizing:border-box;border:1px solid rgba(104,118,123,.34);border-radius:9px;background:var(--card,#fff);color:var(--ink,#2f3a3f);padding:8px 11px;font:600 11px Montserrat,system-ui,sans-serif;line-height:1.2;text-decoration:none;cursor:pointer}.bhw-system-navigation button:hover,.bhw-system-navigation a:hover{border-color:var(--blue,#80abbd)}.bhw-system-navigation-fallback{position:fixed;right:18px;bottom:18px;z-index:2147483000;padding:8px;border:1px solid rgba(104,118,123,.25);border-radius:12px;background:var(--card,#fff);box-shadow:0 8px 26px rgba(36,50,57,.18)}@media(max-width:640px){.bhw-system-navigation-fallback{right:10px;bottom:10px}.bhw-system-navigation button,.bhw-system-navigation a{padding:8px 9px;font-size:10px}}@media print{.bhw-system-navigation{display:none!important}}";
      document.head.append(style);
      document.body.append(navigation);

      navigation.querySelector('[data-system-nav="back"]').addEventListener("click", () => {
        let sameOriginReferrer = false;
        try { sameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin; } catch { /* invalid referrer */ }
        if (sameOriginReferrer && history.length > 1) history.back();
        else location.assign("/crewos");
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
  }

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

  if (session?.exp && Date.now() < Number(session.exp)) {
    installSystemNavigation();
    return;
  }
  try { sessionStorage.removeItem("crewos_token"); } catch { /* storage unavailable */ }
  const next = `${location.pathname}${location.search}${location.hash}`;
  location.replace(`/crewos?next=${encodeURIComponent(next)}`);
})();

