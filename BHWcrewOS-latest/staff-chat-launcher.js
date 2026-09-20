/* Shared, local-copy launcher. No identity, patient context, or message content crosses origins. */
(function () {
  if (window !== window.top || window.BHWStaffChat) return;
  let host, frame, button, opened = false, ready = false;
  const crewOrigin = "https://crewhq.bhwmedical.org";
  const localCrew = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "crewhq.bhwmedical.org" || location.hostname.endsWith("--bhwcrewos.netlify.app");
  const origin = localCrew ? location.origin : crewOrigin;
  const postState = () => { if (ready) frame.contentWindow.postMessage({ type: "bhw-chat-view", visible: opened && document.visibilityState === "visible" }, origin); };
  function toggle(value) {
    opened = value;
    frame.hidden = !opened;
    button.setAttribute("aria-expanded", String(opened));
    button.textContent = opened ? "Close chat" : "Staff Chat";
    try { sessionStorage.setItem("bhw-staff-chat-open", String(opened)); } catch { /* optional UI preference */ }
    postState();
    if (opened) frame.focus(); else button.focus();
  }
  function receive(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    if (event.data?.type === "bhw-chat-ready") { ready = true; postState(); }
    if (event.data?.type === "bhw-chat-close") toggle(false);
    if (event.data?.type === "bhw-chat-badge" && !opened) {
      const count = Math.min(100, Math.max(0, Number(event.data.count) || 0));
      button.textContent = count && event.data.enabled === true ? `Staff Chat · ${count} new` : "Staff Chat";
    }
  }
  function mount() {
    if (host || !document.body) return;
    host = document.createElement("div"); host.id = "bhw-staff-chat-launcher";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<link rel="stylesheet" href="/staff-chat-launcher.css"><iframe title="BHW internal staff chat" hidden referrerpolicy="no-referrer"></iframe><button type="button" aria-expanded="false" aria-label="Open or close internal staff chat">Staff Chat</button>`;
    frame = shadow.querySelector("iframe"); button = shadow.querySelector("button");
    frame.src = `${origin}/staff-chat?parentOrigin=${encodeURIComponent(location.origin)}`;
    button.addEventListener("click", () => toggle(!opened));
    window.addEventListener("message", receive);
    document.addEventListener("visibilitychange", postState);
    document.body.append(host);
    try { if (sessionStorage.getItem("bhw-staff-chat-open") === "true") toggle(true); } catch { /* optional UI preference */ }
  }
  function unmount() {
    window.removeEventListener("message", receive); document.removeEventListener("visibilitychange", postState);
    host?.remove(); host = frame = button = null; ready = false; opened = false;
  }
  window.BHWStaffChat = { mount, unmount };
  // CrewOS pages include this locally; other applications call mount only after their own auth gate succeeds.
  if (localCrew && !location.pathname.startsWith("/staff-chat")) {
    const check = () => {
      let signedIn = false;
      try { signedIn = Boolean(sessionStorage.getItem("crewos_token")); } catch { /* fail closed */ }
      if (signedIn) mount(); else unmount();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check, { once: true }); else check();
    setInterval(check, 2000);
  }
})();
