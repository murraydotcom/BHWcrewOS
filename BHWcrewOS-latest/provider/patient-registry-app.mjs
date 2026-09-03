import { createPatientRegistryClient } from "./patient-registry-client.mjs";

const THEME_KEY = "bhw_provider_theme_v1";
const PENDING_PATIENT_KEY = "bhw_pending_encounter_patient_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const PAYERS = ["Medicare", "Medicare + QMB", "Maryland Medicaid", "CareFirst BCBS", "UnitedHealthcare Commercial", "UnitedHealthcare Medicare Advantage", "UnitedHealthcare Community Plan", "Aetna Commercial", "Aetna Better Health of Maryland", "Cigna", "Humana", "Maryland Physicians Care", "TRICARE", "Alterwood Advantage", "Self-pay", "Other"];
const STATUS_OPTIONS = ["active", "prospective", "inactive", "transferred", "deceased"];
const COVERAGE_OPTIONS = ["verified", "pending", "needs-review", "inactive", "self-pay", "unknown"];
const CONSENT_SOURCES = ["previsit-form", "new-patient-packet"];

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
    field(`${prefix}Suffix`, "Suffix", patient.nameSuffix || ""),
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
    nameSuffix: $(`${prefix}Suffix`).value.trim(),
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

function localDateTimeValue(value = "") {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function consentSourceLabel(value) {
  return value === "new-patient-packet" ? "New-patient packet" : "Previsit form";
}

async function renderRecordingConsent(bhwPatientId) {
  const panel = $("recordingConsentPanel");
  if (!panel) return;
  try {
    const result = await client.recordingConsent(bhwPatientId);
    if (selectedId !== bhwPatientId || !$("recordingConsentPanel")) return;
    const consent = result.consent || {};
    const source = CONSENT_SOURCES.includes(consent.sourceType) ? consent.sourceType : CONSENT_SOURCES[0];
    const statusClass = result.eligible ? "complete" : "warning";
    const statusText = result.eligible
      ? `Current · ${consentSourceLabel(source)} · signed ${new Date(consent.signedAt).toLocaleString()}`
      : consent.status === "revoked" ? "Revoked" : "Not yet verified";
    panel.innerHTML = `<div class="card-head" style="padding:0 0 12px;border:0"><div><h3>Visit recording &amp; AI-transcription consent</h3><div class="privacy">Use either the signed previsit form or signed new-patient packet. Do not paste the document or patient details here—record only its secure identifier or location.</div></div><span class="badge ${statusClass}">${esc(statusText)}</span></div><div class="formgrid">${field("dConsentSource", "Signed form source", source, "select", CONSENT_SOURCES)}${field("dConsentSignedAt", "Patient signed at", localDateTimeValue(consent.signedAt), "datetime-local")}${field("dConsentVersion", "Form version", consent.formVersion || "recording-ai-consent-v1")}${field("dConsentEvidence", "Signed form reference", consent.evidenceReference || "")}</div><label class="attestation"><input type="checkbox" id="dConsentReviewed"><span>I reviewed the signed form and confirmed that it specifically authorizes visit recording and AI-assisted transcription.</span></label><div class="actions"><button class="btn primary" id="verifyRecordingConsent">Verify signed consent</button>${consent.consentId && consent.status !== "revoked" ? '<button class="btn" id="revokeRecordingConsent">Mark consent revoked</button>' : ""}</div><div class="privacy">This verification controls access to real-patient recording. The patient and everyone else who may be heard must still agree again at the visit.</div>`;
    $("dConsentSource").value = source;
    $("verifyRecordingConsent").onclick = async () => {
      if (!$("dConsentReviewed").checked) { showToast("Review the signed form and check the verification statement first."); return; }
      if (!$("dConsentSignedAt").value || !$("dConsentEvidence").value.trim()) { showToast("Signed date/time and the secure form reference are required."); return; }
      try {
        const saved = await client.saveRecordingConsent(bhwPatientId, {
          sourceType: $("dConsentSource").value,
          signedAt: new Date($("dConsentSignedAt").value).toISOString(),
          formVersion: $("dConsentVersion").value.trim(),
          evidenceReference: $("dConsentEvidence").value.trim(),
          status: "current",
          verificationAttestation: true,
        });
        await renderRecordingConsent(bhwPatientId);
        showToast(`Signed consent verified from the ${consentSourceLabel(saved.consent.sourceType).toLowerCase()}.`);
      } catch (error) { showToast(error.message || "Signed consent could not be verified."); }
    };
    if ($("revokeRecordingConsent")) {
      $("revokeRecordingConsent").onclick = async () => {
        if (!confirm("Mark this recording and AI-transcription consent as revoked? Real-patient recording will be blocked immediately.")) return;
        try {
          await client.saveRecordingConsent(bhwPatientId, { status: "revoked" });
          await renderRecordingConsent(bhwPatientId);
          showToast("Consent marked revoked. Real-patient recording is blocked.");
        } catch (error) { showToast(error.message || "Consent could not be revoked."); }
      };
    }
  } catch (error) {
    if (selectedId === bhwPatientId && $("recordingConsentPanel")) {
      $("recordingConsentPanel").innerHTML = `<div class="notice"><b>Consent verification is unavailable.</b><br>${esc(error.message || "Try again after the protected registry reconnects.")}</div>`;
    }
  }
}

function visiblePatients() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  return patients.filter((patient) => {
    const matchesStatus = filter === "all" || (filter === "needs-review" ? patient.coverageStatus === "needs-review" : patient.patientStatus === filter);
    const haystack = [patient.bhwPatientId, patient.legalFirstName, patient.legalLastName, patient.nameSuffix, patient.preferredName, patient.phone, patient.primaryPayer, patient.memberId].join(" ").toLowerCase();
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
    const name = `${patient.legalLastName}${patient.nameSuffix ? ` ${patient.nameSuffix}` : ""}, ${patient.preferredName || patient.legalFirstName}`;
    const coverageClass = patient.coverageStatus === "verified" ? "complete" : "warning";
    return `<tr data-id="${esc(patient.bhwPatientId)}" class="${patient.bhwPatientId === selectedId ? "on" : ""}"><td><b>${esc(patient.bhwPatientId)}</b></td><td>${esc(name)}</td><td>${esc(patient.dateOfBirth)}</td><td>${esc(patient.phone || "—")}</td><td>${esc(patient.primaryPayer || "—")}<br><span class="badge ${coverageClass}">${esc(patient.coverageStatus)}</span></td><td>${esc(patient.patientStatus)}</td></tr>`;
  }).join("") : '<tr><td colspan="6"><div class="empty">No patient records match this view.</div></td></tr>';
  document.querySelectorAll("tr[data-id]").forEach((row) => { row.onclick = () => { selectedId = row.dataset.id; render(); }; });
}

function renderDetail() {
  const patient = patients.find((item) => item.bhwPatientId === selectedId);
  if (!patient) { $("detail").innerHTML = '<div class="empty">Select a patient to review the master record.</div>'; return; }
  const displayedLastName = `${patient.legalLastName}${patient.nameSuffix ? ` ${patient.nameSuffix}` : ""}`;
  $("detail").innerHTML = `<div class="card-head"><div><h3>${esc(patient.bhwPatientId)} · ${esc(displayedLastName)}, ${esc(patient.preferredName || patient.legalFirstName)}</h3><div class="privacy">Last verified ${patient.lastVerifiedAt ? new Date(patient.lastVerifiedAt).toLocaleString() : "not recorded"}</div></div><span class="badge ${patient.coverageStatus === "verified" ? "complete" : "warning"}">${esc(patient.coverageStatus)}</span></div><div class="detail"><div class="formgrid">${patientFields(patient)}</div><div class="actions"><button class="btn primary" id="savePatient">Save verified changes</button><button class="btn" id="startEncounter">Create encounter</button></div><div class="privacy">Patient-reported changes must be verified before they replace this authoritative record. This registry supports operations; CharmHealth remains the legal medical record.</div><div class="consent-panel" id="recordingConsentPanel"><div class="privacy">Loading signed consent status…</div></div></div>`;
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
  void renderRecordingConsent(patient.bhwPatientId);
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
    patients.sort((left, right) => `${left.legalLastName}|${left.nameSuffix || ""}|${left.legalFirstName}`.localeCompare(`${right.legalLastName}|${right.nameSuffix || ""}|${right.legalFirstName}`));
    selectedId = response.patient.bhwPatientId;
    $("modal").classList.remove("on");
    render();
    showToast(`${selectedId} added to the protected Patient Registry.`);
  } catch (error) { showToast(error.message || "The patient record could not be created."); }
};

async function initialize() {
  try {
    client = await createPatientRegistryClient();
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


