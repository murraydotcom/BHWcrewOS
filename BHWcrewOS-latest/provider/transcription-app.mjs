import { createEncounterCloudClient } from "./cloud-queue.mjs";

const SYNTHETIC_PATIENT_ID = "BHW0000";
const SYNTHETIC_CONSENT = "synthetic-role-play";
const LIVE_CONSENT = "session-recording-confirmed";
const MAX_AUDIO_BYTES = 9 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
let cloudClient = null;
let recorder = null;
let stream = null;
let chunks = [];
let audioBlob = null;
let elapsedSeconds = 0;
let timerHandle = null;
let toastTimer = null;
let sessionVersion = 0;
let verifiedConsent = null;
let consentLookupVersion = 0;

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), 5500);
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function setState(value) { $("state").textContent = value; }
function selectedPatientId() { return $("patient").value; }
function isSynthetic() { return selectedPatientId() === SYNTHETIC_PATIENT_ID; }
function consentMode() { return isSynthetic() ? SYNTHETIC_CONSENT : LIVE_CONSENT; }
function hasVerifiedConsent() { return Boolean(verifiedConsent?.eligible); }
function consentSourceLabel(value) {
  return value === "new-patient-packet" ? "new-patient packet" : "previsit form";
}

function stopTracks() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function discardAudio() {
  chunks = [];
  audioBlob = null;
}

function canStart() {
  return Boolean(
    cloudClient
    && selectedPatientId()
    && (isSynthetic() ? $("previsitConsent").checked : hasVerifiedConsent())
    && $("sessionConsent").checked
    && !recorder
    && !audioBlob,
  );
}

function updateStartAvailability() {
  $("start").disabled = !canStart();
}

function updateConsentCopy() {
  const selected = Boolean(selectedPatientId());
  if (isSynthetic()) {
    $("previsitConsent").disabled = false;
    $("previsitConsentText").textContent = "I confirm this is a staff role-play with no real patient or real patient information.";
    $("sessionConsentText").textContent = "Everyone who may be heard knows and agrees that the microphone is recording.";
  } else if (selected) {
    $("previsitConsent").disabled = true;
    $("previsitConsent").checked = hasVerifiedConsent();
    if (hasVerifiedConsent()) {
      const consent = verifiedConsent.consent;
      const signed = new Date(consent.signedAt).toLocaleDateString();
      $("previsitConsentText").textContent = `Signed recording and AI-transcription consent verified from the ${consentSourceLabel(consent.sourceType)} on ${signed}.`;
    } else {
      $("previsitConsentText").textContent = "No current signed recording and AI-transcription consent is verified from the previsit form or new-patient packet.";
    }
    $("sessionConsentText").textContent = "The patient—and every other person who may be heard—agrees to recording for this visit.";
  } else {
    $("previsitConsent").disabled = true;
    $("previsitConsent").checked = false;
    $("previsitConsentText").textContent = "Select a patient to review the required consent.";
    $("sessionConsentText").textContent = "Select a patient to confirm recording agreement for this visit.";
  }
  $("sessionConsent").disabled = !selected || (!isSynthetic() && !hasVerifiedConsent());
  updateStartAvailability();
}

async function refreshRecordingConsent() {
  const bhwPatientId = selectedPatientId();
  const version = ++consentLookupVersion;
  verifiedConsent = null;
  if (!bhwPatientId || isSynthetic()) {
    updateConsentCopy();
    return verifiedConsent;
  }
  setState("Checking signed consent…");
  updateConsentCopy();
  try {
    const result = await cloudClient.recordingConsent(bhwPatientId);
    if (version !== consentLookupVersion || selectedPatientId() !== bhwPatientId) return null;
    verifiedConsent = result;
    setState(result.eligible ? "Ready after today’s recording agreement" : "Signed consent must be verified in the Patient Registry");
    updateConsentCopy();
    return result;
  } catch (error) {
    if (version !== consentLookupVersion || selectedPatientId() !== bhwPatientId) return null;
    verifiedConsent = null;
    setState("Consent verification unavailable");
    updateConsentCopy();
    showToast(error.message || "Signed consent could not be verified.");
    return null;
  }
}

function clearSession({ resetAttestations = true } = {}) {
  sessionVersion += 1;
  const activeRecorder = recorder;
  recorder = null;
  if (activeRecorder?.state === "recording" || activeRecorder?.state === "paused") {
    activeRecorder.ondataavailable = null;
    activeRecorder.onstop = stopTracks;
    activeRecorder.stop();
  }
  stopTracks();
  clearInterval(timerHandle);
  timerHandle = null;
  discardAudio();
  elapsedSeconds = 0;
  $("timer").textContent = "00:00";
  $("transcript").value = "";
  $("meta").textContent = "";
  $("reviewed").checked = false;
  $("pause").disabled = true;
  $("pause").textContent = "Pause";
  $("finish").disabled = true;
  $("transcribe").disabled = true;
  $("copy").disabled = true;
  $("patient").disabled = !cloudClient;
  if (resetAttestations) {
    if (isSynthetic()) $("previsitConsent").checked = false;
    $("sessionConsent").checked = false;
  }
  setState(selectedPatientId() ? "Ready after consent is confirmed" : "Select a patient");
  updateConsentCopy();
}

function lockSelection(value) {
  $("patient").disabled = value;
  if (value) {
    $("previsitConsent").disabled = true;
    $("sessionConsent").disabled = true;
  } else {
    updateConsentCopy();
  }
}

function addPatientOption(value, label, { disabled = false } = {}) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  $("patient").append(option);
}

function loadPatientOptions(patients, { realPatientEnabled = false } = {}) {
  $("patient").replaceChildren();
  addPatientOption("", "Choose a verified patient…");
  addPatientOption(SYNTHETIC_PATIENT_ID, "BHW0000 · Synthetic staff role-play");
  if (realPatientEnabled) {
    for (const patient of patients) {
      const name = `${patient.legalLastName || ""}, ${patient.preferredName || patient.legalFirstName || ""}`.replace(/^, |, $/g, "");
      const status = patient.patientStatus && patient.patientStatus !== "active" ? ` · ${patient.patientStatus}` : "";
      addPatientOption(patient.bhwPatientId, `${name} · ${patient.bhwPatientId}${status}`);
    }
  } else {
    addPatientOption("", "Real-patient transcription awaiting BHW BAA approval", { disabled: true });
  }
  $("patient").disabled = false;
  updateConsentCopy();
}

$("patient").onchange = async () => {
  verifiedConsent = null;
  clearSession({ resetAttestations: true });
  await refreshRecordingConsent();
};
for (const id of ["previsitConsent", "sessionConsent"]) {
  $(id).onchange = () => {
    if ((recorder || audioBlob) && !$(id).checked) {
      clearSession({ resetAttestations: true });
      showToast("Recording stopped and discarded because recording agreement was withdrawn.");
      return;
    }
    updateStartAvailability();
  };
}

$("start").onclick = async () => {
  if (!canStart()) {
    showToast("Select the patient, verify signed consent, and confirm today’s recording agreement before starting.");
    return;
  }
  try {
    if (!isSynthetic()) {
      const current = await refreshRecordingConsent();
      if (!current?.eligible || !$("sessionConsent").checked) {
        showToast("Recording did not start because current signed consent could not be verified.");
        return;
      }
    }
    $("transcript").value = "";
    $("meta").textContent = "";
    $("reviewed").checked = false;
    $("copy").disabled = true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mpeg"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!preferred) throw Object.assign(new Error("unsupported-audio-format"), { name: "NotSupportedError" });
    recorder = new MediaRecorder(stream, { mimeType: preferred });
    const activeRecorder = recorder;
    chunks = [];
    $("patient").disabled = true;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (recorder !== activeRecorder) return;
      recorder = null;
      audioBlob = new Blob(chunks, { type: activeRecorder.mimeType || chunks[0]?.type || "audio/webm" });
      chunks = [];
      stopTracks();
      $("transcribe").disabled = !audioBlob.size;
      setState(`Ready to transcribe · ${(audioBlob.size / 1024 / 1024).toFixed(1)} MB`);
    };
    recorder.start(1000);
    elapsedSeconds = 0;
    timerHandle = setInterval(() => {
      if (recorder?.state === "recording") elapsedSeconds += 1;
      $("timer").textContent = formatTime(elapsedSeconds);
      if (elapsedSeconds >= 600) $("finish").click();
    }, 1000);
    $("start").disabled = true;
    $("pause").disabled = false;
    $("finish").disabled = false;
    $("transcribe").disabled = true;
    setState(isSynthetic() ? "Recording synthetic role-play" : "Recording consented visit");
  } catch (error) {
    recorder = null;
    stopTracks();
    $("patient").disabled = false;
    updateStartAvailability();
    if (error.name === "NotAllowedError") showToast("Microphone access was not allowed.");
    else if (error.name === "NotSupportedError") showToast("This browser cannot create a Speech-to-Text compatible recording. Use Edge or Chrome.");
    else showToast("The microphone could not start.");
  }
};

$("pause").onclick = () => {
  if (!recorder) return;
  if (recorder.state === "recording") {
    recorder.pause();
    $("pause").textContent = "Resume";
    setState("Paused");
  } else if (recorder.state === "paused") {
    recorder.resume();
    $("pause").textContent = "Pause";
    setState(isSynthetic() ? "Recording synthetic role-play" : "Recording consented visit");
  }
};

$("finish").onclick = () => {
  if (!recorder || recorder.state === "inactive") return;
  recorder.stop();
  clearInterval(timerHandle);
  timerHandle = null;
  $("pause").disabled = true;
  $("finish").disabled = true;
  $("pause").textContent = "Pause";
};

$("transcribe").onclick = async () => {
  if (!audioBlob || !cloudClient) return;
  const recording = audioBlob;
  const bhwPatientId = selectedPatientId();
  const attestation = consentMode();
  const requestVersion = sessionVersion;
  discardAudio();
  $("transcribe").disabled = true;
  lockSelection(true);
  if (recording.size > MAX_AUDIO_BYTES) {
    setState("Recording discarded · over 9 MB limit");
    lockSelection(false);
    if (isSynthetic()) $("previsitConsent").checked = false;
    $("sessionConsent").checked = false;
    updateConsentCopy();
    showToast("This recording was over the 9 MB limit and has been discarded. Please record a shorter visit.");
    return;
  }
  setState("Cloud Speech-to-Text is transcribing…");
  try {
    const result = await cloudClient.transcribe(recording, { bhwPatientId, consentMode: attestation });
    if (requestVersion !== sessionVersion) return;
    $("transcript").value = result.transcript;
    $("meta").textContent = `Draft created ${new Date(result.transcribedAt).toLocaleString()} · ${result.model} · audio discarded`;
    $("reviewed").checked = false;
    $("copy").disabled = true;
    setState("Draft ready for provider review · audio discarded");
  } catch (error) {
    if (requestVersion !== sessionVersion) return;
    setState("Transcription failed · audio discarded");
    showToast(error.message || "The recording could not be transcribed.");
  } finally {
    discardAudio();
    if (requestVersion !== sessionVersion) return;
    lockSelection(false);
    if (isSynthetic()) $("previsitConsent").checked = false;
    $("sessionConsent").checked = false;
    updateConsentCopy();
  }
};

$("reviewed").onchange = () => { $("copy").disabled = !$("reviewed").checked || !$("transcript").value.trim(); };
$("transcript").oninput = () => { $("reviewed").checked = false; $("copy").disabled = true; };
$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("transcript").value);
  showToast("Reviewed transcript copied. It is still a draft, not a signed note.");
};
$("clear").onclick = () => clearSession({ resetAttestations: true });
window.addEventListener("pagehide", () => {
  stopTracks();
  discardAudio();
});

async function initialize() {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
    $("cloudStatus").textContent = "Browser microphone unsupported";
    $("start").disabled = true;
    return;
  }
  try {
    cloudClient = await createEncounterCloudClient();
    if (!cloudClient) throw new Error("Google Cloud is not configured for this site.");
    const [patients, config] = await Promise.all([
      cloudClient.listPatients(),
      cloudClient.transcriptionConfig(),
    ]);
    loadPatientOptions(patients, config);
    $("cloudStatus").textContent = config.realPatientEnabled ? "Google Cloud ready" : "Training only · BAA pending";
    if (!config.realPatientEnabled) {
      $("complianceNotice").innerHTML = "<b>Real-patient recording is still locked.</b> BHW must confirm its active Google Cloud BAA before the server will offer real patients. Synthetic BHW0000 role-play remains available.";
      setState("Training only until BAA approval");
    } else {
      setState("Select a patient");
    }
  } catch (error) {
    $("cloudStatus").textContent = "Cloud authorization failed";
    $("start").disabled = true;
    $("patient").disabled = true;
    showToast(error.message || "Google Cloud authorization failed.");
  }
}

initialize();


