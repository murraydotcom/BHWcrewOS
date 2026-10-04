import { createPatientRegistryClient } from "./patient-registry-client.mjs";
import {
  COVERAGE_ORDERS,
  COVERAGE_STATUSES,
  INSURANCE_TYPES,
  INSURANCE_TYPE_LABELS,
  MSP_REASONS,
  MSP_REASON_LABELS,
  PAYER_DIRECTORY,
  coverageSlotsForPatient,
  hasCoverageIdentity,
  insuranceReviewFlags,
  insuranceStorageForPatient,
  insuranceValidationMessage,
  medicareMbiForPatient,
  payerDirectoryEntry,
} from "../shared/patient-coverage.mjs";

const THEME_KEY = "bhw_provider_theme_v1";
const PENDING_PATIENT_KEY = "bhw_pending_encounter_patient_v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
const STATUS_OPTIONS = ["active", "prospective", "inactive", "transferred", "deceased"];
const CONSENT_SOURCES = ["previsit-form", "new-patient-packet"];
const CARE_API = "https://bhw-medication-api-343692256275.us-east4.run.app";
const PORTAL_ACCESS_STATUSES = ["not-invited", "approved", "invited", "active", "paused", "revoked"];

let client = null;
let patients = [];
let selectedId = "";
let toastTimer;
let careToken = "";
let careTokenExpiresAt = 0;
let registryFormDirty = false;
let registryRefreshPromise = null;

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

function labeledSelect(id, label, value, values, labels) {
  const optionValues = value && !values.includes(value) ? [value, ...values] : values;
  return `<div class="field"><label>${esc(label)}</label><select id="${id}">${optionValues.map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(labels[option] || option || "Not selected")}</option>`).join("")}</select></div>`;
}

const PAYER_DIRECTORY_OPTIONS = PAYER_DIRECTORY.flatMap((entry) => [entry.name, ...(entry.aliases || [])]
  .map((name) => ({ name, insuranceType: entry.insuranceType })))
  .sort((left, right) => `${left.insuranceType} ${left.name}`.localeCompare(`${right.insuranceType} ${right.name}`));

function payerDirectoryStatus(value) {
  const entry = payerDirectoryEntry(value);
  if (!value) return "Choose a payer from the directory or enter the exact payer name.";
  if (!entry) return "Not in the payer directory. Select the classification after verifying the plan.";
  if (!entry.insuranceType) return "Carrier name only; the plan classification still needs review.";
  return `Directory classification: ${INSURANCE_TYPE_LABELS[entry.insuranceType]}.`;
}

function payerField(id, value = "", required = false) {
  const listId = `${id}Directory`;
  const options = PAYER_DIRECTORY_OPTIONS.map((option) => `<option value="${esc(option.name)}" label="${esc(INSURANCE_TYPE_LABELS[option.insuranceType] || "Classification required")}"></option>`).join("");
  return `<div class="field"><label>${required ? "Actual primary insurance / payer name *" : "Insurance / payer name"}</label><input id="${id}" type="text" value="${esc(value)}" list="${listId}" autocomplete="off" ${required ? 'required aria-required="true"' : ""}><datalist id="${listId}">${options}</datalist><div class="coverage-help" id="${id}DirectoryStatus">${esc(payerDirectoryStatus(value))}</div></div>`;
}

function wireInsuranceDirectory(prefix) {
  for (const order of COVERAGE_ORDERS) {
    const key = order[0].toUpperCase() + order.slice(1);
    const payer = $(`${prefix}${key}Payer`);
    const type = $(`${prefix}${key}Type`);
    const status = $(`${prefix}${key}PayerDirectoryStatus`);
    if (!payer || !type || !status) continue;
    payer.addEventListener("input", () => {
      const entry = payerDirectoryEntry(payer.value);
      if (entry?.insuranceType) type.value = entry.insuranceType;
      else if (entry && !entry.insuranceType) type.value = "";
      status.textContent = payerDirectoryStatus(payer.value);
    });
  }
}

function coverageCard(patient, prefix, order) {
  const coverage = coverageSlotsForPatient(patient)[order];
  const title = ({ primary: "Primary insurance", secondary: "Secondary insurance", other: "Additional / other insurance" })[order];
  const key = order[0].toUpperCase() + order.slice(1);
  const mspField = order === "secondary"
    ? `${labeledSelect(`${prefix}${key}MspReason`, "Medicare-secondary reason", coverage.medicareSecondaryReason, MSP_REASONS, MSP_REASON_LABELS)}<div class="coverage-help">Complete this only when Original Medicare or Medicare Advantage is secondary. Leave it “Not yet verified” rather than guessing.</div>`
    : "";
  return `<section class="coverage-card" data-coverage-order="${order}"><div class="coverage-card-head"><div><b>${esc(title)}</b><span>${esc(order)}</span></div></div><div class="coverage-grid">${labeledSelect(`${prefix}${key}Type`, "Insurance classification", coverage.insuranceType, INSURANCE_TYPES, INSURANCE_TYPE_LABELS)}${payerField(`${prefix}${key}Payer`, coverage.payerName, order === "primary")}${field(`${prefix}${key}Plan`, "Plan / program name", coverage.planName)}${field(`${prefix}${key}Member`, "Member / policy ID", coverage.memberId)}${field(`${prefix}${key}Group`, "Group number", coverage.groupNumber)}${field(`${prefix}${key}PayerId`, "Electronic payer ID", coverage.payerId)}${field(`${prefix}${key}From`, "Effective from", coverage.effectiveFrom, "date")}${field(`${prefix}${key}To`, "Effective to", coverage.effectiveTo, "date")}${labeledSelect(`${prefix}${key}Coverage`, "Coverage status", coverage.coverageStatus, COVERAGE_STATUSES, {})}${mspField}</div></section>`;
}

function insuranceFields(patient, prefix) {
  const flags = insuranceReviewFlags(patient);
  const flagMarkup = flags.length
    ? `<div class="insurance-review"><b>Insurance review needed</b><ul>${flags.map((flag) => `<li>${esc(flag)}</li>`).join("")}</ul></div>`
    : `<div class="insurance-review complete"><b>Insurance structure complete</b><div>No structural insurance gaps are detected. Eligibility still requires payer verification.</div></div>`;
  return `<section class="insurance-section"><div class="insurance-title"><div><h4>Insurance coverage</h4><p>The primary coverage must show the actual insurance or payer name. Store its classification separately; “Commercial,” “Medicaid / MCO,” or “Medicare Advantage” is not the payer name. The MBI is never replaced by a Medicare Advantage plan member ID.</p></div></div><div class="mbi-row">${field(`${prefix}MedicareMbi`, "Medicare Beneficiary Identifier (MBI)", medicareMbiForPatient(patient))}<div class="coverage-help">Enter the patient’s 11-character MBI whenever Medicare is primary or secondary. Leave blank until verified.</div></div>${flagMarkup}<div class="coverage-cards">${COVERAGE_ORDERS.map((order) => coverageCard(patient, prefix, order)).join("")}</div></section>`;
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
    insuranceFields(patient, prefix),
    field(`${prefix}Referral`, "Referral source", patient.referralSource || ""),
    field(`${prefix}Staff`, "Responsible staff", patient.responsibleStaff || "Operations Manager"),
    field(`${prefix}PcpStaffId`, "Main PCP CrewHQ staff ID", patient.primaryCareProvider?.crewStaffId || ""),
    field(`${prefix}PcpProfileId`, "Main PCP Health Core profile ID", patient.primaryCareProvider?.clinicalStaffProfileId || ""),
    field(`${prefix}PcpName`, "Main PCP name", patient.primaryCareProvider?.name || ""),
    field(`${prefix}PcpCredential`, "Main PCP credential", patient.primaryCareProvider?.credential || ""),
    `<label class="attestation"><input id="${prefix}PcpVerified" type="checkbox"><span><b>Verify this main PCP identity</b><small>Required only when assigning or changing the PCP. Confirm the exact CrewHQ and Health Core identities before saving.</small></span></label>`,
  ].join("");
}

function readCoverage(prefix) {
  const slots = Object.fromEntries(COVERAGE_ORDERS.map((order) => {
    const key = order[0].toUpperCase() + order.slice(1);
    return [order, {
      coverageOrder: order,
      insuranceType: $(`${prefix}${key}Type`).value,
      payerName: $(`${prefix}${key}Payer`).value.trim(),
      planName: $(`${prefix}${key}Plan`).value.trim(),
      memberId: $(`${prefix}${key}Member`).value.trim(),
      groupNumber: $(`${prefix}${key}Group`).value.trim(),
      payerId: $(`${prefix}${key}PayerId`).value.trim(),
      effectiveFrom: $(`${prefix}${key}From`).value,
      effectiveTo: $(`${prefix}${key}To`).value,
      coverageStatus: $(`${prefix}${key}Coverage`).value,
      medicareSecondaryReason: order === "secondary" ? $(`${prefix}${key}MspReason`).value : "",
    }];
  }));
  return insuranceStorageForPatient({}, slots, $(`${prefix}MedicareMbi`).value);
}

function readPatient(prefix, bhwPatientId = "") {
  const insurance = readCoverage(prefix);
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
    ...insurance,
    referralSource: $(`${prefix}Referral`).value.trim(),
    responsibleStaff: $(`${prefix}Staff`).value.trim(),
    primaryCareProvider: {
      crewStaffId: $(`${prefix}PcpStaffId`).value.trim(),
      clinicalStaffProfileId: $(`${prefix}PcpProfileId`).value.trim(),
      name: $(`${prefix}PcpName`).value.trim(),
      credential: $(`${prefix}PcpCredential`).value.trim(),
    },
    primaryCareProviderVerificationAttestation: $(`${prefix}PcpVerified`).checked,
    lastVerifiedAt: new Date().toISOString(),
  };
}

function validationMessage(patient) {
  if (!/^BHW\d{4}$/.test(patient.bhwPatientId) || patient.bhwPatientId === "BHW0000") return "Enter the verified BHW Patient ID in the BHW#### format.";
  if (!patient.legalFirstName || !patient.legalLastName || !patient.dateOfBirth) return "Legal first name, legal last name, and date of birth are required.";
  const insuranceError = insuranceValidationMessage(patient);
  if (insuranceError) return insuranceError;
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

async function getCareToken() {
  if (careToken && Date.now() < careTokenExpiresAt) return careToken;
  const crewToken = sessionStorage.getItem("crewos_token") || "";
  if (!crewToken) throw new Error("CrewHQ session expired. Sign in again.");
  const response = await fetch("/.netlify/functions/care-cloud-token", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) throw new Error(body.error || "Patient communication history is unavailable.");
  careToken = body.token;
  careTokenExpiresAt = Date.now() + Math.max(30, Number(body.expiresIn || 300) - 30) * 1000;
  return careToken;
}

async function careRequest(path) {
  const token = await getCareToken();
  const response = await fetch(`${CARE_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Patient communication history is unavailable.");
  return body;
}

function communicationStatusLabel(status) {
  return ({ generated: "Generated", sent_recorded: "Recorded sent", opened: "Opened", submitted: "Submitted", expired: "Expired", revoked: "Revoked" })[status] || status || "Unknown";
}

function communicationChannelLabel(channel) {
  return ({ dialpad_sms: "Dialpad SMS", patient_portal: "Patient portal", email: "BHW email", phone: "Telephone", in_person: "In person", other_approved: "Other approved channel" })[channel] || channel || "";
}

function communicationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

async function renderEducationCommunication(bhwPatientId) {
  const panel = $("educationCommunicationPanel");
  if (!panel) return;
  try {
    const result = await careRequest(`/v1/staff/content-assignments?patientId=${encodeURIComponent(bhwPatientId)}&limit=100`);
    if (selectedId !== bhwPatientId || !$("educationCommunicationPanel")) return;
    const assignments = Array.isArray(result.assignments) ? result.assignments : [];
    const rows = assignments.length ? assignments.map((item) => {
      const sent = item.sentAt ? `Recorded sent ${communicationTime(item.sentAt)} via ${communicationChannelLabel(item.sendChannel)}${item.destinationMasked ? ` to ${item.destinationMasked}` : ""}` : "Not recorded as sent";
      const activity = [item.openedAt ? `Opened ${communicationTime(item.openedAt)}` : "", item.submittedAt ? `Submitted ${communicationTime(item.submittedAt)}` : "", item.revokedAt ? `Revoked ${communicationTime(item.revokedAt)}` : ""].filter(Boolean).join(" · ");
      const badgeClass = ["submitted", "opened"].includes(item.status) ? "complete" : ["expired", "revoked"].includes(item.status) ? "needs-review" : "warning";
      return `<div class="communication-row"><div><b>${esc(item.title)}</b><div class="privacy" style="margin-top:4px">Created ${esc(communicationTime(item.createdAt) || "time unavailable")} · Expires ${esc(communicationTime(item.expiresAt) || "time unavailable")}</div><div class="privacy" style="margin-top:3px">${esc(sent)}</div>${activity ? `<div class="privacy" style="margin-top:3px">${esc(activity)}</div>` : ""}</div><span class="badge ${badgeClass}">${esc(communicationStatusLabel(item.status))}</span></div>`;
    }).join("") : '<div class="empty" style="padding:24px">No education or interactive communication assignments are recorded for this patient.</div>';
    panel.innerHTML = `<div class="card-head" style="padding:0 0 12px;border:0"><div><h3>Education &amp; Interactive Communication</h3><div class="privacy">Patient-specific care plans, education, interactive questions, and communication status.</div></div><a class="btn" href="/bhw-patient-materials.html?patient=${encodeURIComponent(bhwPatientId)}">Create assignment</a></div><div class="communication-list">${rows}</div><div class="privacy"><b>Proof standard:</b> Recorded sent means a staff member attested that the exact link was sent through the documented channel. Opened and submitted are system-recorded. Carrier delivery confirmation is not available until Dialpad is connected.</div>`;
  } catch (error) {
    if (selectedId === bhwPatientId && $("educationCommunicationPanel")) {
      $("educationCommunicationPanel").innerHTML = `<div class="notice"><b>Education &amp; Interactive Communication is unavailable.</b><br>${esc(error.message || "Try again after the Care Cloud connection is restored.")}</div>`;
    }
  }
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

function checked(id, value) {
  return `<label class="attestation"><input type="checkbox" id="${id}" ${value ? "checked" : ""}><span>`;
}

async function renderPortalAccess(bhwPatientId) {
  const panel = $("portalAccessPanel");
  if (!panel) return;
  try {
    const result = await client.portalAccess(bhwPatientId);
    if (selectedId !== bhwPatientId || !$("portalAccessPanel")) return;
    const access = result.access || {};
    const status = PORTAL_ACCESS_STATUSES.includes(access.portalAccessStatus) ? access.portalAccessStatus : "not-invited";
    const pilotClass = result.organizationPilotEnabled ? "complete" : "warning";
    panel.innerHTML = `<div class="card-head" style="padding:0 0 12px;border:0"><div><h3>Care Connect pilot access</h3><div class="privacy">Adult Primary Care pilot · patient self-access only · proxy and guardian access disabled.</div></div><span class="badge ${pilotClass}">${result.organizationPilotEnabled ? "Organization access on" : "Organization access off"}</span></div><div class="formgrid">${field("dPortalStatus", "Portal access status", status, "select", PORTAL_ACCESS_STATUSES)}${field("dPortalChannel", "Verified invitation channel", access.preferredChannel || "email", "select", ["email", "sms"])}${field("dPortalConsentStatus", "Portal consent", access.consentStatus || "", "select", ["", "current", "revoked"])}${field("dPortalConsentedAt", "Patient consented at", localDateTimeValue(access.consentedAt), "datetime-local")}${field("dPortalConsentEvidence", "Protected consent reference", access.consentEvidenceReference || "")}${field("dPortalDisableReason", "Pause / revoke reason", access.disableReason || "")}</div>${checked("dPortalAllowlisted", access.allowlisted === true)}Personally selected for the adult Primary Care pilot.</span></label>${checked("dPortalContactVerified", false)}I verified the selected email or phone against the current Patient Registry record.</span></label>${checked("dPortalInvitationConfirmed", false)}I confirm the patient invitation was delivered through the verified channel. This records the invitation; it does not send one.</span></label><div class="notice"><b>Invitation preview · not sent</b><br>${esc(result.invitationPreview?.message || "BHW Medical secure patient portal invitation.")}</div><div class="actions"><button class="btn primary" id="savePortalAccess">Save pilot access</button></div><div class="privacy">Current status: ${esc(status)} · ${access.exactContactBound ? "exact contact verified" : "exact contact not verified"}${access.portalInvitedAt ? ` · invited ${esc(new Date(access.portalInvitedAt).toLocaleString())}` : ""}${access.lastAuthenticatedAt ? ` · last authenticated ${esc(new Date(access.lastAuthenticatedAt).toLocaleString())}` : ""}. Clinical details are never included in the invitation.</div>`;
    $("dPortalStatus").value = status;
    $("dPortalChannel").value = access.preferredChannel || "email";
    $("dPortalConsentStatus").value = access.consentStatus || "";
    $("savePortalAccess").onclick = async () => {
      const selectedStatus = $("dPortalStatus").value;
      if (selectedStatus === "active" && status !== "active") { showToast("Active status is created only after the patient's first verified sign-in."); return; }
      try {
        const saved = await client.savePortalAccess(bhwPatientId, {
          portalAccessStatus: selectedStatus,
          preferredChannel: $("dPortalChannel").value,
          allowlisted: $("dPortalAllowlisted").checked,
          contactVerificationConfirmed: $("dPortalContactVerified").checked,
          consentStatus: $("dPortalConsentStatus").value,
          consentedAt: $("dPortalConsentedAt").value ? new Date($("dPortalConsentedAt").value).toISOString() : "",
          consentEvidenceReference: $("dPortalConsentEvidence").value.trim(),
          invitationDeliveryConfirmed: $("dPortalInvitationConfirmed").checked,
          disableReason: $("dPortalDisableReason").value.trim(),
        });
        await renderPortalAccess(bhwPatientId);
        showToast(`Care Connect access saved as ${saved.access.portalAccessStatus}. No invitation was sent.`);
      } catch (error) { showToast(error.message || "Care Connect pilot access could not be saved."); }
    };
  } catch (error) {
    if (selectedId === bhwPatientId && $("portalAccessPanel")) {
      $("portalAccessPanel").innerHTML = `<div class="notice"><b>Care Connect pilot controls are unavailable.</b><br>${esc(error.message || "Try again after the protected services reconnect.")}</div>`;
    }
  }
}

function visiblePatients() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  return patients.filter((patient) => {
    const coverageRecords = Object.values(coverageSlotsForPatient(patient)).filter(hasCoverageIdentity);
    const matchesStatus = filter === "all" || (filter === "needs-review" ? patient.coverageStatus === "needs-review" || insuranceReviewFlags(patient).length > 0 : patient.patientStatus === filter);
    const haystack = [patient.bhwPatientId, patient.legalFirstName, patient.legalLastName, patient.nameSuffix, patient.preferredName, patient.phone, ...coverageRecords.flatMap((coverage) => [coverage.payerName, coverage.planName, coverage.memberId])].join(" ").toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function renderKpis() {
  const active = patients.filter((patient) => patient.patientStatus === "active").length;
  const prospective = patients.filter((patient) => patient.patientStatus === "prospective").length;
  const coverageReview = patients.filter((patient) => ["pending", "needs-review", "unknown"].includes(patient.coverageStatus) || insuranceReviewFlags(patient).length > 0).length;
  $("kpis").innerHTML = [[patients.length, "Master records"], [active, "Active patients"], [prospective, "Prospective / referrals"], [coverageReview, "Coverage follow-up"]]
    .map(([value, label]) => `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`).join("");
}

function renderRows() {
  const visible = visiblePatients();
  $("patientRows").innerHTML = visible.length ? visible.map((patient) => {
    const name = `${patient.legalLastName}${patient.nameSuffix ? ` ${patient.nameSuffix}` : ""}, ${patient.preferredName || patient.legalFirstName}`;
    const slots = coverageSlotsForPatient(patient);
    const reviewFlags = insuranceReviewFlags(patient);
    const coverageClass = patient.coverageStatus === "verified" && !reviewFlags.length ? "complete" : "warning";
    const secondary = hasCoverageIdentity(slots.secondary) ? (slots.secondary.payerName || slots.secondary.planName || INSURANCE_TYPE_LABELS[slots.secondary.insuranceType]) : "";
    const mbiStatus = Object.values(slots).some((coverage) => ["original-medicare", "medicare-advantage"].includes(coverage.insuranceType))
      ? (medicareMbiForPatient(patient) ? "MBI on file" : "MBI missing")
      : "";
    const primaryName = slots.primary.payerName || patient.primaryPayer || "Insurance name missing";
    const primaryClass = INSURANCE_TYPE_LABELS[slots.primary.insuranceType] || "Not classified";
    return `<tr data-id="${esc(patient.bhwPatientId)}" class="${patient.bhwPatientId === selectedId ? "on" : ""}"><td><b>${esc(patient.bhwPatientId)}</b></td><td>${esc(name)}</td><td>${esc(patient.dateOfBirth)}</td><td>${esc(patient.phone || "—")}</td><td>${esc(primaryName)}<div class="coverage-summary">Classification: ${esc(primaryClass)}</div>${secondary ? `<div class="coverage-summary">Secondary: ${esc(secondary)}</div>` : ""}${mbiStatus ? `<div class="coverage-summary">${esc(mbiStatus)}</div>` : ""}<span class="badge ${coverageClass}">${esc(reviewFlags.length ? "needs review" : patient.coverageStatus)}</span></td><td>${esc(patient.patientStatus)}</td></tr>`;
  }).join("") : '<tr><td colspan="6"><div class="empty">No patient records match this view.</div></td></tr>';
  document.querySelectorAll("tr[data-id]").forEach((row) => { row.onclick = () => { selectedId = row.dataset.id; render(); }; });
}

function renderDetail() {
  const patient = patients.find((item) => item.bhwPatientId === selectedId);
  if (!patient) { $("detail").innerHTML = '<div class="empty">Select a patient to review the master record.</div>'; return; }
  const displayedLastName = `${patient.legalLastName}${patient.nameSuffix ? ` ${patient.nameSuffix}` : ""}`;
  $("detail").innerHTML = `<div class="card-head"><div><h3>${esc(patient.bhwPatientId)} · ${esc(displayedLastName)}, ${esc(patient.preferredName || patient.legalFirstName)}</h3><div class="privacy">Last verified ${patient.lastVerifiedAt ? new Date(patient.lastVerifiedAt).toLocaleString() : "not recorded"}</div></div><span class="badge ${patient.coverageStatus === "verified" ? "complete" : "warning"}">${esc(patient.coverageStatus)}</span></div><div class="detail"><div class="formgrid" id="patientMasterFields">${patientFields(patient)}</div><div class="actions"><a class="btn" href="patient-360.html?patient=${encodeURIComponent(patient.bhwPatientId)}">Open Patient 360</a><button class="btn primary" id="savePatient">Save verified changes</button><button class="btn" id="startEncounter">Create encounter</button></div><div class="privacy">Patient-reported changes must be verified before they replace this authoritative record. This registry supports operations; CharmHealth remains the legal medical record.</div><div class="consent-panel" id="portalAccessPanel"><div class="privacy">Loading Care Connect pilot access…</div></div><div class="consent-panel" id="recordingConsentPanel"><div class="privacy">Loading signed consent status…</div></div><div class="communication-panel" id="educationCommunicationPanel"><div class="privacy">Loading education and interactive communication history…</div></div></div>`;
  registryFormDirty = false;
  document.querySelectorAll("#patientMasterFields input, #patientMasterFields select").forEach((control) => {
    control.addEventListener("input", () => { registryFormDirty = true; });
    control.addEventListener("change", () => { registryFormDirty = true; });
  });
  wireInsuranceDirectory("d");
  $("savePatient").onclick = async () => {
    const next = readPatient("d", patient.bhwPatientId);
    const error = validationMessage(next);
    if (error) { showToast(error); return; }
    const button = $("savePatient");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await client.savePatient(next);
      await refreshPatients({ force: true, selectId: patient.bhwPatientId });
      const current = patients.find((item) => item.bhwPatientId === patient.bhwPatientId);
      const fields = ["legalFirstName", "legalLastName", "nameSuffix", "preferredName", "dateOfBirth", "phone", "email", "patientStatus", "primaryPayer", "memberId", "coverageStatus", "referralSource", "responsibleStaff"];
      if (!current || fields.some((key) => String(current[key] || "") !== String(next[key] || ""))) {
        throw new Error("The patient update could not be verified in the current Cloud registry.");
      }
      const savedInsurance = insuranceStorageForPatient(current);
      const intendedInsurance = insuranceStorageForPatient(next);
      if (savedInsurance.medicareMbi !== intendedInsurance.medicareMbi || JSON.stringify(savedInsurance.coverageRecords) !== JSON.stringify(intendedInsurance.coverageRecords)) {
        throw new Error("The primary, secondary, additional, or Medicare insurance details were not retained by the current Cloud registry.");
      }
      const providerFields = ["crewStaffId", "clinicalStaffProfileId", "name", "credential"];
      if (providerFields.some((key) => String(current.primaryCareProvider?.[key] || "") !== String(next.primaryCareProvider?.[key] || ""))) {
        throw new Error("The main PCP assignment could not be verified in the current Cloud registry.");
      }
      if (next.primaryCareProvider?.crewStaffId && current.primaryCareProvider?.verificationStatus !== "verified") {
        throw new Error("The main PCP assignment was saved without verified identity status.");
      }
      registryFormDirty = false;
      showToast(`Saved to BHW Cloud at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Save verified changes";
      showToast(error.message || "The patient record could not be saved.");
    }
  };
  $("startEncounter").onclick = () => {
    sessionStorage.setItem(PENDING_PATIENT_KEY, patient.bhwPatientId);
    location.href = "workflow.html";
  };
  void renderRecordingConsent(patient.bhwPatientId);
  void renderEducationCommunication(patient.bhwPatientId);
  void renderPortalAccess(patient.bhwPatientId);
}

function render() { renderKpis(); renderRows(); renderDetail(); }

async function refreshPatients({ force = false, selectId = selectedId, announce = false } = {}) {
  if (!client) return false;
  if (registryFormDirty && !force) {
    if (announce) showToast("Save or discard the patient changes before refreshing the registry list.");
    return false;
  }
  if (registryRefreshPromise) {
    await registryRefreshPromise;
    if (force) return refreshPatients({ force, selectId, announce });
    return true;
  }
  registryRefreshPromise = (async () => {
    const button = $("refreshPatients");
    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    try {
      const current = await client.listPatients();
      patients = current;
      selectedId = current.some((patient) => patient.bhwPatientId === selectId) ? selectId : (current[0]?.bhwPatientId || "");
      registryFormDirty = false;
      $("cloudStatus").className = "badge complete";
      $("cloudStatus").textContent = "Google Cloud synced";
      $("lastRegistrySync").textContent = `Current as of ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      render();
      if (announce) showToast(`Patient Registry refreshed from BHW Cloud · ${current.length} current records.`);
      return true;
    } catch (error) {
      $("cloudStatus").className = "badge warning";
      $("cloudStatus").textContent = "Refresh interrupted";
      if (announce) showToast(error.message || "The Patient Registry could not refresh.");
      return false;
    } finally {
      if (button) { button.disabled = false; button.textContent = "Refresh current list"; }
      registryRefreshPromise = null;
    }
  })();
  return registryRefreshPromise;
}

$("search").oninput = renderRows;
$("statusFilter").onchange = renderRows;
$("refreshPatients").onclick = () => { void refreshPatients({ announce: true }); };
$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
};
if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";

$("newPatient").onclick = () => { $("newPatientFields").innerHTML = patientFields({}, "n", true); wireInsuranceDirectory("n"); $("modal").classList.add("on"); $("nId").focus(); };
$("cancel").onclick = () => $("modal").classList.remove("on");
$("create").onclick = async () => {
  const patient = readPatient("n");
  const error = validationMessage(patient);
  if (error) { showToast(error); return; }
  if (patients.some((item) => item.bhwPatientId === patient.bhwPatientId)) { showToast("That BHW Patient ID already exists. Open the existing record instead."); return; }
  try {
    const response = await client.savePatient(patient);
    selectedId = response.patient.bhwPatientId;
    $("modal").classList.remove("on");
    await refreshPatients({ force: true, selectId: selectedId });
    showToast(`${selectedId} created. Saved to BHW Cloud at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  } catch (error) { showToast(error.message || "The patient record could not be created."); }
};

async function initialize() {
  try {
    client = await createPatientRegistryClient();
    const refreshed = await refreshPatients({ force: true });
    if (!refreshed) throw new Error("The protected Patient Registry could not be refreshed.");
    $("newPatient").disabled = false;
  } catch (error) {
    $("cloudStatus").className = "badge warning";
    $("cloudStatus").textContent = "Cloud unavailable";
    $("detail").innerHTML = `<div class="empty"><b>The protected Patient Registry is unavailable.</b><br>${esc(error.message || "Try again after the Google Cloud connection is restored.")}</div>`;
    showToast(error.message || "The Patient Registry could not connect.");
  }
}

initialize();

window.addEventListener("focus", () => { void refreshPatients(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshPatients();
});
setInterval(() => { void refreshPatients(); }, 60000);
