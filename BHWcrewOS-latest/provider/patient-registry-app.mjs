import { createEncounterCloudClient } from "./cloud-queue.mjs";

const THEME_KEY = "bhw_provider_theme_v1";
const PENDING_PATIENT_KEY = "bhw_pending_encounter_patient_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const PAYERS = ["Medicare", "Medicare + QMB", "Maryland Medicaid", "CareFirst BCBS", "UnitedHealthcare Commercial", "UnitedHealthcare Medicare Advantage", "UnitedHealthcare Community Plan", "Aetna Commercial", "Aetna Better Health of Maryland", "Cigna", "Humana", "Maryland Physicians Care", "TRICARE", "Alterwood Advantage", "Self-pay", "Other"];
const STATUS_OPTIONS = ["active", "prospective", "inactive", "transferred", "deceased"];
const COVERAGE_OPTIONS = ["verified", "pending", "needs-review", "inactive", "self-pay", "unknown"];

let client = null;
let patients = [];
let selectedId = "";
let toastTimer;

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), 6500);
}

function field(id, label, value = "", type = "text", options = []) {
  const optionValues = value && options.length && !options.includes(value) ? [value, ...options] : options;
  const control = optionValues.length
    ? `<select id="${id}">${optionValues.map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>`
    : `<input id="${id}" type="${type}" value="${esc(value)}">`;
  return `<div class="field"><label>${esc(label)}</label>${control}</div>`;
}

function patientFields(patient = {}, prefix = "d", includeId = false) {
  return [
    includeId ? field(`${prefix}Id`, "BHW Patient ID", patient.bhwPatientId || "") : "",
    field(`${prefix}First`, "Legal first name", patient.legalFirstName || ""),
    field(`${prefix}Last`, "Legal last name", patient.legalLastName || ""),
    field(`${prefix}Preferred`, "Preferred name", patient.preferredName || ""),
    field(`${prefix}Dob`, "Date of birth", patient.dateOfBirth || "", "date"),
    field(`${prefix}Phone`, "Primary phone", patient.phone || "", "tel"),
    field(`${prefix}Email`, "Email", patient.email || "", "email"),
    field(`${prefix}Status`, "Patient status", patient.patientStatus || "active", "select", STATUS_OPTIONS),
    field(`${prefix}Payer`, "Primary payer", patient.primaryPayer || PAYERS[0], "select", PAYERS),
    field(`${prefix}Member`, "Member ID", patient.memberId || ""),
    field(`${prefix}Coverage`, "Coverage status", patient.coverageStatus || "unknown", "select", COVERAGE_OPTIONS),
    field(`${prefix}Referral`, "Referral source", patient.referralSource || ""),
    field(`${prefix}Staff`, "Responsible staff", patient.responsibleStaff || "Operations Manager"),
  ].join("");
}

function readPatient(prefix, bhwPatientId = "") {
  return {
    bhwPatientId: (bhwPatientId || $(`${prefix}Id`)?.value || "").trim().toUpperCase(),
    legalFirstName: $(`${prefix}First`).value.trim(),
    legalLastName: $(`${prefix}Last`).value.trim(),
    preferredName: $(`${prefix}Preferred`).value.trim(),
    dateOfBirth: $(`${prefix}Dob`).value,
    phone: $(`${prefix}Phone`).value.trim(),
    email: $(`${prefix}Email`).value.trim(),
    patientStatus: $(`${prefix}Status`).value,
    primaryPayer: $(`${prefix}Payer`).value,
    memberId: $(`${prefix}Member`).value.trim(),
    coverageStatus: $(`${prefix}Coverage`).value,
    referralSource: $(`${prefix}Referral`).value.trim(),
    responsibleStaff: $(`${prefix}Staff`).value.trim(),
    lastVerifiedAt: new Date().toISOString(),
  };
}

function validationMessage(patient) {
  if (!/^BHW\d{4}$/.test(patient.bhwPatientId) || patient.bhwPatientId === "BHW0000") return "Enter the verified BHW Patient ID in the BHW#### format.";
  if (!patient.legalFirstName || !patient.legalLastName || !patient.dateOfBirth) return "Legal first name, legal last name, and date of birth are required.";
  return "";
}

function visiblePatients() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  return patients.filter((patient) => {
    const matchesStatus = filter === "all" || (filter === "needs-review" ? patient.coverageStatus === "needs-review" : patient.patientStatus === filter);
    const haystack = [patient.bhwPatientId, patient.legalFirstName, patient.legalLastName, patient.preferredName, patient.phone, patient.primaryPayer, patient.memberId].join(" ").toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function renderKpis() {
  const active = patients.filter((patient) => patient.patientStatus === "active").length;
  const prospective = patients.filter((patient) => patient.patientStatus === "prospective").length;
  const coverageReview = patients.filter((patient) => ["pending", "needs-review", "unknown"].includes(patient.coverageStatus)).length;
  $("kpis").innerHTML = [[patients.length, "Master records"], [active, "Active patients"], [prospective, "Prospective / referrals"], [coverageReview, "Coverage follow-up"]]
    .map(([value, label]) => `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`).join("");
}

function renderRows() {
  const visible = visiblePatients();
  $("patientRows").innerHTML = visible.length ? visible.map((patient) => {
    const name = `${patient.legalLastName}, ${patient.preferredName || patient.legalFirstName}`;
    const coverageClass = patient.coverageStatus === "verified" ? "complete" : "warning";
    return `<tr data-id="${esc(patient.bhwPatientId)}" class="${patient.bhwPatientId === selectedId ? "on" : ""}"><td><b>${esc(patient.bhwPatientId)}</b></td><td>${esc(name)}</td><td>${esc(patient.dateOfBirth)}</td><td>${esc(patient.phone || "—")}</td><td>${esc(patient.primaryPayer || "—")}<br><span class="badge ${coverageClass}">${esc(patient.coverageStatus)}</span></td><td>${esc(patient.patientStatus)}</td></tr>`;
  }).join("") : '<tr><td colspan="6"><div class="empty">No patient records match this view.</div></td></tr>';
  document.querySelectorAll("tr[data-id]").forEach((row) => { row.onclick = () => { selectedId = row.dataset.id; render(); }; });
}

function renderDetail() {
  const patient = patients.find((item) => item.bhwPatientId === selectedId);
  if (!patient) { $("detail").innerHTML = '<div class="empty">Select a patient to review the master record.</div>'; return; }
  $("detail").innerHTML = `<div class="card-head"><div><h3>${esc(patient.bhwPatientId)} · ${esc(patient.legalLastName)}, ${esc(patient.preferredName || patient.legalFirstName)}</h3><div class="privacy">Last verified ${patient.lastVerifiedAt ? new Date(patient.lastVerifiedAt).toLocaleString() : "not recorded"}</div></div><span class="badge ${patient.coverageStatus === "verified" ? "complete" : "warning"}">${esc(patient.coverageStatus)}</span></div><div class="detail"><div class="formgrid">${patientFields(patient)}</div><div class="actions"><button class="btn primary" id="savePatient">Save verified changes</button><button class="btn" id="startEncounter">Create encounter</button></div><div class="privacy">Patient-reported changes must be verified before they replace this authoritative record. This registry supports operations; CharmHealth remains the legal medical record.</div></div>`;
  $("savePatient").onclick = async () => {
    const next = readPatient("d", patient.bhwPatientId);
    const error = validationMessage(next);
    if (error) { showToast(error); return; }
    try {
      const response = await client.savePatient(next);
      Object.assign(patient, response.patient);
      render();
      showToast(`${patient.bhwPatientId} saved to the protected Patient Registry.`);
    } catch (error) { showToast(error.message || "The patient record could not be saved."); }
  };
  $("startEncounter").onclick = () => {
    sessionStorage.setItem(PENDING_PATIENT_KEY, patient.bhwPatientId);
    location.href = "workflow.html";
  };
}

function render() { renderKpis(); renderRows(); renderDetail(); }

$("search").oninput = renderRows;
$("statusFilter").onchange = renderRows;
$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
};
if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";

$("newPatient").onclick = () => { $("newPatientFields").innerHTML = patientFields({}, "n", true); $("modal").classList.add("on"); $("nId").focus(); };
$("cancel").onclick = () => $("modal").classList.remove("on");
$("create").onclick = async () => {
  const patient = readPatient("n");
  const error = validationMessage(patient);
  if (error) { showToast(error); return; }
  if (patients.some((item) => item.bhwPatientId === patient.bhwPatientId)) { showToast("That BHW Patient ID already exists. Open the existing record instead."); return; }
  try {
    const response = await client.savePatient(patient);
    patients.push(response.patient);
    patients.sort((left, right) => `${left.legalLastName}|${left.legalFirstName}`.localeCompare(`${right.legalLastName}|${right.legalFirstName}`));
    selectedId = response.patient.bhwPatientId;
    $("modal").classList.remove("on");
    render();
    showToast(`${selectedId} added to the protected Patient Registry.`);
  } catch (error) { showToast(error.message || "The patient record could not be created."); }
};

async function initialize() {
  try {
    client = await createEncounterCloudClient();
    if (!client) throw new Error("Google Cloud is not configured for this site.");
    patients = await client.listPatients();
    selectedId = patients[0]?.bhwPatientId || "";
    $("cloudStatus").className = "badge complete";
    $("cloudStatus").textContent = "Google Cloud synced";
    $("newPatient").disabled = false;
    render();
  } catch (error) {
    $("cloudStatus").className = "badge warning";
    $("cloudStatus").textContent = "Cloud unavailable";
    $("detail").innerHTML = `<div class="empty"><b>The protected Patient Registry is unavailable.</b><br>${esc(error.message || "Try again after the Google Cloud connection is restored.")}</div>`;
    showToast(error.message || "The Patient Registry could not connect.");
  }
}

initialize();
