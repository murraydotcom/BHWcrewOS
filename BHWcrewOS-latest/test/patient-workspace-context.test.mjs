import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createClinicalContextApp, clinicalContextEnabled } from "../cloud/operations-api/clinical-context-app.mjs";
import {
  consumePatientWorkspaceContext,
  createPatientWorkspaceContext,
  PATIENT_WORKSPACE_LAUNCH_TTL_SECONDS,
  PATIENT_WORKSPACE_SESSION_TTL_SECONDS,
  protectedPatientReference,
  validatePatientWorkspaceContext,
} from "../cloud/operations-api/clinical-context.mjs";
import {
  PATIENT_WORKSPACE_SESSION_KEY,
  readPatientWorkspaceContext,
  resolvePatientWorkspaceContext,
} from "../provider/patient-workspace-context.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "patient-workspace-context-secret-32-bytes-minimum";
const AUTH_SECRET = "operations-auth-secret";
const NOW = new Date("2026-09-11T16:00:00.000Z");
const ACTOR = { type: "staff", id: "staff:BHW-STAFF-1", staffId: "BHW-STAFF-1", name: "Synthetic Provider", role: "provider" };
const FIXED_TOKEN = "A".repeat(43);

function operationsBearer(actor = ACTOR) {
  const claims = {
    iss: "bhw-crewhq",
    aud: "bhw-operations-cloud",
    sub: actor.id,
    staffId: actor.staffId,
    name: actor.name,
    role: actor.role,
    iat: Math.floor(NOW.getTime() / 1000) - 10,
    exp: Math.floor(NOW.getTime() / 1000) + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

function browserState(href) {
  const locationLike = { href };
  const historyLike = {
    state: null,
    replaceState(_state, _title, next) {
      locationLike.href = new URL(next, locationLike.href).href;
    },
  };
  return { locationLike, historyLike };
}

test("patient workspace token is opaque, short-lived, treatment-bound, and stores only a protected audit reference", () => {
  const issued = createPatientWorkspaceContext({
    bhwPatientId: "BHW1234",
    destination: "clinical-map",
    treatmentPurposeAttestation: true,
  }, ACTOR, {
    now: NOW,
    token: FIXED_TOKEN,
    contextId: "CTX-TEST-1",
    secret: SECRET,
  });
  assert.equal(issued.token, FIXED_TOKEN);
  assert.equal(issued.token.includes("BHW1234"), false);
  assert.equal(issued.record.bhwPatientId, "BHW1234");
  assert.equal(issued.record.patientReference, protectedPatientReference("BHW1234", SECRET));
  assert.equal(issued.record.patientReference.includes("BHW1234"), false);
  assert.equal(issued.record.purposeOfUse, "treatment");
  assert.equal(issued.record.sourceApplication, "patient-registry");
  assert.equal(new Date(issued.record.expiresAt).getTime() - NOW.getTime(), PATIENT_WORKSPACE_LAUNCH_TTL_SECONDS * 1000);
  assert.deepEqual(issued.record.scopes, ["clinical-map.read", "body-system-atlas.read", "patient-operations.read"]);
});

test("redemption is bound to exact staff and destination and produces a 15-minute tab grant", () => {
  const { record } = createPatientWorkspaceContext({
    bhwPatientId: "BHW1234",
    destination: "body-system-atlas",
    treatmentPurposeAttestation: true,
  }, ACTOR, { now: NOW, token: FIXED_TOKEN, contextId: "CTX-TEST-2", secret: SECRET });
  assert.throws(() => validatePatientWorkspaceContext(record, { destination: "clinical-map" }, ACTOR, { now: NOW }), /not authorized/);
  assert.throws(() => validatePatientWorkspaceContext(record, { destination: "body-system-atlas" }, { ...ACTOR, staffId: "OTHER" }, { now: NOW }), /not authorized/);
  const { consumed, grant } = consumePatientWorkspaceContext(record, { destination: "body-system-atlas" }, ACTOR, { now: NOW });
  assert.equal(consumed.status, "consumed");
  assert.equal(grant.bhwPatientId, "BHW1234");
  assert.equal(new Date(grant.sessionExpiresAt).getTime() - NOW.getTime(), PATIENT_WORKSPACE_SESSION_TTL_SECONDS * 1000);
  assert.throws(() => consumePatientWorkspaceContext(consumed, { destination: "body-system-atlas" }, ACTOR, { now: NOW }), /already used/);
});

test("synthetic BHW0000 remains outside the real-patient token path", () => {
  assert.throws(() => createPatientWorkspaceContext({
    bhwPatientId: "BHW0000",
    destination: "clinical-map",
    treatmentPurposeAttestation: true,
  }, ACTOR, { now: NOW, token: FIXED_TOKEN, secret: SECRET }), /existing synthetic workspace/);
});

test("browser redemption removes token and patient ID from the URL and retains only a tab-scoped grant", async () => {
  const storage = memoryStorage();
  const browser = browserState(`https://crewhq.bhwmedical.org/provider/patient-360.html?context=${FIXED_TOKEN}`);
  const grant = await resolvePatientWorkspaceContext({
    destination: "clinical-map",
    ...browser,
    storage,
    now: NOW.getTime(),
    redeem: async (token, destination) => ({
      schemaVersion: 1,
      contextId: "CTX-TEST-3",
      bhwPatientId: "BHW1234",
      patientReference: "reference",
      sourceApplication: "patient-registry",
      destination,
      purposeOfUse: "treatment",
      scopes: ["clinical-map.read", "body-system-atlas.read", "patient-operations.read"],
      authorizedStaffId: "BHW-STAFF-1",
      authorizedRole: "provider",
      consumedAt: NOW.toISOString(),
      sessionExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1000).toISOString(),
      suppliedToken: token,
    }),
  });
  assert.equal(grant.bhwPatientId, "BHW1234");
  assert.equal(new URL(browser.locationLike.href).search, "");
  assert.equal(storage.values.has(PATIENT_WORKSPACE_SESSION_KEY), true);
  assert.equal(readPatientWorkspaceContext(storage, "body-system-atlas", NOW.getTime()).bhwPatientId, "BHW1234");
});

test("a visible real patient ID never authorizes a Clinical Map page", async () => {
  const storage = memoryStorage();
  const browser = browserState("https://crewhq.bhwmedical.org/provider/patient-360.html?patient=BHW1234");
  await assert.rejects(() => resolvePatientWorkspaceContext({
    destination: "clinical-map",
    ...browser,
    storage,
    now: NOW.getTime(),
    redeem: async () => { throw new Error("must not redeem"); },
  }), /must be opened from Patient Registry/);
  assert.equal(new URL(browser.locationLike.href).search, "");
});

test("API status is visible while issuance and redemption stay behind the explicit activation gate", async () => {
  const repository = {
    async issuePatientWorkspaceContext(input) { return { contextId: "CTX", token: FIXED_TOKEN, destination: input.destination, launchPath: "/provider/patient-360.html" }; },
    async redeemPatientWorkspaceContext() { return { contextId: "CTX", bhwPatientId: "BHW1234" }; },
  };
  const disabledEnvironment = { CREWOS_OPERATIONS_TOKEN_SECRET: AUTH_SECRET };
  const disabled = createClinicalContextApp({ baseApp: async () => new Response("base"), repository, environment: disabledEnvironment, now: () => NOW });
  const statusResponse = await disabled(new Request("https://api.example/v1/clinical-contexts/status", { headers: { Authorization: operationsBearer() } }));
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).enabled, false);
  const blocked = await disabled(new Request("https://api.example/v1/clinical-contexts", {
    method: "POST",
    headers: { Authorization: operationsBearer(), "Content-Type": "application/json" },
    body: JSON.stringify({ bhwPatientId: "BHW1234", destination: "clinical-map", treatmentPurposeAttestation: true }),
  }));
  assert.equal(blocked.status, 503);

  const enabledEnvironment = {
    CREWOS_OPERATIONS_TOKEN_SECRET: AUTH_SECRET,
    PATIENT_WORKSPACE_CONTEXT_ENABLED: "true",
    PATIENT_WORKSPACE_CONTEXT_SECRET: SECRET,
  };
  assert.equal(clinicalContextEnabled(enabledEnvironment), true);
  const enabled = createClinicalContextApp({ baseApp: async () => new Response("base"), repository, environment: enabledEnvironment, now: () => NOW });
  const created = await enabled(new Request("https://api.example/v1/clinical-contexts", {
    method: "POST",
    headers: { Authorization: operationsBearer(), "Content-Type": "application/json" },
    body: JSON.stringify({ bhwPatientId: "BHW1234", destination: "clinical-map", treatmentPurposeAttestation: true }),
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).context.token, FIXED_TOKEN);
});

test("Patient Registry, Clinical Map, Atlas, and Patient Operations expose the governed handoff", () => {
  const provider = path.join(root, "provider");
  const registry = fs.readFileSync(path.join(provider, "patient-registry.html"), "utf8");
  const launcher = fs.readFileSync(path.join(provider, "patient-workspace-launcher.mjs"), "utf8");
  const entry = fs.readFileSync(path.join(provider, "clinical-map-entry.mjs"), "utf8");
  const contextResolver = fs.readFileSync(path.join(provider, "patient-workspace-context.mjs"), "utf8");
  const worklist = fs.readFileSync(path.join(provider, "patient-operations.html"), "utf8");
  const repository = fs.readFileSync(path.join(root, "cloud/operations-api/clinical-context-repository.mjs"), "utf8");
  assert.match(registry, /patient-workspace-launcher\.mjs/);
  assert.match(launcher, /Open Whole-Person Clinical Map/);
  assert.match(launcher, /Open Body-System Atlas/);
  assert.match(launcher, /Open Patient Operations/);
  assert.match(launcher, /Open Health Core Chart Summary/);
  assert.match(launcher, /Cross-domain real-patient launch remains locked/);
  assert.match(contextResolver, /visible patient ID cannot authorize access/i);
  assert.match(entry, /temporaryPatientQuery/);
  assert.match(worklist, /Patient Worklist/);
  assert.match(worklist, /does not independently create diagnoses/);
  assert.match(repository, /runTransaction/);
  assert.match(repository, /only an active Patient Registry record/);

  const clinicalMapPages = fs.readdirSync(provider).filter((name) => /^patient-360(?:-[a-z]+)?\.html$/.test(name));
  assert.equal(clinicalMapPages.length, 8);
  for (const page of clinicalMapPages) {
    const html = fs.readFileSync(path.join(provider, page), "utf8");
    assert.match(html, /clinical-map-entry\.mjs/);
    assert.doesNotMatch(html, /src="patient-360-app\.mjs"/);
    assert.match(html, /patient-operations\.html/);
  }
});
