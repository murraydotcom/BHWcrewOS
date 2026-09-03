import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOperationsCloudClient } from "../provider/operations-queue.mjs";

test("Patient Requests is the command center and Google Chat is only a mirror", async () => {
  const html = await readFile(new URL("../bhw-requests.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

  assert.match(html, /One Google-backed queue/);
  assert.match(html, /Google Chat mirrors alerts and quick actions/);
  assert.match(html, /bhw-staff-guide\.html#patient-requests-training/);
  assert.match(html, /Patient request work queue/);
  assert.match(script, /listPatientRequests/);
  assert.match(script, /listPatientRequestCommunications/);
  assert.match(script, /patientRequestAction/);
  assert.match(script, /pa_submitted/);
  assert.match(script, /referral_sent/);
  assert.match(script, /closed_without_scheduling/);
  assert.match(script, /noPhiAttestation:true/);
  assert.doesNotMatch(script, /chat\.googleapis\.com|GOOGLE_CHAT_DEFAULT_SPACE/);
  assert.doesNotThrow(() => new Function(script));
});

test("Patient Requests uses the dedicated Operations token exchange and one Google queue", async () => {
  const priorStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem(key) { return key === "crewos_token" ? "synthetic-crew-session" : null; },
    removeItem() {},
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === "/.netlify/functions/operations-cloud-config") {
      return new Response(JSON.stringify({ enabled: true, apiBase: "https://api.example" }), { status: 200 });
    }
    if (url === "/.netlify/functions/operations-cloud-token") {
      assert.equal(options.headers.Authorization, "Bearer synthetic-crew-session");
      return new Response(JSON.stringify({ token: "synthetic-cloud-token", expiresIn: 300 }), { status: 200 });
    }
    assert.equal(options.headers.Authorization, "Bearer synthetic-cloud-token");
    if (String(url).includes("/v1/patient-requests?") && options.method !== "POST") {
      return new Response(JSON.stringify({ requests: [{ id: "synthetic-request-1", status: "received" }] }), { status: 200 });
    }
    if (String(url).endsWith("/actions")) {
      const body = JSON.parse(options.body);
      assert.equal(body.action, "start");
      assert.ok(body.idempotencyKey);
      return new Response(JSON.stringify({ ok: true, request: { id: "synthetic-request-1", status: "in_progress" } }), { status: 200 });
    }
    if (String(url).endsWith("/messages")) {
      const body = JSON.parse(options.body);
      assert.equal(body.noPhiAttestation, true);
      assert.equal("to" in body, false, "phone number stays server-side");
      return new Response(JSON.stringify({ ok: true, status: "sent", communicationId: "synthetic-comm-1" }), { status: 202 });
    }
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  };

  try {
    const client = await createOperationsCloudClient(fetchImpl);
    const requests = await client.listPatientRequests({ status: "open", serviceLine: "clinical", assignedTeam: "clinical", bhwPatientId: "BHW0000" });
    assert.equal(requests[0].id, "synthetic-request-1");
    const listUrl = String(calls.find((call) => call.url.includes("/v1/patient-requests?")).url);
    assert.match(listUrl, /serviceLine=clinical/);
    assert.match(listUrl, /assignedTeam=clinical/);
    assert.match(listUrl, /bhwPatientId=BHW0000/);
    const started = await client.patientRequestAction("synthetic-request-1", "start", { idempotencyKey: "synthetic-start" });
    assert.equal(started.request.status, "in_progress");
    const sent = await client.sendPatientRequestSms("synthetic-request-1", "Please open your secure BHW page.", {
      noPhiAttestation: true,
      idempotencyKey: "synthetic-message",
    });
    assert.equal(sent.status, "sent");
    assert.equal(calls.filter((call) => call.url === "/.netlify/functions/operations-cloud-token").length, 1, "short-lived token is reused");
  } finally {
    globalThis.sessionStorage = priorStorage;
  }
});
