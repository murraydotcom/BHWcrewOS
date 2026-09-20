import { createPatientWorkspaceContextClient } from "./patient-workspace-context-client.mjs";
import {
  cleanPatientWorkspaceUrl,
  destinationFromPath,
  resolvePatientWorkspaceContext,
  temporaryPatientQuery,
} from "./patient-workspace-context.mjs";

const MAP_PATH = /\/provider\/patient-360(?:-[a-z]+)?\.html$/;
const PATIENT_SCOPED_PATH = /\/(?:provider\/nutrition-intelligence|bhw-paperwork|bhw-patient-monitor-list)\.html$/;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[character]);
}

function installContextStyles() {
  if (document.getElementById("patient-workspace-context-styles")) return;
  const style = document.createElement("style");
  style.id = "patient-workspace-context-styles";
  style.textContent = `
    .patient-workspace-context-panel{margin:14px 0;border-left:4px solid var(--green);box-shadow:var(--edge-gold)}
    .patient-workspace-context-panel .panel-body{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center}
    .patient-workspace-context-panel h3{margin:0 0 5px;font-size:1.05rem}.patient-workspace-context-panel p{margin:0;color:var(--muted);font-size:.82rem;line-height:1.55}
    .patient-workspace-context-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .patient-workspace-context-lock{font-size:.76rem;color:var(--muted);margin-top:7px}
    @media(max-width:760px){.patient-workspace-context-panel .panel-body{grid-template-columns:1fr}.patient-workspace-context-actions{justify-content:flex-start}}
  `;
  document.head.append(style);
}

function cleanInternalPatientLinks(context) {
  const synthetic = context.synthetic === true;
  for (const anchor of document.querySelectorAll("a[href]")) {
    let url;
    try { url = new URL(anchor.getAttribute("href"), location.href); } catch { continue; }
    if (url.origin !== location.origin) continue;
    if (MAP_PATH.test(url.pathname)) {
      url.searchParams.delete("patient");
      url.searchParams.delete("context");
      anchor.setAttribute("href", `${url.pathname.split("/").pop()}${url.search}${url.hash}`);
      continue;
    }
    if (url.pathname.endsWith("/provider/patient-operations.html")) {
      url.searchParams.delete("patient");
      url.searchParams.delete("context");
      anchor.setAttribute("href", `${url.pathname.split("/").pop()}${url.search}${url.hash}`);
      continue;
    }
    if (url.searchParams.has("patient")) {
      url.searchParams.delete("patient");
      if (!synthetic && PATIENT_SCOPED_PATH.test(url.pathname)) {
        anchor.setAttribute("href", "patient-registry.html");
        anchor.setAttribute("title", "Open this patient-specific workspace from Patient Registry until its secure handoff is connected.");
        anchor.dataset.patientContextLocked = "true";
      } else {
        anchor.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
      }
    }
    if (!synthetic && PATIENT_SCOPED_PATH.test(url.pathname) && !anchor.dataset.patientContextLocked) {
      anchor.setAttribute("href", "patient-registry.html");
      anchor.setAttribute("title", "Open this patient-specific workspace from Patient Registry until its secure handoff is connected.");
      anchor.dataset.patientContextLocked = "true";
    }
  }
}

function insertRegistryContextPanel(context) {
  if (context.synthetic || document.getElementById("patient-workspace-context-panel")) return;
  const content = document.getElementById("content");
  const hero = content?.querySelector(".navigator-hero") || content?.firstElementChild;
  if (!content || !hero) return;
  const panel = document.createElement("section");
  panel.id = "patient-workspace-context-panel";
  panel.className = "panel patient-workspace-context-panel";
  panel.innerHTML = `<div class="panel-body"><div><span class="eyebrow">Patient Registry verified</span><h3>Protected patient workspace context</h3><p>This tab is authorized for treatment-purpose read access to the Whole-Person Clinical Map, Body-System Atlas, and Patient Operations. Health Core remains the canonical record.</p><div class="patient-workspace-context-lock">The one-time launch token has been consumed and removed from the address. This tab context expires at ${escapeHtml(new Date(context.sessionExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}.</div></div><div class="patient-workspace-context-actions"><a class="btn primary" href="patient-operations.html">Open Patient Operations</a><a class="btn" href="patient-registry.html">Return to Patient Registry</a></div></div>`;
  hero.insertAdjacentElement("afterend", panel);
}

function watchRenderedContent(context) {
  const paint = () => {
    cleanInternalPatientLinks(context);
    insertRegistryContextPanel(context);
  };
  paint();
  const observer = new MutationObserver(paint);
  observer.observe(document.body, { subtree: true, childList: true });
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[data-patient-context-locked='true']");
    if (!anchor) return;
    event.preventDefault();
    location.assign("patient-registry.html");
  }, true);
}

function renderBlocked(error) {
  installContextStyles();
  const status = document.getElementById("status");
  if (status) {
    status.className = "badge restricted";
    status.textContent = "Patient context required";
  }
  const content = document.getElementById("content");
  if (content) content.innerHTML = `<section class="panel"><div class="panel-head"><h3>Open this workspace from Patient Registry</h3><span class="badge restricted">Access blocked</span></div><div class="panel-body"><p>${escapeHtml(error?.message || "The patient workspace could not be verified.")}</p><a class="btn primary" href="patient-registry.html">Return to Patient Registry</a></div></section>`;
}

async function start() {
  installContextStyles();
  const destination = destinationFromPath(location.pathname);
  const client = createPatientWorkspaceContextClient();
  const context = await resolvePatientWorkspaceContext({
    destination,
    redeem: (token, target) => client.redeem(token, target),
  });
  window.bhwPatientWorkspaceContext = context;

  const restoreCleanUrl = temporaryPatientQuery(context);
  try {
    await import("./patient-360-app.mjs");
  } finally {
    restoreCleanUrl();
  }
  watchRenderedContent(context);

  if (context.synthetic) {
    await import("./whole-person-clinical-map-bridge.mjs");
  }
}

start().catch((error) => {
  cleanPatientWorkspaceUrl();
  renderBlocked(error);
});
