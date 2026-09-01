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
  if (record?.schemaVersion !== "bhw.lab-crewos-pilot.v1" || record?.boundary?.syntheticOnly !== true || record?.boundary?.bhwPatientId !== SYNTHETIC_PATIENT_ID) {
    throw new Error("Unsupported or unsafe Lab Intelligence pilot record.");
  }
  const patientLinked = [record.patient, ...(record.dashboard?.workItems || []), ...(record.orders || [])]
    .filter((item) => item?.bhwPatientId);
  if (patientLinked.some((item) => item.bhwPatientId !== SYNTHETIC_PATIENT_ID)) throw new Error("The pilot record contains a non-synthetic patient link.");
  return record;
}

export function activeResults(results = []) {
  const superseded = new Set(results.map((result) => result.supersedesResultId).filter(Boolean));
  const explicitlySuperseded = new Set(results.filter((result) => result.supersededByResultId).map((result) => result.resultId));
  return results.filter((result) => !explicitlySuperseded.has(result.resultId) && !superseded.has(result.resultId));
}

export function resultRevisionChain(results = [], resultId) {
  const byId = new Map(results.map((result) => [result.resultId, result]));
  const chain = [];
  let current = byId.get(resultId);
  while (current) {
    chain.push(current);
    current = current.supersedesResultId ? byId.get(current.supersedesResultId) : null;
  }
  return chain;
}

export function filteredWorkItems(items = [], queue = "all", query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return items.filter((item) => (queue === "all" || item.queue === queue)
    && (!needle || [item.patientName, item.bhwPatientId, item.title, item.detail, item.status].some((value) => String(value || "").toLowerCase().includes(needle))));
}

export function filteredTimeline(events = [], type = "all", query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return [...events]
    .filter((event) => (type === "all" || event.type === type)
      && (!needle || [event.title, event.summary, event.type, event.status, event.sourceId].some((value) => String(value || "").toLowerCase().includes(needle))))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

export function trendSummary(trend = {}) {
  if (!trend.comparable || !Array.isArray(trend.points) || trend.points.length < 3) return "Three comparable verified timepoints are not available.";
  return `${statusText(trend.direction)} · net ${trend.netChange > 0 ? "+" : ""}${trend.netChange} ${trend.unit} · ${trend.percentageChange}% change · clinical meaning requires provider review`;
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
    <a class="button small" href="patient-lab-timeline.html?patient=${encodeURIComponent(item.bhwPatientId)}">Open lab timeline</a>
  </article>`).join("");
}

function renderDashboard(record) {
  const order = record.orders[0];
  document.getElementById("lab-kpis").innerHTML = dashboardKpis(record);
  document.getElementById("directory-summary").innerHTML = `
    <div><b>${record.directory.authoritativePhysicalEntries}</b><span>Authoritative Physical</span></div>
    <div><b>${record.directory.specialtyCandidates}</b><span>Specialty candidates</span></div>
    <div><b>${record.directory.escalationBranches}</b><span>Escalation branches</span></div>
    <div><b>${record.directory.totalRecords}</b><span>Total directory records</span></div>`;
  document.getElementById("template-integrity").innerHTML = `<div class="integrity-head">${badge(order.templatePreserved ? "verified" : "blocked", order.templatePreserved ? "complete template preserved" : "template integrity blocked")}</div>
    <p><b>${order.authoritativeTemplateItemCount}</b> authoritative items + <b>${order.programAdditionCount}</b> program additions + <b>${order.patientSpecificAdditionCount}</b> patient-specific addition.</p>
    <p class="meta">Directory metadata cannot alter template membership. Vendor mappings remain ${escapeHtml(statusText(record.directory.vendorValidationStatus))}.</p>`;
  const list = document.getElementById("work-items");
  const queue = document.getElementById("queue-filter");
  const search = document.getElementById("work-search");
  const paint = () => { list.innerHTML = renderWorkItems(record, queue.value, search.value); };
  queue.addEventListener("change", paint);
  search.addEventListener("input", paint);
  paint();
}

function renderPatientHeader(record) {
  const patient = record.patient;
  return `<section class="patient-hero"><div><span class="eyebrow">Patient 360 · focused laboratory record</span><h1>${escapeHtml(patient.name)}</h1><p>Verified laboratory events, immutable revisions, comparable trends, open loops, and source boundaries.</p></div>
    <div class="patient-grid">
      <div><span>BHW Patient ID</span><b>${escapeHtml(patient.bhwPatientId)}</b></div>
      <div><span>DOB</span><b>${escapeHtml(dateText(patient.dob))}</b></div>
      <div><span>Communication</span><b>${escapeHtml(patient.communicationStatus)}</b></div>
      <div><span>Care team</span><b>${patient.careTeam.map(escapeHtml).join(" · ")}</b></div>
      <div><span>Programs</span><b>${patient.programs.map(escapeHtml).join(" · ")}</b></div>
      <div><span>Risk status</span><b>${escapeHtml(patient.riskStatus)}</b></div>
      <div><span>Last encounter</span><b>${escapeHtml(dateText(patient.lastEncounter, true))}</b></div>
      <div><span>Next appointment</span><b>${escapeHtml(dateText(patient.nextAppointment, true))}</b></div>
    </div></section>`;
}

function trendChart(trend) {
  const values = trend.points.map((point) => Number(point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const coords = trend.points.map((point, index) => {
    const x = 28 + index * 116;
    const y = 105 - ((Number(point.value) - min) / spread) * 66;
    return { x, y, point };
  });
  return `<article class="trend-card"><div class="row-top"><h3>${escapeHtml(trend.testName)}</h3>${badge(trend.clinicalMeaning)}</div>
    <svg class="spark" viewBox="0 0 300 130" role="img" aria-label="${escapeHtml(trend.testName)} three-timepoint trend">
      <line x1="28" y1="105" x2="260" y2="105" class="axis"></line>
      <polyline points="${coords.map(({ x, y }) => `${x},${y}`).join(" ")}" class="trend-line"></polyline>
      ${coords.map(({ x, y, point }) => `<circle cx="${x}" cy="${y}" r="5"></circle><text x="${x}" y="${Math.max(17, y - 12)}">${escapeHtml(point.value)}</text><text x="${x}" y="123">${escapeHtml(point.date.slice(0, 4))}</text>`).join("")}
    </svg><p>${escapeHtml(trendSummary(trend))}</p><div class="meta">Same unit, specimen, and method; corrected active values are used without deleting originals.</div></article>`;
}

function renderResults(record, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const active = activeResults(record.results).filter((result) => !needle || [result.testName, result.value, result.unit, result.status, result.laboratoryName].some((value) => String(value || "").toLowerCase().includes(needle)));
  if (!active.length) return `<tr><td colspan="8">No active results match this search.</td></tr>`;
  return active.sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt)).map((result) => `<tr data-result-id="${escapeHtml(result.resultId)}">
    <td><b>${escapeHtml(result.testName)}</b>${result.supersedesResultId ? `<small>Revision ${result.revision}; prior preserved</small>` : ""}</td>
    <td>${escapeHtml(result.value)} ${escapeHtml(result.unit)}</td><td>${escapeHtml(result.referenceRange)}</td><td>${badge(result.abnormalFlag || "within-lab-range", result.abnormalFlag || "no flag")}</td>
    <td>${escapeHtml(dateText(result.collectedAt))}</td><td>${escapeHtml(result.laboratoryName)}</td><td>${escapeHtml(result.methodology)}</td><td>${badge(result.verificationStatus)}</td>
  </tr>`).join("");
}

function renderTimeline(record, type = "all", query = "") {
  const events = filteredTimeline(record.timeline, type, query);
  if (!events.length) return `<div class="empty">No laboratory events match this view.</div>`;
  return events.map((event) => `<article class="timeline-event ${statusTone(event.status)}"><div class="timeline-date">${escapeHtml(dateText(event.occurredAt, true))}</div><div class="timeline-dot"></div><div class="timeline-card"><div class="row-top"><b>${escapeHtml(event.title)}</b>${badge(event.status)}</div><p>${escapeHtml(event.summary)}</p><div class="meta">${escapeHtml(statusText(event.type))} · source ${escapeHtml(event.sourceId)} · ${escapeHtml(statusText(event.verification))}</div></div></article>`).join("");
}

function renderCritical(record) {
  const event = record.criticalEvents[0];
  if (!event) return `<div class="empty">No critical-result event is present.</div>`;
  const checks = [
    [Boolean(event.providerAcknowledgedAt), "Provider acknowledgment"],
    [Boolean(event.assessment), "Clinical assessment"],
    [Boolean(event.patientAction), "Patient action or disposition"],
    [Boolean(event.closure), "Documented closure"],
  ];
  return `<div class="critical-summary"><div class="row-top"><h3>Critical-result closure requirements</h3>${badge(event.status)}</div>${checks.map(([done, label]) => `<div class="closure-step ${done ? "done" : "open"}"><span>${done ? "Complete" : "Open"}</span><b>${escapeHtml(label)}</b></div>`).join("")}<p class="meta">Final interpretation approval remains blocked while any required closure step is open.</p></div>`;
}

function renderPatientTimeline(record) {
  document.getElementById("patient-header").innerHTML = renderPatientHeader(record);
  document.getElementById("trend-cards").innerHTML = record.trends.map(trendChart).join("");
  document.getElementById("critical-panel").innerHTML = renderCritical(record);
  const timeline = document.getElementById("timeline-events");
  const type = document.getElementById("event-filter");
  const search = document.getElementById("lab-search");
  const resultRows = document.getElementById("result-rows");
  const paint = () => {
    timeline.innerHTML = renderTimeline(record, type.value, search.value);
    resultRows.innerHTML = renderResults(record, search.value);
  };
  type.addEventListener("change", paint);
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
  if (view === "dashboard") renderDashboard(record);
  else if (view === "timeline") renderPatientTimeline(record);
  else throw new Error("Unsupported Lab Intelligence view.");
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
