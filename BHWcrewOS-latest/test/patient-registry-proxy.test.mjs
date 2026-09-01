import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import registryHandler from "../netlify/functions/patient-registry.mjs";
import { createPatientRegistryClient } from "../provider/patient-registry-client.mjs";

function signedCrewToken(secret = "synthetic-session-secret") {
  const payload = Buffer.from(JSON.stringify({
    staffId: "synthetic-staff",
    name: "Synthetic Staff",
    access: "Admin",
    exp: Date.now() + 60_000,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test("Patient Registry browser client stays on the signed-in CrewOS origin", async () => {
  const calls = [];
  const storage = {
    getItem: (key) => key === "crewos_token" ? "synthetic-crew-token" : "",
    removeItem: () => {},
  };
  const client = await createPatientRegistryClient(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    if (body.action === "list") return Response.json({ patients: [{ bhwPatientId: "BHW9999" }] });
    if (body.action === "save-patient") return Response.json({ patient: body.patient });
    return Response.json({ consent: body.consent || { status: "current" }, eligible: true });
  }, storage);

  const patients = await client.listPatients();
  await client.savePatient({ bhwPatientId: "BHW9999", legalFirstName: "Synthetic" });
  await client.recordingConsent("BHW9999");
  await client.saveRecordingConsent("BHW9999", { status: "current" });
  assert.equal(patients[0].bhwPatientId, "BHW9999");
  assert.ok(calls.every((call) => call.url === "/.netlify/functions/patient-registry"));
  assert.ok(calls.every((call) => call.options.headers.Authorization === "Bearer synthetic-crew-token"));
  assert.deepEqual(calls[0].body, { action: "list" });
  assert.equal(calls[1].body.action, "save-patient");
  assert.deepEqual(calls[2].body, { action: "recording-consent", bhwPatientId: "BHW9999" });
  assert.deepEqual(calls[3].body, { action: "save-recording-consent", bhwPatientId: "BHW9999", consent: { status: "current" } });
});

test("Patient Registry proxy verifies CrewOS and calls Google Cloud server-side", async () => {
  const environment = new Map([
    ["SESSION_SECRET", "synthetic-session-secret"],
    ["CREWHQ_CLOUD_TOKEN_SECRET", "synthetic-cloud-secret"],
    ["RCM_CLOUD_API_URL", "https://rcm.example.test"],
  ]);
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  const outbound = [];
  globalThis.Netlify = { env: { get: (key) => environment.get(key) || "" } };
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options });
    if (url.endsWith("/recording-consent")) return Response.json({ consent: { status: "current" }, eligible: true });
    if (options.method === "PUT") return Response.json({ patient: JSON.parse(options.body) });
    return Response.json({ patients: [{ bhwPatientId: "BHW9999" }] });
  };

  try {
    const request = new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signedCrewToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "list" }),
    });
    const response = await registryHandler(request);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.patients[0].bhwPatientId, "BHW9999");
    assert.equal(outbound[0].url, "https://rcm.example.test/v1/patients");
    const cloudClaims = JSON.parse(Buffer.from(outbound[0].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(cloudClaims.aud, "bhw-rcm-cloud");
    assert.equal(cloudClaims.staffId, "synthetic-staff");

    const saveResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signedCrewToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "save-patient", patient: { bhwPatientId: "BHW9999", legalFirstName: "Synthetic", ignored: "drop-me" } }),
    }));
    assert.equal(saveResponse.status, 200);
    assert.equal(outbound[1].url, "https://rcm.example.test/v1/patients/BHW9999");
    assert.equal(outbound[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(outbound[1].options.body), { bhwPatientId: "BHW9999", legalFirstName: "Synthetic" });

    const consentResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signedCrewToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "recording-consent", bhwPatientId: "BHW9999" }),
    }));
    assert.equal(consentResponse.status, 200);
    assert.equal(outbound[2].url, "https://rcm.example.test/v1/patients/BHW9999/recording-consent");
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});

test("Patient Registry proxy rejects unauthenticated and unknown requests", async () => {
  const priorNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (key) => key === "SESSION_SECRET" ? "synthetic-session-secret" : "" } };
  try {
    const unauthenticated = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    }));
    assert.equal(unauthenticated.status, 401);

    const unknown = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signedCrewToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "anything-else" }),
    }));
    assert.equal(unknown.status, 400);
  } finally {
    globalThis.Netlify = priorNetlify;
  }
});
