import { createPatientWorkspaceContextClient } from "./patient-workspace-context-client.mjs";
import {
  cleanPatientWorkspaceUrl,
  resolvePatientWorkspaceContext,
} from "./patient-workspace-context.mjs";

const THEME_KEY = "bhw_provider_theme_v1";
let context = null;
let requests = [];

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
})[character]);
const statusText = (value) => String(value || "not recorded").replace(/[_-]+/g, " ");

function dateText(value, withTime = false) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

function requestId(item = {}) {
  return String(item.patientRequestId || item.id || "").trim();
}

function complete(item = {}) {
  const state = String(item.statusCategory || item.status || "").toLowerCase().replace(/_/g, "-");
  return ["completed", "resolved", "closed", "cancelled"].includes(state);
}

function waiting(item = {}) {
  return /waiting|external|patient/.test(String(item.statusCategory || item.status || "").toLowerCase());
}

function urgency(item = {}) {
  const priority = String(item.priority || "routine").toLowerCase();
  if (["urgent", "emergency"].includes(priority)) return "urgent";
  if (["high", "time-sensitive"].includes(priority)) return "high";
  return complete(item) ? "complete" : "routine";
}

function assignment(item = {}) {
  return item.assignedToName || item.assignedTo || item.assignedTeam || item.routing?.assignedTeam || "Unassigned";
}

function dueText(item = {}) {
  return dateText(item.dueAt || item.targetDate || item.followUpAt || item.nextActionAt || item.updatedAt || item.createdAt);
}

function workLink(item = {}) {
  const id = requestId(item);
  return id ? `/bhw-requests.html?request=${encodeURIComponent(id)}` : "/bhw-requests.html";
}

function badge(item) {
  const tone = urgency(item);
  const label = item.priority && item.priority !== "routine"
    ? `${statusText(item.priority)} · ${statusText(item.status || item.statusCategory)}`
    : statusText(item.status || item.statusCategory);
  return `<span class="badge ${tone === "urgent" ? "restricted" : tone === "high" ? "warning" : tone === "complete" ? "complete" : "neutral"}">${escapeHtml(label)}</span>`;
}

function filteredRequests() {
  const query = $("work-search").value.trim().toLowerCase();
  const view = $("work-status").value;
  return requests.filter((item) => {
    if (view === "open" && complete(item)) return false;
    if (view === "urgent" && !["urgent", "high"].includes(urgency(item))) return false;
    if (view === "waiting" && !waiting(item)) return false;
    if (view === "completed" && !complete(item)) return false;
    if (!query) return true;
    return JSON.stringify({
      summary: item.summary,
      type: item.requestType,
      status: item.status,
      team: item.assignedTeam,
      person: item.assignedToName,
      source: item.source,
    }).toLowerCase().includes(query);
  });
}

function renderKpis() {
  const open = requests.filter((item) => !complete(item));
  const values = [
    [open.length, "Open work"],
    [open.filter((item) => urgency(item) === "urgent").length, "Urgent"],
    [open.filter((item) => urgency(item) === "high").length, "High / time-sensitive"],
    [open.filter(waiting).length, "Waiting"],
    [open.filter((item) => assignment(item) === "Unassigned").length, "Unassigned"],
  ];
  $("operations-kpis").innerHTML = values.map(([value, label]) => `<article class="kpi"><strong>${value}</strong><span>${escapeHtml(label)}</span></article>`).join("");
}

function renderRows() {
  const rows = filteredRequests();
  $("patient-work-list").innerHTML = rows.length ? rows.map((item) => {
    const id = requestId(item);
    return `<article class="work-row ${urgency(item)}">
      <div><h3>${escapeHtml(item.summary || statusText(item.requestType || "Patient request"))}</h3><p>${escapeHtml(statusText(item.requestType || "general"))}${item.source ? ` · ${escapeHtml(statusText(item.source))}` : ""}${id ? ` · ${escapeHtml(id)}` : ""}</p></div>
      <div class="work-meta"><span>Ownership</span><b>${escapeHtml(assignment(item))}</b></div>
      <div class="work-meta"><span>Updated / due review</span><b>${escapeHtml(dueText(item))}</b></div>
      <div class="work-actions">${badge(item)}<a class="btn" href="${escapeHtml(workLink(item))}">Open request</a></div>
    </article>`;
  }).join("") : '<div class="empty">No work items match this view.</div>';
}

function render() {
  renderKpis();
  renderRows();
}

function renderBlocked(error) {
  $("connection-status").className = "badge restricted";
  $("connection-status").textContent = "Context required";
  $("patient-context-label").textContent = "Not authorized";
  $("patient-context-detail").textContent = "Return to Patient Registry to select the patient again.";
  $("operations-kpis").innerHTML = "";
  $("patient-work-list").innerHTML = `<div class="error"><b>Patient Worklist could not open.</b><br>${escapeHtml(error?.message || "The patient workspace context was not verified.")}<br><br><a class="btn primary" href="patient-registry.html">Return to Patient Registry</a></div>`;
}

async function load() {
  const client = createPatientWorkspaceContextClient();
  context = await resolvePatientWorkspaceContext({
    destination: "patient-operations",
    redeem: (token, destination) => client.redeem(token, destination),
  });
  window.bhwPatientWorkspaceContext = context;
  $("patient-context-label").textContent = context.synthetic ? "Synthetic Patient · BHW0000" : `Protected Registry patient · ${context.bhwPatientId}`;
  $("patient-context-detail").textContent = context.synthetic
    ? "Synthetic operations preview."
    : `Treatment-purpose context expires ${new Date(context.sessionExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  $("connection-status").className = "badge complete";
  $("connection-status").textContent = context.synthetic ? "Synthetic context" : "Registry context verified";
  requests = await client.listPatientRequests(context.bhwPatientId, 200);
  render();
}

$("work-search").addEventListener("input", renderRows);
$("work-status").addEventListener("change", renderRows);
$("refresh").addEventListener("click", () => {
  $("connection-status").className = "badge warning";
  $("connection-status").textContent = "Refreshing";
  load().catch(renderBlocked);
});
$("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
  $("theme").textContent = dark ? "Black Opal" : "Light Opal";
});
if (localStorage.getItem(THEME_KEY) === "dark") {
  document.documentElement.dataset.theme = "dark";
  $("theme").textContent = "Light Opal";
}

load().catch((error) => {
  cleanPatientWorkspaceUrl();
  renderBlocked(error);
});
