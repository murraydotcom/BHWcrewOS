const HEALTH_CORE_ORIGIN = "https://health-core.bhwmedical.org";
const HEALTH_CORE_DOCUMENTATION_URL = `${HEALTH_CORE_ORIGIN}/clinical-documentation.html?patient=BHW0000`;
const HANDOFF_SCHEMA = "bhw.billing-toolkit.health-core-handoff.v1";
const READY_TYPE = "bhw.billing-toolkit.health-core-ready";
const PAYLOAD_TYPE = "bhw.billing-toolkit.health-core-draft";
const SAVED_TYPE = "bhw.billing-toolkit.health-core-draft-saved";

const clean = (value, maximum = 12_000) => String(value ?? "").trim().slice(0, maximum);

export function decodeCrewSession(token) {
  try {
    const segment = String(token || "").split(".")[0] || "";
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    return { staffId: clean(payload.staffId, 160), name: clean(payload.name, 160), role: clean(payload.role, 80) };
  } catch {
    return { staffId: "", name: "", role: "" };
  }
}

export function patientDisplayName(patient = {}) {
  return [patient.preferredName || patient.legalFirstName, patient.legalLastName, patient.nameSuffix].map((value) => clean(value, 100)).filter(Boolean).join(" ");
}

export function buildBillingToolkitHandoff({ patient, noteText, encounterDate, handoffId = crypto.randomUUID() } = {}) {
  if (patient?.bhwPatientId !== "BHW0000") throw new Error("Health Core handoff is currently restricted to synthetic patient BHW0000.");
  const rawNote = String(noteText ?? "").trim();
  if (rawNote.length > 12_000) throw new Error("The generated chart note is too long for the bounded Health Core encounter field. Shorten it before handoff.");
  const subjective = clean(rawNote);
  const date = clean(encounterDate, 10);
  const correlationId = clean(handoffId, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(correlationId)) throw new Error("A valid Health Core handoff correlation ID is required.");
  if (!subjective || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Generate the chart note and enter the documentation date before opening Health Core.");
  return Object.freeze({
    type: PAYLOAD_TYPE,
    schema: HANDOFF_SCHEMA,
    handoffId: correlationId,
    bhwPatientId: "BHW0000",
    draft: Object.freeze({
      encounterType: "Care-management review",
      draftSource: "Manual clinician entry",
      encounterDate: date,
      episode: "Primary Care",
      reason: "Monthly care-management documentation review",
      subjective,
      objective: "",
      assessment: "",
      plan: "Assigned PCP review and exact-revision signature required before this draft becomes signed clinical documentation.",
    }),
  });
}

export function validateHealthCoreSavedMessage(message = {}, expectedHandoffId = "") {
  const receipt = {
    handoffId: clean(message.handoffId, 100),
    bhwPatientId: clean(message.bhwPatientId, 20).toUpperCase(),
    noteId: clean(message.noteId, 100),
    revision: Number(message.revision),
    contentHash: clean(message.contentHash, 80).toLowerCase(),
    savedAt: clean(message.savedAt, 40),
  };
  if (message.type !== SAVED_TYPE || message.schema !== HANDOFF_SCHEMA || receipt.bhwPatientId !== "BHW0000"
    || !expectedHandoffId || receipt.handoffId !== expectedHandoffId
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(receipt.noteId)
    || !Number.isInteger(receipt.revision) || receipt.revision < 1
    || !/^[a-f0-9]{64}$/.test(receipt.contentHash)
    || !Number.isFinite(Date.parse(receipt.savedAt))) {
    throw new Error("Health Core did not return a valid saved-draft receipt.");
  }
  return receipt;
}

async function registryRequest(token, body) {
  const response = await fetch("/.netlify/functions/patient-registry", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Patient Registry request failed.");
  return result;
}

function syntheticPatient() {
  return {
    bhwPatientId: "BHW0000",
    legalFirstName: "Synthetic",
    legalLastName: "Patient",
    preferredName: "Synthetic",
    dateOfBirth: "1980-01-01",
    patientStatus: "synthetic",
    primaryCareProvider: { name: "Configured synthetic provider", credential: "" },
  };
}

function mount() {
  const select = document.getElementById("billingPatientSelect");
  const status = document.getElementById("healthCoreHandoffStatus");
  const button = document.getElementById("sendToHealthCore");
  const attestation = document.getElementById("coordinatorPreparationAttestation");
  const token = sessionStorage.getItem("crewos_token") || "";
  const actor = decodeCrewSession(token);
  const preparedBy = document.querySelector('[data-field="prepared-by"]');
  const preparedRole = document.querySelector('[data-field="prepared-role"]');
  const preparedDate = document.querySelector('[data-field="prepared-date"]');
  if (preparedBy) preparedBy.value = actor.name;
  if (preparedRole) preparedRole.value = actor.role;
  if (preparedDate && !preparedDate.value) preparedDate.value = new Date().toISOString().slice(0, 10);

  let patients = [syntheticPatient()];
  let selected = patients[0];
  let healthCoreWindow = null;
  let pendingPayload = null;

  const setStatus = (message, kind = "") => {
    status.textContent = message;
    status.dataset.state = kind;
  };
  const renderSelection = () => {
    selected = patients.find((patient) => patient.bhwPatientId === select.value) || patients[0];
    const name = patientDisplayName(selected);
    document.querySelector('[data-field="patient"]').value = name;
    document.querySelector('[data-field="dobmrn"]').value = [selected.dateOfBirth, selected.bhwPatientId].filter(Boolean).join(" / ");
    const provider = selected.primaryCareProvider || {};
    document.querySelector('[data-field="provider"]').value = [provider.name, provider.credential].filter(Boolean).join(", ");
    button.disabled = selected.bhwPatientId !== "BHW0000" || !attestation.checked;
    setStatus(selected.bhwPatientId === "BHW0000"
      ? "Synthetic test patient selected. Health Core will require a protected clinical session, source review, and a second preparation attestation before saving."
      : "Patient loaded from the authoritative Registry. Real-patient Health Core handoff remains locked until controlled-pilot activation and verified PCP routing are enabled.");
  };

  const renderOptions = () => {
    const options = patients.map((patient) => {
      const option = document.createElement("option");
      option.value = clean(patient.bhwPatientId, 20);
      option.textContent = `${option.value} · ${patientDisplayName(patient)}`;
      return option;
    });
    select.replaceChildren(...options);
    select.value = "BHW0000";
    renderSelection();
  };
  renderOptions();
  select.addEventListener("change", renderSelection);
  attestation.addEventListener("change", renderSelection);

  if (!token) {
    select.innerHTML = '<option value="BHW0000">BHW0000 · Synthetic Patient</option>';
    setStatus("CrewHQ session expired. Sign in again before loading the Patient Registry or routing provider review.", "blocked");
    button.disabled = true;
  } else {
    registryRequest(token, { action: "list" }).then((result) => {
      const real = (result.patients || []).filter((patient) => patient.patientStatus !== "deceased" && patient.bhwPatientId !== "BHW0000")
        .sort((left, right) => `${left.legalLastName}|${left.legalFirstName}`.localeCompare(`${right.legalLastName}|${right.legalFirstName}`));
      patients = [syntheticPatient(), ...real];
      renderOptions();
    }).catch((error) => setStatus(`Only BHW0000 is available: ${error.message}`, "blocked"));
  }

  button.addEventListener("click", () => {
    try {
      if (!attestation.checked) throw new Error("Coordinator preparation attestation is required.");
      window.generateChartNote?.();
      pendingPayload = buildBillingToolkitHandoff({
        patient: selected,
        noteText: document.getElementById("chartNoteOutput").value,
        encounterDate: preparedDate.value,
      });
      healthCoreWindow = window.open(HEALTH_CORE_DOCUMENTATION_URL, "bhw-health-core-documentation");
      if (!healthCoreWindow) throw new Error("Health Core was blocked by the browser. Allow the pop-up and try again.");
      setStatus("Health Core opened. Complete Google protection and the clinical-session step-up; this page will transfer the draft only after Health Core signals it is ready.", "pending");
    } catch (error) {
      setStatus(error.message, "blocked");
    }
  });

  window.addEventListener("message", async (event) => {
    if (event.origin !== HEALTH_CORE_ORIGIN || event.source !== healthCoreWindow) return;
    if (event.data?.type === READY_TYPE && event.data?.schema === HANDOFF_SCHEMA && pendingPayload) {
      healthCoreWindow.postMessage(pendingPayload, HEALTH_CORE_ORIGIN);
      setStatus("Draft transferred to Health Core memory. Review and explicitly save it there; no note or provider alert exists yet.", "pending");
      return;
    }
    if (event.data?.type !== SAVED_TYPE) return;
    try {
      const receipt = validateHealthCoreSavedMessage(event.data, pendingPayload?.handoffId || "");
      setStatus(`Health Core draft revision ${receipt.revision} saved and read back. Creating the minimum-necessary CrewHQ provider alert…`, "pending");
      const result = await registryRequest(token, { action: "notify-billing-toolkit-provider", receipt });
      setStatus(`Health Core draft revision ${receipt.revision} saved. ${result.notification?.providerName || "Assigned PCP"} was notified in CrewHQ. Provider signature is still required.`, "ready");
      pendingPayload = null;
    } catch (error) {
      setStatus(`Health Core draft was saved, but provider notification was not verified: ${error.message}`, "blocked");
    }
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") mount();

export const billingToolkitHealthCoreContract = Object.freeze({
  schema: HANDOFF_SCHEMA,
  readyType: READY_TYPE,
  payloadType: PAYLOAD_TYPE,
  savedType: SAVED_TYPE,
  healthCoreOrigin: HEALTH_CORE_ORIGIN,
});
