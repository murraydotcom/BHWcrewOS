const POLL_MS = 45_000;
const MAX_ALERTS = 30;
const TYPE_LABELS = Object.freeze({
  medication: "Medication request",
  refill: "Medication request",
  medication_refill: "Medication request",
  referral: "Referral request",
  prior_auth: "Prior authorization",
  prior_authorization: "Prior authorization",
  pa: "Prior authorization",
  billing: "Billing request",
  billing_rcm: "Billing request",
  rcm: "Billing request",
  general: "Patient request",
});

const clean = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const normalized = (value) => clean(value).toLowerCase().replaceAll("-", "_");

function decodeSession(token) {
  try {
    const encoded = String(token || "").split(".")[1] || "";
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    return {
      staffId: clean(payload.staffId, 200),
      name: clean(payload.name, 160),
      role: clean(payload.role, 120),
      access: clean(payload.access, 80),
      divisions: Array.isArray(payload.divisions) ? payload.divisions.map((value) => normalized(value)) : [],
    };
  } catch {
    return null;
  }
}

export function roleRoutes(actor = {}) {
  const role = `${clean(actor.role)} ${clean(actor.access)}`.toLowerCase();
  if (/admin|administrator|executive|owner|office manager|director/.test(role)) return ["*"];
  const routes = new Set((actor.divisions || []).map(normalized).filter(Boolean));
  if (/crnp|pmhnp|fnp|\bnp\b|\bmd\b|\bdo\b|provider|medical assistant|\bma\b/.test(role)) {
    ["clinical", "medication", "authorizations"].forEach((route) => routes.add(route));
  }
  if (/coordinator|care manager|chronic care|behavioral health|bh assistant/.test(role)) {
    ["care_coordination", "referrals", "patient_access"].forEach((route) => routes.add(route));
  }
  if (/billing|revenue|\brcm\b/.test(role)) {
    ["revenue_cycle", "rcm"].forEach((route) => routes.add(route));
  }
  if (/front desk|reception|office assistant|porter house/.test(role)) {
    ["front_desk", "patient_access", "general"].forEach((route) => routes.add(route));
  }
  return [...routes];
}

function isAssignedTo(request, actor) {
  const assignedId = clean(request.assignedTo || request.assignedToId, 200);
  const assignedName = clean(request.assignedToName, 160).toLowerCase();
  return Boolean(
    (assignedId && actor.staffId && assignedId === actor.staffId)
    || (assignedName && actor.name && assignedName === actor.name.toLowerCase()),
  );
}

function routeFor(request) {
  return normalized(request.assignedTeam || request.serviceLine || "general");
}

function isCompleted(request) {
  const category = normalized(request.statusCategory);
  const status = normalized(request.status);
  return category === "completed" || /completed|resolved|closed|approved|denied|scheduled/.test(status);
}

export function alertKey(request) {
  return [clean(request.id, 240), Number(request.version) || 1, normalized(request.status || request.statusCategory)].join(":");
}

export function safeAlertForRequest(request, actor = {}, now = Date.now()) {
  if (!request?.id || isCompleted(request)) return null;
  const status = normalized(request.status);
  const category = normalized(request.statusCategory);
  const priority = normalized(request.priority);
  const route = routeFor(request);
  const assignedToMe = isAssignedTo(request, actor);
  const unassigned = !clean(request.assignedTo || request.assignedToId || request.assignedToName);
  const dueAt = Date.parse(request.dueAt || request.slaDueAt || "");
  const overdue = /overdue|breach/.test(normalized(request.sla)) || (Number.isFinite(dueAt) && dueAt < now);
  const urgent = ["urgent", "emergency"].includes(priority) || (Array.isArray(request.safetyFlags) && request.safetyFlags.length > 0);

  let reason = "";
  let severity = "routine";
  if (urgent) { reason = "Urgent review"; severity = "urgent"; }
  else if (category === "escalated" || status === "escalated") { reason = "Escalated"; severity = "urgent"; }
  else if (overdue) { reason = "Overdue"; severity = "warning"; }
  else if (assignedToMe) { reason = "Assigned to you"; }
  else if (unassigned && ["received", "new", ""].includes(category)) { reason = "Needs an owner"; }
  else return null;

  const actorRoutes = roleRoutes(actor);
  const canSeeRoute = actorRoutes.includes("*") || actorRoutes.includes(route);
  if (!assignedToMe && !canSeeRoute) return null;

  const type = normalized(request.requestType || request.type || "general");
  const changedAt = clean(request.updatedAt || request.createdAt, 80);
  return {
    id: clean(request.id, 240),
    key: alertKey(request),
    label: TYPE_LABELS[type] || "Patient request",
    reason,
    severity,
    route: route.replaceAll("_", "-"),
    status: clean(request.statusLabel || request.status || "Open", 100).replaceAll("_", " "),
    changedAt,
    href: `/bhw-requests.html?request=${encodeURIComponent(clean(request.id, 240))}`,
  };
}

export function collectSafeAlerts(requests, actor, now = Date.now()) {
  return (Array.isArray(requests) ? requests : [])
    .map((request) => safeAlertForRequest(request, actor, now))
    .filter(Boolean)
    .sort((a, b) => {
      const severity = { urgent: 0, warning: 1, routine: 2 };
      return (severity[a.severity] - severity[b.severity]) || String(b.changedAt).localeCompare(String(a.changedAt));
    })
    .slice(0, MAX_ALERTS);
}

function storageJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be disabled */ }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function injectStyles() {
  if (document.getElementById("bhw-alert-styles")) return;
  const style = document.createElement("style");
  style.id = "bhw-alert-styles";
  style.textContent = `
    .bhw-alert-root{position:fixed;top:14px;right:14px;z-index:2147482000;font-family:Montserrat,Inter,system-ui,sans-serif;color:#22303a}
    .bhw-alert-root.bhw-alert-inline{position:relative;top:auto;right:auto;display:inline-block;flex:0 0 auto}
    .bhw-alert-bell{width:44px;height:44px;border:1px solid #d9e2e2;border-radius:14px;background:#fff;box-shadow:0 7px 24px rgba(34,48,58,.16);display:grid;place-items:center;cursor:pointer;position:relative;color:#3c7c78}
    .bhw-alert-bell:hover{border-color:#4f9a95}.bhw-alert-bell svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .bhw-alert-count{position:absolute;right:-5px;top:-5px;min-width:20px;height:20px;padding:0 5px;border-radius:20px;background:#b0525a;color:#fff;border:2px solid #fff;display:grid;place-items:center;font-size:10px;font-weight:800}
    .bhw-alert-count[hidden]{display:none}.bhw-alert-panel[hidden]{display:none}
    .bhw-alert-panel{position:absolute;right:0;top:52px;width:min(380px,calc(100vw - 28px));max-height:min(610px,calc(100vh - 84px));overflow:hidden;background:#fff;border:1px solid #dfe5e3;border-radius:17px;box-shadow:0 18px 55px rgba(34,48,58,.24)}
    .bhw-alert-head{display:flex;align-items:center;gap:10px;padding:14px 15px;border-bottom:1px solid #eee9e2;background:#fcfaf6}.bhw-alert-head b{font-size:14px}.bhw-alert-head span{margin-left:auto;font-size:10px;font-weight:800;color:#5b6b76;text-transform:uppercase;letter-spacing:.05em}
    .bhw-alert-list{max-height:490px;overflow:auto;padding:7px}.bhw-alert-item{display:block;text-decoration:none;color:inherit;padding:11px;border-radius:12px;border:1px solid transparent}.bhw-alert-item:hover{background:#f4f8f7;border-color:#dcebe8}
    .bhw-alert-item+.bhw-alert-item{border-top-color:#eee9e2}.bhw-alert-top{display:flex;align-items:center;gap:8px}.bhw-alert-type{font-size:12px;font-weight:800}.bhw-alert-reason{margin-left:auto;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:4px 7px;border-radius:20px;background:#eaf2f1;color:#3c7c78}
    .bhw-alert-item.urgent .bhw-alert-reason{background:#f6e2e2;color:#9a424b}.bhw-alert-item.warning .bhw-alert-reason{background:#fbf1dd;color:#8a6a26}
    .bhw-alert-meta{font-size:10.5px;color:#5b6b76;font-weight:650;margin-top:5px}.bhw-alert-empty{padding:34px 18px;text-align:center;color:#7f8d95;font-size:12px;font-weight:700}
    .bhw-alert-foot{display:flex;padding:10px 12px;border-top:1px solid #eee9e2;background:#fcfaf6}.bhw-alert-foot a{margin-left:auto;color:#3c7c78;font-size:11px;font-weight:800;text-decoration:none}
    .bhw-alert-toast{position:fixed;right:14px;bottom:18px;z-index:2147482001;max-width:min(360px,calc(100vw - 28px));background:#22303a;color:#fff;border-radius:13px;padding:12px 15px;box-shadow:0 12px 35px rgba(34,48,58,.28);font-size:12px;font-weight:700;line-height:1.4;opacity:0;transform:translateY(10px);pointer-events:none;transition:.18s}
    .bhw-alert-toast.on{opacity:1;transform:translateY(0)}
    @media(max-width:640px){.bhw-alert-root{top:auto;bottom:14px}.bhw-alert-panel{top:auto;bottom:52px;max-height:70vh}.bhw-alert-toast{bottom:70px}}
  `;
  document.head.append(style);
}

function createUi() {
  injectStyles();
  const root = document.createElement("section");
  root.className = "bhw-alert-root";
  root.setAttribute("aria-label", "CrewOS alerts");
  root.innerHTML = `
    <button class="bhw-alert-bell" type="button" aria-label="Open CrewOS alerts" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
      <span class="bhw-alert-count" hidden>0</span>
    </button>
    <div class="bhw-alert-panel" hidden>
      <div class="bhw-alert-head"><b>CrewOS alerts</b><span>Role routed</span></div>
      <div class="bhw-alert-list"></div>
      <div class="bhw-alert-foot"><a href="/bhw-requests.html">Open Patient Requests →</a></div>
    </div>`;
  const toast = document.createElement("div");
  toast.className = "bhw-alert-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  let mount = document.querySelector("header .top-right");
  if (!mount) {
    const right = document.querySelector("header .right");
    if (right) mount = getComputedStyle(right).display.includes("flex") ? right : right.parentElement;
  }
  if (mount) {
    root.classList.add("bhw-alert-inline");
    mount.prepend(root);
    document.body.append(toast);
  } else {
    document.body.append(root, toast);
  }
  return { root, button: root.querySelector(".bhw-alert-bell"), badge: root.querySelector(".bhw-alert-count"), panel: root.querySelector(".bhw-alert-panel"), list: root.querySelector(".bhw-alert-list"), toast };
}

function startAlertCenter(token) {
  const actor = decodeSession(token);
  if (!actor?.staffId) return false;
  const ui = createUi();
  const seenKey = `bhw-alert-seen-v1:${actor.staffId}`;
  const knownKey = `bhw-alert-known-v1:${actor.staffId}`;
  let current = [];
  let clientPromise;
  let toastTimer;
  let refreshing = false;

  function seenMap() { return storageJson(seenKey, {}); }
  function unread() {
    const seen = seenMap();
    return current.filter((alert) => !seen[alert.key]);
  }
  function markSeen(keys) {
    const seen = seenMap();
    const stamped = new Date().toISOString();
    keys.forEach((key) => { seen[key] = stamped; });
    const trimmed = Object.fromEntries(Object.entries(seen).slice(-300));
    saveJson(seenKey, trimmed);
  }
  function toast(message) {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add("on");
    toastTimer = setTimeout(() => ui.toast.classList.remove("on"), 5200);
  }
  function render() {
    const notRead = unread();
    ui.badge.textContent = notRead.length > 99 ? "99+" : String(notRead.length);
    ui.badge.hidden = notRead.length === 0;
    ui.button.setAttribute("aria-label", notRead.length ? `Open CrewOS alerts, ${notRead.length} unread` : "Open CrewOS alerts");
    ui.list.innerHTML = current.length ? current.map((alert) => `
      <a class="bhw-alert-item ${escapeHtml(alert.severity)}" href="${escapeHtml(alert.href)}" data-alert-key="${escapeHtml(alert.key)}">
        <span class="bhw-alert-top"><span class="bhw-alert-type">${escapeHtml(alert.label)}</span><span class="bhw-alert-reason">${escapeHtml(alert.reason)}</span></span>
        <span class="bhw-alert-meta">${escapeHtml(alert.status)} · ${escapeHtml(alert.route)}</span>
      </a>`).join("") : '<div class="bhw-alert-empty">No routed alerts need your attention.</div>';
  }
  function applyRequests(requests) {
    ui.root.hidden = false;
    current = collectSafeAlerts(requests, actor);
    const known = storageJson(knownKey, []);
    const knownSet = new Set(Array.isArray(known) ? known : []);
    const newAlerts = current.filter((alert) => !knownSet.has(alert.key));
    if (knownSet.size && newAlerts.length) {
      const first = newAlerts[0];
      toast(newAlerts.length === 1 ? `${first.label} · ${first.reason}` : `${newAlerts.length} new CrewOS alerts`);
    }
    saveJson(knownKey, current.map((alert) => alert.key));
    render();
  }
  async function refresh(providedRequests) {
    if (Array.isArray(providedRequests)) { applyRequests(providedRequests); return; }
    if (refreshing) return;
    refreshing = true;
    try {
      clientPromise ||= import("/provider/operations-queue.mjs").then(({ createOperationsCloudClient }) => createOperationsCloudClient());
      const client = await clientPromise;
      if (!client) throw new Error("Google workflow backend is not configured");
      applyRequests(await client.listPatientRequests({ status: "open", limit: 300 }));
    } catch {
      ui.root.hidden = true;
    } finally {
      refreshing = false;
    }
  }

  ui.button.addEventListener("click", () => {
    const opening = ui.panel.hidden;
    ui.panel.hidden = !opening;
    ui.button.setAttribute("aria-expanded", String(opening));
    if (opening) { markSeen(current.map((alert) => alert.key)); render(); }
  });
  ui.list.addEventListener("click", (event) => {
    const link = event.target.closest("[data-alert-key]");
    if (link) markSeen([link.dataset.alertKey]);
  });
  document.addEventListener("click", (event) => {
    if (!ui.root.contains(event.target)) { ui.panel.hidden = true; ui.button.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { ui.panel.hidden = true; ui.button.setAttribute("aria-expanded", "false"); ui.button.focus(); }
  });
  window.addEventListener("bhw:requests-updated", (event) => refresh(event.detail?.requests));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.BHWAlerts = Object.freeze({ refresh });
  refresh();
  setInterval(refresh, POLL_MS);
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  let started = false;
  const waitForSession = () => {
    if (started) return;
    let token = "";
    try { token = sessionStorage.getItem("crewos_token") || ""; } catch { /* unavailable */ }
    if (token) started = startAlertCenter(token);
  };
  waitForSession();
  const sessionTimer = setInterval(() => {
    waitForSession();
    if (started) clearInterval(sessionTimer);
  }, 1000);
}
