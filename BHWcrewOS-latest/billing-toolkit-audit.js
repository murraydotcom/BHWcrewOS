(function installBillingToolkitAudit() {
  const ENDPOINT = "/.netlify/functions/billing-toolkit-audit";
  const SECTIONS = new Set(["template", "audit", "apcm", "bhi", "rpm", "ccm", "pcm", "cocm", "overlap", "stacking", "dashboard"]);
  const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
  const HEARTBEAT_MS = 60 * 1000;
  const sessionId = makeUuid();
  let lastTickAt = Date.now();
  let lastInteractionAt = lastTickAt;
  let visibleMilliseconds = 0;
  let activeMilliseconds = 0;
  let ended = false;
  let pendingSummaryTimer = 0;
  let lastSummaryFingerprint = "";

  function makeUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) return "";
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function token() {
    try { return sessionStorage.getItem("crewos_token") || ""; } catch { return ""; }
  }

  function currentSection() {
    const top = document.querySelector(".tab-content.active")?.id?.replace("tab-", "") || "template";
    if (top !== "audit") return SECTIONS.has(top) ? top : "template";
    const nested = document.querySelector(".subtab-content.active")?.id?.replace("subtab-", "") || "audit";
    return SECTIONS.has(nested) ? nested : "audit";
  }

  function tick() {
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(now - lastTickAt, 30_000));
    if (!document.hidden) {
      visibleMilliseconds += elapsed;
      if (now - lastInteractionAt <= ACTIVE_WINDOW_MS) activeMilliseconds += elapsed;
    }
    lastTickAt = now;
  }

  function durations() {
    tick();
    return {
      activeSeconds: Math.min(43_200, Math.round(activeMilliseconds / 1000)),
      visibleSeconds: Math.min(43_200, Math.round(visibleMilliseconds / 1000)),
    };
  }

  function post(eventType, details) {
    const authorization = token();
    const eventId = makeUuid();
    if (!authorization || !sessionId || !eventId) return;
    const body = { eventId, eventType, sessionId, section: currentSection(), ...(details || {}) };
    fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  function sessionHeartbeat(reason) {
    post("billing-toolkit.session-heartbeat", { ...durations(), reason });
  }

  function sessionEnded() {
    if (ended) return;
    ended = true;
    post("billing-toolkit.session-ended", { ...durations(), reason: "pagehide" });
  }

  function sectionViewed(section) {
    if (!SECTIONS.has(section)) return;
    post("billing-toolkit.section-viewed", { section });
  }

  function auditCalculated(summary) {
    if (!summary || ["audited", "pass", "review", "error"].some((key) => !Number.isInteger(summary[key]) || summary[key] < 0)) return;
    const safe = { audited: summary.audited, pass: summary.pass, review: summary.review, error: summary.error };
    const fingerprint = JSON.stringify(safe);
    if (fingerprint === lastSummaryFingerprint) return;
    clearTimeout(pendingSummaryTimer);
    pendingSummaryTimer = setTimeout(() => {
      lastSummaryFingerprint = fingerprint;
      post("billing-toolkit.audit-calculated", { summary: safe });
    }, 2000);
  }

  window.BhwBillingToolkitAudit = { sectionViewed, auditCalculated };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((type) => {
    addEventListener(type, () => { lastInteractionAt = Date.now(); }, { passive: true });
  });
  addEventListener("beforeprint", () => post("billing-toolkit.print-requested"));
  addEventListener("pagehide", sessionEnded);
  document.addEventListener("visibilitychange", () => {
    tick();
    if (document.hidden) sessionHeartbeat("hidden");
  });
  addEventListener("DOMContentLoaded", () => post("billing-toolkit.opened"), { once: true });
  setInterval(tick, 15_000);
  setInterval(() => {
    if (!document.hidden) sessionHeartbeat("interval");
  }, HEARTBEAT_MS);
})();
