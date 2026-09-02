const FIXTURE_URL = "/provider/fixtures/lab-intelligence.synthetic.json";
const SYNTHETIC_PATIENT_ID = "BHW0000";
const RESULT_QUEUES = Object.freeze(["critical", "missing", "partial"]);
const PROHIBITED_CLINICAL_ROOTS = Object.freeze(["orders", "results", "reports", "specimens", "trends", "timeline", "criticalEvents", "outsideIntakes", "interpretations", "justifications", "blueprints"]);
const PROHIBITED_WORK_ITEM_KEYS = Object.freeze(new Set(["result", "resultValue", "value", "unit", "referenceRange", "testName", "laboratoryName", "specimen", "methodology", "clinicalAssessment", "patientAction", "patientDisposition", "diagnosis", "sourceDocument", "reportPayload", "orderPayload"]));

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
  if (/(critical|blocked|missing|rejected|high|overdue|escalated)/.test(status)) return "danger";
  if (/(partial|pending|candidate|needs|review|acknowledged|watching|due)/.test(status)) return "warning";
  if (/(final|verified|complete|closed|received)/.test(status)) return "success";
  return "neutral";
}

function nestedKeys(value, keys = []) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    nestedKeys(child, keys);
  }
  return keys;
}

export function assertOperationalWorkItem(item) {
  if (item?.recordType !== "operational-lab-work-item" || !item.workItemId || !item.queue || !item.priority) throw new Error("Invalid operational laboratory work item.");
  if (item.bhwPatientId !== SYNTHETIC_PATIENT_ID) throw new Error("Every pilot work item must link only to BHW0000.");
  if (!String(item.healthCoreRecordReference || "").startsWith("health-core://")) throw new Error("Every laboratory work item requires an opaque Health Core record reference.");
  if (nestedKeys(item).some((key) => PROHIBITED_WORK_ITEM_KEYS.has(key))) throw new Error("CrewOS work items cannot contain clinical laboratory payload fields.");
  if (!item.owner?.team || !item.owner?.requiredRole || !item.owner?.assignmentStatus) throw new Error("Every operational work item requires ownership metadata.");
  if (!item.sla?.dueAt || !Number.isFinite(new Date(item.sla.dueAt).getTime()) || !item.sla?.status || !item.sla?.policyStatus) throw new Error("Every operational work item requires a due time and SLA status.");
  if (!Number.isInteger(item.escalation?.level) || !item.escalation?.status) throw new Error("Every operational work item requires escalation metadata.");
  if (!Array.isArray(item.closureRequirements) || !Array.isArray(item.allowedActions)) throw new Error("Every operational work item requires closure and action contracts.");
  const prohibitedActions = new Set(["sign", "place-order", "diagnose", "prescribe", "approve-clinical", "notify-patient", "enter-result"]);
  if (item.allowedActions.some((action) => prohibitedActions.has(action))) throw new Error("CrewOS operational actions cannot authorize clinical activity.");
  return item;
}

export function queueCounts(items = []) {
  const count = (queue) => items.filter((item) => item.queue === queue).length;
  return Object.freeze({
    criticalOpen: count("critical"),
    missing: count("missing"),
    partial: count("partial"),
    missingOrPartial: count("missing") + count("partial"),
    outsideVerification: count("outside"),
    providerReview: count("review"),
  });
}

export function assertSyntheticLabRecord(record, requestedPatientId = SYNTHETIC_PATIENT_ID) {
  if (requestedPatientId !== SYNTHETIC_PATIENT_ID) throw new Error("Lab Intelligence pilot permits only BHW0000.");
  if (record?.schemaVersion !== "bhw.lab-crewos-work-queues.v2"
    || record?.boundary?.syntheticOnly !== true
    || record?.boundary?.bhwPatientId !== SYNTHETIC_PATIENT_ID
    || record?.boundary?.readOnly !== true
    || record?.boundary?.operationalWritesEnabled !== false
    || record?.boundary?.healthCoreRoutingEnabled !== false
    || record?.boundary?.clinicalPayloadAllowed !== false) {
    throw new Error("Unsupported or unsafe Lab Intelligence pilot record.");
  }
  if (PROHIBITED_CLINICAL_ROOTS.some((field) => Object.hasOwn(record, field))) throw new Error("CrewOS queue fixtures cannot contain the Health Core clinical laboratory record.");
  const items = record.dashboard?.workItems || [];
  items.forEach(assertOperationalWorkItem);
  if (new Set(items.map((item) => item.workItemId)).size !== items.length) throw new Error("Operational work-item identities must be unique.");
  if (RESULT_QUEUES.some((queue) => !record.queueDefinitions?.[queue] || !items.some((item) => item.queue === queue))) throw new Error("Critical, missing, and partial result queues must each be explicitly defined and populated.");
  const calculated = queueCounts(items);
  for (const [key, value] of Object.entries(calculated)) if (record.dashboard.queues[key] !== value) throw new Error(`Declared queue count does not match ${key}.`);
  for (const queue of RESULT_QUEUES) {
    const definition = record.queueDefinitions[queue];
    if (definition.recordType !== "operational-work-item" || definition.clinicalSourceOfTruth !== "Health Core EHR") throw new Error("Result queue definitions must preserve the Health Core source-of-truth boundary.");
    const required = new Set(definition.requiredHealthCoreSignals || []);
    const present = new Set(items.find((item) => item.queue === queue).closureRequirements.filter((step) => step.systemOfRecord === "Health Core EHR").map((step) => step.key));
    if ([...required].some((key) => !present.has(key))) throw new Error(`The ${queue} queue is missing a required Health Core closure signal.`);
  }
  return record;
}

export function filteredWorkItems(items = [], queue = "all", query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return items.filter((item) => (queue === "all" || item.queue === queue)
    && (!needle || [item.patientName, item.bhwPatientId, item.title, item.detail, item.status, item.owner?.team, item.owner?.requiredRole].some((value) => String(value || "").toLowerCase().includes(needle))));
}

export function resultQueueItems(items = [], queue = "all", query = "") {
  const priority = { critical: 0, high: 1, routine: 2 };
  return filteredWorkItems(items.filter((item) => RESULT_QUEUES.includes(item.queue)), queue, query)
    .sort((a, b) => (priority[a.priority] ?? 9) - (priority[b.priority] ?? 9) || new Date(a.sla.dueAt) - new Date(b.sla.dueAt));
}

export function closureAssessment(item) {
  assertOperationalWorkItem(item);
  const operational = item.closureRequirements.find((step) => step.key === "operational-queue-closure");
  const prerequisites = item.closureRequirements.filter((step) => step.key !== "operational-queue-closure");
  const blockers = prerequisites.filter((step) => step.status !== "complete").map((step) => step.key);
  return Object.freeze({
    readyForOperationalClosure: Boolean(operational) && blockers.length === 0,
    fullyClosed: Boolean(operational) && operational.status === "complete" && blockers.length === 0,
    blockers: Object.freeze(blockers),
    healthCoreSignalsOpen: Object.freeze(prerequisites.filter((step) => step.systemOfRecord === "Health Core EHR" && step.status !== "complete").map((step) => step.key)),
  });
}

export function escalationAssessment(item, asOf = new Date()) {
  assertOperationalWorkItem(item);
  const asOfDate = new Date(asOf);
  if (!Number.isFinite(asOfDate.getTime())) throw new Error("A valid escalation assessment time is required.");
  const dueAt = new Date(item.sla.dueAt);
  const closed = closureAssessment(item).fullyClosed;
  return Object.freeze({ dueAt: item.sla.dueAt, overdue: !closed && asOfDate > dueAt, escalationLevel: item.escalation.level, escalationStatus: item.escalation.status });
}

export function buildOperationalActionPreview(record, workItemId, action) {
  assertSyntheticLabRecord(record);
  const item = record.dashboard.workItems.find((candidate) => candidate.workItemId === workItemId);
  if (!item) throw new Error("Unknown operational work item.");
  if (!item.allowedActions.includes(action)) throw new Error("Action is not permitted for this work item.");
  if (action === "close-after-health-core-confirmation" && !closureAssessment(item).readyForOperationalClosure) throw new Error("Health Core and operational closure prerequisites remain open.");
  const blockers = [];
  if (record.boundary.operationalWritesEnabled !== true) blockers.push("operational-writes-disabled");
  if (action === "view-health-core" && record.boundary.healthCoreRoutingEnabled !== true) blockers.push("authenticated-health-core-routing-disabled");
  return Object.freeze({
    schemaVersion: "bhw.lab-crewos-action-preview.v1",
    workItemId,
    action,
    eligibleForLiveExecution: blockers.length === 0,
    blockers: Object.freeze(blockers),
    persisted: false,
    actionRecorded: false,
    healthCoreMutationCreated: false,
    clinicalPayloadWritten: false,
  });
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
  return [[queues.criticalOpen,"Open critical"],[queues.missing,"Missing"],[queues.partial,"Partial"],[queues.outsideVerification,"Outside verification"],[queues.providerReview,"Provider review"]]
    .map(([value, label]) => `<article class="kpi"><strong>${value}</strong><span>${escapeHtml(label)}</span></article>`).join("");
}

function operationalMeta(item) {
  return `<div class="work-meta"><span><b>Owner</b>${escapeHtml(item.owner.team)} · ${escapeHtml(statusText(item.owner.requiredRole))}</span><span><b>Due</b>${escapeHtml(dateText(item.sla.dueAt, true))} · ${escapeHtml(statusText(item.sla.status))}</span><span><b>Escalation</b>Level ${item.escalation.level} · ${escapeHtml(statusText(item.escalation.status))}</span></div>`;
}

function renderWorkItems(record, queue = "all", query = "") {
  const items = filteredWorkItems(record.dashboard.workItems, queue, query);
  if (!items.length) return `<div class="empty">No work items match this view.</div>`;
  return items.map((item) => `<article class="work-row ${statusTone(item.priority)}"><div><div class="row-top"><b>${escapeHtml(item.title)}</b>${badge(item.status)}</div><p>${escapeHtml(item.detail)}</p>${operationalMeta(item)}<div class="meta">${escapeHtml(item.patientName)} · ${escapeHtml(item.bhwPatientId)} · updated ${escapeHtml(dateText(item.updatedAt, true))}</div></div><div class="work-actions">${RESULT_QUEUES.includes(item.queue) ? `<a class="button small" href="lab-result-queues.html?patient=BHW0000&queue=${encodeURIComponent(item.queue)}">Open operational queue</a>` : ""}<button class="small" disabled title="Authenticated Health Core routing is not connected.">Open in Health Core</button></div></article>`).join("");
}

function renderDashboard(record) {
  document.getElementById("lab-kpis").innerHTML = dashboardKpis(record);
  document.getElementById("directory-summary").innerHTML = `<div><b>${record.directory.authoritativePhysicalEntries}</b><span>Authoritative Physical</span></div><div><b>${record.directory.specialtyCandidates}</b><span>Specialty candidates</span></div><div><b>${record.directory.escalationBranches}</b><span>Escalation branches</span></div><div><b>${record.directory.totalRecords}</b><span>Total directory records</span></div>`;
  const integrity = record.dashboard.orderIntegrity;
  document.getElementById("template-integrity").innerHTML = `<div class="integrity-head">${badge(integrity.templatePreserved ? "verified" : "blocked", integrity.templatePreserved ? "complete template preserved" : "template integrity blocked")}</div><p><b>${integrity.authoritativeTemplateItemCount}</b> authoritative items + <b>${integrity.programAdditionCount}</b> program additions + <b>${integrity.patientSpecificAdditionCount}</b> patient-specific addition.</p><p class="meta">Directory metadata cannot alter template membership. Vendor mappings remain ${escapeHtml(statusText(record.directory.vendorValidationStatus))}.</p>`;
  const list = document.getElementById("work-items");
  const queue = document.getElementById("queue-filter");
  const search = document.getElementById("work-search");
  const paint = () => { list.innerHTML = renderWorkItems(record, queue.value, search.value); };
  queue.addEventListener("change", paint);
  search.addEventListener("input", paint);
  paint();
}

function closureSteps(item) {
  if (!item.closureRequirements.length) return `<p class="meta">No result-reconciliation closure contract is shown for this queue.</p>`;
  return item.closureRequirements.map((step) => `<div class="closure-step ${step.status === "complete" ? "done" : "open"}"><span>${escapeHtml(statusText(step.status))}</span><div><b>${escapeHtml(step.label)}</b><small>System of record: ${escapeHtml(step.systemOfRecord)}</small></div></div>`).join("");
}

function resultQueueCard(record, item) {
  const assessment = closureAssessment(item);
  return `<article class="queue-card ${statusTone(item.priority)}"><div class="queue-card-head"><div><span class="eyebrow">${escapeHtml(statusText(item.queue))} queue · ${escapeHtml(item.workItemId)}</span><h3>${escapeHtml(item.title)}</h3></div>${badge(item.priority)}</div><p>${escapeHtml(item.detail)}</p>${operationalMeta(item)}<div class="source-reference"><b>Health Core reference</b><code>${escapeHtml(item.healthCoreRecordReference)}</code><small>Opaque routing reference only; no clinical result payload is stored here.</small></div><div class="closure-contract"><div class="row-top"><h4>Closure checkpoints</h4>${badge(assessment.readyForOperationalClosure ? "complete" : "blocked", assessment.readyForOperationalClosure ? "Ready for CrewOS closure" : `${assessment.blockers.length} open`)}</div>${closureSteps(item)}</div><div class="queue-actions"><button disabled>Reassign</button><button disabled>Record follow-up</button><button disabled>Escalate</button><button disabled>Open in Health Core</button><button disabled>Close work item</button></div><p class="meta">Synthetic read-only preview. No assignment, escalation, closure, patient communication, or Health Core action was recorded.</p></article>`;
}

function queueDefinition(record, queue) {
  if (queue === "all") return `<h3>Operational result queues</h3><p>Critical, missing, and partial work is separated so ownership, urgency, due time, escalation, and closure can be managed without duplicating the clinical record.</p><p class="meta">All displayed SLA targets are synthetic proposals and require BHW operational approval before production use.</p>`;
  const definition = record.queueDefinitions[queue];
  return `<h3>${escapeHtml(definition.label)}</h3><p>${escapeHtml(definition.purpose)}</p><div class="definition-line"><span>Clinical source of truth</span><b>${escapeHtml(definition.clinicalSourceOfTruth)}</b></div><div class="definition-line"><span>Policy status</span><b>${escapeHtml(statusText(definition.policyStatus))}</b></div><h4>Required Health Core signals</h4><ul>${definition.requiredHealthCoreSignals.map((signal) => `<li>${escapeHtml(statusText(signal))}</li>`).join("")}</ul>`;
}

function renderResultQueues(record) {
  const counts = record.dashboard.queues;
  document.getElementById("result-queue-kpis").innerHTML = [[counts.criticalOpen,"Critical open"],[counts.missing,"Missing"],[counts.partial,"Partial"],[counts.missingOrPartial,"Reconciliation total"]].map(([value,label]) => `<article class="kpi"><strong>${value}</strong><span>${escapeHtml(label)}</span></article>`).join("");
  const allowed = new Set(["all", ...RESULT_QUEUES]);
  let selected = new URLSearchParams(location.search).get("queue") || "all";
  if (!allowed.has(selected)) selected = "all";
  const search = document.getElementById("result-queue-search");
  const list = document.getElementById("result-queue-items");
  const definition = document.getElementById("queue-definition");
  const buttons = [...document.querySelectorAll("[data-result-queue]")];
  const paint = () => {
    buttons.forEach((button) => button.classList.toggle("active", button.dataset.resultQueue === selected));
    const items = resultQueueItems(record.dashboard.workItems, selected, search.value);
    list.innerHTML = items.length ? items.map((item) => resultQueueCard(record, item)).join("") : `<div class="empty">No operational result work matches this view.</div>`;
    definition.innerHTML = queueDefinition(record, selected);
  };
  buttons.forEach((button) => button.addEventListener("click", () => { selected = button.dataset.resultQueue; paint(); }));
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
  else if (view === "result-queues") renderResultQueues(record);
  else throw new Error("CrewOS supports only operational laboratory views.");
  const status = document.getElementById("connection-status");
  status.className = "status warning";
  status.textContent = "Synthetic contract preview";
  document.getElementById("boundary-notice").textContent = record.boundary.notice;
  document.getElementById("refresh")?.addEventListener("click", () => location.reload());
  document.getElementById("theme")?.addEventListener("click", setTheme);
}

if (typeof document !== "undefined") {
  try { const saved = localStorage.getItem("bhw-theme"); if (saved) document.documentElement.dataset.theme = saved; } catch { /* no storage */ }
  mountLabIntelligence().catch((error) => {
    const status = document.getElementById("connection-status");
    if (status) { status.className = "status danger"; status.textContent = "Unavailable"; }
    const root = document.getElementById("lab-root");
    if (root) root.innerHTML = `<section class="panel error-panel"><h2>Lab Intelligence view unavailable</h2><p>${escapeHtml(error.message)}</p><p>No operational or clinical action was taken.</p></section>`;
  });
}
