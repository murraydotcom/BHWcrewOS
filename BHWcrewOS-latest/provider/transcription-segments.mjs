export const MAX_VISIT_SECONDS = 2 * 60 * 60;
export const SEGMENT_SECONDS = 5 * 60;

function segmentSnapshot(segments, processing) {
  const retained = segments.filter((segment) => segment.blob && segment.status !== "done");
  return {
    total: segments.length,
    completed: segments.filter((segment) => segment.status === "done").length,
    pending: segments.filter((segment) => segment.status === "pending").length,
    failed: segments.filter((segment) => segment.status === "failed").length,
    transcribing: segments.filter((segment) => segment.status === "transcribing").length,
    retained: retained.length,
    retainedBytes: retained.reduce((sum, segment) => sum + Number(segment.blob?.size || 0), 0),
    processing,
  };
}

export function createTranscriptionSegmentQueue({
  transcribeSegment,
  onTranscript = () => {},
  onError = () => {},
  onChange = () => {},
} = {}) {
  if (typeof transcribeSegment !== "function") throw new TypeError("transcribeSegment is required");

  let segments = [];
  let activePromise = null;
  let epoch = 0;
  let nextId = 1;

  function snapshot() {
    return segmentSnapshot(segments, Boolean(activePromise));
  }

  function notify() {
    onChange(snapshot());
  }

  function enqueue({ blob, startedAtSeconds = 0, endedAtSeconds = 0, patientId = "", consentMode = "" } = {}) {
    if (!blob?.size) return null;
    const segment = {
      id: nextId++,
      blob,
      startedAtSeconds,
      endedAtSeconds,
      patientId,
      consentMode,
      status: "pending",
      error: "",
    };
    segments.push(segment);
    notify();
    void process();
    return segment.id;
  }

  function process({ retryFailed = false } = {}) {
    if (activePromise) return activePromise;
    if (retryFailed) {
      for (const segment of segments) {
        if (segment.status === "failed") {
          segment.status = "pending";
          segment.error = "";
        }
      }
    }

    const runEpoch = epoch;
    activePromise = (async () => {
      for (const segment of segments) {
        if (runEpoch !== epoch) return;
        if (segment.status === "done") continue;
        if (segment.status === "failed") break;
        if (segment.status !== "pending") continue;

        segment.status = "transcribing";
        notify();
        try {
          const result = await transcribeSegment(segment);
          if (runEpoch !== epoch) return;
          await onTranscript(result, {
            id: segment.id,
            startedAtSeconds: segment.startedAtSeconds,
            endedAtSeconds: segment.endedAtSeconds,
          });
          if (runEpoch !== epoch) return;
          segment.blob = null;
          segment.status = "done";
          segment.error = "";
          notify();
        } catch (error) {
          if (runEpoch !== epoch) return;
          segment.status = "failed";
          segment.error = String(error?.message || "Transcription failed");
          onError(error, {
            id: segment.id,
            startedAtSeconds: segment.startedAtSeconds,
            endedAtSeconds: segment.endedAtSeconds,
          });
          notify();
          break;
        }
      }
    })().finally(() => {
      if (runEpoch !== epoch) return;
      activePromise = null;
      notify();
    });
    return activePromise;
  }

  function retry() {
    return process({ retryFailed: true });
  }

  function clear() {
    epoch += 1;
    for (const segment of segments) segment.blob = null;
    segments = [];
    activePromise = null;
    nextId = 1;
    notify();
  }

  return {
    enqueue,
    process,
    retry,
    clear,
    snapshot,
    hasRetainedAudio: () => snapshot().retained > 0,
  };
}
