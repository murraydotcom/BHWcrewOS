import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import registryHandler, {
  providerReviewRequestId,
  validateHealthCoreDraftReceipt,
} from "../netlify/functions/patient-registry.mjs";
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
    if (body.action === "content-assignments") return Response.json({ assignments: [{ id: "assignment-synthetic" }] });
    if (body.action === "save-patient") return Response.json({ patient: body.patient });
    if (body.action === "upload-verification-evidence") return Response.json({ evidence: { status: "verified", evidenceReference: "VE-synthetic" } });
    return Response.json({ consent: body.consent || { status: "current" }, eligible: true });
  }, storage);

  const patients = await client.listPatients();
  const assignments = await client.contentAssignments("BHW0000", 100);
  await client.savePatient({ bhwPatientId: "BHW9999", legalFirstName: "Synthetic", updatedAt: "2026-10-05T12:00:00.000Z" });
  await client.recordingConsent("BHW9999");
  await client.saveRecordingConsent("BHW9999", { status: "current" });
  await client.portalAccess("BHW9999");
  await client.savePortalAccess("BHW9999", { portalAccessStatus: "paused" });
  await client.uploadVerificationEvidence("BHW9999", {
    name: "patient-name-must-not-leave-browser.pdf",
    type: "application/pdf",
    arrayBuffer: async () => Uint8Array.from(Buffer.from("%PDF-1.7\nSynthetic\n%%EOF")).buffer,
  });
  assert.equal(patients[0].bhwPatientId, "BHW9999");
  assert.equal(assignments[0].id, "assignment-synthetic");
  assert.ok(calls.every((call) => call.url === "/.netlify/functions/patient-registry"));
  assert.ok(calls.every((call) => call.options.headers.Authorization === "Bearer synthetic-crew-token"));
  assert.deepEqual(calls[0].body, { action: "list" });
  assert.deepEqual(calls[1].body, { action: "content-assignments", bhwPatientId: "BHW0000", limit: 100 });
  assert.equal(calls[2].body.action, "save-patient");
  assert.equal(calls[2].body.expectedUpdatedAt, "2026-10-05T12:00:00.000Z");
  assert.deepEqual(calls[3].body, { action: "recording-consent", bhwPatientId: "BHW9999" });
  assert.deepEqual(calls[4].body, { action: "save-recording-consent", bhwPatientId: "BHW9999", consent: { status: "current" } });
  assert.deepEqual(calls[5].body, { action: "portal-access", bhwPatientId: "BHW9999" });
  assert.deepEqual(calls[6].body, { action: "save-portal-access", bhwPatientId: "BHW9999", access: { portalAccessStatus: "paused" } });
  assert.equal(calls[7].body.action, "upload-verification-evidence");
  assert.equal(calls[7].body.bhwPatientId, "BHW9999");
  assert.equal(calls[7].body.evidence.contentType, "application/pdf");
  assert.doesNotMatch(JSON.stringify(calls[7].body), /patient-name-must-not-leave-browser/);
});

test("Patient Registry proxy verifies CrewOS and calls Google Cloud server-side", async () => {
  const environment = new Map([
    ["SESSION_SECRET", "synthetic-session-secret"],
    ["CREWHQ_CLOUD_TOKEN_SECRET", "synthetic-cloud-secret"],
    ["RCM_CLOUD_API_URL", "https://rcm.example.test"],
    ["OPERATIONS_CLOUD_API_URL", "https://operations.example.test"],
    ["CREWOS_OPERATIONS_TOKEN_SECRET", "synthetic-operations-secret"],
    ["CREWHQ_CARE_TOKEN_SECRET", "synthetic-care-secret"],
    ["BHW_MEDICATION_API_URL", "https://care.example.test"],
    ["CONTEXT", "deploy-preview"],
  ]);
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  const outbound = [];
  globalThis.Netlify = { env: { get: (key) => environment.get(key) || "" } };
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options });
    if (url.includes("/v1/patient-portal-access/")) {
      return Response.json({
        ok: true,
        access: options.method === "PUT" ? JSON.parse(options.body) : null,
        invitationPreview: { deliveryStatus: "not-sent", message: "BHW Medical secure patient portal invitation." },
      });
    }
    if (url.endsWith("/v1/verification-evidence")) {
      return Response.json({ ok: true, evidence: { status: "verified", evidenceReference: "VE-00000000-0000-4000-8000-000000000001" } }, { status: 201 });
    }
    if (url.includes("/v1/staff/content-assignments")) return Response.json({ assignments: [] });
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
    assert.equal(result.patients[0].bhwPatientId, "BHW0000");
    assert.equal(result.patients[1].bhwPatientId, "BHW9999");
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
      body: JSON.stringify({
        action: "save-patient",
        expectedUpdatedAt: "2026-10-05T12:00:00.000Z",
        patient: {
          bhwPatientId: "BHW9999",
          legalFirstName: "Synthetic",
          nameSuffix: "III",
          medicareMbi: "1eg4-te5-mk73",
          coverageRecords: [{
            coverageOrder: "secondary",
            insuranceType: "original-medicare",
            payerName: "Medicare",
            memberId: "1EG4TE5MK73",
            coverageStatus: "verified",
            medicareSecondaryReason: "12",
            ignoredNested: "drop-me-too",
          }],
          ignored: "drop-me",
        },
      }),
    }));
    assert.equal(saveResponse.status, 200);
    assert.equal(outbound[1].url, "https://rcm.example.test/v1/patients/BHW9999");
    assert.equal(outbound[1].options.method, "PUT");
    const savedPatient = JSON.parse(outbound[1].options.body);
    assert.equal(savedPatient.bhwPatientId, "BHW9999");
    assert.equal(savedPatient.legalFirstName, "Synthetic");
    assert.equal(savedPatient.nameSuffix, "III");
    assert.equal(savedPatient.medicareMbi, "1EG4TE5MK73");
    assert.equal(savedPatient.coverageRecords[0].coverageOrder, "secondary");
    assert.equal(savedPatient.coverageRecords[0].insuranceType, "original-medicare");
    assert.equal(savedPatient.coverageRecords[0].medicareSecondaryReason, "12");
    assert.equal(savedPatient.coverageRecords[0].ignoredNested, undefined);
    assert.equal(savedPatient.ignored, undefined);
    assert.equal(savedPatient.expectedUpdatedAt, "2026-10-05T12:00:00.000Z");

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

    const accessResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "portal-access", bhwPatientId: "BHW9999" }),
    }));
    assert.equal(accessResponse.status, 200);
    assert.equal(outbound[3].url, "https://operations.example.test/v1/patient-portal-access/BHW9999");
    const accessClaims = JSON.parse(Buffer.from(outbound[3].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(accessClaims.aud, "bhw-operations-cloud");
    assert.equal(accessClaims.role, "admin");

    const updateResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-portal-access", bhwPatientId: "BHW9999", access: { portalAccessStatus: "paused", ignored: "server-validates" } }),
    }));
    assert.equal(updateResponse.status, 200);
    assert.equal(outbound[4].options.method, "PUT");
    assert.deepEqual(JSON.parse(outbound[4].options.body), { portalAccessStatus: "paused", ignored: "server-validates" });

    const uploadResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload-verification-evidence",
        bhwPatientId: "BHW9999",
        evidence: {
          purpose: "patient-portal-consent",
          contentType: "application/pdf",
          byteLength: 8,
          contentBase64: "JVBERi0xLjc=",
          filename: "must-be-dropped.pdf",
          ignored: "drop-me",
        },
      }),
    }));
    assert.equal(uploadResponse.status, 200);
    assert.equal(outbound[5].url, "https://operations.example.test/v1/verification-evidence");
    assert.equal(outbound[5].options.method, "POST");
    const forwardedEvidence = JSON.parse(outbound[5].options.body);
    assert.deepEqual(forwardedEvidence, {
      bhwPatientId: "BHW9999",
      purpose: "patient-portal-consent",
      contentType: "application/pdf",
      byteLength: 8,
      contentBase64: "JVBERi0xLjc=",
    });
    const proofClaims = JSON.parse(Buffer.from(outbound[5].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(proofClaims.aud, "bhw-operations-cloud");
    assert.equal(proofClaims.role, "admin");

    const assignmentsResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "content-assignments", bhwPatientId: "BHW0000", limit: 500 }),
    }));
    assert.equal(assignmentsResponse.status, 200);
    assert.equal(outbound[6].url, "https://care.example.test/v1/staff/content-assignments?patientId=BHW0000&limit=100");
    const careClaims = JSON.parse(Buffer.from(outbound[6].options.headers.Authorization.replace("Bearer ", "").split(".")[0], "base64url").toString("utf8"));
    assert.equal(careClaims.aud, "bhw-care-cloud");
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

test("BHW0000 stays preview-only and is never injected into the production registry", async () => {
  const environment = new Map([
    ["SESSION_SECRET", "synthetic-session-secret"],
    ["CREWHQ_CLOUD_TOKEN_SECRET", "synthetic-cloud-secret"],
    ["RCM_CLOUD_API_URL", "https://rcm.example.test"],
    ["CONTEXT", "production"],
  ]);
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.Netlify = { env: { get: (key) => environment.get(key) || "" } };
  globalThis.fetch = async () => {
    externalCalls += 1;
    return Response.json({ patients: [{ bhwPatientId: "BHW9999" }] });
  };
  try {
    const headers = { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" };
    const listResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "list" }),
    }));
    const listResult = await listResponse.json();
    assert.deepEqual(listResult.patients.map((patient) => patient.bhwPatientId), ["BHW9999"]);
    assert.equal(externalCalls, 1);

    const portalResponse = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "portal-access", bhwPatientId: "BHW0000" }),
    }));
    assert.equal(portalResponse.status, 400);
    assert.equal(externalCalls, 1);
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});

test("saved synthetic Health Core draft creates an idempotent PCP mention without copying note content", async () => {
  const receipt = validateHealthCoreDraftReceipt({
    handoffId: "handoff-synthetic-1",
    bhwPatientId: "BHW0000",
    noteId: "synthetic-note-1",
    revision: 1,
    contentHash: "b".repeat(64),
    savedAt: "2026-10-02T12:00:00.000Z",
  });
  const environment = new Map([
    ["SESSION_SECRET", "synthetic-session-secret"],
    ["CREWOS_OPERATIONS_TOKEN_SECRET", "synthetic-operations-secret"],
    ["OPERATIONS_CLOUD_API_URL", "https://operations.example.test"],
    ["SYNTHETIC_BILLING_TOOLKIT_PROVIDER_STAFF_ID", "synthetic-provider"],
    ["SYNTHETIC_BILLING_TOOLKIT_PROVIDER_NAME", "Synthetic Provider"],
  ]);
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  const outbound = [];
  globalThis.Netlify = { env: { get: (key) => environment.get(key) || "" } };
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === "GET") return Response.json({ error: "not found" }, { status: 404 });
    if (url.endsWith("/team-notes")) return Response.json({ ok: true, replayed: false });
    const body = JSON.parse(options.body);
    return Response.json({ ok: true, request: { ...body, id: body.id } }, { status: 201 });
  };
  try {
    const response = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "notify-billing-toolkit-provider", receipt }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.notification.providerStaffId, "synthetic-provider");
    assert.equal(result.notification.requestId, providerReviewRequestId(receipt));
    assert.equal(outbound[1].body.requestType, "clinical_review");
    assert.equal(outbound[1].body.notificationMode, "none");
    assert.equal(outbound[2].body.mentions[0].staffId, "synthetic-provider");
    assert.match(outbound[2].body.content, /no clinical content is copied/i);
    assert.doesNotMatch(JSON.stringify(outbound), /Synthetic monthly care-management documentation/);
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});

test("real-patient provider routing stays server-blocked even if a legacy-looking flag is present", async () => {
  const environment = new Map([
    ["SESSION_SECRET", "synthetic-session-secret"],
    ["BILLING_TOOLKIT_REAL_PATIENT_ENABLED", "true"],
  ]);
  const priorNetlify = globalThis.Netlify;
  const priorFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.Netlify = { env: { get: (key) => environment.get(key) || "" } };
  globalThis.fetch = async () => { externalCalls += 1; return Response.json({ ok: true }); };
  try {
    const response = await registryHandler(new Request("https://bhwcrewos.example/.netlify/functions/patient-registry", {
      method: "POST",
      headers: { Authorization: `Bearer ${signedCrewToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "notify-billing-toolkit-provider",
        receipt: {
          handoffId: "handoff-real-patient-1",
          bhwPatientId: "BHW0557",
          noteId: "real-note-1",
          revision: 1,
          contentHash: "c".repeat(64),
          savedAt: "2026-10-02T12:00:00.000Z",
        },
      }),
    }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /not activated/);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.Netlify = priorNetlify;
    globalThis.fetch = priorFetch;
  }
});
