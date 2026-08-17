import { createEncounterCloudClient } from "./cloud-queue.mjs";

const $ = (id) => document.getElementById(id);
let cloudClient = null;
let recorder = null;
let stream = null;
let chunks = [];
let audioBlob = null;
let elapsedSeconds = 0;
let timerHandle = null;

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("on");
  setTimeout(() => $("toast").classList.remove("on"), 4500);
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function setState(value) { $("state").textContent = value; }

function stopTracks() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function resetPilot() {
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
  chunks = [];
  audioBlob = null;
  elapsedSeconds = 0;
  $("timer").textContent = "00:00";
  $("transcript").value = "";
  $("meta").textContent = "";
  $("reviewed").checked = false;
  $("start").disabled = false;
  $("pause").disabled = true;
  $("finish").disabled = true;
  $("transcribe").disabled = true;
  $("copy").disabled = true;
  setState("Ready");
}

$("start").onclick = async () => {
  if (!$("synthetic").checked || !$("consent").checked) {
    showToast("Confirm both synthetic role-play and recording awareness before starting.");
    return;
  }
  if (!cloudClient) {
    showToast("Wait for the protected Google Cloud connection.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
    const activeRecorder = recorder;
    chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (recorder !== activeRecorder) return;
      audioBlob = new Blob(chunks, { type: activeRecorder.mimeType || chunks[0]?.type || "audio/webm" });
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
    setState("Recording synthetic role-play");
  } catch (error) {
    stopTracks();
    showToast(error.name === "NotAllowedError" ? "Microphone access was not allowed." : "The microphone could not start.");
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
    setState("Recording synthetic role-play");
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
  if (audioBlob.size > 12 * 1024 * 1024) {
    showToast("This recording is over the 12 MB pilot limit. Clear it and try a shorter role-play.");
    return;
  }
  $("transcribe").disabled = true;
  setState("Vertex AI is transcribing…");
  try {
    const result = await cloudClient.transcribe(audioBlob, { bhwPatientId: "BHW0000", syntheticRolePlay: true });
    $("transcript").value = result.transcript;
    $("meta").textContent = `Draft created ${new Date(result.transcribedAt).toLocaleString()} · ${result.model}`;
    $("reviewed").checked = false;
    $("copy").disabled = true;
    setState("Draft ready for provider review");
  } catch (error) {
    $("transcribe").disabled = false;
    setState("Transcription failed");
    showToast(error.message || "The recording could not be transcribed.");
  }
};

$("reviewed").onchange = () => { $("copy").disabled = !$("reviewed").checked || !$("transcript").value.trim(); };
$("transcript").oninput = () => { $("reviewed").checked = false; $("copy").disabled = true; };
$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("transcript").value);
  showToast("Reviewed transcript copied. It is still a draft, not a signed note.");
};
$("clear").onclick = resetPilot;
window.addEventListener("beforeunload", stopTracks);

async function initialize() {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
    $("cloudStatus").textContent = "Browser microphone unsupported";
    $("start").disabled = true;
    return;
  }
  try {
    cloudClient = await createEncounterCloudClient();
    $("cloudStatus").textContent = cloudClient ? "Google Cloud ready" : "Cloud unavailable";
    if (!cloudClient) $("start").disabled = true;
  } catch (error) {
    $("cloudStatus").textContent = "Cloud authorization failed";
    $("start").disabled = true;
    showToast(error.message || "Google Cloud authorization failed.");
  }
}

initialize();
