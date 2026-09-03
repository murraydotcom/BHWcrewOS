import { CREW_SESSION_EXPIRED, createEncounterCloudClient } from "./cloud-queue.mjs";
import {
  createTranscriptionSegmentQueue,
  MAX_VISIT_SECONDS,
  SEGMENT_SECONDS,
} from "./transcription-segments.mjs";
import { createScreenWakeLockController } from "./transcription-wake-lock.mjs";

const SYNTHETIC_PATIENT_ID = "BHW0000";
const SYNTHETIC_CONSENT = "synthetic-role-play";
const LIVE_CONSENT = "session-recording-confirmed";
const DEFAULT_MAX_AUDIO_BYTES = 9 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
let cloudClient = null;
let longRecordingEnabled = false;
let recorder = null;
let stream = null;
let segmentChunks = [];
let segmentQueue = null;
let preferredMimeType = "";
let visitPatientId = "";
let visitConsentMode = "";
let visitActive = false;
let visitFinishing = false;
let stopReason = "";
let elapsedSeconds = 0;
let segmentElapsedSeconds = 0;
let segmentStartedAtSeconds = 0;
let maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES;
let maxVisitSeconds = MAX_VISIT_SECONDS;
let segmentSeconds = SEGMENT_SECONDS;
let timerHandle = null;
let toastTimer = null;
let sessionVersion = 0;
let verifiedConsent = null;
let consentLookupVersion = 0;
let crewSessionChannel = null;
let wakeWarningState = "";

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
function renderScreenWakeStatus({ state }) {
  const messages = {
    idle: "Screen awake protection starts with recording",
    requesting: "Turning on screen awake protection…",
    active: "Screen awake protection active · keep this tab visible",
    hidden: "Screen protection needs attention · return to this tab",
    released: "Screen awake protection was released · keep the screen on",
    unsupported: "Screen awake protection unavailable · disable device sleep",
    unavailable: "Screen awake protection unavailable · keep the screen on",
  };
  const status = $("wakeStatus");
  status.dataset.state = state;
  status.textContent = messages[state] || messages.idle;
  const warning = ["hidden", "released", "unsupported", "unavailable"].includes(state);
  if (warning && visitActive && wakeWarningState !== state) {
    wakeWarningState = state;
    showToast("Screen awake protection is not active. Keep this tab visible and disable device sleep until the visit is safely transcribed.");
  } else if (state === "active" || state === "idle") {
    wakeWarningState = "";
  }
}

const screenWakeLock = createScreenWakeLockController({
  wakeLock: navigator.wakeLock,
  visibilityState: () => document.visibilityState,
  onStatus: renderScreenWakeStatus,
});
function crewSignInUrl() {
  const next = `${location.pathname}${location.search}${location.hash}`;
  return `/crewos?next=${encodeURIComponent(next)}`;
}
function signInAgain() { location.replace(crewSignInUrl()); }
function consentSourceLabel(value) {
  return value === "new-patient-packet" ? "new-patient packet" : "previsit form";
}

function localDateTimeValue(value = "") {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function populateConsentVerification(result) {
  const consent = result?.consent || {};
  $("consentSource").value = consent.sourceType === "new-patient-packet" ? "new-patient-packet" : "previsit-form";
  $("consentSignedAt").value = localDateTimeValue(consent.signedAt);
  $("consentVersion").value = consent.formVersion || "recording-ai-consent-v1";
  $("consentEvidence").value = consent.evidenceReference || "";
}

function stopTracks() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function discardAudio() {
  segmentChunks = [];
  segmentQueue?.clear();
}

function queueSnapshot() {
  return segmentQueue?.snapshot() || {
    total: 0,
    completed: 0,
    pending: 0,
    failed: 0,
    transcribing: 0,
    retained: 0,
    retainedBytes: 0,
    processing: false,
  };
}

function segmentLabel(segment) {
  return `Segment ${segment.id} · ${formatTime(segment.startedAtSeconds)}–${formatTime(segment.endedAtSeconds)}`;
}

function appendSegmentTranscript(result, segment) {
  const text = String(result?.transcript || "").trim();
  const block = `${segmentLabel(segment)}\n${text || "[No speech recognized in this segment.]"}`;
  const current = $("transcript").value.trim();
  $("transcript").value = current ? `${current}\n\n${block}` : block;
  $("reviewed").checked = false;
  $("copy").disabled = true;
}

async function transcribeSegment(segment) {
  if (!cloudClient) throw new Error("Google Cloud transcription is unavailable");
  if (segment.blob.size > maxAudioBytes) {
    throw Object.assign(new Error("This protected segment is over the upload limit"), { code: "AUDIO_SEGMENT_TOO_LARGE" });
  }
  return cloudClient.transcribe(segment.blob, {
    bhwPatientId: segment.patientId,
    consentMode: segment.consentMode,
  });
}

function handleSegmentError(error, segment) {
  const sessionExpired = error?.code === CREW_SESSION_EXPIRED;
  const detail = error?.code === "AUDIO_SEGMENT_TOO_LARGE"
    ? `${segmentLabel(segment)} is too large to upload. Its audio is still retained in this open tab.`
    : sessionExpired
      ? "Your CrewHQ session expired. This segment is retained in the open tab. Do not close or reload it; sign in from another tab, then retry here."
      : `${segmentLabel(segment)} could not be transcribed. Its audio is retained in this open tab for retry.`;
  setState(sessionExpired
    ? "CrewHQ session expired · audio retained in this tab"
    : "Transcription needs attention · audio retained for retry");
  $("reauth").hidden = !sessionExpired;
  showToast(detail);
}

function finishSuccessfulVisit(snapshot) {
  if (!visitFinishing || snapshot.processing || snapshot.retained || snapshot.completed !== snapshot.total) return;
  void screenWakeLock.release();
  visitActive = false;
  visitFinishing = false;
  lockSelection(false);
  $("previsitConsent").checked = false;
  $("sessionConsent").checked = false;
  updateConsentCopy();
  $("reviewed").checked = false;
  $("copy").disabled = true;
  $("reauth").hidden = true;
  setState("Draft ready for provider review · all segment audio discarded after successful transcription");
}

function updateSegmentStatus(snapshot = queueSnapshot()) {
  const waiting = snapshot.pending + snapshot.transcribing;
  $("transcribe").textContent = snapshot.failed ? `Retry ${snapshot.failed} retained segment${snapshot.failed === 1 ? "" : "s"}` : "Retry retained audio";
  $("transcribe").disabled = snapshot.failed === 0;
  $("meta").textContent = snapshot.total
    ? `${snapshot.completed} of ${snapshot.total} protected segment${snapshot.total === 1 ? "" : "s"} transcribed${snapshot.retained ? ` · ${snapshot.retained} retained in this tab` : " · successful audio discarded"}`
    : "";
  if (snapshot.failed) {
    setState("Transcription needs attention · audio retained for retry");
  } else if (visitFinishing && waiting) {
    setState(`Finishing visit · ${waiting} protected segment${waiting === 1 ? "" : "s"} processing`);
  } else if (visitActive && !visitFinishing) {
    setState(`${isSynthetic() ? "Recording synthetic role-play" : "Recording consented visit"} · protected segments transcribe automatically`);
  }
  finishSuccessfulVisit(snapshot);
}

function beginSegmentRecorder() {
  if (!stream || !visitActive || visitFinishing) return;
  segmentChunks = [];
  segmentElapsedSeconds = 0;
  segmentStartedAtSeconds = elapsedSeconds;
  const activeRecorder = new MediaRecorder(stream, {
    mimeType: preferredMimeType,
    audioBitsPerSecond: 96_000,
  });
  recorder = activeRecorder;
  activeRecorder.ondataavailable = (event) => { if (event.data.size) segmentChunks.push(event.data); };
  activeRecorder.onstop = () => {
    if (recorder === activeRecorder) recorder = null;
    const completedReason = stopReason;
    stopReason = "";
    const blob = new Blob(segmentChunks, { type: activeRecorder.mimeType || segmentChunks[0]?.type || "audio/webm" });
    segmentChunks = [];
    if (blob.size) {
      segmentQueue.enqueue({
        blob,
        startedAtSeconds: segmentStartedAtSeconds,
        endedAtSeconds: elapsedSeconds,
        patientId: visitPatientId,
        consentMode: visitConsentMode,
      });
    }
    if (visitFinishing || completedReason === "finish") {
      stopTracks();
      if (!blob.size && queueSnapshot().total === 0) {
        void screenWakeLock.release();
        visitActive = false;
        visitFinishing = false;
        lockSelection(false);
        setState("No audio was captured");
      } else {
        updateSegmentStatus();
      }
      return;
    }
    beginSegmentRecorder();
  };
  activeRecorder.start(1000);
}

function rotateSegment() {
  if (!recorder || recorder.state !== "recording" || stopReason) return;
  stopReason = "rotate";
  setState("Securing the current segment · recording continues automatically");
  recorder.stop();
}

function finishVisit() {
  if (!visitActive || visitFinishing) return;
  visitFinishing = true;
  clearInterval(timerHandle);
  timerHandle = null;
  $("pause").disabled = true;
  $("finish").disabled = true;
  $("pause").textContent = "Pause";
  if (recorder && recorder.state !== "inactive") {
    stopReason = "finish";
    recorder.stop();
  } else {
    stopTracks();
    updateSegmentStatus();
  }
}

function canStart() {
  return Boolean(
    cloudClient
    && longRecordingEnabled
    && selectedPatientId()
    && $("previsitConsent").checked
    && (isSynthetic() || hasVerifiedConsent())
    && $("sessionConsent").checked
    && !visitActive
    && !queueSnapshot().retained
    && !queueSnapshot().processing,
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
    $("previsitConsent").disabled = false;
    if (hasVerifiedConsent()) {
      const consent = verifiedConsent.consent;
      const signed = new Date(consent.signedAt).toLocaleDateString();
      $("previsitConsentText").textContent = `Signed recording and AI-transcription consent is current from the ${consentSourceLabel(consent.sourceType)} (${signed}). Check to confirm you reviewed it for today’s recording.`;
    } else {
      $("previsitConsentText").textContent = "I reviewed a signed previsit form or new-patient packet and confirmed that it authorizes visit recording and AI-assisted transcription. Check to verify it here.";
    }
    $("sessionConsentText").textContent = "The patient—and every other person who may be heard—agrees to recording for this visit.";
  } else {
    $("previsitConsent").disabled = true;
    $("previsitConsent").checked = false;
    $("previsitConsentText").textContent = "Select a patient to review the required consent.";
    $("sessionConsentText").textContent = "Select a patient to confirm recording agreement for this visit.";
  }
  $("consentVerification").hidden = !selected || isSynthetic() || hasVerifiedConsent() || !$("previsitConsent").checked;
  $("sessionConsent").disabled = !selected;
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
    populateConsentVerification(result);
    setState(result.eligible ? "Check both consent boxes to record" : "Verify signed consent below, then check today’s recording agreement");
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
  void screenWakeLock.release();
  sessionVersion += 1;
  visitActive = false;
  visitFinishing = false;
  stopReason = "";
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
  segmentElapsedSeconds = 0;
  segmentStartedAtSeconds = 0;
  visitPatientId = "";
  visitConsentMode = "";
  $("timer").textContent = "00:00";
  $("transcript").value = "";
  $("meta").textContent = "";
  $("reviewed").checked = false;
  $("pause").disabled = true;
  $("pause").textContent = "Pause";
  $("finish").disabled = true;
  $("transcribe").disabled = true;
  $("transcribe").textContent = "Retry retained audio";
  $("reauth").hidden = true;
  $("copy").disabled = true;
  $("patient").disabled = !cloudClient;
  if (resetAttestations) {
    $("previsitConsent").checked = false;
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

segmentQueue = createTranscriptionSegmentQueue({
  transcribeSegment,
  onTranscript: appendSegmentTranscript,
  onError: handleSegmentError,
  onChange: updateSegmentStatus,
});

$("patient").onchange = async () => {
  verifiedConsent = null;
  clearSession({ resetAttestations: true });
  await refreshRecordingConsent();
};
for (const id of ["previsitConsent", "sessionConsent"]) {
  $(id).onchange = () => {
    const snapshot = queueSnapshot();
    if ((visitActive || snapshot.retained || snapshot.processing) && !$(id).checked) {
      clearSession({ resetAttestations: true });
      showToast("Recording stopped and discarded because recording agreement was withdrawn.");
      return;
    }
    updateConsentCopy();
  };
}

$("saveRecordingConsent").onclick = async () => {
  const bhwPatientId = selectedPatientId();
  const snapshot = queueSnapshot();
  if (!bhwPatientId || isSynthetic() || visitActive || snapshot.retained || snapshot.processing) return;
  if (!$("previsitConsent").checked) {
    showToast("Check the signed-consent verification statement first.");
    return;
  }
  const signedAt = $("consentSignedAt").value;
  const evidenceReference = $("consentEvidence").value.trim();
  if (!signedAt || !evidenceReference) {
    showToast("Patient signed date/time and the secure signed-form reference are required.");
    return;
  }
  const button = $("saveRecordingConsent");
  button.disabled = true;
  setState("Saving signed consent to BHW Cloud…");
  try {
    await cloudClient.saveRecordingConsent(bhwPatientId, {
      sourceType: $("consentSource").value,
      signedAt: new Date(signedAt).toISOString(),
      formVersion: $("consentVersion").value.trim() || "recording-ai-consent-v1",
      evidenceReference,
      status: "current",
      verificationAttestation: true,
    });
    const current = await refreshRecordingConsent();
    if (!current?.eligible) throw new Error("The saved consent did not become current. Review the signed form details.");
    setState(`Saved to BHW Cloud · ${new Date().toLocaleString()} · check both consent boxes to record`);
    showToast(`Signed consent saved to BHW Cloud from the ${consentSourceLabel(current.consent.sourceType)}.`);
  } catch (error) {
    showToast(error.message || "Signed consent could not be verified.");
    setState("Not saved · signed consent verification needs attention");
  } finally {
    button.disabled = false;
    updateConsentCopy();
  }
};

$("start").onclick = async () => {
  if (!canStart()) {
    showToast("Select the patient, verify signed consent, and confirm today’s recording agreement before starting.");
    return;
  }
  try {
    if (!isSynthetic()) {
      const current = await refreshRecordingConsent();
      if (!current?.eligible || !$("previsitConsent").checked || !$("sessionConsent").checked) {
        showToast("Recording did not start because current signed consent could not be verified.");
        return;
      }
    }
    segmentQueue.clear();
    $("transcript").value = "";
    $("meta").textContent = "";
    $("reviewed").checked = false;
    $("copy").disabled = true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    preferredMimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mpeg"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!preferredMimeType) throw Object.assign(new Error("unsupported-audio-format"), { name: "NotSupportedError" });
    visitPatientId = selectedPatientId();
    visitConsentMode = consentMode();
    visitActive = true;
    visitFinishing = false;
    stopReason = "";
    elapsedSeconds = 0;
    segmentElapsedSeconds = 0;
    lockSelection(true);
    beginSegmentRecorder();
    void screenWakeLock.request();
    timerHandle = setInterval(() => {
      if (recorder?.state === "recording") {
        elapsedSeconds += 1;
        segmentElapsedSeconds += 1;
      }
      $("timer").textContent = formatTime(elapsedSeconds);
      if (elapsedSeconds >= maxVisitSeconds) {
        finishVisit();
      } else if (segmentElapsedSeconds >= segmentSeconds) {
        rotateSegment();
      }
    }, 1000);
    $("start").disabled = true;
    $("pause").disabled = false;
    $("finish").disabled = false;
    $("transcribe").disabled = true;
    setState(`${isSynthetic() ? "Recording synthetic role-play" : "Recording consented visit"} · protected segments transcribe automatically`);
  } catch (error) {
    recorder = null;
    visitActive = false;
    visitFinishing = false;
    void screenWakeLock.release();
    stopTracks();
    lockSelection(false);
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
    void screenWakeLock.release();
    $("pause").textContent = "Resume";
    setState("Paused · keep this tab open");
  } else if (recorder.state === "paused") {
    recorder.resume();
    void screenWakeLock.request();
    $("pause").textContent = "Pause";
    setState(`${isSynthetic() ? "Recording synthetic role-play" : "Recording consented visit"} · protected segments transcribe automatically`);
  }
};

$("finish").onclick = () => finishVisit();

$("transcribe").onclick = async () => {
  if (!cloudClient || queueSnapshot().failed === 0) return;
  $("transcribe").disabled = true;
  setState("Retrying retained protected audio…");
  await segmentQueue.retry();
};
$("reauth").onclick = () => {
  window.open(crewSignInUrl(), "_blank", "noopener");
  showToast("Complete CrewHQ sign-in in the new tab, then return here. Retained audio stays in this tab.");
};

$("reviewed").onchange = () => { $("copy").disabled = !$("reviewed").checked || !$("transcript").value.trim(); };
$("transcript").oninput = () => { $("reviewed").checked = false; $("copy").disabled = true; };
$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("transcript").value);
  showToast("Reviewed transcript copied. It is still a draft, not a signed note.");
};
$("clear").onclick = () => {
  const snapshot = queueSnapshot();
  if (
    (visitActive || snapshot.retained || snapshot.processing || $("transcript").value.trim())
    && !globalThis.confirm("Permanently clear this visit's audio and transcript draft? Cleared content cannot be recovered.")
  ) return;
  clearSession({ resetAttestations: true });
};
window.addEventListener("beforeunload", (event) => {
  const snapshot = queueSnapshot();
  if (!visitActive && !snapshot.retained && !snapshot.processing) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => {
  crewSessionChannel?.close();
  void screenWakeLock.release();
  stopTracks();
  discardAudio();
});
document.addEventListener("visibilitychange", () => {
  if (!visitActive || recorder?.state === "paused") return;
  void screenWakeLock.handleVisibilityChange();
});

if ("BroadcastChannel" in globalThis) {
  crewSessionChannel = new BroadcastChannel("bhw-crew-session-v1");
  crewSessionChannel.onmessage = (event) => {
    const token = typeof event.data?.token === "string" ? event.data.token : "";
    if (event.data?.type !== "crew-session" || token.length > 4096 || token.split(".").length !== 2) return;
    try { sessionStorage.setItem("crewos_token", token); } catch { return; }
    $("reauth").hidden = true;
    setState("CrewHQ sign-in refreshed · retained audio is ready to retry");
    showToast("CrewHQ sign-in refreshed. Click Retry retained audio.");
  };
}

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
    longRecordingEnabled = Boolean(config.longRecordingEnabled);
    maxAudioBytes = Math.max(1, Number(config.maxAudioBytes) || DEFAULT_MAX_AUDIO_BYTES);
    maxVisitSeconds = Math.max(SEGMENT_SECONDS, Number(config.maxVisitSeconds) || MAX_VISIT_SECONDS);
    segmentSeconds = Math.min(
      maxVisitSeconds,
      Math.max(60, Number(config.segmentSeconds) || SEGMENT_SECONDS),
    );
    loadPatientOptions(patients, config);
    if (!longRecordingEnabled) {
      $("cloudStatus").textContent = "Long recording setup incomplete";
      $("complianceNotice").innerHTML = "<b>Recording is temporarily locked.</b> Private temporary audio storage and immediate deletion must be configured before either short or long visit transcription can run.";
      setState("Waiting for protected long-recording setup");
      updateStartAvailability();
      return;
    }
    $("cloudStatus").textContent = config.realPatientEnabled ? "Google Cloud ready" : "Training only · BAA pending";
    if (!config.realPatientEnabled) {
      $("complianceNotice").innerHTML = "<b>Real-patient recording is still locked.</b> BHW must confirm its active Google Cloud BAA before the server will offer real patients. Synthetic BHW0000 role-play remains available.";
      setState("Training only until BAA approval");
    } else {
      setState("Select a patient");
    }
  } catch (error) {
    if (error.code === CREW_SESSION_EXPIRED) {
      signInAgain();
      return;
    }
    $("cloudStatus").textContent = "Cloud authorization failed";
    $("start").disabled = true;
    $("patient").disabled = true;
    showToast(error.message || "Google Cloud authorization failed.");
  }
}

initialize();

