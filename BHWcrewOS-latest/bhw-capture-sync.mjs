const CONFIG_URL = "/.netlify/functions/rcm-cloud-config";
const TOKEN_URL = "/.netlify/functions/rcm-cloud-token";

function asIso(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export function toCloudMemory(entry, device = {}) {
  return {
    id: String(entry.id || ""),
    createdAt: asIso(entry.createdAt),
    clientUpdatedAt: asIso(entry.updatedAt || entry.createdAt),
    mode: entry.mode || "Brain Dump",
    title: entry.title || "Untitled capture",
    project: entry.project || "Personal work",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    actions: Array.isArray(entry.actions) ? entry.actions : [],
    summary: entry.summary || "",
    transcript: entry.transcript || "",
    source: {
      kind: entry.sourceKind || "typed",
      captureMode: entry.mode || "Brain Dump",
    },
    device: {
      id: device.id || "",
      platform: device.platform || "",
      userAgent: device.userAgent || "",
      standalone: Boolean(device.standalone),
    },
    nonPhiConfirmed: true,
    version: Math.max(3, Number(entry.version) || 3),
  };
}

export function fromCloudMemory(memory, existing = null) {
  if (memory.deletedAt) {
    return {
      id: memory.id,
      createdAt: Date.parse(memory.createdAt) || Date.now(),
      updatedAt: Date.parse(memory.updatedAt) || Date.now(),
      deletedAt: memory.deletedAt,
      syncStatus: "synced",
      lastSyncError: "",
      version: Math.max(3, Number(memory.version) || 3),
    };
  }
  return {
    ...memory,
    createdAt: Date.parse(memory.createdAt) || Date.now(),
    updatedAt: Date.parse(memory.updatedAt) || Date.now(),
    deletedAt: "",
    syncStatus: "synced",
    lastSyncError: "",
    sourceKind: memory.source?.kind || existing?.sourceKind || "typed",
    audio: existing?.audio || null,
    audioType: existing?.audioType || null,
    durationMs: Number(existing?.durationMs) || 0,
    version: Math.max(3, Number(memory.version) || 3),
  };
}

export function getDeviceMetadata(storage = localStorage, navigatorLike = navigator) {
  const key = "bhw_capture_device_v1";
  let id = "";
  try { id = storage.getItem(key) || ""; } catch { /* storage unavailable */ }
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { storage.setItem(key, id); } catch { /* storage unavailable */ }
  }
  return {
    id,
    platform: navigatorLike.userAgentData?.platform || navigatorLike.platform || "Browser",
    userAgent: navigatorLike.userAgent || "",
    standalone: Boolean(globalThis.matchMedia?.("(display-mode: standalone)")?.matches || navigatorLike.standalone),
  };
}

export async function createBhwMemoryCloudClient(fetchImpl = fetch, options = {}) {
  const configResponse = await fetchImpl(CONFIG_URL, { credentials: "same-origin", cache: "no-store" });
  if (!configResponse.ok) return null;
  const config = await configResponse.json();
  if (!config.enabled || !config.apiBase) return null;

  const readCrewToken = options.getCrewToken || (() => {
    try { return sessionStorage.getItem("crewos_token") || ""; } catch { return ""; }
  });
  let token = "";
  let tokenExpiresAt = 0;

  async function getToken(force = false) {
    if (!force && token && tokenExpiresAt > Date.now() + 30000) return token;
    const crewToken = readCrewToken();
    if (!crewToken) throw Object.assign(new Error("Sign in to CrewOS to sync BHW Memory"), { status: 401 });
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Authorization: `Bearer ${crewToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token) {
      throw Object.assign(new Error(body.error || "Google Cloud authorization failed"), { status: response.status });
    }
    token = body.token;
    tokenExpiresAt = Date.now() + Number(body.expiresIn || 300) * 1000;
    return token;
  }

  async function request(path, options = {}, retry = true) {
    const bearer = await getToken();
    const response = await fetchImpl(`${config.apiBase}${path}`, {
      ...options,
      headers: {
        ...(options.body && !options.headers?.["Content-Type"] ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        Authorization: `Bearer ${bearer}`,
      },
      cache: "no-store",
    });
    if (response.status === 401 && retry) {
      await getToken(true);
      return request(path, options, false);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(body.error || `BHW Memory sync failed (${response.status})`), { status: response.status });
    }
    return body;
  }

  return {
    apiBase: config.apiBase,
    async list() {
      const body = await request("/v1/memories");
      return Array.isArray(body.memories) ? body.memories : [];
    },
    async save(memory) {
      const body = await request(`/v1/memories/${encodeURIComponent(memory.id)}`, {
        method: "PUT",
        body: JSON.stringify(memory),
      });
      return body.memory;
    },
    async remove(id) {
      const body = await request(`/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      return body.memory;
    },
  };
}
