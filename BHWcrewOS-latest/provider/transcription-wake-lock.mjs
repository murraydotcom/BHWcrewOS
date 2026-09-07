export function createScreenWakeLockController({
  wakeLock = globalThis.navigator?.wakeLock,
  visibilityState = () => globalThis.document?.visibilityState || "visible",
  onStatus = () => {},
} = {}) {
  let desired = false;
  let sentinel = null;
  let generation = 0;

  const emit = (state, error = null) => onStatus({ state, error });

  async function request() {
    desired = true;
    if (sentinel && !sentinel.released) {
      emit("active");
      return true;
    }
    if (visibilityState() !== "visible") {
      emit("hidden");
      return false;
    }
    if (!wakeLock?.request) {
      emit("unsupported");
      return false;
    }

    const requestGeneration = ++generation;
    emit("requesting");
    try {
      const acquired = await wakeLock.request("screen");
      if (!desired || requestGeneration !== generation) {
        try {
          await acquired.release();
        } catch {
          // A device may revoke a pending request before the recorder finishes stopping.
        }
        return false;
      }
      sentinel = acquired;
      acquired.addEventListener?.("release", () => {
        if (sentinel !== acquired) return;
        sentinel = null;
        emit(desired ? "released" : "idle");
      }, { once: true });
      emit("active");
      return true;
    } catch (error) {
      if (desired && requestGeneration === generation) emit("unavailable", error);
      return false;
    }
  }

  async function release() {
    desired = false;
    generation += 1;
    const active = sentinel;
    sentinel = null;
    if (active && !active.released) {
      try {
        await active.release();
      } catch {
        // The device may have released it first; the recorder can still stop safely.
      }
    }
    emit("idle");
  }

  async function handleVisibilityChange() {
    if (!desired) return false;
    if (visibilityState() === "visible") return request();
    emit("hidden");
    return false;
  }

  return {
    request,
    release,
    handleVisibilityChange,
    snapshot: () => ({ desired, active: Boolean(sentinel && !sentinel.released) }),
  };
}
