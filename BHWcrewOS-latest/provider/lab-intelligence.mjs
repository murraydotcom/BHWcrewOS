const FIXTURE_URL = "/provider/fixtures/lab-intelligence.synthetic.json";
const SYNTHETIC_PATIENT_ID = "BHW0000";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

export function dateText(value, withTime = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Not recorded";
  return withTime ? new Date(value).toLocaleString() : new Date(value).toLocaleDateString();
}

export function statusText(value) {
  return String(value || "not recorded").replace(/-/g, " ");
}

export function statusTone(value) {
  const status = String(value || "").toLowerCase();
  if (/(critical|blocked|missing|rejected|high)/.test(status)) return "danger";
  if (/(partial|pending|candidate|needs|review|acknowledged)/.test(status)) return "warning";
  if (/(final|verified|complete|closed|received)/.test(status)) return "success";
  return "neutral";
}

export function assertSyntheticLabRecord(record, requestedPatientId = SYNTHETIC_PATIENT_ID) {
  if (requestedPatientId !== SYNTHETIC_PATIENT_ID) throw new Error("Lab Intelligence pilot permits only BHW0000.");
  if (record?.schemaVersion !== "bhw.lab-crewos-work-queues.v1" || record?.boundary?.syntheticOnly !== true || record?.boundary?.bhwPatientId !== SYNTHETIC_PATIENT_ID) {
    throw new Error("Unsupported or unsafe Lab Intelligence pilot record.");
  }
  if ((record.dashboard?.workItems || []).some((item) => item?.bhwPatientId !== SYNTHETIC_PATIENT_ID)) throw new Error("Every pilot work item must link only to BHW0000.");
  const prohibitedClinicalPayloads = ["results", "reports", "specimens", "trends", "timeline", "criticalEvents", "outsideIntakes"];
  if (prohibitedClinicalPayloads.some((field) => Object.hasOwn(record, field))) throw new Error("CrewOS queue fixtures cannot contain the Health Core clinical laboratory record.");
  return record;
}

export function filteredWorkItems(items = [], queue = "all", query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return items.filter((item) => (queue === "all" || item.queue === queue)
    && (!needle || [item.patientName, item.bhwPatientId, item.title, item.detail, item.status].some((value) => String(value || "").toLowerCase().includes(needle))));
}

export async function loadSyntheticLabRecord(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const response = await fetchImpl(FIXTURE_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load the synthetic Lab Intelligence record (${response.status}).`);
  return assertSyntheticLabRecord(await response.json());
}

function badge(value, label = value) {
  return `<span class="status ${statusTone(value)}">${escapeHtml(statusText(label))}</span>`;
}

function dashboardKpis(record) {
  const queues = record.dashboard.queues;
  return [
    [queues.criticalOpen, "Open critical"],
    [queues.missingOrPartial, "Missing / partial"],
    [queues.outsideVerification, "Outside verification"],
    [queues.providerReview, "Provider review"],
  ].map(([value, label]) => `<article class="kpi"><strong>${value}</strong><span>${escapeHtml(label)}</span></article>`).join("");
}

function renderWorkItems(record, queue = "all", query = "") {
  const items = filteredWorkItems(record.dashboard.workItems, queue, query);
  if (!items.length) return `<div class="empty">No work items match this view.</div>`;
  return items.map((item) => `<article class="work-row ${statusTone(item.priority)}">
    <div><div class="row-top"><b>${escapeHtml(item.title)}</b>${badge(item.status)}</div><p>${escapeHtml(item.detail)}</p><div class="meta">${escapeHtml(item.patientName)} · ${escapeHtml(item.bhwPatientId)} · updated ${escapeHtml(dateText(item.updatedAt, true))}</div></div>
    <span class="status neutral" title="The Health Core EHR route is not connected in this synthetic CrewOS preview.">Open in Health Core</span>
  </article>`).join("");
}

function renderDashboard(record) {
  document.getElementById("lab-kpis").innerHTML = dashboardKpis(record);
  document.getElementById("directory-summary").innerHTML = `
    <div><b>${record.directory.authoritativePhysicalEntries}</b><span>Authoritative Physical</span></div>
    <div><b>${record.directory.specialtyCandidates}</b><span>Specialty candidates</span></div>
    <div><b>${record.directory.escalationBranches}</b><span>Escalation branches</span></div>
    <div><b>${record.directory.totalRecords}</b><span>Total directory records</span></div>`;
  const integrity = record.dashboard.orderIntegrity;
  document.getElementById("template-integrity").innerHTML = `<div class="integrity-head">${badge(integrity.templatePreserved ? "verified" : "blocked", integrity.templatePreserved ? "complete template preserved" : "template integrity blocked")}</div>
    <p><b>${integrity.authoritativeTemplateItemCount}</b> authoritative items + <b>${integrity.programAdditionCount}</b> program additions + <b>${integrity.patientSpecificAdditionCount}</b> patient-specific addition.</p>
    <p class="meta">Directory metadata cannot alter template membership. Vendor mappings remain ${escapeHtml(statusText(record.directory.vendorValidationStatus))}.</p>`;
  const list = document.getElementById("work-items");
  const queue = document.getElementById("queue-filter");
  const search = document.getElementById("work-search");
  const paint = () => { list.innerHTML = renderWorkItems(record, queue.value, search.value); };
  queue.addEventListener("change", paint);
  search.addEventListener("input", paint);
  paint();
}

function setTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem("bhw-theme", next);
}

export async function mountLabIntelligence() {
  const requestedPatient = new URLSearchParams(location.search).get("patient") || SYNTHETIC_PATIENT_ID;
  if (requestedPatient !== SYNTHETIC_PATIENT_ID) throw new Error("This pilot is locked to synthetic patient BHW0000.");
  const record = await loadSyntheticLabRecord();
  const view = document.body.dataset.labView;
  if (view !== "dashboard") throw new Error("CrewOS supports only the operational Lab Dashboard.");
  renderDashboard(record);
  const status = document.getElementById("connection-status");
  status.className = "status warning";
  status.textContent = "Synthetic contract preview";
  document.getElementById("boundary-notice").textContent = record.boundary.notice;
  document.getElementById("refresh")?.addEventListener("click", () => location.reload());
  document.getElementById("theme")?.addEventListener("click", setTheme);
  document.getElementById("print")?.addEventListener("click", () => window.print());
}

if (typeof document !== "undefined") {
  try { const saved = localStorage.getItem("bhw-theme"); if (saved) document.documentElement.dataset.theme = saved; } catch { /* no storage */ }
  mountLabIntelligence().catch((error) => {
    const status = document.getElementById("connection-status");
    if (status) { status.className = "status danger"; status.textContent = "Unavailable"; }
    const root = document.getElementById("lab-root");
    if (root) root.innerHTML = `<section class="panel error-panel"><h2>Lab Intelligence view unavailable</h2><p>${escapeHtml(error.message)}</p><p>No clinical action was taken.</p></section>`;
  });
}
