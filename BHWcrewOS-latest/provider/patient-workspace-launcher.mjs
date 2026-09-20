import { createPatientWorkspaceContextClient } from "./patient-workspace-context-client.mjs";

const client = createPatientWorkspaceContextClient();
let statusPromise = null;
let painting = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[character]);
}

function installStyles() {
  if (document.getElementById("patient-workspace-launcher-styles")) return;
  const style = document.createElement("style");
  style.id = "patient-workspace-launcher-styles";
  style.textContent = `
    .patient-workspace-launcher{border-top:1px solid var(--line);margin-top:18px;padding-top:17px}
    .patient-workspace-launcher-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
    .patient-workspace-launcher h4{margin:0 0 4px;font-size:14px}.patient-workspace-launcher p{margin:0;color:var(--muted);font-size:10.5px;line-height:1.55}
    .patient-workspace-launch-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
    .patient-workspace-launch{display:grid;gap:3px;text-align:left;border:1px solid var(--line);border-radius:12px;padding:11px;background:color-mix(in srgb,var(--blue) 6%,var(--card));color:var(--ink);cursor:pointer;font-family:Montserrat}
    .patient-workspace-launch:hover:not(:disabled){border-color:var(--blue-d);transform:translateY(-1px)}.patient-workspace-launch b{font-size:11px}.patient-workspace-launch span{font-size:9.5px;color:var(--muted);line-height:1.45}.patient-workspace-launch:disabled{opacity:.52;cursor:not-allowed}
    .patient-workspace-launch.primary{background:var(--blue-d);border-color:var(--blue-d);color:#fff}.patient-workspace-launch.primary span{color:rgba(255,255,255,.82)}
    .patient-workspace-launch-state{margin-top:10px;padding:9px 11px;border-left:3px solid var(--bronze);background:color-mix(in srgb,var(--bronze) 8%,var(--card));border-radius:8px;font-size:10px;line-height:1.5}
    @media(max-width:760px){.patient-workspace-launch-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function selectedPatientId(detail) {
  const value = String(detail?.querySelector("h3")?.textContent || "").trim().toUpperCase();
  return /^BHW\d{4}$/.test(value) && value !== "BHW0000" ? value : "";
}

async function contextStatus() {
  if (!statusPromise) statusPromise = client.status().catch((error) => ({ enabled: false, error }));
  return statusPromise;
}

function launchPanel(patientId, status) {
  const enabled = status.enabled === true;
  const state = enabled
    ? "A one-time opaque launch token will be bound to your staff identity, treatment purpose, selected patient, and destination. The token expires in two minutes and is removed after use."
    : status.error?.message || "Secure real-patient workspace launch is built but has not been activated in the Operations API.";
  return `<section class="patient-workspace-launcher" data-patient-workspace-launcher="${escapeHtml(patientId)}">
    <div class="patient-workspace-launcher-head"><div><h4>Open the selected patient workspace</h4><p>Patient Registry is the front door. Each workspace stays separate while using the same protected patient identity.</p></div><span class="badge ${enabled ? "complete" : "warning"}">${enabled ? "Secure launch ready" : "Activation pending"}</span></div>
    <div class="patient-workspace-launch-grid">
      <button class="patient-workspace-launch primary" type="button" data-workspace-destination="clinical-map" ${enabled ? "" : "disabled"}><b>Open Whole-Person Clinical Map</b><span>PSCM synthesis, body systems, timeline, mechanisms, context, reserve, and feasible planning.</span></button>
      <button class="patient-workspace-launch" type="button" data-workspace-destination="body-system-atlas" ${enabled ? "" : "disabled"}><b>Open Body-System Atlas</b><span>Anatomical locations plus past, current, and unresolved findings across body systems.</span></button>
      <button class="patient-workspace-launch" type="button" data-workspace-destination="patient-operations" ${enabled ? "" : "disabled"}><b>Open Patient Operations</b><span>Patient Worklist for requests, ownership, priority, waiting states, follow-through, and closure.</span></button>
      <button class="patient-workspace-launch" type="button" disabled><b>Open Health Core Chart Summary</b><span>Cross-domain real-patient launch remains locked until Health Core accepts the same signed context.</span></button>
    </div>
    <div class="patient-workspace-launch-state" data-workspace-launch-state>${escapeHtml(state)}</div>
  </section>`;
}

async function paint() {
  if (painting) return;
  painting = true;
  try {
    const detail = document.getElementById("detail");
    const patientId = selectedPatientId(detail);
    if (!detail || !patientId) return;
    const existing = detail.querySelector("[data-patient-workspace-launcher]");
    if (existing?.dataset.patientWorkspaceLauncher === patientId) return;
    existing?.remove();
    const status = await contextStatus();
    const target = detail.querySelector(".detail");
    if (!target || selectedPatientId(detail) !== patientId) return;
    target.insertAdjacentHTML("beforeend", launchPanel(patientId, status));
  } finally {
    painting = false;
  }
}

async function launch(button) {
  const detail = document.getElementById("detail");
  const patientId = selectedPatientId(detail);
  const destination = button.dataset.workspaceDestination;
  const state = detail?.querySelector("[data-workspace-launch-state]");
  if (!patientId || !destination || !state) return;
  const buttons = [...detail.querySelectorAll("[data-workspace-destination]")];
  buttons.forEach((item) => { item.disabled = true; });
  state.textContent = "Creating a one-time treatment-purpose launch…";
  try {
    const issued = await client.issue(patientId, destination);
    if (!issued?.token || !issued?.launchPath) throw new Error("Secure launch was not returned.");
    state.textContent = "Opening the protected patient workspace…";
    location.assign(`${issued.launchPath}?context=${encodeURIComponent(issued.token)}`);
  } catch (error) {
    state.textContent = `Not opened · ${error.message || "secure launch failed"}`;
    buttons.forEach((item) => { item.disabled = false; });
    if (error.status === 401) location.assign("/crewos?next=%2Fprovider%2Fpatient-registry.html");
  }
}

installStyles();
const detail = document.getElementById("detail");
new MutationObserver(paint).observe(detail, { childList: true, subtree: true });
detail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-workspace-destination]");
  if (button) launch(button);
});
paint();
