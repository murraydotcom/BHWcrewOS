import test from "node:test";
import assert from "node:assert/strict";

import { createScreenWakeLockController } from "../provider/transcription-wake-lock.mjs";

function fakeSentinel() {
  const releaseListeners = [];
  return {
    released: false,
    addEventListener(type, listener) {
      if (type === "release") releaseListeners.push(listener);
    },
    async release() {
      this.released = true;
      releaseListeners.splice(0).forEach((listener) => listener());
    },
    deviceRelease() {
      this.released = true;
      releaseListeners.splice(0).forEach((listener) => listener());
    },
  };
}

test("screen awake protection is requested for recording and released afterward", async () => {
  const states = [];
  const sentinel = fakeSentinel();
  const requests = [];
  const controller = createScreenWakeLockController({
    wakeLock: { async request(type) { requests.push(type); return sentinel; } },
    visibilityState: () => "visible",
    onStatus: ({ state }) => states.push(state),
  });

  assert.equal(await controller.request(), true);
  assert.deepEqual(requests, ["screen"]);
  assert.deepEqual(controller.snapshot(), { desired: true, active: true });
  assert.equal(states.at(-1), "active");

  await controller.release();
  assert.equal(sentinel.released, true);
  assert.deepEqual(controller.snapshot(), { desired: false, active: false });
  assert.equal(states.at(-1), "idle");
});

test("screen awake protection reports unsupported devices without blocking recording", async () => {
  const states = [];
  const controller = createScreenWakeLockController({
    wakeLock: null,
    visibilityState: () => "visible",
    onStatus: ({ state }) => states.push(state),
  });

  assert.equal(await controller.request(), false);
  assert.equal(states.at(-1), "unsupported");
  assert.deepEqual(controller.snapshot(), { desired: true, active: false });
});

test("screen awake protection waits while hidden and reacquires when visible", async () => {
  const states = [];
  let visibility = "hidden";
  let requestCount = 0;
  const controller = createScreenWakeLockController({
    wakeLock: { async request() { requestCount += 1; return fakeSentinel(); } },
    visibilityState: () => visibility,
    onStatus: ({ state }) => states.push(state),
  });

  assert.equal(await controller.request(), false);
  assert.equal(requestCount, 0);
  assert.equal(states.at(-1), "hidden");

  visibility = "visible";
  assert.equal(await controller.handleVisibilityChange(), true);
  assert.equal(requestCount, 1);
  assert.equal(states.at(-1), "active");
});

test("an operating-system release becomes a visible interrupted state", async () => {
  const states = [];
  const sentinel = fakeSentinel();
  const controller = createScreenWakeLockController({
    wakeLock: { async request() { return sentinel; } },
    visibilityState: () => "visible",
    onStatus: ({ state }) => states.push(state),
  });

  await controller.request();
  sentinel.deviceRelease();

  assert.equal(states.at(-1), "released");
  assert.deepEqual(controller.snapshot(), { desired: true, active: false });
});

test("a pending wake-lock request is released if recording stops first", async () => {
  const sentinel = fakeSentinel();
  let resolveRequest;
  const pendingSentinel = new Promise((resolve) => { resolveRequest = resolve; });
  const controller = createScreenWakeLockController({
    wakeLock: { request: () => pendingSentinel },
    visibilityState: () => "visible",
  });

  const pendingRequest = controller.request();
  await controller.release();
  resolveRequest(sentinel);

  assert.equal(await pendingRequest, false);
  assert.equal(sentinel.released, true);
  assert.deepEqual(controller.snapshot(), { desired: false, active: false });
});
