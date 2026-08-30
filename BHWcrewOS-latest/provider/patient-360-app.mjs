import { createEncounterCloudClient } from "./cloud-queue.mjs";

const PATIENT_ID = "BHW0000";
const THEME_KEY = "bhw_provider_theme_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const compact = (values) => values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
const allResources = (record) => (record.fhir?.entry || []).map((item) => item.resource).filter(Boolean);
const dateText = (value, withTime = false) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Date not recorded";
  return withTime ? new Date(value).toLocaleString() : new Date(value).toLocaleDateString();
};
const conceptText = (concept = {}) => concept.text || concept.coding?.[0]?.display || concept.coding?.[0]?.code || "Not labeled";
const statusText = (value) => String(value || "not assessed").replace(/-/g, " ");
const titleText = (item = {}) => {
  const codedTitle = item.medicationCodeableConcept
    || item.vaccineCode
    || item.code
    || item.type?.[0]
    || item.category?.[0];
  return item.title
    || item.description
    || item.medicationReference?.display
    || (codedTitle ? conceptText(codedTitle) : "")
    || statusText(item.resourceType || "Unlabeled item");
};

function securityText(item = {}) {
  return JSON.stringify({
    visibility: item.visibility,
    restriction: item.restriction,
    security: item.security,
    metaSecurity: item.meta?.security,
    sensitivity: item.dataSensitivity,
  }).toLowerCase();
}

function isDisplayable(item = {}) {
  if (/(restricted|internal-only|sensitive)/.test(securityText(item))) return false;
  if (/must not be exposed/i.test(String(item.title || item.label || item.description || ""))) return false;
  return true;
}

function resourcesOf(resources, type) {
  return resources.filter((resource) => resource.resourceType === type);
}

function list(items, render, empty = "Nothing has been documented in this section.") {
  return items.length ? `<div class="list">${items.map(render).join("")}</div>` : `<div class="empty-note">${esc(empty)} Blank means undocumented or not connected - not clinically absent.</div>`;
}

function badge(status, label = status) {
  const normalized = String(status || "").toLowerCase();
  const style = /(urgent|high|critical|needs-attention|active-risk)/.test(normalized)
    ? "restricted"
    : /(complete|active|final|resolved|connected|documented)/.test(normalized)
      ? "complete"
      : /(not-assessed|unknown|pending|draft|requested)/.test(normalized)
        ? "warning"
        : "neutral";
  return `<span class="badge ${style}">${esc(statusText(label))}</span>`;
}

function ageText(birthDate) {
  if (!birthDate || !Number.isFinite(new Date(birthDate).getTime())) return "not recorded";
  const birth = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return String(age);
}

function normalizePatientName(name = {}) {
  const raw = compact([...(name.given || []), name.family]).join(" ") || "Synthetic Patient";
  return raw.replace(/\b(\w+)\s+\1\b/gi, "$1");
}

function renderResourceItem(item, detail = "") {
  return `<div class="item"><b>${esc(titleText(item))}</b><div class="meta">${esc(detail || compact([item.resourceType, item.status]).join(" - ") || "Recorded")}</div></div>`;
}

function observationDetail(item) {
  const value = item.valueQuantity ? `${item.valueQuantity.value ?? ""} ${item.valueQuantity.unit || ""}`.trim() : conceptText(item.valueCodeableConcept || {});
  return compact([item.status, value === "Not labeled" ? "" : value, dateText(item.effectiveDateTime || item.issued)]).join(" - ");
}

function medicationDetail(item) {
  return compact([
    item.status,
    item.dosageInstruction?.[0]?.text || "Directions not recorded",
    item.authoredOn ? `ordered ${dateText(item.authoredOn)}` : "",
  ]).join(" - ");
}

function systemCards(systems) {
  const catalog = [
    ["Energy & metabolism", ["energy & metabolism"]],
    ["Blood vessels & circulation", ["blood vessels & circulation"]],
    ["Nervous system & stress regulation", ["nervous system & stress regulation"]],
    ["Immune system & inflammation", ["immune system & inflammation"]],
    ["Hormone regulation", ["hormone regulation"]],
    ["Eyes, ears & upper airway", ["eyes", "ears", "ent", "upper airway"]],
    ["Heart, lungs & cardiopulmonary", ["heart", "lungs", "cardiopulmonary"]],
    ["GI, liver, pancreas & microbiome", ["gi", "liver", "pancreas", "microbiome"]],
    ["Kidneys & genitourinary", ["kidney", "renal", "genitourinary"]],
    ["Musculoskeletal, pain & spine", ["musculoskeletal", "pain", "spine"]],
    ["Skin, hair & barrier", ["skin", "hair", "barrier"]],
    ["Reproductive & sexual health", ["reproductive", "sexual health"]],
    ["Behavioral health & substance use", ["behavioral health", "substance"]],
    ["Whole-body function & other", ["whole-body", "whole body", "other"]],
  ];
  const matched = new Set();
  const cards = catalog.map(([label, aliases]) => {
    const system = systems.find((candidate, index) => {
      const name = String(candidate.label || "").toLowerCase();
      const matches = aliases.some((alias) => name.includes(alias));
      if (matches) matched.add(index);
      return matches;
    });
    const status = system?.status || "not-assessed";
    return `<article class="system ${esc(status)}"><div class="actions"><h4>${esc(label)}</h4>${badge(status)}</div><p>${esc(system?.summary || "No structured summary is available in this record.")}</p>${system?.focus?.length ? `<div class="focus">Focus: ${system.focus.map(esc).join(" - ")}</div>` : `<div class="focus">Evidence: not supplied</div>`}</article>`;
  });
  systems.forEach((system, index) => {
    if (matched.has(index)) return;
    const status = system.status || "not-assessed";
    cards.push(`<article class="system ${esc(status)}"><div class="actions"><h4>${esc(system.label || "Additional system")}</h4>${badge(status)}</div><p>${esc(system.summary || "No structured summary is available in this record.")}</p>${system.focus?.length ? `<div class="focus">Focus: ${system.focus.map(esc).join(" - ")}</div>` : ""}</article>`);
  });
  return cards.join("");
}

function timelineItems(timeline) {
  return list(timeline, (event) => `<article class="timeline-item"><b>${esc(event.label || event.type || "Timeline event")}</b><div class="meta">${esc(event.type || "Event")} - ${esc(dateText(event.date))}</div>${event.physiologicDomains?.length ? `<div class="timeline-tags">${event.physiologicDomains.map((domain) => `<span>${esc(statusText(domain))}</span>`).join("")}</div>` : ""}</article>`, "No high-value turning points are available yet.");
}

function mechanismMap(clinicalImpressions) {
  const steps = [
    ["Structural risk + baseline vulnerability", "Genetics, anatomy, development, prior injury, chronic disease, early exposures and long-standing social conditions.", ""],
    ["Trigger / initiating event", "Infection, medication, trauma, sleep loss, exposure, hormonal shift, acute stressor or loss of access.", ""],
    ["Alarm + defense activation", "Immune, inflammatory, autonomic, endocrine, vascular, behavioral, pain or threat response.", "purple"],
    ["Compensation + adaptation", "Helpful or costly adaptations; what preserves function now and what may be failing.", "purple"],
    ["Amplification + sustaining loops", "Sleep-pain-stress, dysglycemia, inflammation, redox, barrier, vascular and behavioral or social loops.", "gold"],
    ["Reserve + recovery capacity", "Energy, cognition, muscle, cardiopulmonary, renal or hepatic clearance, nutrition, coping and social reserve.", "green"],
    ["Current stability + manifestations", "Stable, vulnerable, fluctuating, progressively unstable or acutely decompensating current phenotype and function.", "coral"],
  ];
  const hasSynthesis = clinicalImpressions.length > 0;
  return `<div class="mechanism-map">${steps.map(([title, prompt, tone]) => `<article class="mechanism-step ${tone}"><div class="actions"><h4>${esc(title)}</h4>${badge(hasSynthesis ? "pending-review" : "not-assessed", hasSynthesis ? "source review needed" : "not documented")}</div><p>${esc(prompt)}</p><div class="evidence-row"><span>documented</span><span>suspected</span><span>historical</span><span>active</span><span>improving</span><span>urgent</span></div></article>`).join("")}</div>`;
}

function contextDomains() {
  const domains = [
    "Housing stability / safety", "Food and nutrition access", "Transportation", "Financial strain / benefits",
    "Employment / workplace conditions", "Education / health literacy", "Insurance / healthcare access",
    "Medication / treatment affordability", "Digital access / technology literacy", "Family / caregiver / social support",
    "Childcare / dependent care", "Neighborhood / environmental exposure", "Legal / immigration / justice system",
    "Language / culture / discrimination / trauma",
  ];
  return domains.map((domain) => `<div class="domain"><b>${esc(domain)}</b><span>Not documented</span></div>`).join("");
}

function lifestyleDomains() {
  return ["Sleep / circadian", "Nutrition / food pattern", "Movement / physical function", "Substances / medication use", "Stress / trauma / coping", "Work / school / home environment", "Social connection / caregiver burden"]
    .map((domain) => `<tr><td><b>${esc(domain)}</b></td><td>Not documented</td><td>Not documented</td><td>Clinical effect not yet linked</td></tr>`).join("");
}

function careRows(carePlans, tasks, goals) {
  const rows = [
    ...goals.map((item) => ({ target: titleText(item), plan: item.description || "Goal recorded", next: "Next step not supplied", owner: "Not assigned" })),
    ...carePlans.map((item) => ({ target: titleText(item), plan: item.description || compact([item.status, item.intent]).join(" - "), next: item.activity?.[0]?.detail?.description || "Next step not supplied", owner: item.author?.display || "Not assigned" })),
    ...tasks.map((item) => ({ target: titleText(item), plan: compact([item.status, item.intent]).join(" - "), next: item.description || "Task recorded", owner: item.owner?.display || "Not assigned" })),
  ].slice(0, 8);
  if (!rows.length) return `<tr><td colspan="4">No care-plan targets or tasks are available.</td></tr>`;
  return rows.map((row) => `<tr><td><b>${esc(row.target)}</b></td><td>${esc(row.plan || "Not supplied")}</td><td>${esc(row.next)}</td><td>${esc(row.owner)}</td></tr>`).join("");
}

function dataCard(title, items, renderer, empty) {
  return `<section class="data-card"><span class="count-chip">${items.length}</span><h4>${esc(title)}</h4>${list(items.slice(0, 4), renderer, empty)}</section>`;
}

function render(record) {
  const originalResources = allResources(record);
  const resources = originalResources.filter(isDisplayable);
  const rawTimeline = Array.isArray(record.timeline) ? record.timeline : [];
  const timeline = rawTimeline.filter(isDisplayable);
  const frontendOmitted = (originalResources.length - resources.length) + (rawTimeline.length - timeline.length);
  const patient = resourcesOf(resources, "Patient")[0] || {};
  const name = patient.name?.[0] || {};
  const conditions = resourcesOf(resources, "Condition");
  const observations = resourcesOf(resources, "Observation");
  const medications = resourcesOf(resources, "MedicationRequest");
  const encounters = resourcesOf(resources, "Encounter");
  const tasks = resourcesOf(resources, "Task");
  const carePlans = resourcesOf(resources, "CarePlan");
  const allergies = resourcesOf(resources, "AllergyIntolerance");
  const reports = resourcesOf(resources, "DiagnosticReport");
  const procedures = resourcesOf(resources, "Procedure");
  const immunizations = resourcesOf(resources, "Immunization");
  const documents = resourcesOf(resources, "DocumentReference");
  const goals = resourcesOf(resources, "Goal");
  const serviceRequests = resourcesOf(resources, "ServiceRequest");
  const clinicalImpressions = resourcesOf(resources, "ClinicalImpression");
  const systems = Array.isArray(record.systems) ? record.systems.filter(isDisplayable) : [];
  const unresolvedTasks = tasks.filter((item) => !["completed", "cancelled", "failed", "rejected"].includes(String(item.status).toLowerCase()));
  const urgentItems = resources.filter((item) => ["stat", "asap", "urgent", "critical"].includes(String(item.priority || item.status).toLowerCase()));
  const gaps = [
    [allergies.length, "allergies"], [immunizations.length, "immunizations"], [procedures.length, "procedures"],
    [documents.length, "source documents"], [clinicalImpressions.length, "clinician mechanism synthesis"],
  ].filter(([count]) => !count).map(([, label]) => label);
  const sourceOmitted = Number(record.restrictedRecordsOmitted || 0);
  const displayName = normalizePatientName(name);

  $("content").innerHTML = `
    <section class="navigator-hero" id="overview">
      <div class="hero-grid"><div><div class="eyebrow">PSCM Complex Patient Navigator - longitudinal Health Core record</div><h1>${esc(displayName)}</h1><p class="subtitle">A source-traceable physiologic systems view of what happened, what remains active, what has not been assessed, and what the care team needs to decide next.</p>
        <div class="patient-meta"><div><span>BHW Patient ID</span><b>${esc(record.bhwPatientId)}</b></div><div><span>DOB / Age</span><b>${esc(patient.birthDate || "not recorded")} / ${esc(ageText(patient.birthDate))}</b></div><div><span>Record generated</span><b>${esc(dateText(record.generatedAt, true))}</b></div><div><span>Primary source</span><b>BHW Health Core</b></div></div>
      </div><aside class="hero-aside"><h2>Working synthesis</h2><p>Every displayed fact should remain linked to its source. Hypotheses, missing information and patient priorities stay visibly separate from verified clinical facts.</p><div class="badge-row">${badge("FHIR R4-shaped")}${badge("synthetic only")}</div><div class="confidence"><b>${urgentItems.length ? `${urgentItems.length} structured urgent item(s)` : "No structured escalation flag returned"}</b><br>This is not a clinical clearance. Confirm safety and urgency against the source record.</div></aside></div>
    </section>
    <nav class="jump-nav" aria-label="Patient 360 sections"><a href="#overview">Overview</a><a href="#atlas">Body-system atlas</a><a href="#timeline">Timeline</a><a href="#mechanism">Mechanism map</a><a href="#context">Context</a><a href="#snapshot">Snapshot & plan</a><a href="#data">Clinical data</a><a href="#sources">Sources</a></nav>
    <div class="safe-notice"><b>Safe pilot record:</b> this page is locked to BHW0000 and does not query a real patient or production Firestore. ${sourceOmitted} restricted synthetic source record(s) and ${frontendOmitted} additional presentation item(s) were withheld. Blank sections mean not documented or not connected - never "normal" or "absent."</div>
    <section class="kpis">${[[conditions.length,"Conditions"],[observations.length+reports.length,"Results / reports"],[medications.length,"Medications"],[encounters.length,"Encounters"],[unresolvedTasks.length,"Open care work"],[resources.length,"FHIR resources"]].map(([value,label]) => `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`).join("")}</section>

    <section class="worksheet" id="atlas"><div class="worksheet-heading"><span class="section-number">1</span><h2>Patient History & Body-System Atlas</h2><p>What happened, where, when, and what remains active?</p></div>
      <div class="panel"><div class="panel-head"><h3>Physiologic systems sweep</h3><span class="badge neutral">Past, current and unresolved</span></div><div class="panel-body atlas">${systemCards(systems)}</div></div>
    </section>

    <section class="worksheet" id="timeline"><div class="worksheet-heading"><span class="section-number">2</span><h2>Layered Longitudinal Timeline</h2><p>High-value turning points with source-aware clinical context</p></div>
      <div class="two-col"><div class="panel"><div class="panel-head"><h3>Function trajectory</h3><span class="badge warning">Awaiting measures</span></div><div class="panel-body"><div class="trajectory"></div><div class="trajectory-labels"><span>Improved</span><span>Baseline</span><span>Declined</span></div><div class="empty-note" style="margin-top:12px">Future digital layer: graph patient-reported function, symptom burden, objective measures and major interventions without turning association into causation.</div></div></div>
      <div class="panel"><div class="panel-head"><h3>Clinical timeline</h3><span class="meta">Newest first</span></div><div class="panel-body timeline">${timelineItems(timeline)}</div></div></div>
    </section>

    <section class="worksheet" id="mechanism"><div class="worksheet-heading"><span class="section-number purple">3</span><h2>PSCM Mechanism Map</h2><p>A testable physiologic story, not a diagnosis generator</p></div>
      <div class="panel"><div class="panel-head"><h3>Mechanism sequence</h3><span class="badge warning">Clinician validation required</span></div><div class="panel-body">${mechanismMap(clinicalImpressions)}<div class="two-col" style="margin-top:15px"><div class="empty-note"><b>Working PSCM synthesis</b><br>${clinicalImpressions.length ? esc(clinicalImpressions.map(titleText).join(" - ")) : "No clinician-validated mechanism synthesis has been returned."}</div><div class="empty-note"><b>Alternative explanations / disconfirming evidence</b><br>No structured alternatives have been returned.</div></div></div></div>
    </section>

    <section class="worksheet" id="context"><div class="worksheet-heading"><span class="section-number green">4</span><h2>Social, Lifestyle & Recovery Context</h2><p>Barriers, protective resources, feasibility and reserve</p></div>
      <div class="two-col"><div class="panel"><div class="panel-head"><h3>Social determinants of health</h3><span class="badge warning">Not yet connected</span></div><div class="panel-body domain-grid">${contextDomains()}</div></div>
      <div class="panel"><div class="panel-head"><h3>Context synthesis</h3><span class="badge neutral">Clinical feasibility</span></div><div class="panel-body snapshot-grid"><div class="snapshot"><h4>Most consequential change over time</h4><p>Not documented.</p></div><div class="snapshot"><h4>Current feasibility barriers</h4><p>Not documented.</p></div><div class="snapshot green"><h4>Protective routines and relationships</h4><p>Not documented.</p></div><div class="snapshot blue"><h4>Resource or referral required</h4><p>${serviceRequests.length ? esc(serviceRequests.map(titleText).join(" - ")) : "Not documented."}</p></div></div></div></div>
      <div class="panel" style="margin-top:15px"><div class="panel-head"><h3>Lifestyle: then vs. now</h3><span class="badge warning">Longitudinal fields reserved</span></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>Domain</th><th>Previous pattern</th><th>Current pattern</th><th>Clinical effect / barrier / protective factor</th></tr></thead><tbody>${lifestyleDomains()}</tbody></table></div></div></div>
    </section>

    <section class="worksheet" id="snapshot"><div class="worksheet-heading"><span class="section-number coral">5</span><h2>Current Snapshot & Feasible Care Plan</h2><p>The five-minute team huddle view</p></div>
      <div class="two-col"><div class="panel"><div class="panel-head"><h3>Current patient snapshot</h3><span class="badge neutral">Documented facts only</span></div><div class="panel-body snapshot-grid">
        <div class="snapshot"><h4>What matters most now</h4><p>${conditions.length ? esc(conditions.map((item) => conceptText(item.code)).join(" - ")) : "No condition priority has been returned."}</p></div>
        <div class="snapshot coral"><h4>Active destabilizers / escalation</h4><p>${urgentItems.length ? esc(urgentItems.map(titleText).join(" - ")) : "No structured escalation flag returned. Verify clinically."}</p></div>
        <div class="snapshot green"><h4>Protective compensations / resources</h4><p>No structured protective resource has been returned.</p></div>
        <div class="snapshot"><h4>Current treatment and care work</h4><p>${compact([medications.length ? `${medications.length} medication(s)` : "", unresolvedTasks.length ? `${unresolvedTasks.length} open task(s)` : "", carePlans.length ? `${carePlans.length} care plan(s)` : ""]).join(" - ") || "No active treatment item has been returned."}</p></div>
        <div class="snapshot"><h4>Unanswered questions / data gaps</h4><p>${gaps.length ? esc(`Missing structured ${gaps.join(", ")}.`) : "Core digital categories are represented."}</p></div>
        <div class="snapshot blue"><h4>Required coordination</h4><p>${serviceRequests.length ? esc(serviceRequests.map(titleText).join(" - ")) : "No structured referral or coordination request has been returned."}</p></div>
      </div></div>
      <div class="panel"><div class="panel-head"><h3>Care plan and goals</h3><span class="badge complete">Source-linked</span></div><div class="panel-body">${list([...goals, ...carePlans, ...tasks], (item) => renderResourceItem(item, compact([item.resourceType, item.status, item.intent]).join(" - ")), "No structured goals, care plans or tasks are available.")}</div></div></div>
      <div class="panel" style="margin-top:15px"><div class="panel-head"><h3>Ideal plan vs. feasible next step</h3><span class="badge warning">Do not infer missing ownership</span></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>PSCM target</th><th>Documented clinical plan</th><th>Feasible next step / resource</th><th>Owner / timing</th></tr></thead><tbody>${careRows(carePlans, tasks, goals)}</tbody></table></div></div></div>
    </section>

    <section class="worksheet" id="data"><div class="worksheet-heading"><span class="section-number gold">6</span><h2>Digital Clinical Data Spine</h2><p>Everything the paper worksheet cannot continuously hold</p></div>
      <div class="data-grid">
        ${dataCard("Medications", medications, (item) => renderResourceItem(item, medicationDetail(item)), "No medication requests are available.")}
        ${dataCard("Allergies & intolerances", allergies, (item) => renderResourceItem(item, compact([item.clinicalStatus?.coding?.[0]?.code, item.criticality]).join(" - ")), "No allergy resource is connected.")}
        ${dataCard("Results & trends", [...observations, ...reports], (item) => renderResourceItem(item, item.resourceType === "Observation" ? observationDetail(item) : compact([item.status, dateText(item.effectiveDateTime)]).join(" - ")), "No result or diagnostic report is connected.")}
        ${dataCard("Procedures & imaging", procedures, (item) => renderResourceItem(item, compact([item.status, dateText(item.performedDateTime)]).join(" - ")), "No procedure or imaging resource is connected.")}
        ${dataCard("Immunizations", immunizations, (item) => renderResourceItem(item, compact([item.status, dateText(item.occurrenceDateTime)]).join(" - ")), "No immunization resource is connected.")}
        ${dataCard("Documents & provenance", documents, (item) => renderResourceItem(item, compact([item.status, dateText(item.date)]).join(" - ")), "No source document reference is connected.")}
        ${dataCard("Encounters", encounters, (item) => renderResourceItem(item, compact([item.status, dateText(item.period?.start)]).join(" - ")), "No encounter resource is connected.")}
        ${dataCard("Orders, referrals & tasks", [...serviceRequests, ...tasks], (item) => renderResourceItem(item, compact([item.resourceType, item.status, item.intent]).join(" - ")), "No structured order, referral or task is connected.")}
        ${dataCard("Care plans & goals", [...carePlans, ...goals], (item) => renderResourceItem(item, compact([item.resourceType, item.status, item.intent]).join(" - ")), "No care-plan or goal resource is connected.")}
      </div>
    </section>

    <section class="worksheet" id="sources"><div class="worksheet-heading"><span class="section-number">7</span><h2>Source Integrity & Record Boundaries</h2><p>What is connected, withheld, validated and still missing</p></div>
      <div class="panel"><div class="panel-head"><h3>FHIR bundle and provenance</h3>${badge("source traceability")}</div><div class="panel-body"><div class="source-strip"><div class="source-cell"><span>Bundle type</span><b>${esc(record.fhir?.type || "not supplied")}</b></div><div class="source-cell"><span>Schema version</span><b>${esc(record.schemaVersion || "not supplied")}</b></div><div class="source-cell"><span>Displayed resources</span><b>${resources.length}</b></div><div class="source-cell"><span>Restricted / withheld</span><b>${sourceOmitted + frontendOmitted}</b></div></div><div class="empty-note" style="margin-top:14px"><b>Future longitudinal connections:</b> verified EHR encounters, CRISP events, medications and fill history, payer data, laboratory and imaging feeds, vital trends, immunizations, referrals, documents, patient-reported outcomes, SDOH, care-team validation, source timestamps, corrections and consent boundaries.</div></div></div>
    </section>`;
}

async function load() {
  $("status").className = "badge warning";
  $("status").textContent = "Loading...";
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
    $("content").innerHTML = `<div class="panel"><div class="error-box"><b>Patient 360 could not connect.</b><br>${esc(error.message || "Try again after the protected connection is restored.")}</div></div>`;
  }
}

$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
};
$("print").onclick = () => window.print();
if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";
load();

