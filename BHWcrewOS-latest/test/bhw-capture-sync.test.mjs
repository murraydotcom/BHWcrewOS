import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createBhwMemoryCloudClient,
  fromCloudMemory,
  toCloudMemory,
} from "../bhw-capture-sync.mjs";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("Capture cloud payload persists text metadata and omits every audio field", () => {
  const audio = new Blob(["synthetic audio"], { type: "audio/webm" });
  const payload = toCloudMemory({
    id: "memory-12345678",
    createdAt: Date.parse("2026-08-21T14:00:00.000Z"),
    updatedAt: Date.parse("2026-08-21T14:01:00.000Z"),
    mode: "Research",
    title: "Synthetic IgA research",
    project: "PREVENT-ND",
    tags: ["immune"],
    actions: ["Review synthetic sources"],
    summary: "A synthetic non-PHI summary.",
    transcript: "A synthetic non-PHI transcript.",
    sourceKind: "voice",
    audio,
    audioType: "audio/webm",
    durationMs: 4000,
    version: 3,
  }, { id: "device-1", platform: "Android", userAgent: "Synthetic Browser", standalone: true });

  assert.equal(payload.transcript, "A synthetic non-PHI transcript.");
  assert.equal(payload.device.platform, "Android");
  assert.equal(payload.nonPhiConfirmed, true);
  assert.equal("audio" in payload, false);
  assert.equal("audioType" in payload, false);
  assert.equal("durationMs" in payload, false);
});

test("remote text remains source of truth while an opted-in audio copy stays device-only", () => {
  const audio = new Blob(["synthetic audio"], { type: "audio/webm" });
  const local = fromCloudMemory({
    id: "memory-12345678",
    createdAt: "2026-08-21T14:00:00.000Z",
    updatedAt: "2026-08-21T14:02:00.000Z",
    mode: "Research",
    title: "Cloud title",
    project: "PREVENT-ND",
    tags: ["immune"],
    actions: [],
    summary: "Cloud summary",
    transcript: "Cloud transcript",
    source: { kind: "voice" },
    version: 3,
  }, { audio, audioType: "audio/webm", durationMs: 4000 });

  assert.equal(local.title, "Cloud title");
  assert.equal(local.syncStatus, "synced");
  assert.equal(local.audio, audio);
  assert.equal(local.sourceKind, "voice");
});

test("Capture reuses the CrewOS token exchange for list, save, and delete", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/.netlify/functions/rcm-cloud-config") return response({ enabled: true, apiBase: "https://api.example.test" });
    if (url === "/.netlify/functions/rcm-cloud-token") return response({ token: "short-cloud-token", expiresIn: 300 });
    if (url === "https://api.example.test/v1/memories") return response({ memories: [] });
    if (options.method === "PUT") return response({ memory: JSON.parse(options.body) });
    if (options.method === "DELETE") return response({ memory: { id: "memory-12345678", deletedAt: "2026-08-21T14:03:00.000Z" } });
    return response({ error: "not found" }, 404);
  };
  const client = await createBhwMemoryCloudClient(fetchImpl, { getCrewToken: () => "crew-session-token" });
  const memory = { id: "memory-12345678", transcript: "Synthetic", nonPhiConfirmed: true };
  await client.save(memory);
  await client.list();
  await client.remove(memory.id);

  const tokenRequest = requests.find(({ url }) => url === "/.netlify/functions/rcm-cloud-token");
  assert.equal(tokenRequest.options.headers.Authorization, "Bearer crew-session-token");
  const cloudRequests = requests.filter(({ url }) => String(url).startsWith("https://api.example.test/"));
  assert.ok(cloudRequests.every(({ options }) => options.headers.Authorization === "Bearer short-cloud-token"));
  assert.ok(cloudRequests.some(({ url, options }) => url.endsWith("/v1/memories/memory-12345678") && options.method === "PUT"));
  assert.ok(cloudRequests.some(({ url, options }) => url.endsWith("/v1/memories/memory-12345678") && options.method === "DELETE"));
});

test("Capture keeps non-PHI caching separate from reauthenticated protected Clinical mode", async () => {
  const [html, app, index] = await Promise.all([
    readFile(new URL("../bhw-capture.html", import.meta.url), "utf8"),
    readFile(new URL("../bhw-capture.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Non-PHI modes/);
  assert.match(html, /data-mode="Clinical">Clinical/);
  assert.doesNotMatch(html, /data-mode="Clinical" disabled/);
  assert.match(html, /id="clinicalGate"/);
  assert.match(html, /current-session agreement/);
  assert.match(html, /Clinical drafts and clinical references never enter this cache/);
  assert.match(html, /id="keepAudio" type="checkbox"/);
  assert.doesNotMatch(html, /id="keepAudio"[^>]*checked/);
  assert.match(html, /id="authGate"/);
  assert.match(html, /Sign in with CrewOS/);
  assert.match(html, /type="module" src="\/bhw-capture\.js\?v=20260825-1"/);
  assert.match(app, /bhw_capture_pin_v1/);
  assert.match(app, /validateCrewSession/);
  assert.match(app, /reauthenticateClinical/);
  assert.match(app, /clinicalClient\.saveCapture/);
  assert.match(app, /clinicalDraftId \|\| \(clinicalDraftId = uid\(\)\)/);
  assert.match(app, /Stop the recording and wait for transcription before changing capture mode/);
  assert.match(app, /Send to 24-Hour Documentation/);
  assert.match(app, /var dbPromise = null/);
  assert.match(app, /CACHE_STARTUP_TIMEOUT_MS/);
  assert.match(app, /await openDB\(\);/);
  assert.match(app, /return openDB\(\)\.then\(function \(database\)/);
  assert.doesNotMatch(app, /\bdb\.transaction\(/);
  assert.match(app, /raw audio discarded/);
  assert.match(index, /next === "\/bhw-capture\.html"/);
});

test("Capture falls back to a text-only cache when IndexedDB is unavailable", async () => {
  const app = await readFile(new URL("../bhw-capture.js", import.meta.url), "utf8");

  assert.match(app, /FALLBACK_STORE_KEY = "bhw_capture_text_cache_v1"/);
  assert.match(app, /if \(!globalThis\.indexedDB\)/);
  assert.match(app, /return Promise\.resolve\(enableFallbackCache\(\)\)/);
  assert.match(app, /Object\.assign\(\{\}, entry, \{ audio: null, audioType: null \}\)/);
  assert.match(app, /keepAudio"\)\.disabled = true/);
});


