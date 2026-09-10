import { CREW_SESSION_EXPIRED, createEncounterCloudClient } from "./cloud-queue.mjs";

const requestedPatientId = new URLSearchParams(location.search).get("patient") || "";
const PATIENT_ID = /^BHW\d{4}$/.test(requestedPatientId) ? requestedPatientId : "BHW0000";
const THEME_KEY = "bhw_provider_theme_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const list = (value) => Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
const label = (value) => String(value || "not assessed").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

let client = null;
let workspace = null;
let activeEvaluation = null;
let formDirty = false;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const control = $("theme");
  if (control) {
    const dark = theme === "dark";
    control.textContent = dark ? "Light Opal" : "Black Opal";
    control.setAttribute("aria-pressed", String(dark));
    control.setAttribute("aria-label", dark ? "Switch to Light Opal theme" : "Switch to Black Opal theme");
  }
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
}

function initialTheme() {
  try { return localStorage.getItem(THEME_KEY) || "light"; } catch { return "light"; }
}

function setConnection(text, state = "warning") {
  const node = $("connection-status");
  node.textContent = text;
  node.className = `badge ${state}`;
}

function setSaveState(text, state, detail = "") {
  const node = $("save-state");
  node.textContent = text;
  node.dataset.state = state;
  if (detail) $("save-detail").textContent = detail;
}

function setReviewReadiness(evaluation) {
  const node = $("review-readiness");
  const readiness = evaluation?.reviewReadiness;
  if (!readiness) {
    node.dataset.state = "not-evaluated";
    node.innerHTML = "<b>Approval readiness not evaluated</b><span>Run a preview to identify required patient-reported and chart fields.</span>";
    return;
  }
  if (readiness.approvalReady) {
    node.dataset.state = "ready";
    node.innerHTML = "<b>Ready for clinician review</b><span>Minimum patient-reported and chart review fields are complete. Safety gates and source reconciliation still apply.</span>";
    return;
  }
  const missing = list(readiness.missingRequiredFacts).map((item) => item.label || label(item.fact)).filter(Boolean);
  node.dataset.state = "incomplete";
  node.innerHTML = `<b>Incomplete—approval blocked</b><span>Complete: ${esc(missing.join(", ") || "the required patient-reported and chart review fields")}.</span>`;
}

function readElement(element) {
  if (element.type === "checkbox") return element.checked;
  if (element.tagName === "SELECT" && element.multiple) return [...element.selectedOptions].map((option) => option.value).filter(Boolean);
  if (element.dataset.list !== undefined) return element.value.split(",").map((item) => item.trim()).filter(Boolean);
  if (element.type === "number") return element.value === "" ? undefined : Number(element.value);
  return element.value === "" ? undefined : element.value;
}

function collectFacts() {
  const patientReported = {};
  const chartFacts = {};
  const grouped = new Set();
  for (const element of document.querySelectorAll("[data-fact]")) {
    const key = element.dataset.fact;
    const target = element.dataset.source === "chart" ? chartFacts : patientReported;
    if (element.dataset.array !== undefined) {
      if (grouped.has(`${element.dataset.source}:${key}`)) continue;
      grouped.add(`${element.dataset.source}:${key}`);
      target[key] = [...document.querySelectorAll(`[data-fact="${CSS.escape(key)}"][data-source="${element.dataset.source}"][data-array]`)]
        .filter((item) => item.checked).map((item) => item.value);
      continue;
    }
    const value = readElement(element);
    if (value !== undefined) target[key] = value;
  }
  const inputFacts = { ...patientReported, ...chartFacts };
  if (inputFacts.confirmed_gi_condition_codes?.includes("lactose_intolerance")) inputFacts.confirmed_lactose_intolerance = true;
  if (inputFacts.confirmed_gi_condition_codes?.includes("documented_gastroparesis")) inputFacts.confirmed_gastroparesis = true;
  if (inputFacts.confirmed_gi_condition_codes?.includes("confirmed_celiac_disease")) inputFacts.confirmed_celiac_disease = true;
  inputFacts.food_first_requested = ["prefer_food_first", "open_to_food_and_supplements", "depends_on_goal"].includes(inputFacts.food_first_preference);
  inputFacts.food_first_willing_sources_present = inputFacts.food_first_requested;
  inputFacts.food_first_candidate_eligible = inputFacts.food_first_requested;
  inputFacts.fortified_food_candidate_eligible = inputFacts.food_first_requested;
  inputFacts.any_gi_alarm = ["blood_visible", "black_tarry", "persistent_vomiting", "unable_to_retain_fluids", "severe_or_progressive_pain", "jaundice"].some((key) => inputFacts[key] === true);
  return {
    patientRef: PATIENT_ID,
    schemaVersion: "1.3.0",
    questionnaireVersion: "1.3.0",
    sourceModel: "questionnaire-reflects-real-life_chart-reflects-physiology_intelligence-reconciles-both",
    patientReported,
    chartFacts,
    inputFacts,
    provenance: {
      patientReported: { sourceType: "clinician-entered-patient-report", sourceApplication: "BHW Clinical Intelligence", reliability: "reported" },
      chart: { sourceType: "Health Core chart reconciliation", sourceApplication: "BHW Clinical Intelligence", reliability: "clinician-reviewed-before-approval" },
    },
  };
}

function setElementValue(element, value) {
  if (element.dataset.array !== undefined) {
    element.checked = list(value).includes(element.value);
  } else if (element.type === "checkbox") {
    element.checked = value === true;
  } else if (element.tagName === "SELECT" && element.multiple) {
    for (const option of element.options) option.selected = list(value).includes(option.value);
  } else if (element.dataset.list !== undefined) {
    element.value = list(value).join(", ");
  } else if (value !== undefined && value !== null) {
    element.value = value;
  }
}

function populateForm(content = {}) {
  const facts = content.inputFacts || { ...(content.patientReported || {}), ...(content.chartFacts || {}) };
  for (const element of document.querySelectorAll("[data-fact]")) setElementValue(element, facts[element.dataset.fact]);
  formDirty = false;
}

function targetText(target = {}) {
  if (target.status === "blocked") return "Blocked pending clinical review";
  if (target.low != null && target.high != null) return `${target.low.toLocaleString()}–${target.high.toLocaleString()} ${target.unit || ""}`.trim();
  if (target.existingFluidOrderMlDay != null) return `Existing order: ${target.existingFluidOrderMlDay.toLocaleString()} mL/day`;
  return label(target.status || "needs data");
}

function chips(values) {
  return list(values).length ? `<div class="code-list">${list(values).map((item) => `<span class="code-chip">${esc(label(item))}</span>`).join("")}</div>` : '<div class="empty-note">None supported by the current inputs.</div>';
}

function gateList(gates) {
  if (!gates?.length) return '<div class="result-item good"><b>No open structured safety gate</b><p>This is not a clinical clearance. Confirm the source record and missing information.</p></div>';
  return gates.map((item) => `<div class="gate-block"><b>${esc(label(item.gateCode))} · ${esc(label(item.severity))}</b><p>${esc(item.reason)}</p><p><b>Blocked:</b> ${esc(item.blockedScopes.map(label).join(", "))}</p></div>`).join("");
}

function foodSources(plan = {}) {
  if (!plan.sourceGroups?.length) return '<div class="empty-note">No food-first source group is ready from the current inputs.</div>';
  return plan.sourceGroups.map((item) => `<article class="food-source"><h4>${esc(item.displayName)}</h4><p>${esc(item.benefitBoundary)}</p><b class="field-label">Natural and fortified sources</b><ul>${item.foodExamples.slice(0, 8).map((example) => `<li>${esc(example)}</li>`).join("")}</ul><p><b>Preparation fit:</b> ${esc(item.preparationOptions.slice(0, 4).join("; "))}</p></article>`).join("");
}

function taskItems(tasks = []) {
  return tasks.length ? tasks.map((item) => `<div class="result-item warning"><b>${esc(label(item.taskType))}</b><p>${esc(label(item.priority))} priority · due within ${esc(item.dueWithinHours)} hour(s) after approval · proposal only</p><small>${esc(item.reasonCodes.map(label).join(", "))}</small></div>`).join("") : '<div class="empty-note">No operational task proposal from the current inputs.</div>';
}

function kidneyDecisionText(decision = {}) {
  if (decision.status === "blocked") return `${label(decision.direction || "blocked")} · no target released`;
  if (decision.status === "follow-existing-plan" && decision.target != null) return `${label(decision.direction)} · ${Number(decision.target).toLocaleString()} ${decision.unit || ""}`.trim();
  const anchor = decision.referenceAnchor != null ? ` · review anchor ${Number(decision.referenceAnchor).toLocaleString()} ${decision.unit || ""}` : "";
  return `${label(decision.direction || decision.status)}${anchor}`;
}

function kidneyPanel(kidney = {}) {
  if (!kidney || kidney.status === "not-applicable") {
    return '<section class="panel kidney-result"><div class="panel-head"><h3>Kidney nutrition</h3><span class="badge neutral">Not applicable</span></div><div class="panel-body"><div class="empty-note">No chart-confirmed kidney pathway is active in this preview.</div></div></section>';
  }
  const decisions = kidney.nutrientDecisions || {};
  const missing = kidney.dataCompleteness?.missingFacts || [];
  return `<section class="panel kidney-result"><div class="panel-head"><div><h3>Kidney nutrition pathway</h3><span class="panel-subtitle">Module ${esc(kidney.moduleVersion || "1.0.0")} · chart physiology controls clinical decisions</span></div><span class="badge warning">Clinical + renal-RDN approval pending</span></div><div class="panel-body result-list">
    <div class="kidney-summary"><div><span>Pathway</span><b>${esc(label(kidney.pathway))}</b></div><div><span>CKD stage</span><b>${esc(kidney.ckdStage || "Not applicable")}</b></div><div><span>Albuminuria</span><b>${esc(kidney.albuminuriaStatus || "Not assessed")}</b></div><div><span>Data readiness</span><b>${esc(label(kidney.dataCompleteness?.status))}</b></div></div>
    ${missing.length ? `<div class="gate-block"><b>Kidney plan needs current chart context</b><p>${esc(missing.map(label).join(", "))}</p></div>` : ""}
    <div class="kidney-decisions">${["energy", "protein", "sodium", "potassium", "phosphorus", "fluid"].map((code) => `<div class="result-item"><b>${esc(label(code))}</b><p>${esc(kidneyDecisionText(decisions[code]))}</p><small>${esc(list(decisions[code]?.rationaleCodes).map(label).join(" · "))}</small></div>`).join("")}</div>
    <div class="result-item"><b>Food-first and natural-source strategies</b>${chips(kidney.foodStrategyCodes)}<small>Suggestions must preserve culture, sensory-safe foods, affordability, GI tolerance, and adequacy. Normal potassium or phosphorus does not justify a blanket restriction.</small></div>
    <div class="result-item"><b>Supplement and shake safety</b>${chips(kidney.supplementSafetyCodes)}<small>No product is automatically selected or called kidney safe.</small></div>
    <div class="result-item"><b>Monitoring</b>${chips(kidney.monitoringCodes)}</div>
    <div class="natural-disclosure"><b>Publication boundary:</b> This kidney plan is clinician-only synthetic review material. It cannot enter Patient 360, the Personal Health Blueprint, or printable education until the kidney module has both clinical-owner and renal-RDN approval.</div>
  </div></section>`;
}

function renderEvaluation(evaluation, sourceStatus = "Preview only") {
  activeEvaluation = evaluation;
  setReviewReadiness(evaluation);
  const gates = evaluation.safetyGates || [];
  const blueprint = evaluation.projections?.personalHealthBlueprint || {};
  $("results").innerHTML = `
    <section class="panel"><div class="panel-head"><div><h3>Nutrition Intelligence synthesis</h3><span class="panel-subtitle">${esc(sourceStatus)} · ruleset ${esc(evaluation.rulesetVersion)}</span></div>${gates.length ? `<span class="badge warning">${gates.length} safety gate${gates.length === 1 ? "" : "s"}</span>` : '<span class="badge complete">No open structured gate</span>'}</div><div class="panel-body">
      <div class="result-summary"><div><span>Energy direction</span><b>${esc(label(evaluation.energyDirection))}</b></div><div><span>Base pattern</span><b>${esc(label(evaluation.dietaryPattern?.selectedBasePattern))}</b></div><div><span>Protein target</span><b>${esc(targetText(evaluation.targets?.protein))}</b></div><div><span>Hydration target</span><b>${esc(targetText(evaluation.targets?.hydration))}</b></div></div>
      <div class="natural-disclosure" style="margin-top:12px"><b>Food-first boundary:</b> ${esc(evaluation.foodFirst?.disclosure || "Natural sources still require patient-specific safety and sufficiency review.")}</div>
    </div></section>
    <div class="result-grid">
      <section class="panel"><div class="panel-head"><h3>Safety gates</h3><span class="badge ${gates.length ? "warning" : "neutral"}">Runs first</span></div><div class="panel-body result-list">${gateList(gates)}</div></section>
      <section class="panel"><div class="panel-head"><h3>Phenotypes—not diagnoses</h3><span class="badge neutral">Evidence-linked</span></div><div class="panel-body">${chips(evaluation.phenotypeCodes)}</div></section>
      ${kidneyPanel(evaluation.kidney)}
      <section class="panel"><div class="panel-head"><h3>GI and BHW 5R</h3><span class="badge neutral">Existing Blueprint model</span></div><div class="panel-body result-list"><div class="result-item"><b>Presentation profiles</b>${chips(evaluation.gi?.presentationProfiles)}</div><div class="result-item"><b>Confirmed chart conditions</b>${chips(evaluation.gi?.confirmedConditions)}</div><div class="result-item"><b>Eligible GI actions</b>${chips(evaluation.gi?.eligibleInterventions)}</div><div class="result-item"><b>5R candidates</b>${chips(evaluation.gi?.fiveR?.candidates)}<small>Steps are optional clinical lenses—not a universal sequence or diagnosis.</small></div></div></section>
      <section class="panel"><div class="panel-head"><h3>Dietary pattern and targets</h3><span class="badge neutral">Clinician review</span></div><div class="panel-body result-list"><div class="result-item"><b>Overlays and modifiers</b>${chips(evaluation.dietaryPattern?.overlays)}</div><div class="result-item"><b>Energy</b><p>${esc(targetText(evaluation.targets?.energy))}</p></div><div class="result-item"><b>Protein</b><p>${esc(targetText(evaluation.targets?.protein))}</p></div><div class="result-item"><b>Carbohydrate</b><p>${esc(targetText(evaluation.targets?.carbohydrate))}</p></div><div class="result-item"><b>Fat</b><p>${esc(targetText(evaluation.targets?.fat))}</p></div><div class="result-item"><b>Fiber</b><p>${esc(targetText(evaluation.targets?.fiber))}</p></div><div class="result-item"><b>Hydration</b><p>${esc(targetText(evaluation.targets?.hydration))}</p></div></div></section>
      <section class="panel"><div class="panel-head"><h3>Natural and food-first sources</h3><span class="badge neutral">Filter, then rank</span></div><div class="panel-body result-list">${foodSources(evaluation.foodFirst)}</div></section>
      <section class="panel"><div class="panel-head"><h3>Supplement and shake escalation</h3><span class="badge warning">No automatic product</span></div><div class="panel-body"><div class="result-item"><b>${esc(label(evaluation.supplementEscalation?.status))}</b>${chips(evaluation.supplementEscalation?.sequence)}<small>Exact product, dose, interactions, contraindications, duration, outcome, and stop rules require review.</small></div></div></section>
      <section class="panel"><div class="panel-head"><h3>Proposed interventions</h3><span class="badge neutral">Not yet published</span></div><div class="panel-body">${chips(evaluation.interventions)}</div></section>
      <section class="panel"><div class="panel-head"><h3>CrewOS work proposals</h3><span class="badge warning">Created only after governed publication</span></div><div class="panel-body result-list">${taskItems(evaluation.taskProposals)}</div></section>
      <section class="panel"><div class="panel-head"><h3>Patient 360 and Blueprint output</h3><span class="badge ${blueprint.status === "blocked" ? "warning" : "neutral"}">${esc(label(blueprint.status))}</span></div><div class="panel-body result-list"><div class="result-item"><b>Patient 360</b><p>Only a separately published provider-approved version becomes visible.</p></div><div class="result-item"><b>Personal Health Blueprint</b><p>Nutrition, hydration, food-first, supplement, GI/5R, and monitoring sections are sent as source material to the existing Blueprint review. Blueprint approval is never automatic.</p></div><div class="result-item"><b>Printable education</b><p>Generated from the same approved version, with food-safety and natural-source disclosures.</p></div></div></section>
      <section class="panel"><div class="panel-head"><h3>Explicit safeguards</h3><span class="badge neutral">Must not occur</span></div><div class="panel-body">${chips(evaluation.prohibited)}</div></section>
    </div>`;
  updateWorkflowControls();
}

function updateWorkflowControls() {
  const draft = workspace?.draft || null;
  const approved = workspace?.approved || null;
  const published = workspace?.published || null;
  const approvalReady = draft?.evaluation?.reviewReadiness?.approvalReady === true;
  const kidneyPending = activeEvaluation?.kidney?.status && activeEvaluation.kidney.status !== "not-applicable" && activeEvaluation.kidney.patientPublicationAllowed !== true;
  if (kidneyPending) {
    $("publication-allowed").checked = false;
    $("publication-allowed").disabled = true;
    $("publication-allowed").closest("label").title = "Kidney patient outputs require BHW clinical-owner and renal-RDN content approval first.";
  } else {
    $("publication-allowed").disabled = false;
    $("publication-allowed").closest("label").title = "";
  }
  $("approve").disabled = !draft || !approvalReady || !$("review-attestation").checked || formDirty;
  $("publish").disabled = !approved || !approved.publicationAllowed || !$("publish-attestation").checked;
  $("print").disabled = !published;
  $("record-status").textContent = published ? `Published v${published.version}` : approved ? `Approved v${approved.version}` : draft ? `Draft r${draft.revision}` : "No saved assessment";
  $("record-status").className = `badge ${published ? "complete" : approved ? "neutral" : draft ? "warning" : "neutral"}`;
}

async function loadWorkspace({ populate = true } = {}) {
  setConnection("Connecting...", "warning");
  try {
    if (!client) client = await createEncounterCloudClient();
    if (!client) throw new Error("The protected Clinical Intelligence connection is not configured.");
    const body = await client.patientNutritionIntelligence(PATIENT_ID);
    workspace = body.workspace || null;
    $("questionnaire-version").textContent = `Questionnaire v${body.questionnaire?.version || "1.3"} · ${body.questionnaire?.fields?.length || 0} fields`;
    if (populate && workspace?.draft?.content) populateForm(workspace.draft.content);
    const current = workspace?.approved?.evaluation || workspace?.draft?.evaluation || null;
    if (current?.rulesetVersion) renderEvaluation(current, workspace?.published ? `Published v${workspace.published.version}` : workspace?.approved ? `Approved v${workspace.approved.version}` : `Saved draft r${workspace.draft.revision}`);
    if (workspace?.updatedAt) setSaveState(`Saved to BHW Cloud · ${new Date(workspace.updatedAt).toLocaleString()}`, "saved", "The protected nutrition workspace was read back from Health Core.");
    else {
      setSaveState("Not saved", "not-saved", "No Nutrition Intelligence record has been saved.");
      setReviewReadiness(null);
    }
    setConnection("Health Core connected", "complete");
    updateWorkflowControls();
  } catch (error) {
    setConnection("Unavailable", "warning");
    setSaveState("Not saved", "error", error.message || "Nutrition Intelligence could not be loaded.");
    if (error?.code === CREW_SESSION_EXPIRED) location.href = `/crewos?next=${encodeURIComponent(`/provider/nutrition-intelligence.html?patient=${PATIENT_ID}`)}`;
  }
}

async function evaluatePreview() {
  if (!client) return;
  setSaveState(formDirty || !workspace?.draft ? "Not saved" : `Saved to BHW Cloud · ${new Date(workspace.updatedAt).toLocaleString()}`, formDirty || !workspace?.draft ? "not-saved" : "saved", "Evaluating without creating side effects...");
  try {
    const body = await client.savePatientNutritionIntelligence(PATIENT_ID, { action: "evaluate", content: collectFacts() });
    renderEvaluation(body.evaluation, "Preview only · not saved");
    setSaveState(formDirty || !workspace?.draft ? "Not saved" : `Saved to BHW Cloud · ${new Date(workspace.updatedAt).toLocaleString()}`, formDirty || !workspace?.draft ? "not-saved" : "saved", "Preview completed. No diagnosis, order, task, message, or patient projection was created.");
  } catch (error) {
    setSaveState("Not saved", "error", error.message);
  }
}

async function saveDraft() {
  if (!client) return;
  setSaveState("Saving…", "saving", "Writing the clinical draft to the protected Health Core workspace.");
  try {
    const body = await client.savePatientNutritionIntelligence(PATIENT_ID, { action: "save-draft", content: collectFacts() });
    workspace = body.workspace;
    formDirty = false;
    renderEvaluation(workspace.draft.evaluation, `Saved draft r${workspace.draft.revision}`);
    const readiness = workspace.draft.evaluation?.reviewReadiness;
    const readinessDetail = readiness?.approvalReady ? "It is ready for clinician review." : "It remains incomplete and cannot be approved yet.";
    setSaveState(`Saved to BHW Cloud · ${new Date(body.savedAt).toLocaleString()}`, "saved", `Draft revision ${workspace.draft.revision} was saved and read back. It is not patient-visible. ${readinessDetail}`);
    updateWorkflowControls();
  } catch (error) {
    setSaveState("Not saved", "error", error.message);
  }
}

async function approveDraft() {
  const draft = workspace?.draft;
  if (!draft || formDirty) return;
  setSaveState("Saving…", "saving", "Locking provider review to the exact saved revision.");
  try {
    const body = await client.savePatientNutritionIntelligence(PATIENT_ID, {
      action: "approve",
      expectedRevision: draft.revision,
      expectedContentHash: draft.contentHash,
      reviewAttestation: true,
      publicationAllowed: $("publication-allowed").checked,
      overallDisposition: "accepted",
      overrides: [],
    });
    workspace = body.workspace;
    renderEvaluation(body.approved.evaluation, `Approved v${body.approved.version} · not yet published`);
    setSaveState(`Saved to BHW Cloud · ${new Date(body.savedAt).toLocaleString()}`, "saved", "The exact draft was provider-approved. Patient 360 and Blueprint projections remain unpublished.");
    updateWorkflowControls();
  } catch (error) {
    setSaveState("Not saved", "error", error.message);
  }
}

async function publishProjections() {
  const approved = workspace?.approved;
  if (!approved) return;
  setSaveState("Saving…", "saving", "Publishing bounded source projections. Blueprint review and patient-release gates remain.");
  try {
    const body = await client.savePatientNutritionIntelligence(PATIENT_ID, {
      action: "publish",
      expectedApprovedVersion: approved.version,
      expectedContentHash: approved.contentHash,
      publishAttestation: true,
    });
    workspace = body.workspace;
    renderEvaluation(approved.evaluation, `Published projection v${body.published.version}`);
    setSaveState(`Saved to BHW Cloud · ${new Date(body.savedAt).toLocaleString()}`, "saved", "Patient 360 received the reviewed summary. The Personal Health Blueprint received source sections for its own review; no Care Connect delivery, order, medication change, or message was created.");
    updateWorkflowControls();
  } catch (error) {
    setSaveState("Not saved", "error", error.message);
  }
}

function wire() {
  $("patient-id").textContent = PATIENT_ID;
  setTheme(initialTheme());
  $("theme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("refresh").addEventListener("click", () => loadWorkspace());
  $("evaluate").addEventListener("click", evaluatePreview);
  $("save-draft").addEventListener("click", saveDraft);
  $("approve").addEventListener("click", approveDraft);
  $("publish").addEventListener("click", publishProjections);
  $("print").addEventListener("click", () => window.print());
  $("review-attestation").addEventListener("change", updateWorkflowControls);
  $("publication-allowed").addEventListener("change", updateWorkflowControls);
  $("publish-attestation").addEventListener("change", updateWorkflowControls);
  $("nutrition-form").addEventListener("input", (event) => {
    if (!["review-attestation", "publication-allowed", "publish-attestation"].includes(event.target.id)) {
      formDirty = true;
      setSaveState("Not saved", "not-saved", "This screen has changes that are not saved to BHW Cloud.");
      updateWorkflowControls();
    }
  });
  loadWorkspace();
}

wire();
