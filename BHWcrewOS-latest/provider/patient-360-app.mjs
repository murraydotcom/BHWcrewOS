import { createEncounterCloudClient } from "./cloud-queue.mjs";

const PATIENT_ID = "BHW0000";
const THEME_KEY = "bhw_provider_theme_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const entries = (record, type) => (record.fhir?.entry || []).map((item) => item.resource).filter((resource) => resource?.resourceType === type);
const dateText = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : "Date not recorded";
const conceptText = (concept = {}) => concept.text || concept.coding?.[0]?.display || concept.coding?.[0]?.code || "Not labeled";

function list(items, render, empty = "Nothing recorded in this synthetic section.") {
  return items.length ? `<div class="list">${items.map(render).join("")}</div>` : `<div class="meta">${esc(empty)}</div>`;
}

function render(record) {
  const patient = entries(record, "Patient")[0] || {};
  const name = patient.name?.[0] || {};
  const displayName = [...(name.given || []), name.family].filter(Boolean).join(" ") || "Synthetic Patient";
  const conditions = entries(record, "Condition");
  const observations = entries(record, "Observation");
  const medications = entries(record, "MedicationRequest");
  const encounters = entries(record, "Encounter");
  const tasks = entries(record, "Task");
  const carePlans = entries(record, "CarePlan");
  const systems = Array.isArray(record.systems) ? record.systems : [];
  const counts = record.counts || {};

  $("content").innerHTML = `
    <section class="hero"><div><h2>${esc(displayName)}</h2><p><b>${esc(record.bhwPatientId)}</b> · DOB ${esc(patient.birthDate || "not recorded")} · ${esc(patient.gender || "unknown")}<br>Generated ${esc(dateText(record.generatedAt))}</p></div><div class="actions"><span class="badge complete">FHIR R4-shaped</span><span class="badge warning">Synthetic only</span><button class="btn primary" id="refresh">Refresh</button></div></section>
    <div class="notice"><b>Safe pilot record:</b> this view is locked to BHW0000. It does not query a real patient or production Firestore. ${Number(record.restrictedRecordsOmitted || 0)} restricted synthetic record(s) were omitted before display.</div>
    <section class="kpis">${[[conditions.length,"Conditions"],[observations.length,"Results"],[medications.length,"Medications"],[encounters.length,"Encounters"],[tasks.length,"Care tasks"]].map(([value,label])=>`<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`).join("")}</section>
    <div class="grid"><div>
      <section class="card"><div class="card-head"><h3>Physiologic systems</h3><span class="badge complete">Longitudinal summary</span></div><div class="card-body systems">${systems.map((system)=>`<article class="system"><div class="actions"><h4>${esc(system.label)}</h4><span class="badge ${system.status === "not-assessed" ? "warning" : "complete"}">${esc(system.status)}</span></div><p>${esc(system.summary || "Not assessed in this synthetic record.")}</p>${system.focus?.length ? `<div class="meta">Focus: ${system.focus.map(esc).join(" · ")}</div>` : ""}</article>`).join("")}</div></section>
      <section class="card"><div class="card-head"><h3>Clinical timeline</h3><span class="meta">Newest first</span></div><div class="card-body">${list(record.timeline || [],(event)=>`<div class="item"><b>${esc(event.label || event.type)}</b><div class="meta">${esc(event.type)} · ${esc(dateText(event.date))}${event.physiologicDomains?.length ? ` · ${event.physiologicDomains.map(esc).join(", ")}` : ""}</div></div>`)}</div></section>
    </div><div>
      <section class="card"><div class="card-head"><h3>Medications</h3><span class="badge complete">Medication service</span></div><div class="card-body">${list(medications,(item)=>`<div class="item"><b>${esc(conceptText(item.medicationCodeableConcept))}</b><div class="meta">${esc(item.status || "unknown")} · ${esc(item.dosageInstruction?.[0]?.text || "Directions not recorded")} · ordered ${esc(dateText(item.authoredOn))}</div></div>`)}</div></section>
      <section class="card"><div class="card-head"><h3>Conditions and results</h3></div><div class="card-body">${list([...conditions,...observations],(item)=>`<div class="item"><b>${esc(conceptText(item.code))}</b><div class="meta">${esc(item.resourceType)} · ${esc(item.clinicalStatus?.coding?.[0]?.code || item.status || "recorded")}${item.valueQuantity ? ` · ${esc(item.valueQuantity.value)} ${esc(item.valueQuantity.unit)}` : ""}</div></div>`)}</div></section>
      <section class="card"><div class="card-head"><h3>Care plan and tasks</h3></div><div class="card-body">${list([...carePlans,...tasks],(item)=>`<div class="item"><b>${esc(item.title || item.description || item.resourceType)}</b><div class="meta">${esc(item.status || "recorded")} · ${esc(item.intent || "")}</div></div>`)}</div></section>
      <section class="card"><div class="card-head"><h3>FHIR bundle</h3></div><div class="card-body"><div class="meta">Bundle type: ${esc(record.fhir?.type || "")}</div><div class="meta">Schema version: ${esc(record.schemaVersion)}</div><div class="meta">Resources: ${esc(Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0))}</div><div class="meta">Restricted omitted: ${esc(record.restrictedRecordsOmitted)}</div></div></section>
    </div></div>`;
  $("refresh").onclick = load;
}

async function load() {
  $("status").className = "badge warning";
  $("status").textContent = "Loading…";
  try {
    const client = await createEncounterCloudClient();
    if (!client) throw new Error("Google Cloud is not configured for this site.");
    const body = await client.healthRecord(PATIENT_ID);
    if (!body?.healthRecord) throw new Error("The synthetic Health Core record was not returned.");
    render(body.healthRecord);
    $("status").className = "badge complete";
    $("status").textContent = "Health Core connected";
  } catch (error) {
    $("status").className = "badge restricted";
    $("status").textContent = "Unavailable";
    $("content").innerHTML = `<div class="card"><div class="empty error"><b>Patient 360 could not connect.</b><br>${esc(error.message || "Try again after the protected connection is restored.")}</div></div>`;
  }
}

$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
};
if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";
load();
