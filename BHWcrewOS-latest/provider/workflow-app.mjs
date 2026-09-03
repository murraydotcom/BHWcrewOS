import { analyzeNote } from "../engine/note-analyze.mjs";
import {
  WORKFLOW_STATUS,
  STATUS_LABELS,
  urgencyFor,
  buildEncounterPacket,
  canQueueCharmEntry,
  summarizeQueue,
  refreshEncounterIntelligence,
} from "../engine/encounter-workflow.mjs";
import {
  applyCodingOpportunity,
  approvedCodingAddenda,
  resolveCodingClarification,
} from "../engine/coding-opportunities.mjs";
import {
  approvedAuditAddenda,
  clinicalAuditSummary,
  controlledClinicalFinding,
  normalizeClinicalAudit,
  parseClinicalAuditReport,
  resolveClinicalAuditFinding,
} from "../engine/clinical-audit.mjs";
import {
  alertTransition,
  buildCharmPacket,
  parseQueue,
  serializeQueue,
} from "../engine/encounter-pilot.mjs";
import { createEncounterCloudClient } from "./cloud-queue.mjs";
import {
  controlledMedicationReviews,
  normalizeMedication,
  normalizeStructuredEncounter,
  structuredLines,
} from "../engine/structured-encounter.mjs";
import { buildMedicationAuthorizationReadiness, validateMedicationAuthorizationHandoff } from "../engine/medication-prior-auth.mjs";
import {
  BENEFIT_ADMINISTRATORS,
  COVERAGE_EVIDENCE_STATUSES,
  COVERAGE_SOURCE_TYPES,
  EPA_CASE_STATUSES,
  EPA_SUBMISSION_METHODS,
  PAYER_CATALOG,
  isMedicationEpaCaseComplete,
  medicationEpaCaseUrgency,
  medicationEpaSummary,
  providerQuestionSummary,
  updateMedicationEpaCase,
} from "../engine/medication-epa-workbench.mjs";
import {
  PRIMARY_NOTE_TEMPLATES,
  NOTE_MODULES,
  ENCOUNTER_CONTEXT_FIELDS,
  composeEncounterNote,
  contextReviewSummary,
  normalizeNotePlan,
} from "../engine/note-composer.mjs";

const QUEUE_KEY = "bhw_encounter_queue_v1";
const NOTES_KEY = "bhw_encounter_session_notes_v1";
const ALERTS_KEY = "bhw_encounter_alert_levels_v1";
const THEME_KEY = "bhw_provider_theme_v1";
const PENDING_PATIENT_KEY = "bhw_pending_encounter_patient_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}[character]));
const ago = (hours) => hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : `${Math.round(hours)}h`;
const mdmLabel = (rank) => ["not established", "straightforward", "low", "moderate", "high"][Number(rank) || 0] || "not established";

function storageGet(storage, key, fallback = null) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function readJson(storage, key, fallback = {}) {
  try {
    return JSON.parse(storageGet(storage, key, "")) || fallback;
  } catch {
    return fallback;
  }
}

function storageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const sessionClinical = readJson(sessionStorage, NOTES_KEY, {});
let rows = parseQueue(storageGet(localStorage, QUEUE_KEY, ""), sessionClinical);
let selected = rows[0]?.id || null;
let filter = "open";
const reports = new Map();
let toastTimer;
let cloudClient = null;
let cloudState = "connecting";
let cloudSaveTimer;
let activeTab = "clinical";
let analyzingId = "";
let structuringId = "";
let patients = [];
let encounterCreationKey = "";
let registryReady = false;

const lineValues = (value) => String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);

function persist() {
  storageSet(localStorage, QUEUE_KEY, serializeQueue(rows));
  const clinical = Object.fromEntries(rows
    .filter((row) => row.note || row.codes.length || row.diagnoses.length || row.tasks.length || row.documents.length || row.codingRecommendations.length || row.clinicalAudit?.status !== "not_run")
    .map((row) => [row.id, {
      note: row.note,
      sourceTranscript: row.sourceTranscript,
      notePlan: row.notePlan,
      noteBuilderInput: row.noteBuilderInput,
      encounterSnapshot: row.encounterSnapshot,
      noteDraftMeta: row.noteDraftMeta,
      coverage: row.coverage,
      medicationEpaCases: row.medicationEpaCases,
      codes: row.codes,
      diagnoses: row.diagnoses,
      medications: row.medications,
      orders: row.orders,
      referrals: row.referrals,
      followUp: row.followUp,
      patientInstructions: row.patientInstructions,
      pendingResults: row.pendingResults,
      returnPrecautions: row.returnPrecautions,
      tasks: row.tasks,
      documents: row.documents,
      codingRecommendations: row.codingRecommendations,
      clinicalAudit: row.clinicalAudit,
    }]));
  storageSet(sessionStorage, NOTES_KEY, JSON.stringify(clinical));
  if (cloudClient) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(async () => {
      try {
        await cloudClient.saveAll(rows);
        setCloudState("connected");
      } catch (error) {
        setCloudState("error");
        showToast(error.message || "Google Cloud sync could not complete. Your browser copy remains available.");
      }
    }, 450);
  }
}

function setCloudState(state) {
  cloudState = state;
  const badge = $("cloudStatus");
  const privacy = $("queuePrivacy");
  if (!badge || !privacy) return;
  badge.className = `badge ${state === "connected" ? "complete" : "warning"}`;
  const labels = {
    connecting: "Connecting…",
    connected: "Google Cloud synced",
    browser: "Browser-only",
    error: "Cloud sync interrupted",
  };
  badge.textContent = labels[state] || labels.browser;
  privacy.textContent = state === "connected"
    ? "Protected Google Cloud queue enabled. Freed and CharmHealth remain the designated medical records."
    : "Temporary browser queue active. Note text and clinical codes remain session-only until Google Cloud reconnects.";
}

function showToast(message, duration = 6500) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("on"), duration);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
    return true;
  } catch {
    showToast("Clipboard access was blocked. Use Ctrl+C from the open field instead.");
    return false;
  }
}

function log(row, text) {
  row.auditTrail.push({ at: new Date().toISOString(), text });
  row.auditTrail = row.auditTrail.slice(-100);
}

function selectedModules(container = document) {
  return [...container.querySelectorAll("input[data-note-module]:checked")].map((input) => input.value);
}

function notePlanFromDetail(row) {
  if (!$('dPrimaryTemplate')) return normalizeNotePlan(row.notePlan);
  return normalizeNotePlan({
    primaryTemplate: $('dPrimaryTemplate').value,
    modules: selectedModules($('dModuleGrid')),
    awvType: $('dAwvType')?.value || "",
  });
}

function builderInputFromDetail(row) {
  const current = row.noteBuilderInput || {};
  const value = (id, fallback = "") => $(id) ? $(id).value : fallback;
  return {
    ...current,
    chiefConcern: value("nbChiefConcern", current.chiefConcern),
    hpi: value("nbHpi", current.hpi),
    relevantHistory: value("nbRelevantHistory", current.relevantHistory),
    ros: value("nbRos", current.ros),
    exam: value("nbExam", current.exam),
    assessment: value("nbAssessment", current.assessment),
    plan: value("nbPlan", current.plan),
    followUp: value("nbFollowUp", current.followUp),
    timeMdm: value("nbTimeMdm", current.timeMdm),
    transcriptReviewed: $("nbTranscriptReviewed") ? $("nbTranscriptReviewed").checked : Boolean(current.transcriptReviewed),
    awv: {
      ...current.awv,
      historyUpdate: value("nbAwvHistory", current.awv?.historyUpdate),
      providers: value("nbAwvProviders", current.awv?.providers),
      measurements: value("nbAwvMeasurements", current.awv?.measurements),
      cognition: value("nbAwvCognition", current.awv?.cognition),
      functionSafety: value("nbAwvFunction", current.awv?.functionSafety),
      preventionSchedule: value("nbAwvPrevention", current.awv?.preventionSchedule),
      opioidSudReview: value("nbAwvSubstance", current.awv?.opioidSudReview),
      personalizedPlan: value("nbAwvPlan", current.awv?.personalizedPlan),
    },
    conditionManagement: {
      ...current.conditionManagement,
      status: value("nbConditionStatus", current.conditionManagement?.status),
      objective: value("nbConditionObjective", current.conditionManagement?.objective),
      treatmentResponse: value("nbConditionTreatment", current.conditionManagement?.treatmentResponse),
    },
    preventiveCare: {
      ...current.preventiveCare,
      screenings: value("nbPreventiveScreenings", current.preventiveCare?.screenings),
      counselingPlan: value("nbPreventivePlan", current.preventiveCare?.counselingPlan),
    },
    controlledMedication: {
      ...current.controlledMedication,
      clinicalReview: value("nbControlledClinical", current.controlledMedication?.clinicalReview),
      pdmp: value("nbControlledPdmp", current.controlledMedication?.pdmp),
      agreementConsent: value("nbControlledAgreement", current.controlledMedication?.agreementConsent),
      sampleMonitoring: value("nbControlledSample", current.controlledMedication?.sampleMonitoring),
      safetyCounseling: value("nbControlledSafety", current.controlledMedication?.safetyCounseling),
      followUp: value("nbControlledFollowUp", current.controlledMedication?.followUp),
    },
    behavioralHealth: {
      ...current.behavioralHealth,
      mse: value("nbBehavioralMse", current.behavioralHealth?.mse),
      risk: value("nbBehavioralRisk", current.behavioralHealth?.risk),
      interventionsResponse: value("nbBehavioralInterventions", current.behavioralHealth?.interventionsResponse),
    },
    charmedMinds: {
      ...current.charmedMinds,
      functionalConcern: value("nbCharmedConcern", current.charmedMinds?.functionalConcern),
      screeningProfile: value("nbCharmedScreening", current.charmedMinds?.screeningProfile),
      goalsPlan: value("nbCharmedGoals", current.charmedMinds?.goalsPlan),
    },
  };
}

function sync(row, { invalidateApproval = true } = {}) {
  const nextNote = $("dNote").value;
  const nextSourceTranscript = $("dTranscript") ? $("dTranscript").value : row.sourceTranscript;
  const nextNotePlan = notePlanFromDetail(row);
  const nextBuilderInput = builderInputFromDetail(row);
  const nextOwner = $("dOwner").value.trim() || "Amaris";
  const nextCodes = $("dCodes").value.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean);
  const nextDiagnoses = $("dDiagnoses").value.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean);
  const clinicalChanged = row.note !== nextNote
    || row.sourceTranscript !== nextSourceTranscript
    || JSON.stringify(normalizeNotePlan(row.notePlan)) !== JSON.stringify(nextNotePlan)
    || JSON.stringify(row.noteBuilderInput || {}) !== JSON.stringify(nextBuilderInput)
    || row.codes.join("|") !== nextCodes.join("|")
    || row.diagnoses.join("|") !== nextDiagnoses.join("|");
  const noteChanged = row.note !== nextNote;
  row.note = nextNote;
  row.sourceTranscript = nextSourceTranscript;
  row.notePlan = nextNotePlan;
  row.noteBuilderInput = nextBuilderInput;
  row.owner = nextOwner;
  row.codes = Array.from(new Set(nextCodes));
  row.diagnoses = Array.from(new Set(nextDiagnoses));
  const structuredInput = noteChanged ? {} : {
    medications: lineValues($("dMedications")?.value).map((value, index) => normalizeMedication(value, index)),
    orders: lineValues($("dOrders")?.value),
    referrals: lineValues($("dReferrals")?.value),
    followUp: lineValues($("dFollowUp")?.value),
    patientInstructions: lineValues($("dInstructions")?.value),
    pendingResults: lineValues($("dPendingResults")?.value),
    returnPrecautions: lineValues($("dReturnPrecautions")?.value),
  };
  Object.assign(row, normalizeStructuredEncounter(structuredInput, row.note));
  refreshEncounterIntelligence(row);
  if (clinicalChanged && invalidateApproval && row.providerApproved) {
    row.providerApproved = false;
    row.charmDraftSaved = false;
    row.status = WORKFLOW_STATUS.DRAFT_RECEIVED;
    log(row, "Clinical content changed; prior provider approval was removed");
  }
  return clinicalChanged;
}

function filteredRows() {
  return rows.filter((row) => {
    const urgency = urgencyFor(row);
    const medicationPa = medicationEpaSummary(row.medicationEpaCases || []);
    if (filter === "all") return true;
    if (filter === "urgent") return ["critical", "overdue"].includes(urgency.level) || medicationPa.overdue > 0;
    if (filter === "provider") return [WORKFLOW_STATUS.READY_FOR_PROVIDER, WORKFLOW_STATUS.NEEDS_CLARIFICATION].includes(row.status);
    return row.status !== WORKFLOW_STATUS.CLOSED;
  }).sort((left, right) => medicationEpaSummary(right.medicationEpaCases || []).overdue - medicationEpaSummary(left.medicationEpaCases || []).overdue || urgencyFor(right).hours - urgencyFor(left).hours);
}

function renderKpis() {
  const summary = summarizeQueue(rows);
  const medicationPa = rows.reduce((combined, row) => {
    const item = medicationEpaSummary(row.medicationEpaCases || []);
    combined.open += item.open;
    combined.overdue += item.overdue;
    return combined;
  }, { open: 0, overdue: 0 });
  const data = [
    [summary.total, "Queue encounters", ""],
    [summary.ready, "Ready for review", ""],
    [summary.clarification, "Need clarification", ""],
    [summary.dueSoon, "Due within 4h", summary.dueSoon ? "alert" : ""],
    [summary.overdue, "Over 24h", summary.overdue ? "alert" : ""],
    [summary.charmSaved, "Charm drafts saved", ""],
    [medicationPa.overdue, `PA follow-ups overdue (${medicationPa.open} open)`, medicationPa.overdue ? "alert" : ""],
  ];
  $("kpis").innerHTML = data.map(([value, label, className]) => `<div class="kpi ${className}"><div class="v">${value}</div><div class="l">${label}</div></div>`).join("");
}

function renderQueue() {
  const list = filteredRows();
  $("queue").innerHTML = list.length ? list.map((row) => {
    const urgency = urgencyFor(row);
    const medicationPa = medicationEpaSummary(row.medicationEpaCases || []);
    return `<div class="enc ${row.id === selected ? "on" : ""}" data-id="${esc(row.id)}"><div><div class="enc-title">${esc(row.id)} · ${esc(row.provider)}</div><div class="enc-meta">${row.bhwPatientId ? `${esc(row.bhwPatientId)} · ` : ""}${esc(row.visitType)} · ${esc(row.payer)} · ${ago(urgency.hours)} since visit</div><div class="status">${esc(STATUS_LABELS[row.status])} · Owner: ${esc(row.owner)}${row.note ? '<span class="session-flag">note loaded</span>' : ""}</div></div><div class="queue-badges"><span class="badge ${urgency.level}">${esc(urgency.label)}</span>${medicationPa.total ? `<span class="badge ${medicationPa.overdue ? "overdue" : medicationPa.open ? "ontrack" : "complete"}">PA ${medicationPa.complete}/${medicationPa.total}${medicationPa.overdue ? ` · ${medicationPa.overdue} overdue` : ""}</span>` : ""}</div></div>`;
  }).join("") : `<div class="empty"><b>No encounters in this view.</b><br>Add the first real encounter using its encounter ID—not the patient name.<br><button class="btn primary" id="emptyAdd">+ Add encounter</button></div>`;
  document.querySelectorAll(".enc").forEach((element) => {
    element.onclick = () => {
      selected = element.dataset.id;
      render();
    };
  });
  if ($("emptyAdd")) $("emptyAdd").onclick = openEncounterModal;
}

function statusOptions(current) {
  return Object.values(WORKFLOW_STATUS).map((status) => `<option value="${status}" ${status === current ? "selected" : ""}>${esc(STATUS_LABELS[status])}</option>`).join("");
}

function templateOptions(current) {
  return Object.entries(PRIMARY_NOTE_TEMPLATES).map(([id, item]) => `<option value="${esc(id)}" ${id === current ? "selected" : ""}>${esc(item.label)}</option>`).join("");
}

function moduleOptions(selected = []) {
  const chosen = new Set(selected);
  return Object.entries(NOTE_MODULES).map(([id, item]) => `<label class="module-option"><input type="checkbox" data-note-module value="${esc(id)}" ${chosen.has(id) ? "checked" : ""}><span>${esc(item.label)}</span></label>`).join("");
}

function renderEncounterContext(row) {
  const summary = contextReviewSummary(row.encounterSnapshot);
  if (!summary.total) return '<div class="notice"><b>Encounter context has not been imported yet.</b> The Patient Registry link is active; the next data-connection step will populate the pre-visit questionnaire, HRA, medications, allergies, problem list, and other master-list fields here.</div>';
  return `<div class="notice"><b>${summary.total} imported context item${summary.total === 1 ? "" : "s"}.</b> ${summary.reviewed} reviewed for note use · ${summary.needsReview} still require reconciliation. Imported data never enters the note silently.</div>${summary.fields.map(({ field, items }) => `<div class="context-field"><b>${esc(ENCOUNTER_CONTEXT_FIELDS[field])}</b>${items.map((item) => `<div class="context-item">${esc(item.value)}<span class="context-meta">${esc(item.source)}${item.updatedAt ? ` · updated ${esc(item.updatedAt)}` : ""}${item.patientReported ? " · patient reported" : ""} · ${esc(item.reviewedForNote ? "reviewed for note" : item.reconciliationStatus.replaceAll("_", " "))}</span></div>`).join("")}</div>`).join("")}`;
}

function noteField(id, label, value = "", rows = 3) {
  return `<div class="field"><label>${esc(label)}</label><textarea id="${esc(id)}" rows="${rows}">${esc(value || "")}</textarea></div>`;
}

function renderModuleBuilderFields(input = {}) {
  return `<details style="margin-top:10px"><summary>Core clinical details</summary><div class="formgrid" style="margin-top:10px">${noteField("nbRelevantHistory", "Relevant history", input.relevantHistory)}${noteField("nbRos", "Relevant ROS", input.ros)}${noteField("nbExam", "Objective / examination", input.exam)}${noteField("nbTimeMdm", "Time / MDM attestation", input.timeMdm)}</div></details>
  <details style="margin-top:10px"><summary>Annual Wellness Visit cascade</summary><div class="formgrid" style="margin-top:10px">${noteField("nbAwvHistory", "Medical and family history update", input.awv?.historyUpdate)}${noteField("nbAwvProviders", "Providers and suppliers", input.awv?.providers)}${noteField("nbAwvMeasurements", "Measurements", input.awv?.measurements)}${noteField("nbAwvCognition", "Cognitive assessment", input.awv?.cognition)}${noteField("nbAwvFunction", "Function and safety", input.awv?.functionSafety)}${noteField("nbAwvPrevention", "Screening/prevention schedule", input.awv?.preventionSchedule)}${noteField("nbAwvSubstance", "Opioid and substance-use review", input.awv?.opioidSudReview)}${noteField("nbAwvPlan", "Personalized prevention plan", input.awv?.personalizedPlan)}</div></details>
  <details style="margin-top:10px"><summary>Condition Management and Preventive Care</summary><div class="formgrid" style="margin-top:10px">${noteField("nbConditionStatus", "Condition status / interval change", input.conditionManagement?.status)}${noteField("nbConditionObjective", "Objective monitoring", input.conditionManagement?.objective)}${noteField("nbConditionTreatment", "Treatment and response", input.conditionManagement?.treatmentResponse)}${noteField("nbPreventiveScreenings", "Preventive screenings", input.preventiveCare?.screenings)}${noteField("nbPreventivePlan", "Preventive counseling and plan", input.preventiveCare?.counselingPlan)}</div></details>
  <details style="margin-top:10px"><summary>Controlled Medication Monitoring</summary><div class="formgrid" style="margin-top:10px">${noteField("nbControlledClinical", "Indication, adherence, effect, adverse effects", input.controlledMedication?.clinicalReview)}${noteField("nbControlledPdmp", "PDMP review", input.controlledMedication?.pdmp)}${noteField("nbControlledAgreement", "Agreement / consent", input.controlledMedication?.agreementConsent)}${noteField("nbControlledSample", "Sample obtained / monitoring", input.controlledMedication?.sampleMonitoring)}${noteField("nbControlledSafety", "Safety counseling", input.controlledMedication?.safetyCounseling)}${noteField("nbControlledFollowUp", "Controlled-medication follow-up", input.controlledMedication?.followUp)}</div></details>
  <details style="margin-top:10px"><summary>Behavioral Health</summary><div class="formgrid" style="margin-top:10px">${noteField("nbBehavioralMse", "Mental status examination", input.behavioralHealth?.mse)}${noteField("nbBehavioralRisk", "Safety / risk assessment", input.behavioralHealth?.risk)}${noteField("nbBehavioralInterventions", "Interventions, response, and progress", input.behavioralHealth?.interventionsResponse)}</div></details>
  <details style="margin-top:10px"><summary>CharmEd Minds</summary><div class="formgrid" style="margin-top:10px">${noteField("nbCharmedConcern", "Functional concern and context", input.charmedMinds?.functionalConcern)}${noteField("nbCharmedScreening", "Standardized screening and cognitive profile", input.charmedMinds?.screeningProfile)}${noteField("nbCharmedGoals", "Goals, transfer, and support plan", input.charmedMinds?.goalsPlan)}</div></details>`;
}

function renderNoteBuilder(row) {
  const notePlan = normalizeNotePlan(row.notePlan);
  const input = row.noteBuilderInput || {};
  const missing = row.noteDraftMeta?.missing || [];
  return `<details open><summary><b>Encounter Note Builder</b> — one primary template plus applicable modules</summary>
    <div class="formgrid" style="margin-top:12px"><div class="field"><label>Primary note template</label><select id="dPrimaryTemplate">${templateOptions(notePlan.primaryTemplate)}</select></div><div class="field"><label>AWV type, when applicable</label><select id="dAwvType"><option value="">Not applicable / select</option><option value="initial" ${notePlan.awvType === "initial" ? "selected" : ""}>Initial AWV</option><option value="subsequent" ${notePlan.awvType === "subsequent" ? "selected" : ""}>Subsequent AWV</option></select></div><div class="field"><label>Chief concern / reason</label><input id="nbChiefConcern" value="${esc(input.chiefConcern || "")}" placeholder="Patient-stated reason for visit"></div></div>
    <div class="field"><label>Additional modules</label><div class="module-grid" id="dModuleGrid">${moduleOptions(notePlan.modules)}</div><div class="privacy">Condition Management covers clinical condition follow-up. Medication content appears only when addressed. CCM is excluded.</div></div>
    ${noteField("nbHpi", "History of present illness", input.hpi, 5)}
    <div class="formgrid" style="margin-top:12px"><div class="field"><label>Assessment</label><textarea id="nbAssessment" rows="4">${esc(input.assessment || "")}</textarea></div><div class="field"><label>Plan</label><textarea id="nbPlan" rows="4">${esc(input.plan || "")}</textarea></div><div class="field"><label>Follow-up</label><textarea id="nbFollowUp" rows="4">${esc(input.followUp || "")}</textarea></div></div>
    ${renderModuleBuilderFields(input)}
    <label class="module-option"><input type="checkbox" id="nbTranscriptReviewed" ${input.transcriptReviewed ? "checked" : ""}><span>I reviewed the source transcription and confirm it may be used to draft this note.</span></label>
    ${missing.length ? `<div class="notice"><b>${missing.length} required element${missing.length === 1 ? "" : "s"} still need documentation.</b><br>${missing.map(esc).join(" · ")}</div>` : ""}
    <div class="actions"><button class="btn bronze" id="structureSource" ${structuringId === row.id ? "disabled" : ""}>${structuringId === row.id ? "Organizing source…" : "Organize Freed draft into fields"}</button><button class="btn primary" id="generateNote">Generate structured note draft</button></div>
  </details><details style="margin-top:12px"><summary><b>Imported patient and pre-visit context</b></summary><div style="margin-top:12px">${renderEncounterContext(row)}</div></details>`;
}

function renderDetail() {
  const row = rows.find((candidate) => candidate.id === selected);
  if (!row) {
    $("detail").innerHTML = '<div class="empty">Select an encounter or add the first encounter.</div>';
    return;
  }
  const urgency = urgencyFor(row);
  const report = reports.get(row.id);
  const auditSummary = clinicalAuditSummary(row.clinicalAudit);
  const pendingCoding = row.codingRecommendations.filter((item) => item.status === "pending").length;
  const openTasks = row.tasks.filter((task) => task.status !== "complete").length;
  $("detail").innerHTML = `
    <div class="card-head"><div><h3>${esc(row.id)} · Encounter packet</h3><div class="enc-meta">${row.bhwPatientId ? `${esc(row.bhwPatientId)} · ` : ""}${esc(row.provider)} · ${esc(row.payer)} · completed ${ago(urgency.hours)} ago</div></div><span class="badge ${urgency.level}">${esc(urgency.label)}</span></div>
    <div class="detail-body"><div class="notice"><b>Operational pilot:</b> ${cloudState === "connected" ? "this packet is encrypted and synchronized through the protected BHW Google Cloud project." : "this packet is temporarily using browser storage until Google Cloud connects."} Freed and CharmHealth remain the designated medical records.</div>
    <div class="formgrid"><div class="field"><label>Status</label><select id="dStatus">${statusOptions(row.status)}</select></div><div class="field"><label>Owner</label><input id="dOwner" value="${esc(row.owner)}"></div><div class="field"><label>Approved CPT/HCPCS — after note audit</label><input id="dCodes" value="${esc(row.codes.join(", "))}" placeholder="Review and apply the post-note recommendations"></div></div>
    <div class="field"><label>Approved ICD-10-CM diagnoses — after note audit</label><input id="dDiagnoses" value="${esc(row.diagnoses.join(", "))}" placeholder="Review and apply the post-note recommendations"></div>
    <div style="margin-top:12px">${renderNoteBuilder(row)}</div>
    <div class="field" style="margin-top:12px"><label>Source transcription or imported clinical draft</label><textarea id="dTranscript" rows="7">${esc(row.sourceTranscript || "")}</textarea><div class="privacy">Source material remains separate from the structured note. Provider review is required before generation.</div></div>
    <div class="field" style="margin-top:12px"><label>Structured clinical note — editable provider draft</label><textarea id="dNote" rows="15">${esc(row.note)}</textarea><div class="privacy">${cloudState === "connected" ? "Protected cloud synchronization is active. Do not treat this queue as the legal medical record." : "Note text and clinical codes stay in this browser tab session only."}</div></div>
    <details class="audit-raw"><summary>Structured encounter packet — auto-extracted, reviewable</summary><div class="formgrid" style="margin-top:12px"><div class="field"><label>Medications — one per line</label><textarea id="dMedications" rows="5">${esc(structuredLines(row.medications.map((item) => item.sourceText || [item.name, item.doseFrequency].filter(Boolean).join(" — "))))}</textarea></div><div class="field"><label>Orders — one per line</label><textarea id="dOrders" rows="5">${esc(structuredLines(row.orders))}</textarea></div><div class="field"><label>Referrals — one per line</label><textarea id="dReferrals" rows="5">${esc(structuredLines(row.referrals))}</textarea></div><div class="field"><label>Follow-up</label><textarea id="dFollowUp" rows="5">${esc(structuredLines(row.followUp))}</textarea></div><div class="field"><label>Patient instructions</label><textarea id="dInstructions" rows="5">${esc(structuredLines(row.patientInstructions))}</textarea></div><div class="field"><label>Pending results</label><textarea id="dPendingResults" rows="5">${esc(structuredLines(row.pendingResults))}</textarea></div><div class="field"><label>Return precautions</label><textarea id="dReturnPrecautions" rows="5">${esc(structuredLines(row.returnPrecautions))}</textarea></div></div></details>
    <div class="actions"><button class="btn" id="pasteFreed">Paste source transcript / draft</button><button class="btn primary" id="analyze" ${analyzingId === row.id ? "disabled" : ""}>${analyzingId === row.id ? "Running full clinical audit…" : "Run documentation + coding + clinical audit"}</button><button class="btn" id="savePacket">Update packet</button><button class="btn danger" id="deleteEncounter">Remove encounter</button></div>
    <div class="tabs"><button class="tab ${activeTab === "clinical" ? "on" : ""}" data-tab="clinical">Required Changes${auditSummary.pending ? ` (${auditSummary.pending})` : ""}</button><button class="tab ${activeTab === "audit" ? "on" : ""}" data-tab="audit">Documentation</button><button class="tab ${activeTab === "coding" ? "on" : ""}" data-tab="coding">Coding clarification & opportunities${pendingCoding ? ` (${pendingCoding})` : ""}</button><button class="tab ${activeTab === "actions" ? "on" : ""}" data-tab="actions">Tasks, AVS & drafts${openTasks ? ` (${openTasks})` : ""}</button><button class="tab ${activeTab === "charm" ? "on" : ""}" data-tab="charm">Charm entry</button><button class="tab ${activeTab === "history" ? "on" : ""}" data-tab="history">Audit trail</button></div>
    <div class="panel ${activeTab === "clinical" ? "on" : ""}" id="p-clinical">${renderClinicalAudit(row)}</div>
    <div class="panel ${activeTab === "audit" ? "on" : ""}" id="p-audit">${renderReport(report)}</div>
    <div class="panel ${activeTab === "coding" ? "on" : ""}" id="p-coding">${renderCoding(row)}</div>
    <div class="panel ${activeTab === "actions" ? "on" : ""}" id="p-actions">${renderOutputs(row)}</div>
    <div class="panel ${activeTab === "charm" ? "on" : ""}" id="p-charm">${renderCharm(row)}</div>
    <div class="panel ${activeTab === "history" ? "on" : ""}" id="p-history">${renderHistory(row)}</div></div>`;
  wireDetail(row);
}

function renderClinicalAudit(row) {
  const audit = row.clinicalAudit || {};
  const summary = clinicalAuditSummary(audit);
  const controlledLabels = {
    diagnosisLinkage: "Diagnosis / indication linkage",
    doseFrequency: "Dose and frequency",
    pdmp: "Applicable PDMP review",
    agreementConsent: "Applicable agreement / consent",
    monitoring: "Applicable monitoring",
    safetyCounseling: "Safety counseling",
    followUp: "Follow-up",
  };
  const controlled = controlledMedicationReviews(row);
  const controlledHtml = controlled.length ? `<h4>Controlled-medication review</h4>${controlled.map((review) => `<div class="document-card"><b>${esc(review.medication)}</b><p class="privacy">Detected from: ${esc(review.sourceText)}</p>${Object.entries(review.checks).map(([key, check]) => {
    const finding = controlledClinicalFinding(audit, review, key, controlled.length);
    const status = check.status === "documented" ? "documented" : finding?.decision && finding.decision !== "pending" ? finding.decision.replaceAll("_", " ") : "needs decision";
    return `<div class="check ${check.status === "documented" || (finding?.decision && finding.decision !== "pending") ? "present" : "missing"}"><div class="mark">${check.status === "documented" || (finding?.decision && finding.decision !== "pending") ? "✓" : "!"}</div><div><b>${esc(controlledLabels[key] || key)}</b><small>${esc(status)}${check.evidence ? ` · ${esc(check.evidence)}` : ""}</small></div></div>`;
  }).join("")}</div>`).join("")}` : "";
  if (audit.status === "not_run" || !audit.rawReport) {
    return `<div class="notice"><b>${analyzingId === row.id ? "Clinical audit is running now." : "Required Changes has not been generated yet."}</b> Use the single <b>Run documentation + coding + clinical audit</b> button above. The note and structured encounter packet are screened together—there is no audit copy/paste step.</div>${controlledHtml}`;
  }
  const risk = audit.recommendedRisk ? audit.recommendedRisk.toUpperCase() : "NOT STATED";
  const suggestedCpt = audit.suggestedCodesAfterChanges?.cpt || [];
  const suggestedDx = audit.suggestedCodesAfterChanges?.icd10 || [];
  const codingAsDocumented = audit.codingAsDocumented || {};
  const corrections = approvedAuditAddenda(audit);
  return `<div class="notice"><b>${esc(audit.verdict || "Clinical audit completed")}</b> · Recommended risk ${esc(risk)} — provider confirmation required${audit.estimatedFixMinutes !== null ? ` · Estimated fix ${esc(audit.estimatedFixMinutes)} min` : ""}.<br>${summary.blocking ? `<b>${summary.blocking} Critical/High finding${summary.blocking === 1 ? "" : "s"} block Charm approval until resolved.</b>` : summary.pending ? `${summary.pending} finding${summary.pending === 1 ? "" : "s"} still need a decision.` : "All findings have a provider decision."}</div>
    ${controlledHtml}
    <div class="review-note"><b>Coding specificity as documented:</b> CPT/HCPCS ${esc((codingAsDocumented.cpt || []).join(", ") || "none stated")} · ICD-10-CM ${esc((codingAsDocumented.icd10 || []).join(", ") || "none stated")}<br><b>HCC relevance:</b> ${esc(codingAsDocumented.hccRelevance || "none stated; validation required")}<br><b>Z-code opportunities:</b> ${esc((codingAsDocumented.zCodes || []).join(", ") || codingAsDocumented.zCodeEvidence || "none stated")}</div>
    <div class="review-note"><b>Audit-suggested codes after changes — review only:</b> CPT/HCPCS ${esc(suggestedCpt.join(", ") || "none stated")} · ICD-10-CM ${esc(suggestedDx.join(", ") || "none stated")}. These are never applied automatically.</div>
    ${audit.findings?.length ? audit.findings.map((finding) => `<div class="audit-finding severity-${esc(finding.severity)}" data-audit-id="${esc(finding.id)}"><div class="output-head"><div><span class="code-chip">${esc(finding.severity.toUpperCase())}</span> <b>${esc(finding.issue)}</b></div><span class="badge ${finding.decision === "pending" ? "warning" : "complete"}">${esc(finding.decision.replaceAll("_", " "))}</span></div><div class="review-note"><b>Location:</b> ${esc(finding.location || "See audit finding")}</div><div class="review-note"><b>Suggested correction:</b> ${esc(finding.suggestedFix || finding.issue)}</div><div class="source"><b>Supporting source:</b> ${esc(finding.supportingSource || "Current primary-source verification required")}</div><div class="field"><label>Your context / reason</label><input class="audit-response" value="${esc(finding.providerResponse || "")}" placeholder="Optional provider context"></div><div class="field"><label>Exact correction to add only if it actually occurred</label><textarea class="audit-addendum" rows="3" placeholder="Enter only facts you can personally confirm occurred during this visit.">${esc(finding.approvedAddendum || "")}</textarea></div><div class="actions"><button class="btn audit-decision" data-decision="occurred">Occurred — draft correction</button><button class="btn audit-decision" data-decision="already_documented">Already documented</button><button class="btn audit-decision" data-decision="not_done">Not done — create task</button><button class="btn audit-decision" data-decision="dismissed">Dismiss</button></div></div>`).join("") : '<p class="privacy">No actionable findings were identified.</p>'}
    ${audit.guidelineChecks?.length ? `<h4>Relevant condition-guideline checks</h4>${audit.guidelineChecks.map((item) => `<div class="review-note"><b>${esc(item.topic || "Guideline check")}</b>${esc(item.note || "")}<div class="source">Source: ${esc(item.source)} · Year: ${esc(item.year)}</div></div>`).join("")}` : ""}
    ${corrections.length ? `<div class="notice"><b>${corrections.length} provider-confirmed correction${corrections.length === 1 ? " is" : "s are"} ready.</b> Append them to the editable note, then the documentation and coding engines will rerun against the corrected note.</div><button class="btn primary" id="applyAuditCorrections">Append confirmed corrections + rerun</button>` : ""}
    <details class="audit-raw"><summary>Full clinical audit output</summary><pre>${esc(audit.rawReport)}</pre></details>
    <div class="actions"><button class="btn" id="reanalyzeAudit">Run the full analysis again</button></div>`;
}

function renderReport(report) {
  if (!report) return '<div class="empty">Paste the Freed note, then run documentation intelligence to compare it with BHW standards and the entered codes.</div>';
  return `<div class="notice"><b>${report.summary.readiness}% documentation readiness.</b> ${report.summary.missing} missing · ${report.summary.review} verify · ${report.summary.present} present.</div>${report.checks.map((check) => `<div class="check ${check.status}"><div class="mark">${check.status === "present" ? "✓" : check.status === "missing" ? "✕" : "!"}</div><div><b>${esc(check.label)}</b><small>${esc(check.detail)} · ${esc(check.source)}</small></div></div>`).join("")}`;
}

function renderCoding(row) {
  const items = row.codingRecommendations || [];
  if (!items.length) return '<div class="empty"><b>No coding rule matched this note yet.</b><br>This does not mean coding is complete. Review the documentation audit and payer-specific opportunities. The engine will not infer diagnoses from medications, symptoms, or test results.</div>';
  const corrections = approvedCodingAddenda(items);
  return `<div class="notice"><b>Coding clarification and revenue-opportunity review—not an automatic code selector.</b> The engine compares documented MDM and total time, asks only evidence-specific questions, and never adds a code automatically. Confirm only work that occurred during the encounter.</div>${items.map((item) => {
    const applied = item.status === "applied";
    const dismissed = item.status === "dismissed";
    const current = item.replaceCode ? `${item.replaceCode} → ` : "";
    const reviewOnly = item.action === "review";
    const pendingQuestions = [].concat(item.clarifications || []).some((question) => question.decision === "pending");
    const mdm = item.mdm;
    const mdmHtml = mdm ? `<div class="mdm-grid"><div><b>Problems</b><span>${esc(mdmLabel(mdm.problems?.rank))}</span></div><div><b>Data</b><span>${esc(mdmLabel(mdm.data?.rank))}</span></div><div><b>Risk</b><span>${esc(mdmLabel(mdm.risk?.rank))}</span></div></div>` : "";
    const questionsHtml = [].concat(item.clarifications || []).map((question) => `<div class="coding-clarification" data-recommendation-id="${esc(item.id)}" data-clarification-id="${esc(question.id)}"><div class="output-head"><div><b>${esc(question.label)}</b><p>${esc(question.question)}</p></div><span class="badge ${question.decision === "pending" ? "warning" : "complete"}">${esc(question.decision.replaceAll("_", " "))}</span></div>${question.evidence ? `<div class="evidence"><b>Why this question appeared</b><div>“${esc(question.evidence)}”</div></div>` : ""}<div class="review-note">${esc(question.reason)}</div><div class="field"><label>Your answer or chart location</label><input class="coding-response" value="${esc(question.providerResponse || "")}" placeholder="Required for Already documented; optional context otherwise"></div><div class="field"><label>Exact provider-confirmed fact to add only if it occurred</label><textarea class="coding-addendum" rows="3" placeholder="Do not copy the suggestion. Enter only the fact you can personally confirm.">${esc(question.approvedAddendum || "")}</textarea></div><div class="actions"><button class="btn coding-decision" data-decision="occurred">Occurred — add exact fact</button><button class="btn coding-decision" data-decision="already_documented">Already documented</button><button class="btn coding-decision" data-decision="not_done">Did not occur</button><button class="btn coding-decision" data-decision="not_applicable">Not applicable</button></div></div>`).join("");
    return `<div class="recommendation ${esc(item.status)}"><div class="output-head"><div><span class="code-chip">${esc(item.category.toUpperCase())}</span> <b>${esc(current)}${esc(item.code)}</b><p>${esc(item.title)}</p></div><span class="badge ${applied ? "complete" : dismissed ? "warning" : "ontrack"}">${reviewOnly && !applied && !dismissed ? "clarify" : esc(item.status)}</span></div>${mdmHtml}<div class="evidence"><b>Evidence found</b><div>“${esc(item.evidence || "No qualifying evidence captured.")}”</div></div>${item.missingDocumentation ? `<div class="review-note"><b>${reviewOnly ? "Documentation/eligibility check:" : "Before applying:"}</b> ${esc(item.missingDocumentation)}</div>` : ""}${questionsHtml}<div class="review-note"><b>Coverage check:</b> ${esc(item.coverageNote)}</div><div class="source"><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">${esc(item.sourceLabel)}</a></div><div class="actions"><button class="btn primary apply-code" data-recommendation-id="${esc(item.id)}" ${applied || dismissed || pendingQuestions || !["add", "replace"].includes(item.action) ? "disabled" : ""}>${item.action === "replace" ? "Apply supported code change" : item.action === "add" ? "Add to approved fields" : "Clarify and rerun first"}</button><button class="btn dismiss-code" data-recommendation-id="${esc(item.id)}" ${applied || dismissed ? "disabled" : ""}>Dismiss</button></div></div>`;
  }).join("")}${corrections.length ? `<div class="notice"><b>${corrections.length} provider-confirmed coding fact${corrections.length === 1 ? " is" : "s are"} ready.</b> Append the exact facts to the note and rerun both MDM and time checks before any code can be applied.</div><button class="btn primary" id="applyCodingCorrections">Append confirmed coding facts + rerun</button>` : ""}`;
}

function optionList(entries, current) {
  const items = Array.isArray(entries) ? entries.map((item) => [item.id, item.label]) : Object.entries(entries);
  return items.map(([value, label]) => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`).join("");
}

function localDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function renderEpaQuestion(question, kind) {
  const suggested = question.source === "encounter_suggestion";
  return `<div class="epa-question" data-question-kind="${esc(kind)}" data-question-id="${esc(question.id)}">
    <div class="output-head"><div><b>${esc(question.label)}</b>${suggested ? '<p class="privacy">Suggested from the encounter—provider must verify it before attesting.</p>' : ""}</div><select class="epa-question-disposition" aria-label="Question status">${optionList({ unanswered: "Needs answer", answered: "Answered", not_applicable: "Not applicable" }, question.disposition)}</select></div>
    <textarea class="epa-question-answer" rows="2" placeholder="Enter the documented answer; do not infer missing clinical facts.">${esc(question.answer)}</textarea>
  </div>`;
}

function renderMedicationEpaWorkbench(row) {
  const cases = row.medicationEpaCases || [];
  if (!cases.length) return "";
  const summary = medicationEpaSummary(cases);
  return `<section class="epa-workbench"><div class="output-head"><div><h4>Medication prior-authorization workbench</h4><p>Prepare the clinical answers once, hand them to staff, and track the external PA through a decision.</p></div><span class="badge ${summary.overdue ? "warning" : summary.open ? "ontrack" : "complete"}">${summary.open} open${summary.overdue ? ` · ${summary.overdue} overdue` : ""}</span></div>
    <div class="notice"><b>This is the BHW preparation and tracking record—not a live benefit response.</b> Staff must confirm current coverage in an authorized payer/PBM, pharmacy, Surescripts, CoverMyMeds, or Charm workflow before marking PA required or not required. Dated formularies can help prepare a case but do not confirm the patient's current benefit.</div>
    ${cases.map((caseItem) => {
      const profile = caseItem.coverageProfile || {};
      const evidence = caseItem.coverageEvidence || {};
      const review = caseItem.providerReview || {};
      const questionnaire = caseItem.payerQuestionnaire || {};
      const submission = caseItem.submission || {};
      const urgency = medicationEpaCaseUrgency(caseItem);
      const questions = providerQuestionSummary(caseItem);
      const events = [].concat(caseItem.events || []).slice().reverse();
      return `<article class="epa-case urgency-${esc(urgency.level)}" data-epa-case-id="${esc(caseItem.id)}">
        <div class="output-head"><div><span class="code-chip">${esc(caseItem.action || "medication")}</span> <b>${esc(caseItem.medicationName)}</b><p>${esc(caseItem.sourceText)}</p></div><div class="epa-badges"><span class="badge ${urgency.level === "complete" ? "complete" : urgency.overdue ? "warning" : "ontrack"}">${esc(urgency.label)}</span><span class="badge ${questions.missing ? "warning" : "complete"}">${questions.complete}/${questions.total} answers</span></div></div>

        <details open><summary>Payer and prescription benefit identity</summary><div class="epa-grid">
          <div class="field"><label>Payer / line of business</label><select data-epa-field="payerProfileId">${optionList(PAYER_CATALOG, profile.payerProfileId)}</select></div>
          <div class="field"><label>Payer name on card</label><input data-epa-field="payer" value="${esc(profile.payer)}" placeholder="Exact name from card or eligibility"></div>
          <div class="field"><label>Plan name</label><input data-epa-field="planName" value="${esc(profile.planName)}"></div>
          <div class="field"><label>Member ID</label><input data-epa-field="memberId" value="${esc(profile.memberId)}"></div>
          <div class="field"><label>BIN</label><input data-epa-field="bin" value="${esc(profile.bin)}"></div>
          <div class="field"><label>PCN</label><input data-epa-field="pcn" value="${esc(profile.pcn)}"></div>
          <div class="field"><label>Rx group</label><input data-epa-field="rxGroup" value="${esc(profile.rxGroup)}"></div>
          <div class="field"><label>Medical group number</label><input data-epa-field="groupNumber" value="${esc(profile.groupNumber)}"></div>
          <div class="field"><label>PBM / benefit administrator</label><select data-epa-field="benefitAdministratorId">${optionList(BENEFIT_ADMINISTRATORS, profile.benefitAdministratorId)}</select></div>
          <div class="field"><label>PBM name</label><input data-epa-field="pbm" value="${esc(profile.pbm)}" placeholder="CarelonRx or other administrator"></div>
          <div class="field"><label>Medicare contract ID</label><input data-epa-field="medicareContractId" value="${esc(profile.medicareContractId)}" placeholder="H####"></div>
          <div class="field"><label>Medicare PBP ID</label><input data-epa-field="medicarePbpId" value="${esc(profile.medicarePbpId)}"></div>
        </div></details>

        <details open><summary>Provider clinical answers</summary><p class="privacy">Questions are anticipated from the documented medication and diagnosis context. They are not represented as the payer's exact questionnaire.</p>${caseItem.questions.map((question) => renderEpaQuestion(question, "common")).join("")}</details>

        <details><summary>Exact payer questions</summary><div class="epa-grid">
          <div class="field"><label>Question source / key</label><input data-epa-field="questionnaireSource" value="${esc(questionnaire.source)}" placeholder="Portal, key ID, fax, or call reference"></div>
          <div class="field"><label>Received</label><input type="datetime-local" data-epa-field="questionnaireReceivedAt" value="${esc(localDateTime(questionnaire.receivedAt))}"></div>
        </div><div class="field"><label>Paste exact questions—one per line</label><textarea data-epa-field="questionnaireRawText" rows="5" placeholder="Paste the real payer questions here. Save once to turn them into answer fields.">${esc(questionnaire.rawText)}</textarea></div>
        ${questionnaire.questions?.length ? questionnaire.questions.map((question) => renderEpaQuestion(question, "payer")).join("") : '<p class="privacy">No exact payer questionnaire has been captured yet. The packet can still be prepared with the anticipated questions above.</p>'}</details>

        <details open><summary>Provider review and staff handoff</summary><div class="epa-grid">
          <div class="field"><label>Provider name</label><input data-epa-field="attestedBy" value="${esc(review.attestedBy)}"></div>
          <div class="field"><label>Case stage</label><select data-epa-field="status">${optionList(EPA_CASE_STATUSES, caseItem.status)}</select></div>
          <div class="field epa-span"><label class="epa-attestation"><input type="checkbox" data-epa-field="attested" ${review.attested ? "checked" : ""}> I verified that these answers are supported by this encounter or the patient's record and are appropriate to give the MA/front desk for the external PA. I did not infer undocumented facts.</label></div>
        </div></details>

        <details><summary>Coverage check evidence</summary><div class="epa-grid">
          <div class="field"><label>Result</label><select data-epa-field="evidenceStatus">${optionList(COVERAGE_EVIDENCE_STATUSES, evidence.status)}</select></div>
          <div class="field"><label>Source type</label><select data-epa-field="evidenceSourceType">${optionList(COVERAGE_SOURCE_TYPES, evidence.sourceType)}</select></div>
          <div class="field"><label>Source label / reference</label><input data-epa-field="evidenceSourceLabel" value="${esc(evidence.sourceLabel)}"></div>
          <div class="field"><label>Authorized source URL</label><input type="url" data-epa-field="evidenceSourceUrl" value="${esc(evidence.sourceUrl)}"></div>
          <div class="field"><label>Checked</label><input type="datetime-local" data-epa-field="evidenceCheckedAt" value="${esc(localDateTime(evidence.checkedAt))}"></div>
          <div class="field"><label>Formulary/criteria effective date</label><input type="date" data-epa-field="evidenceEffectiveDate" value="${esc(evidence.effectiveDate)}"></div>
          <div class="field"><label>Verified by</label><input data-epa-field="evidenceVerifiedBy" value="${esc(evidence.verifiedBy)}"></div>
          <div class="field epa-span"><label>Restrictions / evidence notes</label><textarea data-epa-field="evidenceNotes" rows="3">${esc(evidence.notes)}</textarea></div>
        </div></details>

        <details><summary>External submission, decision, and follow-up</summary><div class="epa-grid">
          <div class="field"><label>Submission method</label><select data-epa-field="submissionMethod">${optionList(EPA_SUBMISSION_METHODS, submission.method)}</select></div>
          <div class="field"><label>Confirmation / PA reference</label><input data-epa-field="submissionReference" value="${esc(submission.reference)}"></div>
          <div class="field"><label>Submitted</label><input type="datetime-local" data-epa-field="submittedAt" value="${esc(localDateTime(submission.submittedAt))}"></div>
          <div class="field"><label>Follow up</label><input type="datetime-local" data-epa-field="followUpAt" value="${esc(localDateTime(submission.followUpAt))}"></div>
          <div class="field"><label>Next workbench action due</label><input type="datetime-local" data-epa-field="nextActionAt" value="${esc(localDateTime(caseItem.nextActionAt))}"></div>
          <div class="field"><label>Decision received</label><input type="datetime-local" data-epa-field="decisionAt" value="${esc(localDateTime(submission.decisionAt))}"></div>
          <div class="field"><label>Authorization expires</label><input type="datetime-local" data-epa-field="expirationAt" value="${esc(localDateTime(submission.expirationAt))}"></div>
          <div class="field epa-span"><label>Decision reason / next step</label><textarea data-epa-field="decisionReason" rows="3">${esc(submission.decisionReason)}</textarea></div>
          <div class="field epa-span"><label>Staff notes</label><textarea data-epa-field="submissionNotes" rows="3">${esc(submission.notes)}</textarea></div>
        </div></details>
        <div class="actions"><button class="btn primary epa-case-save" data-epa-case-id="${esc(caseItem.id)}">Save PA workbench</button></div>
        ${events.length ? `<details><summary>PA activity history</summary><div class="audit">${events.map((event) => `<div class="audit-row"><b>${esc(event.text)}</b><div>${new Date(event.at).toLocaleString()}</div></div>`).join("")}</div></details>` : ""}
      </article>`;
    }).join("")}</section>`;
}

function renderOutputs(row) {
  const tasks = row.tasks || [];
  const documents = row.documents || [];
  const completed = tasks.filter((task) => task.status === "complete").length;
  const medicationPa = buildMedicationAuthorizationReadiness(row);
  const medicationAnswered = medicationPa.candidates.reduce((sum, item) => sum + item.documented, 0);
  const medicationTotal = medicationPa.candidates.reduce((sum, item) => sum + item.total, 0);
  const medicationNotice = medicationPa.candidates.length
    ? `<div class="notice"><b>Medication PA readiness: ${medicationAnswered}/${medicationTotal} common clinical answers found for ${medicationPa.candidates.length} new or changed medication request${medicationPa.candidates.length === 1 ? "" : "s"}.</b> Coverage has not been checked. The prescriber should complete or mark the remaining items not applicable, review the packet, and then use <b>Ready for MA/front desk</b>. Staff still verify the live formulary/benefit and answer any payer-specific follow-up questions.</div>`
    : "";
  return `${medicationNotice}${renderMedicationEpaWorkbench(row)}<div class="notice"><b>${tasks.length - completed} open task${tasks.length - completed === 1 ? "" : "s"}; ${documents.length} generated draft${documents.length === 1 ? "" : "s"}.</b> Drafts live in this encounter packet and synchronize to the protected queue. Edit them here, download when needed, and mark the work complete.</div><h4>Completion tasks</h4>${tasks.length ? tasks.map((task) => `<label class="task ${task.status === "complete" ? "done" : ""}"><input type="checkbox" class="task-toggle" data-task-id="${esc(task.id)}" ${task.status === "complete" ? "checked" : ""}><span><b>${esc(task.title)}</b><small>${esc(task.reason)} · Owner: ${esc(task.owner)} · Suggested role: ${esc(task.recommendedRole)} · Due ${new Date(task.dueAt).toLocaleString()}</small></span></label>`).join("") : '<p class="privacy">Paste or update the note to generate work tasks.</p>'}<h4>Generated documents and forms</h4>${documents.length ? documents.map((document) => `<div class="document-card"><div class="output-head"><div><b>${esc(document.title)}</b><p>${esc(document.reason)}</p></div><span class="badge ${document.status === "complete" ? "complete" : "warning"}">${esc(document.status)}</span></div><textarea class="document-content" data-document-id="${esc(document.id)}" rows="12">${esc(document.content)}</textarea><div class="actions"><button class="btn document-save" data-document-id="${esc(document.id)}">Save draft</button><button class="btn document-ready" data-document-id="${esc(document.id)}" ${document.status === "complete" ? "disabled" : ""}>${document.type === "medication_authorization" ? "Ready for MA/front desk" : "Mark ready"}</button><button class="btn primary document-complete" data-document-id="${esc(document.id)}" ${document.status === "complete" ? "disabled" : ""}>Complete</button><button class="btn document-download" data-document-id="${esc(document.id)}">Download .txt</button></div></div>`).join("") : '<p class="privacy">No generated document is required from the language detected in this note.</p>'}`;
}

function renderCharm(row) {
  const gate = canQueueCharmEntry(row);
  const openDownstream = [].concat(row.tasks || []).filter((task) => task.status !== "complete").length;
  return `<div class="notice"><b>Supervised Charm Draft Bridge</b><br>Copy one approved packet to the no-network browser extension. It can fill detected draft text fields, but it never saves or signs the chart.</div>
    <div class="approval"><label><input type="checkbox" id="providerApproved" ${row.providerApproved ? "checked" : ""}> I reviewed the clinical note, diagnoses, codes, modifiers, units, and generated documents. They are approved for draft entry.</label></div>
    <ul class="guardrails"><li>Personally match both patient and encounter before entry.</li><li>Never add unsupported findings or change clinical meaning.</li><li>The bridge never signs, prescribes, saves, submits a claim, or releases information.</li><li>Review every highlighted field in CharmHealth before saving it yourself.</li></ul>
    <div class="actions"><button class="btn" id="copyApprovedNote" ${gate.allowed ? "" : "disabled"}>Copy approved note</button><button class="btn bronze" id="copyCharm" ${gate.allowed ? "" : "disabled"}>Copy Charm packet</button><a class="btn link" href="charm-bridge-setup.html">Bridge setup</a><button class="btn" id="markCharmSaved" ${gate.allowed ? "" : "disabled"}>Confirm Charm draft saved</button><button class="btn primary" id="closeEncounter" ${row.charmDraftSaved ? "" : "disabled"}>${openDownstream ? "Close documentation; keep tasks open" : "Close workflow"}</button>${row.charmDraftSaved ? '<span class="badge complete">Draft verified in Charm</span>' : ""}</div>
    ${row.charmDraftSaved && openDownstream ? `<p class="privacy">${openDownstream} downstream task${openDownstream === 1 ? " remains" : "s remain"}. Closing documentation will leave the encounter in Orders/forms pending until staff complete them.</p>` : ""}
    ${gate.allowed ? "" : `<p class="privacy">${esc(gate.reasons.join(" "))}</p>`}`;
}

function renderHistory(row) {
  return `<div class="audit">${row.auditTrail.length ? row.auditTrail.slice().reverse().map((entry) => `<div class="audit-row"><b>${esc(entry.text)}</b><div>${new Date(entry.at).toLocaleString()}</div></div>`).join("") : '<div class="privacy">No workflow activity recorded.</div>'}</div>`;
}

async function runEncounterAnalysis(row) {
  sync(row);
  if (row.note.trim().length < 20) {
    showToast("Paste the Freed note before running the full analysis.");
    return;
  }
  reports.set(row.id, analyzeNote(row.note, { codes: row.codes, dxCodes: row.diagnoses }));
  row.clinicalAudit = parseClinicalAuditReport("", row);
  row.providerApproved = false;
  row.charmDraftSaved = false;
  row.status = WORKFLOW_STATUS.AUDIT_REVIEW;
  activeTab = "clinical";
  analyzingId = row.id;
  log(row, "Documentation, coding, and clinical audit started from the encounter packet");
  persist();
  render();

  try {
    if (!cloudClient) throw new Error("The protected Google Cloud audit connection is not available yet. Wait for Google Cloud synced, then run the analysis again.");
    const result = await cloudClient.analyze(row);
    const audit = parseClinicalAuditReport(result.rawReport, row);
    audit.source = result.source || "BHW on-demand documentation analysis";
    audit.sourceNoteHash = result.sourceNoteHash || "";
    audit.automatedAt = result.automatedAt || new Date().toISOString();
    audit.model = result.model || "";
    audit.automationRunId = result.automationRunId || "";
    row.clinicalAudit = audit;
    refreshEncounterIntelligence(row);
    const summary = clinicalAuditSummary(row.clinicalAudit);
    const pendingCoding = row.codingRecommendations.some((item) => item.status === "pending");
    row.status = summary.pending
      ? WORKFLOW_STATUS.AUDIT_REVIEW
      : pendingCoding ? WORKFLOW_STATUS.CODING_REVIEW : WORKFLOW_STATUS.READY_FOR_PROVIDER;
    log(row, `Full clinical analysis completed; ${summary.pending} Required Changes finding${summary.pending === 1 ? "" : "s"} require provider decisions`);
    showToast(summary.pending
      ? "Analysis complete. Required Changes is first—resolve each finding before Charm approval."
      : "Analysis complete with no unresolved Required Changes findings.");
  } catch (error) {
    row.status = WORKFLOW_STATUS.NEEDS_CLARIFICATION;
    log(row, "Clinical audit could not complete; provider review remains blocked");
    showToast(error.message || "The clinical audit could not complete. No approval was granted.", 9000);
  } finally {
    analyzingId = "";
    persist();
    render();
  }
}

function wireDetail(row) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab,.panel").forEach((element) => element.classList.remove("on"));
      tab.classList.add("on");
      $("p-" + tab.dataset.tab).classList.add("on");
      activeTab = tab.dataset.tab;
    };
  });

  document.querySelectorAll(".audit-decision").forEach((button) => {
    button.onclick = () => {
      const card = button.closest(".audit-finding");
      const decision = button.dataset.decision;
      const providerResponse = card?.querySelector(".audit-response")?.value || "";
      const approvedAddendum = card?.querySelector(".audit-addendum")?.value || "";
      if (decision === "occurred" && !approvedAddendum.trim()) {
        showToast("Enter the exact fact you can confirm occurred. The audit suggestion itself cannot become chart documentation.");
        card?.querySelector(".audit-addendum")?.focus();
        return;
      }
      row.clinicalAudit = resolveClinicalAuditFinding(row.clinicalAudit, card.dataset.auditId, decision, { providerResponse, approvedAddendum });
      refreshEncounterIntelligence(row);
      const summary = clinicalAuditSummary(row.clinicalAudit);
      const pendingCoding = row.codingRecommendations.some((item) => item.status === "pending");
      row.providerApproved = false;
      row.charmDraftSaved = false;
      row.status = summary.pending ? WORKFLOW_STATUS.AUDIT_REVIEW : pendingCoding ? WORKFLOW_STATUS.CODING_REVIEW : WORKFLOW_STATUS.READY_FOR_PROVIDER;
      log(row, `Clinical audit finding ${card.dataset.auditId} marked ${decision.replaceAll("_", " ")}`);
      persist();
      render();
    };
  });

  if ($("applyAuditCorrections")) $("applyAuditCorrections").onclick = async () => {
    const corrections = approvedAuditAddenda(row.clinicalAudit);
    if (!corrections.length) return;
    const block = corrections.map((item) => `- ${item.text}`).join("\n");
    $("dNote").value = `${$("dNote").value.trim()}\n\nProvider-confirmed audit clarification:\n${block}`.trim();
    const appliedAt = new Date().toISOString();
    row.clinicalAudit.findings.forEach((finding) => {
      if (corrections.some((item) => item.id === finding.id)) finding.addendumAppliedAt = appliedAt;
    });
    log(row, `${corrections.length} provider-confirmed audit correction${corrections.length === 1 ? "" : "s"} appended; full analysis will rerun`);
    await runEncounterAnalysis(row);
  };

  if ($("reanalyzeAudit")) $("reanalyzeAudit").onclick = () => runEncounterAnalysis(row);

  $("structureSource").onclick = async () => {
    row.notePlan = notePlanFromDetail(row);
    row.noteBuilderInput = builderInputFromDetail(row);
    row.sourceTranscript = $("dTranscript").value.trim();
    if (!row.sourceTranscript) {
      showToast("Paste or enter the Freed draft or transcription first.");
      $("dTranscript").focus();
      return;
    }
    if (!cloudClient) {
      showToast("The protected Google Cloud note organizer is not connected yet.");
      return;
    }
    structuringId = row.id;
    render();
    try {
      const result = await cloudClient.structureNote(row);
      const extracted = result.noteBuilderInput || {};
      const merged = { ...row.noteBuilderInput };
      for (const [key, value] of Object.entries(extracted)) {
        if (["awv", "conditionManagement", "preventiveCare", "controlledMedication", "behavioralHealth", "charmedMinds"].includes(key)) continue;
        if (key !== "transcriptReviewed" && String(value || "").trim()) merged[key] = value;
      }
      for (const group of ["awv", "conditionManagement", "preventiveCare", "controlledMedication", "behavioralHealth", "charmedMinds"]) {
        merged[group] = { ...(row.noteBuilderInput?.[group] || {}) };
        for (const [key, value] of Object.entries(extracted[group] || {})) {
          if (String(value || "").trim()) merged[group][key] = value;
        }
      }
      merged.transcriptReviewed = false;
      row.noteBuilderInput = merged;
      if (merged.orders) row.orders = lineValues(merged.orders);
      if (merged.referrals) row.referrals = lineValues(merged.referrals);
      if (merged.patientInstructions) row.patientInstructions = lineValues(merged.patientInstructions);
      if (merged.returnPrecautions) row.returnPrecautions = lineValues(merged.returnPrecautions);
      if (merged.followUp) row.followUp = lineValues(merged.followUp);
      row.providerApproved = false;
      row.charmDraftSaved = false;
      row.status = WORKFLOW_STATUS.DRAFT_RECEIVED;
      log(row, `Protected source draft organized into editable note fields with ${result.model || "Vertex AI"}; provider review remains required`);
      if (Array.isArray(result.warnings) && result.warnings.length) {
        log(row, `${result.warnings.length} source gap${result.warnings.length === 1 ? "" : "s"} flagged for provider review`);
      }
      persist();
      showToast(result.warnings?.length
        ? `Draft organized. Review the populated fields and ${result.warnings.length} source gap${result.warnings.length === 1 ? "" : "s"}, then confirm the source.`
        : "Draft organized into editable fields. Review them, confirm the source, then generate the structured note.");
    } catch (error) {
      showToast(error.message || "The protected note organizer could not process this source draft.");
    } finally {
      structuringId = "";
      render();
    }
  };

  $("generateNote").onclick = () => {
    row.notePlan = notePlanFromDetail(row);
    row.noteBuilderInput = builderInputFromDetail(row);
    row.sourceTranscript = $("dTranscript").value.trim();
    if (!row.sourceTranscript) {
      showToast("Paste or enter the source transcription before generating the structured note.");
      $("dTranscript").focus();
      return;
    }
    if (!row.noteBuilderInput.transcriptReviewed) {
      showToast("Review the source transcription and confirm it may be used before generating the note.");
      $("nbTranscriptReviewed").focus();
      return;
    }
    const result = composeEncounterNote({
      ...row,
      ...row.noteBuilderInput,
      transcript: row.sourceTranscript,
      transcriptReviewed: true,
      notePlan: row.notePlan,
      encounterSnapshot: row.encounterSnapshot,
      orders: row.orders,
      referrals: row.referrals,
      patientInstructions: row.patientInstructions,
      returnPrecautions: row.returnPrecautions,
      followUp: row.noteBuilderInput.followUp || row.followUp,
    });
    row.note = result.note;
    row.notePlan = result.notePlan;
    row.noteDraftMeta = {
      generatedAt: result.generatedAt,
      generator: "BHW Encounter Note Builder",
      missing: result.missing,
    };
    row.providerApproved = false;
    row.charmDraftSaved = false;
    row.clinicalAudit = normalizeClinicalAudit(null);
    row.status = WORKFLOW_STATUS.DRAFT_RECEIVED;
    reports.delete(row.id);
    refreshEncounterIntelligence(row);
    log(row, `Structured note draft generated from ${PRIMARY_NOTE_TEMPLATES[row.notePlan.primaryTemplate].label} with ${row.notePlan.modules.length} additional module${row.notePlan.modules.length === 1 ? "" : "s"}`);
    persist();
    render();
    showToast(result.missing.length
      ? `Structured draft created. ${result.missing.length} required element${result.missing.length === 1 ? "" : "s"} still need provider documentation before approval.`
      : "Structured draft created. Run the documentation, coding, HCC, Z-code, and clinical audit next.");
  };

  $("pasteFreed").onclick = async () => {
    try {
      const note = await navigator.clipboard.readText();
      if (!note.trim()) throw new Error("The clipboard is empty.");
      $("dTranscript").value = note;
      sync(row);
      row.status = WORKFLOW_STATUS.DRAFT_RECEIVED;
      reports.delete(row.id);
      log(row, "Source transcription or clinical draft pasted into the encounter packet");
      persist();
      render();
      showToast("Source material loaded. Review it, select the note template and modules, then generate the structured note.");
    } catch (error) {
      showToast(error.message || "Clipboard access was blocked. Click in the note box and press Ctrl+V.");
    }
  };

  $("analyze").onclick = () => runEncounterAnalysis(row);

  $("savePacket").onclick = () => {
    const changed = sync(row);
    log(row, changed ? "Encounter packet updated; approval rechecked" : "Encounter packet updated");
    persist();
    render();
    showToast("Encounter packet updated.");
  };

  $("dStatus").onchange = (event) => {
    row.status = event.target.value;
    log(row, `Status changed to ${STATUS_LABELS[row.status]}`);
    persist();
    render();
  };

  document.querySelectorAll(".coding-decision").forEach((button) => {
    button.onclick = () => {
      const card = button.closest(".coding-clarification");
      const recommendation = row.codingRecommendations.find((item) => item.id === card?.dataset.recommendationId);
      const decision = button.dataset.decision;
      const providerResponse = card?.querySelector(".coding-response")?.value || "";
      const approvedAddendum = card?.querySelector(".coding-addendum")?.value || "";
      if (decision === "occurred" && !approvedAddendum.trim()) {
        showToast("Enter the exact fact you can personally confirm occurred. A coding question cannot become chart documentation by itself.");
        card?.querySelector(".coding-addendum")?.focus();
        return;
      }
      if (decision === "already_documented" && !providerResponse.trim()) {
        showToast("Enter where the supporting fact is already documented so it can be verified on rerun.");
        card?.querySelector(".coding-response")?.focus();
        return;
      }
      if (!resolveCodingClarification(recommendation, card.dataset.clarificationId, decision, { providerResponse, approvedAddendum })) return;
      row.providerApproved = false;
      row.charmDraftSaved = false;
      row.status = WORKFLOW_STATUS.CODING_REVIEW;
      log(row, `Coding clarification ${card.dataset.clarificationId} marked ${decision.replaceAll("_", " ")}`);
      persist();
      render();
    };
  });

  if ($("applyCodingCorrections")) $("applyCodingCorrections").onclick = async () => {
    const corrections = approvedCodingAddenda(row.codingRecommendations);
    if (!corrections.length) return;
    const block = corrections.map((item) => `- ${item.text}`).join("\n");
    $("dNote").value = `${$("dNote").value.trim()}\n\nProvider-confirmed coding clarification:\n${block}`.trim();
    const appliedAt = new Date().toISOString();
    for (const correction of corrections) {
      const recommendation = row.codingRecommendations.find((item) => item.id === correction.recommendationId);
      const question = recommendation?.clarifications?.find((item) => item.id === correction.id);
      if (question) question.addendumAppliedAt = appliedAt;
    }
    log(row, `${corrections.length} provider-confirmed coding fact${corrections.length === 1 ? "" : "s"} appended; MDM and time analysis will rerun`);
    await runEncounterAnalysis(row);
  };

  document.querySelectorAll(".apply-code").forEach((button) => {
    button.onclick = () => {
      const recommendation = row.codingRecommendations.find((item) => item.id === button.dataset.recommendationId);
      if (!recommendation || !applyCodingOpportunity(row, recommendation)) return;
      row.providerApproved = false;
      row.charmDraftSaved = false;
      row.status = WORKFLOW_STATUS.CODING_REVIEW;
      refreshEncounterIntelligence(row);
      log(row, `${recommendation.code} coding recommendation applied to the editable encounter fields; provider approval required`);
      persist();
      render();
      showToast(`${recommendation.code} added to the editable fields. Review the evidence and approve before Charm entry.`);
    };
  });

  document.querySelectorAll(".dismiss-code").forEach((button) => {
    button.onclick = () => {
      const recommendation = row.codingRecommendations.find((item) => item.id === button.dataset.recommendationId);
      if (!recommendation) return;
      recommendation.status = "dismissed";
      recommendation.decidedAt = new Date().toISOString();
      log(row, `${recommendation.code} coding recommendation dismissed`);
      const stillPending = row.codingRecommendations.some((item) => item.status === "pending");
      if (!stillPending && row.status === WORKFLOW_STATUS.CODING_REVIEW) row.status = WORKFLOW_STATUS.READY_FOR_PROVIDER;
      persist();
      render();
    };
  });

  document.querySelectorAll(".epa-case-save").forEach((button) => {
    button.onclick = () => {
      const card = button.closest(".epa-case");
      const caseItem = row.medicationEpaCases?.find((item) => item.id === button.dataset.epaCaseId);
      if (!card || !caseItem) return;
      const value = (name) => card.querySelector(`[data-epa-field="${name}"]`)?.value || "";
      const checked = (name) => Boolean(card.querySelector(`[data-epa-field="${name}"]`)?.checked);
      const profileEntry = PAYER_CATALOG.find((item) => item.id === value("payerProfileId")) || PAYER_CATALOG[0];
      const questionPatch = (question, kind) => {
        const questionCard = [...card.querySelectorAll(`.epa-question[data-question-kind="${kind}"]`)].find((element) => element.dataset.questionId === question.id);
        if (!questionCard) return question;
        return {
          ...question,
          answer: questionCard.querySelector(".epa-question-answer")?.value || "",
          disposition: questionCard.querySelector(".epa-question-disposition")?.value || "unanswered",
          source: kind === "common" ? "provider" : question.source === "encounter_suggestion" ? "provider" : question.source,
        };
      };
      const result = updateMedicationEpaCase(caseItem, {
        status: value("status"),
        coverageProfile: {
          payerProfileId: profileEntry.id,
          payerFamily: profileEntry.family,
          lineOfBusiness: profileEntry.lineOfBusiness,
          payer: value("payer"),
          planName: value("planName"),
          memberId: value("memberId"),
          bin: value("bin"),
          pcn: value("pcn"),
          rxGroup: value("rxGroup"),
          groupNumber: value("groupNumber"),
          benefitAdministratorId: value("benefitAdministratorId"),
          pbm: value("pbm"),
          medicareContractId: value("medicareContractId"),
          medicarePbpId: value("medicarePbpId"),
        },
        questions: caseItem.questions.map((question) => questionPatch(question, "common")),
        payerQuestionnaire: {
          source: value("questionnaireSource"),
          receivedAt: value("questionnaireReceivedAt"),
          rawText: value("questionnaireRawText"),
          questions: [].concat(caseItem.payerQuestionnaire?.questions || []).map((question) => questionPatch(question, "payer")),
        },
        providerReview: {
          attested: checked("attested"),
          attestedBy: value("attestedBy"),
          attestedAt: caseItem.providerReview?.attestedAt,
        },
        coverageEvidence: {
          status: value("evidenceStatus"),
          sourceType: value("evidenceSourceType"),
          sourceLabel: value("evidenceSourceLabel"),
          sourceUrl: value("evidenceSourceUrl"),
          checkedAt: value("evidenceCheckedAt"),
          effectiveDate: value("evidenceEffectiveDate"),
          verifiedBy: value("evidenceVerifiedBy"),
          notes: value("evidenceNotes"),
        },
        submission: {
          method: value("submissionMethod"),
          reference: value("submissionReference"),
          submittedAt: value("submittedAt"),
          followUpAt: value("followUpAt"),
          decisionAt: value("decisionAt"),
          expirationAt: value("expirationAt"),
          decisionReason: value("decisionReason"),
          notes: value("submissionNotes"),
        },
        nextActionAt: value("nextActionAt"),
      });
      if (!result.ok) {
        showToast(result.reasons.join(" "), 9000);
        return;
      }
      row.medicationEpaCases = row.medicationEpaCases.map((item) => item.id === caseItem.id ? result.caseItem : item);
      row.coverage = { ...(row.coverage || {}), ...result.caseItem.coverageProfile };
      const allComplete = row.medicationEpaCases.length && row.medicationEpaCases.every(isMedicationEpaCaseComplete);
      row.tasks.filter((task) => task.type === "medication_authorization").forEach((task) => {
        task.status = allComplete ? "complete" : "open";
        task.completedAt = allComplete ? new Date().toISOString() : "";
      });
      if (allComplete) row.documents.filter((document) => document.type === "medication_authorization").forEach((document) => {
        document.status = "complete";
        document.updatedAt = new Date().toISOString();
      });
      log(row, `${result.caseItem.medicationName} PA workbench saved as ${EPA_CASE_STATUSES[result.caseItem.status]}`);
      persist();
      render();
      showToast(result.caseItem.status === "ready_for_staff" ? "Provider answers are ready for the MA/front desk benefit check." : "Medication PA workbench saved.");
    };
  });

  document.querySelectorAll(".task-toggle").forEach((checkbox) => {
    checkbox.onchange = () => {
      const task = row.tasks.find((item) => item.id === checkbox.dataset.taskId);
      if (!task) return;
      if (checkbox.checked && task.type === "medication_authorization") {
        const epaCases = row.medicationEpaCases || [];
        if (epaCases.length && !epaCases.every(isMedicationEpaCaseComplete)) {
          checkbox.checked = false;
          showToast("Keep this task open until every medication PA case is approved, confirmed not required, or closed with its tracked outcome.");
          return;
        }
        const handoff = row.documents.find((item) => item.id === task.documentId);
        if (!epaCases.length && (!handoff || handoff.status === "draft")) {
          checkbox.checked = false;
          showToast("Review the medication PA packet and use Ready for MA/front desk before completing this task.");
          return;
        }
      }
      task.status = checkbox.checked ? "complete" : "open";
      task.completedAt = checkbox.checked ? new Date().toISOString() : "";
      if (row.charmDraftSaved) row.status = row.tasks.every((item) => item.status === "complete") ? WORKFLOW_STATUS.CLOSED : WORKFLOW_STATUS.DOWNSTREAM_PENDING;
      log(row, `${task.title} task marked ${task.status}`);
      persist();
      render();
    };
  });

  const saveDocument = (button, status) => {
    const documentItem = row.documents.find((item) => item.id === button.dataset.documentId);
    const content = button.closest(".document-card")?.querySelector(".document-content")?.value;
    if (!documentItem || typeof content !== "string") return;
    if (documentItem.type === "medication_authorization" && status === "ready") {
      const validation = validateMedicationAuthorizationHandoff(content);
      if (!validation.valid) {
        showToast(validation.reasons.join(" "));
        return;
      }
    }
    if (documentItem.type === "medication_authorization" && status === "complete") {
      const epaCases = row.medicationEpaCases || [];
      if (epaCases.length && !epaCases.every(isMedicationEpaCaseComplete)) {
        showToast("The handoff can be marked ready now, but it stays open until the external PA outcome is tracked in the workbench.");
        return;
      }
    }
    const changed = documentItem.content !== content || documentItem.status !== status;
    documentItem.content = content;
    documentItem.status = status;
    documentItem.updatedAt = new Date().toISOString();
    if (changed && row.providerApproved) {
      row.providerApproved = false;
      row.charmDraftSaved = false;
      row.status = WORKFLOW_STATUS.READY_FOR_PROVIDER;
    }
    if (status === "complete") {
      const task = row.tasks.find((item) => item.documentId === documentItem.id);
      if (task) {
        task.status = "complete";
        task.completedAt = new Date().toISOString();
      }
      if (row.charmDraftSaved) row.status = row.tasks.every((item) => item.status === "complete") ? WORKFLOW_STATUS.CLOSED : WORKFLOW_STATUS.DOWNSTREAM_PENDING;
    }
    log(row, `${documentItem.title} saved as ${status}`);
    persist();
    render();
    showToast(`${documentItem.title} saved in the encounter packet.`);
  };

  document.querySelectorAll(".document-save").forEach((button) => { button.onclick = () => saveDocument(button, "draft"); });
  document.querySelectorAll(".document-ready").forEach((button) => { button.onclick = () => saveDocument(button, "ready"); });
  document.querySelectorAll(".document-complete").forEach((button) => { button.onclick = () => saveDocument(button, "complete"); });
  document.querySelectorAll(".document-download").forEach((button) => {
    button.onclick = () => {
      const documentItem = row.documents.find((item) => item.id === button.dataset.documentId);
      const content = button.closest(".document-card")?.querySelector(".document-content")?.value;
      if (!documentItem || typeof content !== "string") return;
      documentItem.content = content;
      documentItem.updatedAt = new Date().toISOString();
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${row.id}-${documentItem.type}-draft.txt`.replace(/[^a-z0-9._-]+/gi, "-");
      link.click();
      URL.revokeObjectURL(link.href);
      log(row, `${documentItem.title} downloaded for supervised use`);
      persist();
    };
  });

  $("providerApproved").onchange = () => {
    sync(row, { invalidateApproval: false });
    const auditSummary = clinicalAuditSummary(row.clinicalAudit);
    if ($("providerApproved").checked && auditSummary.status === "not_run") {
      row.providerApproved = false;
      showToast("Run the Required Changes clinical audit before approving Charm entry.");
    } else if ($("providerApproved").checked && auditSummary.blocking) {
      row.providerApproved = false;
      showToast(`Resolve the ${auditSummary.blocking} pending Critical/High clinical audit finding${auditSummary.blocking === 1 ? "" : "s"} before approving Charm entry.`);
    } else if ($("providerApproved").checked && (!row.note.trim() || !row.codes.length)) {
      row.providerApproved = false;
      showToast("An approved note and at least one approved CPT/HCPCS code are required.");
    } else {
      row.providerApproved = $("providerApproved").checked;
      row.charmDraftSaved = false;
      if (row.providerApproved) {
        row.status = WORKFLOW_STATUS.APPROVED_FOR_ENTRY;
        log(row, "Provider approved the note and codes for supervised draft entry");
      } else {
        row.status = WORKFLOW_STATUS.READY_FOR_PROVIDER;
        log(row, "Provider approval removed");
      }
    }
    persist();
    render();
  };

  $("copyApprovedNote").onclick = async () => {
    sync(row);
    if (!row.providerApproved) {
      persist();
      render();
      showToast("Clinical content changed. Review and approve it again before copying.");
      return;
    }
    await copyText(row.note, "Approved note copied. Paste it only into the matched Charm encounter.");
    log(row, "Approved note copied for supervised Charm entry");
    persist();
  };

  $("copyCharm").onclick = async () => {
    sync(row);
    const result = buildCharmPacket(row);
    if (!result.ok) {
      persist();
      render();
      showToast(result.reasons.join(" "));
      return;
    }
    if (await copyText(JSON.stringify(result.packet, null, 2), "Approved Charm packet copied. Open the matched Charm encounter and the BHW bridge.")) {
      row.status = WORKFLOW_STATUS.APPROVED_FOR_ENTRY;
      log(row, "Approved Charm packet copied to the supervised draft bridge");
      persist();
      renderQueue();
    }
  };

  $("markCharmSaved").onclick = () => {
    if (!confirm("Confirm that you personally reviewed the matched Charm encounter and saved the draft without signing or submitting it.")) return;
    row.charmDraftSaved = true;
    row.status = WORKFLOW_STATUS.CHARM_DRAFT_SAVED;
    log(row, "Provider confirmed the reviewed draft was saved in CharmHealth");
    persist();
    render();
  };

  $("closeEncounter").onclick = () => {
    const openTasks = row.tasks.filter((task) => task.status !== "complete");
    row.status = openTasks.length ? WORKFLOW_STATUS.DOWNSTREAM_PENDING : WORKFLOW_STATUS.CLOSED;
    log(row, openTasks.length
      ? `Documentation closed after Charm draft verification; ${openTasks.length} downstream task${openTasks.length === 1 ? " remains" : "s remain"}`
      : "Encounter workflow closed after Charm draft verification");
    persist();
    render();
  };

  $("deleteEncounter").onclick = async () => {
    if (!confirm(`Remove ${row.id} from this browser's operational queue? This does not alter Freed or CharmHealth.`)) return;
    rows = rows.filter((candidate) => candidate.id !== row.id);
    if (cloudClient) {
      try { await cloudClient.remove(row.id); }
      catch (error) { setCloudState("error"); showToast(error.message || "The cloud copy could not be removed."); }
    }
    reports.delete(row.id);
    selected = rows[0]?.id || null;
    persist();
    render();
    showToast("Encounter removed from this browser queue.");
  };
}

function updateClock() {
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " · monitoring";
}

function checkAlerts() {
  const previous = readJson(localStorage, ALERTS_KEY, {});
  let changed = false;
  rows.forEach((row) => {
    const urgency = urgencyFor(row);
    const transition = alertTransition(row, previous[row.id] || "ontrack");
    if (transition) {
      const message = `${row.id}: ${transition.label}. Current owner: ${row.owner}.`;
      showToast(message, 9000);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("BHW 24-hour chart alert", { body: message, tag: `bhw-${row.id}-${transition.level}` });
      }
    }
    if (previous[row.id] !== urgency.level) {
      previous[row.id] = urgency.level;
      changed = true;
    }
  });
  if (changed) storageSet(localStorage, ALERTS_KEY, JSON.stringify(previous));
}

function render() {
  renderKpis();
  renderQueue();
  renderDetail();
  updateClock();
}

function tick() {
  renderKpis();
  renderQueue();
  updateClock();
  checkAlerts();
}

function openEncounterModal() {
  $("modal").classList.add("on");
  const automaticIdsReady = Boolean(cloudClient);
  encounterCreationKey = globalThis.crypto?.randomUUID?.() || `encounter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  $("mCompleted").value = date.toISOString().slice(0, 16);
  const pendingPatientId = storageGet(sessionStorage, PENDING_PATIENT_KEY, "");
  if (pendingPatientId) {
    $("mPatient").value = pendingPatientId;
    try { sessionStorage.removeItem(PENDING_PATIENT_KEY); } catch { /* session storage may be unavailable */ }
  }
  $("mId").readOnly = automaticIdsReady;
  $("mId").value = "";
  $("mId").placeholder = automaticIdsReady ? "Assigned when saved" : "ENC-YYYY-####";
  $("mPrimary").value = "established_office";
  $("mModules").querySelectorAll("input[data-note-module]").forEach((input) => { input.checked = false; });
  $("encounterIdNotice").innerHTML = registryReady
    ? "<b>The Encounter ID is assigned automatically by Google Cloud.</b> Select the verified BHW Patient ID for clinical work. Use reserved ID <b>BHW0000</b> only for the de-identified synthetic role-play pilot; it never links to the Patient Registry."
    : automaticIdsReady
      ? "<b>The Encounter ID is assigned automatically by Google Cloud.</b> The Patient Registry list is temporarily unavailable, so only reserved test ID <b>BHW0000</b> may create a new synthetic packet."
      : "<b>Google Cloud is not connected, so a new Encounter ID cannot be reserved safely.</b> You may enter an existing Encounter ID only for temporary or migration work.";
  $("mPatient").focus();
}

function renderPatientOptions() {
  const options = patients.map((patient) => {
    const lastName = [patient.legalLastName, patient.nameSuffix].filter(Boolean).join(" ");
    const name = [lastName, patient.legalFirstName].filter(Boolean).join(", ");
    return `<option value="${esc(patient.bhwPatientId)}" label="${esc(name || patient.bhwPatientId)}"></option>`;
  }).join("");
  $("patientOptions").innerHTML = options;
}

function renderNotePlanOptions() {
  $("mPrimary").innerHTML = templateOptions("established_office");
  $("mModules").innerHTML = moduleOptions([]);
}

document.querySelectorAll(".filter").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll(".filter").forEach((candidate) => candidate.classList.remove("on"));
    button.classList.add("on");
    filter = button.dataset.filter;
    renderQueue();
  };
});

$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  storageSet(localStorage, THEME_KEY, dark ? "light" : "dark");
};

if (storageGet(localStorage, THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";

$("alerts").onclick = async () => {
  if (!("Notification" in window)) {
    showToast("This browser does not support desktop notifications. The dashboard alerts will still work while it is open.");
    return;
  }
  const permission = await Notification.requestPermission();
  $("alerts").textContent = permission === "granted" ? "Alerts enabled" : "Alerts blocked";
  showToast(permission === "granted" ? "Desktop 12-, 20-, and 24-hour alerts are enabled." : "Desktop alerts were not enabled. Dashboard urgency badges will continue working.");
};

if ("Notification" in window && Notification.permission === "granted") $("alerts").textContent = "Alerts enabled";

$("newEncounter").onclick = openEncounterModal;
$("cancel").onclick = () => $("modal").classList.remove("on");
$("create").onclick = async () => {
  const button = $("create");
  const bhwPatientId = $("mPatient").value.trim().toUpperCase();
  const syntheticRolePlay = bhwPatientId === "BHW0000";
  if (bhwPatientId && !/^BHW\d{4}$/.test(bhwPatientId)) {
    showToast("Enter a BHW Patient ID in the BHW#### format.");
    $("mPatient").focus();
    return;
  }
  if (!syntheticRolePlay && !registryReady) {
    showToast("The Patient Registry is not connected. Refresh or sign in again before creating a real-patient encounter.");
    $("mPatient").focus();
    return;
  }
  if (registryReady && !syntheticRolePlay && !patients.some((patient) => patient.bhwPatientId === bhwPatientId)) {
    showToast("Select a patient from the protected Patient Registry before creating the encounter.");
    $("mPatient").focus();
    return;
  }
  const completedAt = new Date($("mCompleted").value);
  if (!Number.isFinite(completedAt.getTime())) {
    showToast("Enter the visit completion date and time.");
    return;
  }
  const selectedPatient = patients.find((patient) => patient.bhwPatientId === bhwPatientId);
  const draft = {
    bhwPatientId,
    provider: $("mProvider").value.trim() || "Amaris",
    owner: "Amaris",
    completedAt: completedAt.toISOString(),
    payer: $("mPayer").value,
    coverage: {
      payer: $("mPayer").value || selectedPatient?.primaryPayer || "",
      planName: selectedPatient?.insurancePlanName || selectedPatient?.primaryPayer || $("mPayer").value || "",
      pbm: selectedPatient?.pbm || "",
      memberId: selectedPatient?.memberId || "",
    },
    visitType: PRIMARY_NOTE_TEMPLATES[$("mPrimary").value]?.label || "Established Office Visit",
    notePlan: normalizeNotePlan({
      primaryTemplate: $("mPrimary").value,
      modules: selectedModules($("mModules")),
    }),
    codes: [],
    auditTrail: [{ at: new Date().toISOString(), text: "Encounter packet created; awaiting Freed draft" }],
  };
  let packet;
  let assignedAutomatically = false;
  button.disabled = true;
  try {
    if (cloudClient) {
      const created = await cloudClient.create(draft, encounterCreationKey);
      packet = buildEncounterPacket(created);
      assignedAutomatically = true;
    } else {
      const id = $("mId").value.trim().toUpperCase();
      if (!/^ENC-\d{4}-\d{4}$/.test(id)) {
        showToast("Enter an existing Encounter ID in the ENC-YYYY-#### format.");
        $("mId").focus();
        return;
      }
      if (rows.some((row) => row.id.toLowerCase() === id.toLowerCase())) {
        showToast("That encounter ID is already in the queue.");
        return;
      }
      packet = buildEncounterPacket({ ...draft, id, encounterId: id });
    }
  } catch (error) {
    showToast(error.message || "The encounter could not be created.");
    return;
  } finally {
    button.disabled = false;
  }
  rows.unshift(packet);
  selected = packet.id;
  $("mPatient").value = "";
  $("mId").value = "";
  $("modal").classList.remove("on");
  persist();
  render();
  showToast(`${packet.id} ${assignedAutomatically ? "created automatically" : "added"}. Copy the note in Freed, then choose Paste from Freed.`);
};

window.addEventListener("beforeunload", persist);
renderNotePlanOptions();
render();
checkAlerts();
setInterval(tick, 60000);

async function initializeCloudQueue() {
  setCloudState("connecting");
  try {
    const client = await createEncounterCloudClient();
    if (!client) {
      setCloudState("browser");
      return;
    }
    const remoteRows = await client.list();
    cloudClient = client;
    try {
      patients = await client.listPatients();
      registryReady = true;
    } catch {
      patients = [];
      registryReady = false;
    }
    renderPatientOptions();
    if (remoteRows.length) {
      rows = remoteRows.map((row) => {
        const patient = patients.find((item) => item.bhwPatientId === row.bhwPatientId);
        const registryCoverage = patient ? Object.fromEntries(Object.entries({
          payer: patient.primaryPayer || row.payer || "",
          planName: patient.insurancePlanName || patient.primaryPayer || "",
          pbm: patient.pbm || "",
          memberId: patient.memberId || "",
        }).filter(([, value]) => String(value || "").trim())) : {};
        return buildEncounterPacket({ ...row, coverage: { ...(row.coverage || {}), ...registryCoverage } });
      });
      selected = rows.some((row) => row.id === selected) ? selected : (rows[0]?.id || null);
    } else if (rows.length) {
      await client.saveAll(rows);
    }
    setCloudState("connected");
    persist();
    render();
  } catch (error) {
    setCloudState("error");
    showToast(error.message || "Google Cloud sync is not available. The temporary browser queue is still working.");
  }
}

initializeCloudQueue();
