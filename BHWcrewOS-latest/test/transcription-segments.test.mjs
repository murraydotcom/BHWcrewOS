import test from "node:test";
import assert from "node:assert/strict";

import {
  createTranscriptionSegmentQueue,
  MAX_VISIT_SECONDS,
  SEGMENT_SECONDS,
} from "../provider/transcription-segments.mjs";

test("visit transcription supports two hours in five-minute protected segments", () => {
  assert.equal(MAX_VISIT_SECONDS, 2 * 60 * 60);
  assert.equal(SEGMENT_SECONDS, 5 * 60);
});

test("failed audio remains available until a retry succeeds", async () => {
  let attempts = 0;
  const transcripts = [];
  const queue = createTranscriptionSegmentQueue({
    transcribeSegment: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return { transcript: "Recovered segment" };
    },
    onTranscript: (result, segment) => transcripts.push(`${segment.id}:${result.transcript}`),
  });

  queue.enqueue({ blob: new Blob(["audio"]), startedAtSeconds: 0, endedAtSeconds: 300 });
  await queue.process();
  assert.equal(queue.snapshot().failed, 1);
  assert.equal(queue.snapshot().retained, 1);
  assert.deepEqual(transcripts, []);

  await queue.retry();
  assert.equal(queue.snapshot().completed, 1);
  assert.equal(queue.snapshot().retained, 0);
  assert.deepEqual(transcripts, ["1:Recovered segment"]);
});

test("segments transcribe in order and later audio waits behind a failure", async () => {
  const attempts = [];
  const transcripts = [];
  let failFirst = true;
  const queue = createTranscriptionSegmentQueue({
    transcribeSegment: async (segment) => {
      attempts.push(segment.id);
      if (segment.id === 1 && failFirst) {
        failFirst = false;
        throw new Error("retry first");
      }
      return { transcript: `segment-${segment.id}` };
    },
    onTranscript: (result) => transcripts.push(result.transcript),
  });

  queue.enqueue({ blob: new Blob(["first"]), startedAtSeconds: 0, endedAtSeconds: 300 });
  queue.enqueue({ blob: new Blob(["second"]), startedAtSeconds: 300, endedAtSeconds: 600 });
  await queue.process();
  assert.deepEqual(attempts, [1]);
  assert.equal(queue.snapshot().retained, 2);

  await queue.retry();
  assert.deepEqual(attempts, [1, 1, 2]);
  assert.deepEqual(transcripts, ["segment-1", "segment-2"]);
  assert.equal(queue.snapshot().retained, 0);
});

test("audio is retained when appending the transcript fails", async () => {
  let appendFails = true;
  const queue = createTranscriptionSegmentQueue({
    transcribeSegment: async () => ({ transcript: "Draft" }),
    onTranscript: async () => {
      if (appendFails) {
        appendFails = false;
        throw new Error("draft append failed");
      }
    },
  });

  queue.enqueue({ blob: new Blob(["audio"]), startedAtSeconds: 0, endedAtSeconds: 10 });
  await queue.process();
  assert.equal(queue.snapshot().retained, 1);
  assert.equal(queue.snapshot().failed, 1);

  await queue.retry();
  assert.equal(queue.snapshot().retained, 0);
  assert.equal(queue.snapshot().completed, 1);
});
