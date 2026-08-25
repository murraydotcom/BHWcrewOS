import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  clearCrewSession,
  crewosSigninUrl,
  validateCrewSession,
} from "../bhw-capture-auth.mjs";

const require = createRequire(import.meta.url);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    removeItem(key) { values.delete(key); },
  };
}

test("builds the CrewOS return URL for Capture", () => {
  assert.equal(crewosSigninUrl(), "/crewos?next=%2Fbhw-capture.html");
});

test("requires a CrewOS token before contacting the server", async () => {
  let called = false;
  const result = await validateCrewSession({
    storage: memoryStorage(),
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.authenticated, false);
  assert.equal(result.reason, "missing");
  assert.equal(called, false);
});

test("returns the server-verified staff identity", async () => {
  const storage = memoryStorage({ crewos_token: "signed-token" });
  const result = await validateCrewSession({
    storage,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer signed-token");
      assert.deepEqual(JSON.parse(options.body), { action: "session" });
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { staffId: "staff-1", name: "Amaris", role: "Provider", access: "Admin" } }),
      };
    },
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.user.name, "Amaris");
});

test("removes an expired or invalid CrewOS token", async () => {
  const storage = memoryStorage({ crewos_token: "expired-token" });
  const result = await validateCrewSession({
    storage,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "expired" }) }),
  });
  assert.equal(result.reason, "expired");
  assert.equal(storage.getItem("crewos_token"), null);
});

test("keeps the token when verification is temporarily unavailable", async () => {
  const storage = memoryStorage({ crewos_token: "signed-token" });
  const result = await validateCrewSession({
    storage,
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(result.reason, "unavailable");
  assert.equal(storage.getItem("crewos_token"), "signed-token");
  clearCrewSession(storage);
  assert.equal(storage.getItem("crewos_token"), null);
});

test("the auth endpoint verifies a signed CrewOS session and returns identity", async () => {
  process.env.SESSION_SECRET = "capture-auth-test-secret";
  const { sign } = require("../netlify/functions/_lib.js");
  const { handler } = require("../netlify/functions/auth.js");
  const token = sign({
    staffId: "staff-1",
    name: "Amaris",
    role: "Provider",
    divisions: ["Primary Care"],
    access: "Admin",
    exp: Date.now() + 60_000,
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { authorization: "Bearer " + token },
    body: JSON.stringify({ action: "session" }),
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.user.name, "Amaris");
  assert.equal(payload.user.role, "Provider");
});

test("the auth endpoint rejects an invalid CrewOS session", async () => {
  process.env.SESSION_SECRET = "capture-auth-test-secret";
  const { handler } = require("../netlify/functions/auth.js");
  const response = await handler({
    httpMethod: "POST",
    headers: { authorization: "Bearer invalid.token" },
    body: JSON.stringify({ action: "session" }),
  });
  assert.equal(response.statusCode, 401);
});

