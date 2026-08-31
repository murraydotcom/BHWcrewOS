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
    || item.label
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
  return `<section class="data-card"><span class="count-chip">${items.length}</span><h4>${esc(title)}</h4>${list(items, renderer, empty)}</section>`;
}

function renderLegacy(record) {
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
  const careTeams = resourcesOf(resources, "CareTeam");
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

const PAGE_LINKS = [
  ["overview", "Overview", "patient-360.html"],
  ["atlas", "Body-system atlas", "patient-360-atlas.html"],
  ["timeline", "Timeline", "patient-360-timeline.html"],
  ["mechanism", "Mechanism map", "patient-360-mechanism.html"],
  ["context", "Social & lifestyle", "patient-360-context.html"],
  ["plan", "Snapshot & plan", "patient-360-plan.html"],
  ["data", "Clinical data", "patient-360-data.html"],
  ["sources", "Sources", "patient-360-sources.html"],
];

function pageNavigation(view) {
  return `<nav class="page-nav" aria-label="Patient 360 pages">${PAGE_LINKS.map(([key, label, href]) => `<a class="${key === view ? "active" : ""}" ${key === view ? 'aria-current="page"' : ""} href="${href}">${esc(label)}</a>`).join("")}</nav>`;
}

function fullHero(context) {
  const { record, patient, displayName, urgentItems } = context;
  return `<section class="navigator-hero"><div class="hero-grid"><div><div class="eyebrow">PSCM Complex Patient Navigator - Health 360 overview</div><h1>${esc(displayName)}</h1><p class="subtitle">A concise, source-aware summary of the whole person with direct paths into the detailed longitudinal record.</p><div class="patient-meta"><div><span>BHW Patient ID</span><b>${esc(record.bhwPatientId || PATIENT_ID)}</b></div><div><span>DOB / age</span><b>${esc(patient.birthDate || "not recorded")} / ${esc(ageText(patient.birthDate))}</b></div><div><span>Record generated</span><b>${esc(dateText(record.generatedAt, true))}</b></div><div><span>Primary source</span><b>BHW Health Core</b></div></div></div><aside class="hero-aside"><h2>Working synthesis</h2><p>Verified facts, hypotheses, missing information and patient priorities remain visibly separate.</p><div class="badge-row">${badge("FHIR R4-shaped")}${badge("synthetic only")}</div><div class="confidence"><b>${urgentItems.length ? `${urgentItems.length} structured escalation flag(s)` : "No structured escalation flag returned"}</b><br>This is not clinical clearance. Confirm safety and urgency against the source record.</div></aside></div></section>`;
}

function compactHeader(context) {
  const { record, patient, displayName } = context;
  return `<section class="panel"><div class="panel-body"><div class="source-strip"><div class="source-cell"><span>Patient</span><b>${esc(displayName)}</b></div><div class="source-cell"><span>BHW ID</span><b>${esc(record.bhwPatientId || PATIENT_ID)}</b></div><div class="source-cell"><span>DOB / age</span><b>${esc(patient.birthDate || "not recorded")} / ${esc(ageText(patient.birthDate))}</b></div><div class="source-cell"><span>Record generated</span><b>${esc(dateText(record.generatedAt, true))}</b></div></div></div></section>`;
}

function safeNotice(context) {
  const { sourceOmitted, frontendOmitted } = context;
  return `<div class="safe-notice"><b>Safe pilot record:</b> locked to BHW0000 with no real-patient or production Firestore query. ${sourceOmitted} restricted source record(s) and ${frontendOmitted} additional presentation item(s) were withheld. Blank sections mean not documented or not connected - never "normal" or "absent."</div>`;
}

function overviewPageLegacy(context) {
  const { conditions, observations, reports, medications, encounters, unresolvedTasks, carePlans, goals, timeline, systems, clinicalImpressions, serviceRequests, resources, gaps, urgentItems, record, sourceOmitted, frontendOmitted } = context;
  const assessedSystems = systems.filter((item) => String(item.status || "").toLowerCase() !== "not-assessed").length;
  const latest = timeline[0];
  return `<section class="kpis">${[[conditions.length,"Conditions"],[observations.length+reports.length,"Results / reports"],[medications.length,"Medications"],[encounters.length,"Encounters"],[unresolvedTasks.length,"Open care work"],[resources.length,"FHIR resources"]].map(([value,label]) => `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`).join("")}</section><section class="overview-lead"><div class="panel"><div class="panel-head"><h3>Health 360 at a glance</h3><span class="badge neutral">Five-minute overview</span></div><div class="panel-body summary-list"><div class="summary-row"><b>Current priorities</b><span>${conditions.length ? esc(conditions.map((item) => conceptText(item.code)).join(" - ")) : "No condition priority has been returned."}</span></div><div class="summary-row"><b>Current treatment</b><span>${medications.length} medication(s), ${carePlans.length} care plan(s), ${unresolvedTasks.length} open care item(s).</span></div><div class="summary-row"><b>Latest turning point</b><span>${latest ? `${esc(latest.label || latest.type)} - ${esc(dateText(latest.date))}` : "No high-value timeline event is available."}</span></div><div class="summary-row"><b>Patient context</b><span>${serviceRequests.length ? `${serviceRequests.length} structured coordination request(s).` : "No structured social, lifestyle or referral summary is connected."}</span></div></div></div><div class="panel"><div class="panel-head"><h3>Safety and completeness</h3><span class="badge warning">Confirm at source</span></div><div class="panel-body summary-list"><div class="summary-row"><b>Escalation</b><span>${urgentItems.length ? `${urgentItems.length} structured urgent item(s) require review.` : "No structured escalation flag returned; this is not clinical clearance."}</span></div><div class="summary-row"><b>Data gaps</b><span>${gaps.length ? `Missing structured ${esc(gaps.join(", "))}.` : "Core digital categories are represented."}</span></div><div class="summary-row"><b>Withheld</b><span>${sourceOmitted + frontendOmitted} restricted or presentation item(s) withheld.</span></div><div class="summary-row"><b>Freshness</b><span>Generated ${esc(dateText(record.generatedAt, true))}; use Refresh for the latest Health Core record.</span></div></div></div></section>
  <section class="worksheet"><div class="worksheet-heading"><span class="section-number overview">360</span><h2>Explore the complete record</h2><p>Open only the detail needed for the current decision</p></div><div class="overview-grid">
    <article class="overview-card"><h3>Body-System Atlas</h3><p>Past, current and unresolved findings organized across the whole body.</p><div class="overview-facts"><span><b>${assessedSystems}</b> Health Core system summaries returned</span><span><b>${Math.max(14-assessedSystems,0)}</b> standard domains still unassessed</span></div><a class="btn primary" href="patient-360-atlas.html">Open body-system atlas</a></article>
    <article class="overview-card"><h3>Longitudinal Timeline</h3><p>High-value events and the future function-trajectory view.</p><div class="overview-facts"><span><b>${timeline.length}</b> timeline events</span><span>${latest ? `Latest: ${esc(latest.label || latest.type)}` : "No timeline event returned"}</span></div><a class="btn primary" href="patient-360-timeline.html">Open timeline</a></article>
    <article class="overview-card purple"><h3>PSCM Mechanism Map</h3><p>The clinician-validated physiologic story, alternatives and evidence boundaries.</p><div class="overview-facts"><span><b>${clinicalImpressions.length}</b> structured clinical impression(s)</span><span>${clinicalImpressions.length ? "Source review required" : "Mechanism synthesis not documented"}</span></div><a class="btn primary" href="patient-360-mechanism.html">Open mechanism map</a></article>
    <article class="overview-card green"><h3>Social & Lifestyle Context</h3><p>SDOH, feasibility, protective resources and change over time.</p><div class="overview-facts"><span>14 SDOH domains reserved</span><span><b>${serviceRequests.length}</b> structured referral or coordination request(s)</span></div><a class="btn primary" href="patient-360-context.html">Open context</a></article>
    <article class="overview-card coral"><h3>Snapshot & Care Plan</h3><p>What matters now, current care work, goals, ownership and next decisions.</p><div class="overview-facts"><span><b>${goals.length + carePlans.length}</b> goal or care-plan resource(s)</span><span><b>${unresolvedTasks.length}</b> open care item(s)</span></div><a class="btn primary" href="patient-360-plan.html">Open snapshot and plan</a></article>
    <article class="overview-card gold"><h3>Clinical Data</h3><p>The complete digital spine: problems, medicines, results, encounters and records.</p><div class="overview-facts"><span><b>${resources.length}</b> displayed FHIR resources</span><span><b>${observations.length + reports.length}</b> result or report resource(s)</span></div><a class="btn primary" href="patient-360-data.html">Open clinical data</a></article>
    <article class="overview-card"><h3>Sources & Boundaries</h3><p>Provenance, schema, withheld information and still-missing connections.</p><div class="overview-facts"><span>Schema ${esc(record.schemaVersion || "not supplied")}</span><span><b>${sourceOmitted + frontendOmitted}</b> withheld item(s)</span></div><a class="btn primary" href="patient-360-sources.html">Open sources</a></article>
  </div></section>`;
}

function itemContains(item, terms) {
  const haystack = JSON.stringify(item || {}).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function compactItems(items, formatter, empty, limit = 3) {
  if (!items.length) return `<p class="overview-empty">${esc(empty)}</p>`;
  return `<ul class="clinical-list">${items.slice(0, limit).map((item) => `<li>${formatter(item)}</li>`).join("")}</ul>${items.length > limit ? `<span class="more-note">+${items.length-limit} more in the detailed page</span>` : ""}`;
}

function trendGraphic(observations) {
  const numeric = observations.filter((item) => Number.isFinite(Number(item.valueQuantity?.value)));
  if (!numeric.length) return `<div class="trend-empty"><span>No numeric laboratory results are connected.</span></div>`;
  const focusLabel = conceptText(numeric[0].code);
  const series = numeric.filter((item) => conceptText(item.code) === focusLabel).sort((a,b) => new Date(a.effectiveDateTime || a.issued || 0) - new Date(b.effectiveDateTime || b.issued || 0));
  const values = series.map((item) => Number(item.valueQuantity.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max-min || 1;
  const points = values.map((value,index) => {
    const x = series.length === 1 ? 150 : 24 + (index * 252 / (series.length-1));
    const y = 92 - ((value-min)/range)*58;
    return [x,y];
  });
  const last = series.at(-1);
  return `<div class="trend-heading"><div><b>${esc(focusLabel)}</b><span>${esc(last.valueQuantity.value)} ${esc(last.valueQuantity.unit || "")}</span></div><span>${series.length > 1 ? `${series.length} trended results` : "1 result - trend needs another point"}</span></div><svg class="trend-svg" viewBox="0 0 300 120" role="img" aria-label="${esc(focusLabel)} result trend"><line x1="20" y1="96" x2="282" y2="96"/><line x1="20" y1="20" x2="20" y2="96"/><polyline points="${points.map(([x,y]) => `${x},${y}`).join(" ")}"/>${points.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join("")}</svg><div class="trend-foot"><span>${esc(dateText(series[0].effectiveDateTime || series[0].issued))}</span><span>${esc(dateText(last.effectiveDateTime || last.issued))}</span></div>`;
}

function patientBodyProfile(patient = {}) {
  const birthSex = patient.extension?.find((item) => String(item?.url || "").toLowerCase().includes("birthsex"))?.valueCode;
  const recordedSex = String(patient.sexAtBirth || patient.birthSex || birthSex || patient.gender || "").trim().toLowerCase();
  if (["f", "female"].includes(recordedSex)) return { sex: "female", label: "Female", asset: "patient-360-body-curved.png" };
  if (["m", "male"].includes(recordedSex)) return { sex: "male", label: "Male", asset: "patient-360-body-neutral.png" };
  return null;
}

const BODY_PROFILES = [
  { sex: "male", label: "Male", asset: "patient-360-body-neutral.png" },
  { sex: "female", label: "Female", asset: "patient-360-body-curved.png" },
];

function bodyFigure(context) {
  const activeSystems = context.systems.filter((item) => String(item.status || "").toLowerCase() !== "not-assessed");
  const focus = activeSystems[0];
  const bodyProfile = patientBodyProfile(context.patient);
  const bodyDisplay = bodyProfile
    ? `<input class="outline-radio" type="radio" name="body-view" id="body-view-front" checked><input class="outline-radio" type="radio" name="body-view" id="body-view-back"><div class="outline-picker" aria-label="Body view"><label for="body-view-front">Front</label><label for="body-view-back">Back</label></div><div class="body-image-stage ${bodyProfile.sex}" role="img" aria-label="${bodyProfile.label} body outline"><div class="body-image body-view-front"><img src="${bodyProfile.asset}" alt=""></div><div class="body-image body-view-back"><img src="${bodyProfile.asset}" alt=""></div><div class="body-focus-marker" aria-hidden="true"></div></div>`
    : `<input class="outline-radio" type="radio" name="body-view" id="body-view-front" checked><input class="outline-radio" type="radio" name="body-view" id="body-view-back"><div class="outline-picker" aria-label="Body view"><label for="body-view-front">Front</label><label for="body-view-back">Back</label></div><div class="body-outline-pair" role="group" aria-label="Male and female body outlines">${BODY_PROFILES.map((profile) => `<div class="body-outline-option"><span>${profile.label} outline</span><div class="body-mini-stage ${profile.sex}" role="img" aria-label="${profile.label} body outline"><div class="body-image body-view-front"><img src="${profile.asset}" alt=""></div><div class="body-image body-view-back"><img src="${profile.asset}" alt=""></div></div></div>`).join("")}</div>`;
  return `<div class="body-center"><div class="body-caption"><span>Whole-person atlas · ${esc(bodyProfile ? `${bodyProfile.label} outline` : "both outlines available")}</span><b>${activeSystems.length ? `${activeSystems.length} active system focus` : "No active system focus returned"}</b></div>${bodyDisplay}${bodyProfile ? "" : '<p class="body-outline-note">Gender or anatomy is not specified, so both outline sets remain available.</p>'}<div class="body-focus-copy"><b>${esc(focus?.label || "Body-system focus not documented")}</b><span>${esc(focus?.summary || "Open the atlas to review documented and unassessed systems.")}</span><a href="patient-360-atlas.html">Open full body-system atlas</a></div></div>`;
}

function evidenceCodes(value) {
  const source = typeof value === "string" ? value : compact([
    value?.status,
    value?.priority,
    value?.clinicalStatus?.coding?.[0]?.code,
    value?.verificationStatus?.coding?.[0]?.code,
  ]).join(" ");
  const status = String(source || "").toLowerCase();
  if (!status || status === "not-assessed") return [];
  const codes = new Set(["D"]);
  if (/suspect|provisional|differential|unconfirmed/.test(status)) codes.add("S");
  if (/historical|history|inactive/.test(status)) codes.add("H");
  if (/active|current|needs-attention/.test(status)) codes.add("A");
  if (/improv|remission/.test(status)) codes.add("I");
  if (/resolved|completed/.test(status)) codes.add("R");
  if (/urgent|critical|stat|asap|destabili/.test(status)) codes.add("U");
  return [...codes];
}

function evidencePills(codes) {
  const names = { D: "documented", S: "suspected", H: "historical", A: "active", I: "improving", R: "resolved", U: "urgent / destabilizing" };
  return `<span class="atlas-evidence-codes">${codes.map((code) => `<span title="${esc(names[code])}">${code}</span>`).join("")}</span>`;
}

function itemState(item) {
  return compact([
    item?.clinicalStatus?.coding?.[0]?.code,
    item?.verificationStatus?.coding?.[0]?.code,
    item?.status,
    item?.priority,
  ]).join(" ");
}

function resourceDomainText(item) {
  const extensions = Array.isArray(item?.extension) ? item.extension : [];
  const extensionValues = extensions.flatMap((entry) => compact([
    entry?.valueCode,
    entry?.valueString,
    entry?.valueCodeableConcept ? conceptText(entry.valueCodeableConcept) : "",
  ]));
  return compact([
    titleText(item),
    ...(Array.isArray(item?.physiologicDomains) ? item.physiologicDomains : []),
    item?.physiologicDomain,
    ...extensionValues,
  ]).join(" ").toLowerCase();
}

function matchesSystem(item, aliases) {
  const text = resourceDomainText(item);
  return aliases.some((alias) => text.includes(alias));
}

function sweepCell(entries, emptyText) {
  if (!entries.length) return `<span class="atlas-cell-empty">${esc(emptyText)}</span>`;
  const seen = new Set();
  return `<div class="atlas-sweep-items">${entries.filter((entry) => {
    const key = `${entry.text}|${entry.codes.join("")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4).map((entry) => `<div>${evidencePills(entry.codes)}<span>${esc(entry.text)}</span></div>`).join("")}</div>`;
}

function bodySystemSweepRows(context) {
  const definitions = [
    ["Brain / neurologic / cognition", ["brain", "neuro", "nervous system", "cognition", "stress regulation"]],
    ["Eyes / ears / ENT", ["eyes", "ears", "ent", "upper airway"]],
    ["Heart / vascular / lungs", ["heart", "vascular", "blood vessels", "circulation", "lungs", "cardiopulmonary"]],
    ["GI / liver / pancreas", ["gi", "gastro", "liver", "pancreas", "microbiome"]],
    ["Endocrine / metabolic", ["endocrine", "energy & metabolism", "metabolic", "hormone regulation"]],
    ["Renal / GU", ["renal", "kidney", "genitourinary", "urinary"]],
    ["Immune / inflammatory / infectious", ["immune", "inflamm", "infectious", "infection"]],
    ["Musculoskeletal / pain / spine", ["musculoskeletal", "pain", "spine", "joint", "muscle"]],
    ["Skin / barrier", ["skin", "hair", "barrier", "dermat"]],
    ["Reproductive / hormonal", ["reproductive", "sexual health", "gynec", "menstrual"]],
    ["Behavioral health / SUD", ["behavioral", "substance", "sud", "mental health"]],
    ["Whole-body / other", ["whole-body", "whole body", "other", "function"]],
  ];
  return definitions.map(([label, aliases]) => {
    const systems = context.systems.filter((system) => aliases.some((alias) => String(system.label || "").toLowerCase().includes(alias)));
    const relatedConditions = context.conditions.filter((condition) => matchesSystem(condition, aliases));
    const past = relatedConditions.filter((condition) => /resolved|inactive|remission|history/.test(itemState(condition).toLowerCase())).map((condition) => ({
      text: compact([conceptText(condition.code), condition.onsetDateTime ? `onset ${dateText(condition.onsetDateTime)}` : ""]).join(" · "),
      codes: evidenceCodes(itemState(condition) || "historical"),
    }));
    const now = [
      ...systems.filter((system) => String(system.status || "").toLowerCase() !== "not-assessed").map((system) => ({
        text: compact([system.summary, system.focus?.length ? `Focus: ${system.focus.join("; ")}` : ""]).join(" · ") || "Structured system entry returned without a summary.",
        codes: evidenceCodes(system.status || "documented"),
      })),
      ...relatedConditions.filter((condition) => !/resolved|inactive|remission|history/.test(itemState(condition).toLowerCase())).map((condition) => ({
        text: conceptText(condition.code),
        codes: evidenceCodes(itemState(condition) || "documented"),
      })),
    ];
    return `<tr><th scope="row">${esc(label)}</th><td>${sweepCell(past, "No distinct historical entry connected.")}</td><td>${sweepCell(now, "No current structured entry connected.")}</td></tr>`;
  }).join("");
}

function bodySiteTexts(item) {
  const sites = Array.isArray(item?.bodySite) ? item.bodySite : item?.bodySite ? [item.bodySite] : [];
  return sites.map((site) => typeof site === "string" ? site : conceptText(site)).filter((site) => site && site !== "Not labeled");
}

function locationEvents(context) {
  const events = [...context.conditions, ...context.observations, ...context.procedures].flatMap((item) => bodySiteTexts(item).map((location) => ({
    date: item.onsetDateTime || item.recordedDate || item.effectiveDateTime || item.performedDateTime || item.issued || item.authoredOn || "",
    location,
    finding: item.resourceType === "Condition" ? conceptText(item.code) : titleText(item),
    state: itemState(item) || "documented",
  })));
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.date}|${event.location}|${event.finding}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20).map((event, index) => ({ ...event, number: index + 1 }));
}

function bodyMarkerPosition(location) {
  const text = String(location || "").toLowerCase();
  const posterior = /posterior|back|spine|cervical|thoracic|lumbar|sacral/.test(text);
  let y = 170;
  if (/head|brain|skull|scalp|eye|ear|face/.test(text)) y = 38;
  else if (/neck|cervical|throat/.test(text)) y = 72;
  else if (/chest|thorax|thoracic|heart|lung|shoulder|breast/.test(text)) y = 116;
  else if (/abdomen|abdominal|stomach|liver|pancreas|gi/.test(text)) y = 170;
  else if (/pelvis|pelvic|hip|renal|kidney|bladder|reproductive|lumbar|sacral/.test(text)) y = 215;
  else if (/thigh|knee/.test(text)) y = 260;
  else if (/leg|calf|ankle|foot/.test(text)) y = 310;
  else if (/arm|elbow|wrist|hand/.test(text)) y = 160;
  const x = /\bleft\b/.test(text) ? 76 : /\bright\b/.test(text) ? 142 : 109;
  return { view: posterior ? "posterior" : "anterior", x, y };
}

function bodyMarkers(events, view) {
  return events.map((event) => ({ event, position: bodyMarkerPosition(event.location) })).filter(({ position }) => position.view === view).map(({ event, position }) => `<span class="atlas-map-marker" style="left:${position.x}px;top:${position.y}px" title="${esc(`${event.number}. ${event.location}: ${event.finding}`)}">${event.number}</span>`).join("");
}

function ctlsRegion(location) {
  const text = String(location || "").toLowerCase();
  if (/cervical|\bc[1-7]\b/.test(text)) return { label: "C", y: 60 };
  if (/thoracic|\bt(?:[1-9]|1[0-2])\b/.test(text)) return { label: "T", y: 142 };
  if (/lumbar|\bl[1-5]\b/.test(text)) return { label: "L", y: 238 };
  if (/sacral|sacrum|\bs[1-5]\b/.test(text)) return { label: "S", y: 306 };
  return null;
}

function ctlsSchematic(events) {
  const markers = events.map((event, index) => ({ event, region: ctlsRegion(event.location), index })).filter(({ region }) => region).map(({ event, region, index }) => `<g class="ctls-marker" transform="translate(${82 + (index % 3) * 15} ${region.y})"><circle r="10"></circle><text text-anchor="middle" y="3.5">${event.number}</text></g>`).join("");
  return `<svg class="ctls-map" viewBox="0 0 140 340" role="img" aria-label="Cervical thoracic lumbar sacral spine schematic"><path class="ctls-spine" d="M70 22 C54 48 62 78 70 98 C80 124 60 150 70 178 C81 207 58 235 69 263 C75 280 71 306 70 327"/><g class="ctls-segment"><rect x="28" y="28" width="28" height="58" rx="12"/><text x="42" y="61">C</text><rect x="28" y="96" width="28" height="91" rx="12"/><text x="42" y="146">T</text><rect x="28" y="197" width="28" height="75" rx="12"/><text x="42" y="239">L</text><rect x="28" y="282" width="28" height="44" rx="12"/><text x="42" y="309">S</text></g>${markers}</svg>`;
}

function anatomicalLocationMap(context) {
  const profile = patientBodyProfile(context.patient);
  const events = locationEvents(context);
  const profiles = profile ? [profile] : BODY_PROFILES;
  const bodyCards = profiles.flatMap((item) => [
    `<article class="atlas-map-card"><h4>${profile ? "Anterior" : `${item.label} · Anterior`}</h4><div class="atlas-anatomy-stage ${item.sex}"><div class="body-image atlas-anterior"><img src="${item.asset}" alt=""></div>${bodyMarkers(events, "anterior")}</div></article>`,
    `<article class="atlas-map-card"><h4>${profile ? "Posterior" : `${item.label} · Posterior`}</h4><div class="atlas-anatomy-stage ${item.sex}"><div class="body-image atlas-posterior"><img src="${item.asset}" alt=""></div>${bodyMarkers(events, "posterior")}</div></article>`,
  ]).join("");
  const rows = events.length ? events.map((event) => `<tr><td><span class="atlas-number-key">${event.number}</span></td><td>${esc(dateText(event.date))}</td><td>${esc(event.location)}</td><td>${esc(event.finding)}</td><td>${evidencePills(evidenceCodes(event.state))}<span>${esc(statusText(event.state))}</span></td></tr>`).join("") : `<tr><td colspan="5" class="atlas-table-empty">No structured anatomical body-site events are connected. Add only source-documented locations.</td></tr>`;
  return `<div class="atlas-map-grid">${bodyCards}<article class="atlas-map-card"><h4>CTLS <small>number each mark to the key</small></h4>${ctlsSchematic(events)}</article></div><div class="atlas-location-key"><h4>Location event key</h4><div class="table-wrap"><table class="atlas-location-table"><thead><tr><th>#</th><th>Date</th><th>Location</th><th>Event / finding</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function workflowVisitNotes(context) {
  const rows = Array.isArray(context.workflowEncounters) ? context.workflowEncounters : [];
  const withNotes = rows.filter((row) => String(row.note || "").trim());
  return {
    attached: withNotes.filter((row) => row.providerApproved),
    pendingCount: Math.max(0, Number(context.workflowConnection?.pendingDraftCount) || 0),
  };
}

function workflowNoteStatus(row) {
  if (row.charmDraftSaved) return "Provider approved · Charm draft saved; signing not confirmed here";
  if (row.providerApproved) return "Provider approved · Charm handoff pending";
  return "24-Hour Documentation draft · provider approval pending";
}

function visitDocumentationPanel(context, { full = false } = {}) {
  const { attached, pendingCount } = workflowVisitNotes(context);
  const connection = context.workflowConnection || {};
  let content = "";
  if (!connection.connected) {
    content = `<div class="empty-note"><b>24-Hour Documentation is not connected to this view.</b><br>${esc(connection.error || "Refresh after the protected encounter queue reconnects.")}</div>`;
  } else if (!attached.length) {
    content = `<div class="empty-note"><b>No provider-approved visit note is attached yet.</b><br>${pendingCount ? `${pendingCount} note draft(s) are still in 24-Hour Documentation review.` : "No matching note packet was returned for this BHW Patient ID."}</div>`;
  } else {
    content = `<div class="visit-note-list">${attached.slice(0, full ? attached.length : 3).map((row) => `<article class="visit-note-card"><div class="visit-note-head"><div><b>${esc(row.visitType || "Visit note")}</b><span>${esc(row.id || "Encounter ID unavailable")} · ${esc(dateText(row.completedAt, true))}</span></div><span class="badge complete">Attached</span></div><p>${esc(workflowNoteStatus(row))}</p>${full ? `<details><summary>View provider-approved note</summary><div class="visit-note-content">${esc(row.note)}</div></details>` : ""}</article>`).join("")}</div>${!full && attached.length > 3 ? `<span class="more-note">+${attached.length - 3} more attached note(s) in Clinical Data</span>` : ""}`;
  }
  return `<section class="panel visit-documentation"><div class="panel-head"><div><h3>Visit documentation</h3><span class="panel-subtitle">Automatically matched from the 24-Hour Work Queue by BHW Patient ID</span></div><a class="btn" href="workflow.html">Open 24-Hour Documentation</a></div><div class="panel-body">${content}<div class="record-boundary"><b>Record boundary</b><span>This is a read-only attachment for longitudinal review. CharmHealth remains the legal medical record; a saved Charm draft is not the same as a signed note.</span></div></div></section>`;
}

function overviewPage(context) {
  const { patient, conditions, observations, medications, encounters, tasks, carePlans, allergies, reports, goals, serviceRequests, clinicalImpressions, timeline, careTeams } = context;
  const activeMedications = medications.filter((item) => !["stopped","cancelled","completed","entered-in-error"].includes(String(item.status).toLowerCase()));
  const specialists = compact([
    ...careTeams.flatMap((team) => team.participant || []).map((participant) => participant.member?.display || participant.role?.[0]?.text),
    ...encounters.flatMap((encounter) => encounter.participant || []).map((participant) => participant.individual?.display),
  ]).filter((value,index,array) => array.indexOf(value) === index);
  const screenings = [...observations, ...reports, ...serviceRequests].filter((item) => itemContains(item,["screen","mammogram","colonoscopy","cervical","depression","preventive"]));
  const labDue = [...serviceRequests, ...tasks].filter((item) => itemContains(item,["laboratory","lab order","blood draw","recheck","repeat test","repeat panel"]));
  const nutrition = [...carePlans, ...goals, ...tasks].filter((item) => itemContains(item,["nutrition","diet","food plan","meal plan","weight management"]));
  const sdoh = [...observations, ...serviceRequests, ...tasks].filter((item) => itemContains(item,["housing","food insecurity","transportation","financial","caregiver","social determinant","utility"]));
  const triggers = [...clinicalImpressions, ...timeline].filter((item) => itemContains(item,["trigger","infection","stress","sleep loss","exposure","trauma","hormonal"]));
  const priorities = goals.length ? goals : conditions;
  const latestTimeline = timeline.slice(0,4);
  return `<section class="worksheet health-overview"><div class="worksheet-heading"><span class="section-number overview">360</span><h2>Whole-Person Health Snapshot</h2><p>What is active, important, due, and shaping this patient's health now</p></div>
    <div class="health360-map"><div class="health-column">
      <article class="health-callout coral"><div class="callout-head"><span>Active symptoms & diagnoses</span><a href="patient-360-data.html">Problem list</a></div>${compactItems(conditions,(item)=>`<b>${esc(conceptText(item.code))}</b><small>${esc(statusText(item.clinicalStatus?.coding?.[0]?.code || item.status || "recorded"))}</small>`,"No active condition or symptom record is connected.")}</article>
      <article class="health-callout teal"><div class="callout-head"><span>Active medications</span><a href="patient-360-data.html">Medications</a></div>${compactItems(activeMedications,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(item.dosageInstruction?.[0]?.text || "Directions not recorded")}</small>`,"No active medication request is connected.")}</article>
      <article class="health-callout gold"><div class="callout-head"><span>Allergies & intolerances</span><a href="patient-360-data.html">Allergies</a></div>${compactItems(allergies,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(item.criticality || "Criticality not recorded")}</small>`,"No allergy record is connected - this does not mean no known allergies.")}</article>
      <article class="health-callout purple"><div class="callout-head"><span>Individual priorities</span><a href="patient-360-plan.html">Care plan</a></div>${compactItems(priorities,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(item.description || "Patient-defined priority not separately documented")}</small>`,"Patient-defined priorities and functional goals are not documented.")}</article>
    </div>${bodyFigure(context)}<div class="health-column">
      <article class="health-callout teal"><div class="callout-head"><span>Specialists & care team</span><a href="patient-360-sources.html">Sources</a></div>${specialists.length ? `<ul class="clinical-list">${specialists.slice(0,4).map((name)=>`<li><b>${esc(name)}</b></li>`).join("")}</ul>` : `<p class="overview-empty">No specialist or CareTeam roster is connected.</p>`}</article>
      <article class="health-callout green"><div class="callout-head"><span>Screening & prevention</span><a href="patient-360-data.html">Results</a></div>${compactItems(screenings,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(dateText(item.effectiveDateTime || item.authoredOn || item.issued))}</small>`,"No structured health-screening status or due list is connected.")}</article>
      <article class="health-callout coral"><div class="callout-head"><span>SDOH needs</span><a href="patient-360-context.html">Context</a></div>${compactItems(sdoh,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(item.status || "recorded")}</small>`,"No structured SDOH need or protective resource is connected.")}</article>
      <article class="health-callout purple"><div class="callout-head"><span>Triggers & patterns</span><a href="patient-360-mechanism.html">Mechanism</a></div>${compactItems(triggers,(item)=>`<b>${esc(titleText(item))}</b><small>Requires clinician validation</small>`,"No clinician-validated triggers or amplifying patterns are documented.")}</article>
    </div></div>
    <div class="overview-clinical-grid"><section class="panel lab-panel"><div class="panel-head"><h3>Important labs & trends</h3><a class="btn" href="patient-360-data.html">All results</a></div><div class="panel-body">${trendGraphic(observations)}</div></section><section class="panel"><div class="panel-head"><h3>What is due next</h3><span class="badge warning">Verify orders</span></div><div class="panel-body due-grid"><div><span>Next laboratory work</span>${compactItems(labDue,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(dateText(item.occurrenceDateTime || item.authoredOn))}</small>`,"No next-lab order or due date is connected.",2)}</div><div><span>Screening or prevention</span>${compactItems(screenings,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(item.status || "recorded")}</small>`,"No screening due status is connected.",2)}</div></div></section></div>
    <div class="overview-clinical-grid"><section class="panel"><div class="panel-head"><h3>Nutrition & individualized plan</h3><a class="btn" href="patient-360-plan.html">Full care plan</a></div><div class="panel-body personalized-grid"><div><span>Nutrition plan</span>${compactItems(nutrition,(item)=>`<b>${esc(titleText(item))}</b><small>${esc(item.description || item.status || "recorded")}</small>`,"No structured individualized nutrition plan is connected.",2)}</div><div><span>Patient-specific details</span><ul class="clinical-list"><li><b>${esc(patient.gender && patient.gender !== "unknown" ? patient.gender : "Administrative gender not recorded")}</b><small>Identity details should remain patient-confirmed</small></li><li><b>${esc(carePlans[0] ? titleText(carePlans[0]) : "Health Blueprint not connected")}</b><small>Current individualized care framework</small></li></ul></div></div></section><section class="panel"><div class="panel-head"><h3>Prominent timeline</h3><a class="btn" href="patient-360-timeline.html">Full timeline</a></div><div class="panel-body prominent-timeline">${latestTimeline.length ? latestTimeline.map((event)=>`<div><time>${esc(dateText(event.date))}</time><span><b>${esc(event.label || event.type)}</b><small>${esc(event.type || "Clinical event")}</small></span></div>`).join("") : `<p class="overview-empty">No high-value timeline events are connected.</p>`}</div></section></div>
    ${visitDocumentationPanel(context)}
  </section>`;
}

function atlasPage(context) {
  const patientGoals = context.goals.filter((goal) => String(goal.expressedBy?.reference || "").startsWith("Patient/"));
  const primaryConcern = patientGoals.length
    ? patientGoals.map(titleText).join(" · ")
    : context.conditions.length
      ? `Patient's own words are not connected. Active coded concern(s): ${context.conditions.slice(0, 3).map((item) => conceptText(item.code)).join(" · ")}`
      : "No patient-authored concern or active coded problem is connected.";
  const goalSummary = patientGoals.length
    ? patientGoals.map(titleText).join(" · ")
    : context.goals.length
      ? `Structured goal(s) exist, but patient authorship is not identified: ${context.goals.slice(0, 3).map(titleText).join(" · ")}`
      : "No patient-defined function, participation, symptom or quality-of-life goal is connected.";
  const functionItems = context.observations.filter((item) => /function|mobility|activity|participation|adl|promis|ability/.test(titleText(item).toLowerCase()));
  const functionSummary = functionItems.length ? functionItems.slice(0, 3).map((item) => `${titleText(item)} · ${observationDetail(item)}`).join(" · ") : "No structured functional change measure is connected.";
  const safetySummary = context.urgentItems.length ? context.urgentItems.slice(0, 4).map((item) => `${titleText(item)} · ${statusText(item.priority || item.status)}`).join(" · ") : "No structured urgent or destabilizing flag was returned. This is not clinical clearance; verify red flags and rapid change directly.";
  const evidenceKey = [["D","documented"],["S","suspected"],["H","historical"],["A","active"],["I","improving"],["R","resolved"],["U","urgent / destabilizing"]];
  return `<section class="worksheet atlas-worksheet"><div class="worksheet-heading"><span class="section-number">1</span><h2>Patient History & Body-System Atlas</h2><p>Map the patient's story from concern and function to location, time and system involvement</p></div><div class="atlas-intake-grid"><article class="atlas-prompt-card"><span>Primary concern / reason for mapping</span><b>${esc(primaryConcern)}</b><small>Patient's words; problem requiring longitudinal review</small></article><article class="atlas-prompt-card"><span>Patient-defined goals</span><b>${esc(goalSummary)}</b><small>Function, participation, symptoms or quality-of-life priorities</small></article><article class="atlas-prompt-card"><span>Current functional change</span><b>${esc(functionSummary)}</b><small>What is newly limited, declining, fluctuating or improved?</small></article><article class="atlas-prompt-card urgent"><span>Safety / urgent concerns</span><b>${esc(safetySummary)}</b><small>Red flags, rapid change, instability or required escalation</small></article></div><section class="panel atlas-map-panel"><div class="panel-head"><h3>Anatomical location map</h3><span class="badge neutral">Number documented marks to the key</span></div><div class="panel-body">${anatomicalLocationMap(context)}</div></section><section class="panel atlas-sweep-panel"><div class="panel-head"><h3>Body-system sweep</h3><span class="badge neutral">Past and now</span></div><div class="panel-body"><div class="table-wrap"><table class="atlas-sweep-table"><thead><tr><th>Body system</th><th>Past</th><th>Now</th></tr></thead><tbody>${bodySystemSweepRows(context)}</tbody></table></div></div></section><div class="atlas-evidence-key"><b>Evidence key</b>${evidenceKey.map(([code, label]) => `<span><strong>${code}</strong>${esc(label)}</span>`).join("")}</div></section>`;
}

function timelinePage(context) {
  return `<section class="worksheet"><div class="worksheet-heading"><span class="section-number">2</span><h2>Layered Longitudinal Timeline</h2><p>High-value turning points with source-aware clinical context</p></div><div class="two-col"><div class="panel"><div class="panel-head"><h3>Function trajectory</h3><span class="badge warning">Awaiting measures</span></div><div class="panel-body"><div class="trajectory"></div><div class="trajectory-labels"><span>Improved</span><span>Baseline</span><span>Declined</span></div><div class="empty-note" style="margin-top:12px">Future digital layer: graph patient-reported function, symptom burden, objective measures and major interventions without turning association into causation.</div></div></div><div class="panel"><div class="panel-head"><h3>Clinical timeline</h3><span class="meta">Newest first</span></div><div class="panel-body timeline">${timelineItems(context.timeline)}</div></div></div></section>`;
}

function mechanismPage(context) {
  return `<section class="worksheet"><div class="worksheet-heading"><span class="section-number purple">3</span><h2>PSCM Mechanism Map</h2><p>A testable physiologic story, not a diagnosis generator</p></div><div class="panel"><div class="panel-head"><h3>Mechanism sequence</h3><span class="badge warning">Clinician validation required</span></div><div class="panel-body">${mechanismMap(context.clinicalImpressions)}<div class="two-col" style="margin-top:15px"><div class="empty-note"><b>Working PSCM synthesis</b><br>${context.clinicalImpressions.length ? esc(context.clinicalImpressions.map(titleText).join(" - ")) : "No clinician-validated mechanism synthesis has been returned."}</div><div class="empty-note"><b>Alternative explanations / disconfirming evidence</b><br>No structured alternatives have been returned.</div></div></div></div></section>`;
}

function contextPage(context) {
  return `<section class="worksheet"><div class="worksheet-heading"><span class="section-number green">4</span><h2>Social, Lifestyle & Recovery Context</h2><p>Barriers, protective resources, feasibility and reserve</p></div><div class="two-col"><div class="panel"><div class="panel-head"><h3>Social determinants of health</h3><span class="badge warning">Not yet connected</span></div><div class="panel-body domain-grid">${contextDomains()}</div></div><div class="panel"><div class="panel-head"><h3>Context synthesis</h3><span class="badge neutral">Clinical feasibility</span></div><div class="panel-body snapshot-grid"><div class="snapshot"><h4>Most consequential change over time</h4><p>Not documented.</p></div><div class="snapshot"><h4>Current feasibility barriers</h4><p>Not documented.</p></div><div class="snapshot green"><h4>Protective routines and relationships</h4><p>Not documented.</p></div><div class="snapshot blue"><h4>Resource or referral required</h4><p>${context.serviceRequests.length ? esc(context.serviceRequests.map(titleText).join(" - ")) : "Not documented."}</p></div></div></div></div><div class="panel" style="margin-top:15px"><div class="panel-head"><h3>Lifestyle: then vs. now</h3><span class="badge warning">Longitudinal fields reserved</span></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>Domain</th><th>Previous pattern</th><th>Current pattern</th><th>Clinical effect / barrier / protective factor</th></tr></thead><tbody>${lifestyleDomains()}</tbody></table></div></div></div></section>`;
}

function planPage(context) {
  const { conditions, urgentItems, medications, unresolvedTasks, carePlans, gaps, serviceRequests, goals, tasks } = context;
  return `<section class="worksheet"><div class="worksheet-heading"><span class="section-number coral">5</span><h2>Current Snapshot & Feasible Care Plan</h2><p>The five-minute team huddle view</p></div><div class="two-col"><div class="panel"><div class="panel-head"><h3>Current patient snapshot</h3><span class="badge neutral">Documented facts only</span></div><div class="panel-body snapshot-grid"><div class="snapshot"><h4>What matters most now</h4><p>${conditions.length ? esc(conditions.map((item) => conceptText(item.code)).join(" - ")) : "No condition priority has been returned."}</p></div><div class="snapshot coral"><h4>Active destabilizers / escalation</h4><p>${urgentItems.length ? esc(urgentItems.map(titleText).join(" - ")) : "No structured escalation flag returned. Verify clinically."}</p></div><div class="snapshot green"><h4>Protective compensations / resources</h4><p>No structured protective resource has been returned.</p></div><div class="snapshot"><h4>Current treatment and care work</h4><p>${compact([medications.length ? `${medications.length} medication(s)` : "", unresolvedTasks.length ? `${unresolvedTasks.length} open task(s)` : "", carePlans.length ? `${carePlans.length} care plan(s)` : ""]).join(" - ") || "No active treatment item has been returned."}</p></div><div class="snapshot"><h4>Unanswered questions / data gaps</h4><p>${gaps.length ? esc(`Missing structured ${gaps.join(", ")}.`) : "Core digital categories are represented."}</p></div><div class="snapshot blue"><h4>Required coordination</h4><p>${serviceRequests.length ? esc(serviceRequests.map(titleText).join(" - ")) : "No structured referral or coordination request has been returned."}</p></div></div></div><div class="panel"><div class="panel-head"><h3>Care plan and goals</h3><span class="badge complete">Source-linked</span></div><div class="panel-body">${list([...goals, ...carePlans, ...tasks], (item) => renderResourceItem(item, compact([item.resourceType, item.status, item.intent]).join(" - ")), "No structured goals, care plans or tasks are available.")}</div></div></div><div class="panel" style="margin-top:15px"><div class="panel-head"><h3>Ideal plan vs. feasible next step</h3><span class="badge warning">Do not infer missing ownership</span></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>PSCM target</th><th>Documented clinical plan</th><th>Feasible next step / resource</th><th>Owner / timing</th></tr></thead><tbody>${careRows(carePlans, tasks, goals)}</tbody></table></div></div></div></section>`;
}

function dataPage(context) {
  const { conditions, medications, allergies, observations, reports, procedures, immunizations, documents, encounters, serviceRequests, tasks, carePlans, goals } = context;
  return `<section class="worksheet"><div class="worksheet-heading"><span class="section-number gold">6</span><h2>Digital Clinical Data Spine</h2><p>The complete structured record behind the overview</p></div>${visitDocumentationPanel(context, { full: true })}<div class="data-grid">${dataCard("Conditions & problem list", conditions, (item) => renderResourceItem(item, compact([item.clinicalStatus?.coding?.[0]?.code, item.verificationStatus?.coding?.[0]?.code, item.onsetDateTime ? `onset ${dateText(item.onsetDateTime)}` : ""]).join(" - ")), "No condition resource is connected.")}${dataCard("Medications", medications, (item) => renderResourceItem(item, medicationDetail(item)), "No medication requests are available.")}${dataCard("Allergies & intolerances", allergies, (item) => renderResourceItem(item, compact([item.clinicalStatus?.coding?.[0]?.code, item.criticality]).join(" - ")), "No allergy resource is connected.")}${dataCard("Results & trends", [...observations, ...reports], (item) => renderResourceItem(item, item.resourceType === "Observation" ? observationDetail(item) : compact([item.status, dateText(item.effectiveDateTime)]).join(" - ")), "No result or diagnostic report is connected.")}${dataCard("Procedures & imaging", procedures, (item) => renderResourceItem(item, compact([item.status, dateText(item.performedDateTime)]).join(" - ")), "No procedure or imaging resource is connected.")}${dataCard("Immunizations", immunizations, (item) => renderResourceItem(item, compact([item.status, dateText(item.occurrenceDateTime)]).join(" - ")), "No immunization resource is connected.")}${dataCard("Documents & provenance", documents, (item) => renderResourceItem(item, compact([item.status, dateText(item.date)]).join(" - ")), "No source document reference is connected.")}${dataCard("Encounters", encounters, (item) => renderResourceItem(item, compact([item.status, dateText(item.period?.start)]).join(" - ")), "No encounter resource is connected.")}${dataCard("Orders, referrals & tasks", [...serviceRequests, ...tasks], (item) => renderResourceItem(item, compact([item.resourceType, item.status, item.intent]).join(" - ")), "No structured order, referral or task is connected.")}${dataCard("Care plans & goals", [...carePlans, ...goals], (item) => renderResourceItem(item, compact([item.resourceType, item.status, item.intent]).join(" - ")), "No care-plan or goal resource is connected.")}</div></section>`;
}

function sourcesPage(context) {
  const { record, resources, sourceOmitted, frontendOmitted } = context;
  return `<section class="worksheet"><div class="worksheet-heading"><span class="section-number">7</span><h2>Source Integrity & Record Boundaries</h2><p>What is connected, withheld, validated and still missing</p></div><div class="panel"><div class="panel-head"><h3>FHIR bundle and provenance</h3>${badge("source traceability")}</div><div class="panel-body"><div class="source-strip"><div class="source-cell"><span>Bundle type</span><b>${esc(record.fhir?.type || "not supplied")}</b></div><div class="source-cell"><span>Schema version</span><b>${esc(record.schemaVersion || "not supplied")}</b></div><div class="source-cell"><span>Displayed resources</span><b>${resources.length}</b></div><div class="source-cell"><span>Restricted / withheld</span><b>${sourceOmitted + frontendOmitted}</b></div></div><div class="empty-note" style="margin-top:14px"><b>Future longitudinal connections:</b> verified EHR encounters, CRISP events, medications and fill history, payer data, laboratory and imaging feeds, vital trends, immunizations, referrals, documents, patient-reported outcomes, SDOH, care-team validation, source timestamps, corrections and consent boundaries.</div></div></div></section>`;
}

function render(record, workflowConnection = { connected: false, encounters: [] }) {
  const view = document.body.dataset.p360View || "overview";
  const originalResources = allResources(record);
  const resources = originalResources.filter(isDisplayable);
  const rawTimeline = Array.isArray(record.timeline) ? record.timeline : [];
  const timeline = rawTimeline.filter(isDisplayable);
  const frontendOmitted = (originalResources.length - resources.length) + (rawTimeline.length - timeline.length);
  const patient = resourcesOf(resources, "Patient")[0] || {};
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
  const careTeams = resourcesOf(resources, "CareTeam");
  const systems = Array.isArray(record.systems) ? record.systems.filter(isDisplayable) : [];
  const unresolvedTasks = tasks.filter((item) => !["completed", "cancelled", "failed", "rejected"].includes(String(item.status).toLowerCase()));
  const urgentItems = resources.filter((item) => ["stat", "asap", "urgent", "critical"].includes(String(item.priority || item.status).toLowerCase()));
  const gaps = [[allergies.length,"allergies"],[immunizations.length,"immunizations"],[procedures.length,"procedures"],[documents.length,"source documents"],[clinicalImpressions.length,"clinician mechanism synthesis"]].filter(([count]) => !count).map(([, label]) => label);
  const sourceOmitted = Number(record.restrictedRecordsOmitted || 0);
  const displayName = normalizePatientName(patient.name?.[0] || {});
  const context = { record, resources, patient, displayName, conditions, observations, medications, encounters, tasks, carePlans, systems, allergies, reports, procedures, immunizations, documents, goals, serviceRequests, clinicalImpressions, careTeams, unresolvedTasks, urgentItems, timeline, frontendOmitted, sourceOmitted, gaps, workflowConnection, workflowEncounters: workflowConnection.encounters || [] };
  const pageRenderers = { overview: overviewPage, atlas: atlasPage, timeline: timelinePage, mechanism: mechanismPage, context: contextPage, plan: planPage, data: dataPage, sources: sourcesPage };
  const header = view === "overview" ? fullHero(context) : compactHeader(context);
  $("content").innerHTML = `${header}${pageNavigation(view)}${safeNotice(context)}${(pageRenderers[view] || overviewPage)(context)}`;
}

async function load() {
  $("status").className = "badge warning";
  $("status").textContent = "Loading...";
  try {
    const client = await createEncounterCloudClient();
    if (!client) throw new Error("Google Cloud is not configured for this site.");
    const body = await client.healthRecord(PATIENT_ID);
    if (!body?.healthRecord) throw new Error("The synthetic Health Core record was not returned.");
    let workflowConnection = { connected: true, encounters: [] };
    try {
      const result = await client.patientVisitNotes(PATIENT_ID);
      workflowConnection.encounters = Array.isArray(result.visitNotes) ? result.visitNotes : [];
      workflowConnection.pendingDraftCount = Math.max(0, Number(result.pendingDraftCount) || 0);
    } catch (error) {
      workflowConnection = {
        connected: false,
        encounters: [],
        error: error.status === 404
          ? "The patient-specific note connection is waiting for the RCM API update."
          : (error.message || "The encounter queue could not be read."),
      };
    }
    render(body.healthRecord, workflowConnection);
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
$("refresh").onclick = load;
$("print").onclick = () => window.print();
if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";
load();

