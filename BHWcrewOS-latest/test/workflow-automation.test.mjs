import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPatientRequestAction,
  buildGoogleChatCard,
  defaultNotificationRules,
  normalizeStaffRole,
  quietHoursState,
  resolveNotificationRule,
  sanitizeManualSms,
  sanitizePatientRequest,
} from "../cloud/operations-api/workflow-automation.mjs";
import { createWorkflowService } from "../cloud/operations-api/workflow-service.mjs";

const USER = { sub: "crew:synthetic-ops", name: "Synthetic Operator", role: "operations-manager" };
const NOON = new Date("2026-08-26T16:00:00.000Z");

test("active CrewOS roster titles normalize to least-privilege workflow roles", () => {
  const expected = new Map([
    ["BH Assistant", "ma-bha"],
    ["BH Coordinator", "care-manager"],
    ["Medical Assistant", "ma-bha"],
    ["CRNP/FNP", "provider"],
    ["Porter House Admin", "front-desk"],
    ["Office Manager", "operations-manager"],
    ["CRNP", "provider"],
    ["Chronic Care Manager", "care-manager"],
  ]);

  for (const [rosterTitle, workflowRole] of expected) {
    assert.equal(normalizeStaffRole(rosterTitle), workflowRole, rosterTitle);
  }
});

function syntheticRequest(requestType, id = `synthetic-${requestType.replaceAll("_", "-")}`) {
  return sanitizePatientRequest({
    id: id.padEnd(12, "0"),
    bhwPatientId: "BHW0000",
    requestType,
    source: "synthetic-test",
    summary: "De-identified workflow exercise",
  }, { user: USER, now: NOON });
}

function act(request, action, details = {}, minute = 1) {
  return applyPatientRequestAction(request, {
    action,
    idempotencyKey: `${request.id}:${action}:${minute}`,
    ...details,
  }, { user: USER, now: new Date(NOON.getTime() + minute * 60_000) }).request;
}

test("workflow milestones distinguish sent/scheduled states from completed outcomes", () => {
  let refill = act(syntheticRequest("refill"), "start");
  refill = act(refill, "milestone", { status: "waiting_on_pharmacy" }, 2);
  refill = act(refill, "resolve", {}, 3);
  assert.equal(refill.status, "refill_completed");
  assert.equal(refill.statusCategory, "completed");

  let referral = act(syntheticRequest("referral"), "start");
  referral = act(referral, "milestone", { status: "referral_sent" }, 2);
  assert.equal(referral.statusCategory, "waiting");
  assert.throws(() => act(referral, "resolve", {}, 3), /specific outcome/);
  referral = act(referral, "milestone", { status: "scheduled" }, 4);
  assert.equal(referral.status, "scheduled");
  assert.equal(referral.statusCategory, "waiting");
  referral = act(referral, "resolve", { outcome: "referral_completed" }, 5);
  assert.equal(referral.status, "referral_completed");
  assert.equal(referral.statusCategory, "completed");

  let priorAuth = act(syntheticRequest("prior_auth"), "start");
  priorAuth = act(priorAuth, "milestone", { status: "pa_submitted" }, 2);
  assert.equal(priorAuth.statusLabel, "Submitted — awaiting decision");
  assert.equal(priorAuth.statusCategory, "waiting");
  const submittedRule = resolveNotificationRule(priorAuth);
  assert.match(submittedRule.template, /not yet approved or denied/i);
  assert.throws(() => act(priorAuth, "resolve", {}, 3), /specific outcome/);
  priorAuth = act(priorAuth, "resolve", { outcome: "pa_approved" }, 4);
  assert.equal(priorAuth.status, "pa_approved");

  let billing = act(syntheticRequest("billing_rcm"), "start");
  billing = act(billing, "milestone", { status: "waiting_on_payer" }, 2);
  billing = act(billing, "resolve", {}, 3);
  assert.equal(billing.status, "billing_resolved");

  let general = act(syntheticRequest("general"), "start");
  general = act(general, "milestone", { status: "waiting" }, 2);
  general = act(general, "resolve", {}, 3);
  assert.equal(general.status, "completed");
});

test("notification rules cover receipt, progress, waiting and terminal states without patient details", () => {
  const rules = defaultNotificationRules();
  for (const requestType of ["refill", "referral", "prior_auth", "billing_rcm", "general"]) {
    const categories = new Set(rules.filter((rule) => rule.requestType === requestType).map((rule) => rule.statusCategory));
    assert.ok(categories.has("received"), `${requestType} received rule`);
    assert.ok(categories.has("in_progress"), `${requestType} progress rule`);
    assert.ok(categories.has("waiting"), `${requestType} waiting rule`);
    assert.ok(categories.has("completed"), `${requestType} completed rule`);
  }
  assert.ok(rules.every((rule) => !/BHW0000|Synthetic Patient|1980-01-01/.test(rule.template)));
});

test("Chat cards route by service line but contain no patient identity or summary", () => {
  const request = syntheticRequest("prior_auth");
  const card = JSON.stringify(buildGoogleChatCard(request, { crewOsUrl: "https://crewhq.bhwmedical.org/bhw-requests.html" }));
  assert.match(card, /authorizations/);
  assert.match(card, /PA submitted/);
  assert.doesNotMatch(card, /BHW0000|De-identified workflow exercise/);
});

test("Chat milestone actions pass the card status into the shared workflow", async () => {
  const repository = inMemoryRepository();
  const request = syntheticRequest("prior_auth", "synthetic-chat-pa");
  repository.requests.set(request.id, structuredClone(request));
  const chat = {
    enabled: true,
    async verifyInteraction() {},
    actor() { return { ...USER, source: "google-chat" }; },
    responseCard(updated) { return { requestStatus: updated.status, actionResponse: { type: "UPDATE_MESSAGE" } }; },
  };
  const service = createWorkflowService(repository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "false" },
    dialpad: { configured: false },
    chat,
    clock: () => NOON,
  });
  const response = await service.handleChatEvent(new Request("https://api.example/v1/chat/events", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic-google-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "CARD_CLICKED",
      eventId: "synthetic-chat-event",
      common: { parameters: {
        requestId: "",
        requestVersion: { stringValue: "" },
        workflowAction: [],
      } },
      action: { parameters: [
        { key: "requestId", value: request.id },
        { key: "requestVersion", value: "1" },
        { key: "workflowAction", value: "milestone" },
        { key: "status", value: "pa_submitted" },
      ] },
    }),
  }));
  assert.equal(response.requestStatus, "pa_submitted");
  assert.equal(repository.requests.get(request.id).statusCategory, "waiting");
});

test("Chat card actions without eventId remain distinct on the same message and retry idempotently", async () => {
  const repository = inMemoryRepository();
  const request = syntheticRequest("general", "synthetic-chat-real-payload");
  repository.requests.set(request.id, structuredClone(request));
  const chat = {
    enabled: true,
    async verifyInteraction() {},
    actor() { return { ...USER, source: "google-chat" }; },
    responseCard(updated, text) {
      return {
        requestStatus: updated.status,
        requestVersion: updated.version,
        responseText: text,
        actionResponse: { type: "UPDATE_MESSAGE" },
      };
    },
  };
  const service = createWorkflowService(repository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "false" },
    dialpad: { configured: false },
    chat,
    clock: () => NOON,
  });
  const cardClick = ({ workflowAction, requestVersion, eventTime }) => new Request("https://api.example/v1/chat/events", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic-google-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "CARD_CLICKED",
      eventTime,
      message: { name: "spaces/SYNTHETIC/messages/shared-card" },
      common: { parameters: {
        requestId: request.id,
        requestVersion: String(requestVersion),
        workflowAction,
      } },
    }),
  });

  const assigned = await service.handleChatEvent(cardClick({
    workflowAction: "assign",
    requestVersion: 1,
    eventTime: "2026-08-26T16:01:00.000Z",
  }));
  assert.equal(assigned.requestVersion, 2);

  const started = await service.handleChatEvent(cardClick({
    workflowAction: "start",
    requestVersion: 2,
    eventTime: "2026-08-26T16:02:00.000Z",
  }));
  assert.equal(started.requestStatus, "in_progress");
  assert.equal(started.requestVersion, 3);
  assert.equal(repository.requests.get(request.id).processedActionKeys.length, 2);

  const retried = await service.handleChatEvent(cardClick({
    workflowAction: "start",
    requestVersion: 2,
    eventTime: "2026-08-26T16:02:00.000Z",
  }));
  assert.equal(retried.responseText, "This action was already applied.");
  assert.equal(retried.requestVersion, 3);
  assert.equal(repository.requests.get(request.id).processedActionKeys.length, 2);
});

test("manual SMS and quiet hours fail safely", () => {
  assert.throws(() => sanitizeManualSms("Please review your update"), /confirm/);
  assert.throws(() => sanitizeManualSms("DOB: 1980-01-01", { noPhiAttestation: true }), /protected identifiers/);
  assert.equal(sanitizeManualSms("Please open your secure BHW page.", { noPhiAttestation: true }), "Please open your secure BHW page.");
  const quiet = quietHoursState(new Date("2026-08-27T02:00:00.000Z"), { timeZone: "America/New_York", start: "20:00", end: "08:00" });
  assert.equal(quiet.quiet, true);
  assert.ok(quiet.sendAfter > "2026-08-27T02:00:00.000Z");
});

function inMemoryRepository() {
  const requests = new Map();
  const communications = new Map();
  const rules = new Map();
  const audit = [];
  let suppression = { active: false };
  return {
    requests,
    communications,
    audit,
    async patientExists() { return true; },
    async createPatientRequest(request) { requests.set(request.id, structuredClone(request)); return structuredClone(request); },
    async getPatientRequest(id) { return requests.has(id) ? structuredClone(requests.get(id)) : null; },
    async commitPatientRequestAction({ previousVersion, request, actionHash }) {
      const current = requests.get(request.id);
      if ((current.processedActionKeys || []).includes(actionHash)) return { request: structuredClone(current), duplicate: true };
      assert.equal(current.version, previousVersion);
      requests.set(request.id, structuredClone(request));
      return { request: structuredClone(request), duplicate: false };
    },
    async attachChatDelivery(id, delivery) {
      const request = requests.get(id);
      request.chatMessageName = delivery.messageName;
      request.chatSpace = delivery.space;
      return structuredClone(request);
    },
    async getPatientMessagingContext() {
      return {
        patient: { bhwPatientId: "BHW0000", patientStatus: "active" },
        contact: { active: true, phoneE164: "+15555550100" },
        smsConsent: {
          bhwPatientId: "BHW0000",
          channel: "sms",
          status: "current",
          verifiedAt: "2026-08-01T12:00:00.000Z",
          evidenceReference: "synthetic-consent",
        },
        smsSuppression: suppression,
      };
    },
    async reserveCommunication(communication) {
      if (communications.has(communication.id)) return { created: false, communication: structuredClone(communications.get(communication.id)) };
      communications.set(communication.id, structuredClone(communication));
      return { created: true, communication: structuredClone(communication) };
    },
    async updateCommunication(id, patch) {
      const next = { ...communications.get(id), ...structuredClone(patch) };
      communications.set(id, next);
      return structuredClone(next);
    },
    async getNotificationRule(id) { return rules.get(id) || null; },
    async getLatestOutboundCommunication(requestId, channel) {
      return [...communications.values()].filter((item) => item.requestId === requestId && item.channel === channel && ["sent", "delivered"].includes(item.status))
        .sort((left, right) => String(right.sentAt || right.createdAt).localeCompare(String(left.sentAt || left.createdAt)))[0] || null;
    },
    async recordWorkflowAudit(event) { audit.push(structuredClone(event)); },
    async listDueCommunications(now, limit) {
      return [...communications.values()].filter((item) => item.status === "queued" && item.sendAfter <= now).slice(0, limit).map((item) => structuredClone(item));
    },
    async claimCommunication(id) {
      const item = communications.get(id);
      if (!item || item.status !== "queued") return { claimed: false };
      item.status = "pending";
      return { claimed: true, communication: structuredClone(item) };
    },
    async setSmsSuppression(_id, next) { suppression = { ...next }; },
    async listPatientRequests() { return [...requests.values()].map((item) => structuredClone(item)); },
    async listRequestCommunications(id) { return [...communications.values()].filter((item) => item.requestId === id).map((item) => structuredClone(item)); },
    async listNotificationRules() { return [...rules.values()].map((item) => structuredClone(item)); },
    async saveNotificationRule(rule) { rules.set(rule.id, structuredClone(rule)); },
  };
}

test("synthetic end-to-end transitions send through one idempotent Dialpad path for all five request types", async () => {
  const repository = inMemoryRepository();
  const sent = [];
  let currentTime = new Date(NOON);
  const dialpad = {
    configured: true,
    async sendSms(message) {
      sent.push(structuredClone(message));
      return { provider: "dialpad", providerMessageId: `synthetic-${sent.length}`, providerStatus: "accepted" };
    },
  };
  const chat = {
    enabled: true,
    async sendRequestCard(request) { return { provider: "google-chat", space: "spaces/SYNTHETIC", messageName: `spaces/SYNTHETIC/messages/${request.id}`, providerMessageId: request.id, providerStatus: "sent" }; },
    async updateRequestCard(request, messageName) { return { provider: "google-chat", space: "spaces/SYNTHETIC", messageName, providerMessageId: messageName, providerStatus: "updated" }; },
  };
  const service = createWorkflowService(repository, {
    environment: {
      PATIENT_WORKFLOW_AUTOMATION_ENABLED: "true",
      PATIENT_PORTAL_URL: "https://health.bhwmedical.org/",
      SMS_TIME_ZONE: "America/New_York",
      SMS_QUIET_HOURS_START: "20:00",
      SMS_QUIET_HOURS_END: "08:00",
    },
    dialpad,
    chat,
    clock: () => new Date(currentTime),
    logger: { error() {}, log() {} },
  });

  const scenarios = [
    ["refill", [{ action: "start" }, { action: "milestone", status: "waiting_on_pharmacy" }, { action: "resolve" }]],
    ["referral", [{ action: "start" }, { action: "milestone", status: "referral_sent" }, { action: "milestone", status: "scheduled" }, { action: "resolve", outcome: "referral_completed" }]],
    ["prior_auth", [{ action: "start" }, { action: "milestone", status: "pa_submitted" }, { action: "resolve", outcome: "pa_approved" }]],
    ["billing_rcm", [{ action: "start" }, { action: "milestone", status: "waiting_on_payer" }, { action: "resolve" }]],
    ["general", [{ action: "start" }, { action: "milestone", status: "waiting" }, { action: "resolve" }]],
  ];
  for (const [index, [requestType, actions]] of scenarios.entries()) {
    const id = `synthetic-e2e-${index}-${requestType.replaceAll("_", "-")}`;
    await service.createRequest({ id, bhwPatientId: "BHW0000", requestType, source: "synthetic-test", summary: "De-identified request" }, USER);
    for (const [actionIndex, details] of actions.entries()) {
      currentTime = new Date(currentTime.getTime() + 10 * 60_000);
      await service.action(id, { ...details, idempotencyKey: `${id}:${actionIndex}` }, USER);
    }
  }

  assert.equal(repository.requests.size, 5);
  assert.equal([...repository.requests.values()].filter((request) => request.statusCategory === "completed").length, 5);
  assert.ok(sent.length >= 15, "received, waiting and terminal messages were sent");
  assert.ok(sent.every((item) => !/BHW0000|De-identified request/.test(item.text)));
  const paSubmitted = sent.find((item) => /not yet approved or denied/i.test(item.text));
  assert.ok(paSubmitted, "PA submission used the non-approval template");
  const referralSent = sent.find((item) => /does not mean an appointment is scheduled/i.test(item.text));
  assert.ok(referralSent, "referral sent used the non-scheduled template");

  const beforeDuplicate = sent.length;
  const general = [...repository.requests.values()].find((request) => request.requestType === "general");
  await service.action(general.id, { action: "reopen", idempotencyKey: "duplicate-reopen" }, USER);
  await service.action(general.id, { action: "reopen", idempotencyKey: "duplicate-reopen" }, USER);
  assert.equal(sent.length, beforeDuplicate, "disabled in-progress rule and duplicate action caused no extra SMS");
});

test("missing messaging configuration and opt-out both suppress rather than send", async () => {
  const repository = inMemoryRepository();
  const service = createWorkflowService(repository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "true" },
    dialpad: { configured: false },
    chat: { enabled: false },
    clock: () => NOON,
  });
  const result = await service.createRequest({ id: "synthetic-gated-001", bhwPatientId: "BHW0000", requestType: "general", source: "synthetic-test" }, USER);
  assert.equal(result.notification.status, "suppressed");
  assert.equal(result.notification.reason, "messaging-not-configured");
  assert.equal([...repository.communications.values()].some((item) => item.statusReason === "messaging-not-configured"), true);

  const optedOutRepository = inMemoryRepository();
  await optedOutRepository.setSmsSuppression("BHW0000", { active: true, source: "synthetic-stop" });
  let sendCount = 0;
  const optedOutService = createWorkflowService(optedOutRepository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "true" },
    dialpad: { configured: true, async sendSms() { sendCount += 1; return {}; } },
    chat: { enabled: false },
    clock: () => NOON,
  });
  const optedOut = await optedOutService.createRequest({ id: "synthetic-optout-001", bhwPatientId: "BHW0000", requestType: "general", source: "synthetic-test" }, USER);
  assert.equal(optedOut.notification.reason, "sms-opted-out");
  assert.equal(sendCount, 0);
});

test("queued-message dispatcher accepts only the configured Google Scheduler identity", async () => {
  const repository = inMemoryRepository();
  const verified = [];
  const service = createWorkflowService(repository, {
    environment: {
      WORKFLOW_DISPATCH_AUDIENCE: "https://bhw-operations-api.example/v1/workflow/dispatch",
      WORKFLOW_DISPATCH_SERVICE_ACCOUNT: "bhw-workflow-dispatcher@example.iam.gserviceaccount.com",
    },
    dialpad: { configured: false },
    chat: { enabled: false },
    verifyOidcToken: async (token, audience) => {
      verified.push({ token, audience });
      return {
        email: token === "synthetic-valid-oidc" ? "bhw-workflow-dispatcher@example.iam.gserviceaccount.com" : "other@example.iam.gserviceaccount.com",
        email_verified: true,
      };
    },
  });

  await assert.rejects(() => service.dispatchDue("Bearer synthetic-wrong-oidc"), (error) => error.status === 401);
  assert.deepEqual(await service.dispatchDue("Bearer synthetic-valid-oidc"), { processed: 0, results: [] });
  assert.deepEqual(verified.at(-1), {
    token: "synthetic-valid-oidc",
    audience: "https://bhw-operations-api.example/v1/workflow/dispatch",
  });
});

test("queued-message dispatcher does not inspect or deliver queued SMS while automation is disabled", async () => {
  const repository = inMemoryRepository();
  let listCount = 0;
  let sendCount = 0;
  repository.listDueCommunications = async () => {
    listCount += 1;
    return [{ id: "synthetic-queued-001", requestId: "synthetic-request-001" }];
  };
  const service = createWorkflowService(repository, {
    environment: {
      PATIENT_WORKFLOW_AUTOMATION_ENABLED: "false",
      WORKFLOW_DISPATCH_SECRET: "synthetic-dispatch-secret",
    },
    dialpad: {
      configured: true,
      async sendSms() { sendCount += 1; return { id: "synthetic-provider-message" }; },
    },
    chat: { enabled: false },
  });

  assert.deepEqual(await service.dispatchDue("Bearer synthetic-dispatch-secret"), { processed: 0, results: [] });
  assert.equal(listCount, 0);
  assert.equal(sendCount, 0);
});

test("queued-message dispatcher keeps legacy secret support without plain string comparison", async () => {
  const service = createWorkflowService(inMemoryRepository(), {
    environment: { WORKFLOW_DISPATCH_SECRET: "synthetic-dispatch-secret" },
    dialpad: { configured: false },
    chat: { enabled: false },
  });
  await assert.rejects(() => service.dispatchDue("Bearer wrong"), (error) => error.status === 401);
  assert.deepEqual(await service.dispatchDue("Bearer synthetic-dispatch-secret"), { processed: 0, results: [] });
});

test("an unmatched STOP suppresses the phone destination and is still logged", async () => {
  const repository = inMemoryRepository();
  let phoneSuppression = null;
  repository.findPatientsByPhone = async () => [];
  repository.getCommunication = async (id) => repository.communications.get(id) || null;
  repository.setPhoneSmsSuppression = async (phone, suppression) => { phoneSuppression = { phone, ...suppression }; };
  const service = createWorkflowService(repository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "true" },
    dialpad: {
      configured: true,
      webhookConfigured: true,
      verifyWebhook(raw) { return JSON.parse(raw); },
    },
    chat: { enabled: false },
    clock: () => NOON,
  });
  const result = await service.handleDialpadWebhook(JSON.stringify({
    id: "synthetic-stop-event",
    direction: "inbound",
    from_number: "+15555550199",
    text: "STOP",
  }));
  assert.equal(result.optedOut, true);
  assert.equal(result.reason, "opt-out-unmatched");
  assert.equal(phoneSuppression.active, true);
  assert.equal([...repository.communications.values()].some((item) => item.statusReason === "opt-out-unmatched"), true);
});

test("a matched START restores consent without creating a patient request", async () => {
  const repository = inMemoryRepository();
  let patientSuppression = null;
  repository.findPatientsByPhone = async () => [{ bhwPatientId: "BHW0000", patientStatus: "active" }];
  repository.getCommunication = async (id) => repository.communications.get(id) || null;
  repository.setPhoneSmsSuppression = async () => {};
  repository.setSmsSuppression = async (_patientId, suppression) => { patientSuppression = suppression; };
  const service = createWorkflowService(repository, {
    environment: { PATIENT_WORKFLOW_AUTOMATION_ENABLED: "true" },
    dialpad: {
      configured: true,
      webhookConfigured: true,
      verifyWebhook(raw) { return JSON.parse(raw); },
    },
    chat: { enabled: false },
    clock: () => NOON,
  });
  const result = await service.handleDialpadWebhook(JSON.stringify({
    id: "synthetic-start-event",
    direction: "inbound",
    from_number: "+15555550100",
    text: "START",
  }));
  assert.equal(result.optedIn, true);
  assert.equal(patientSuppression.active, false);
  assert.equal(repository.requests.size, 0);
  assert.equal([...repository.communications.values()].some((item) => item.statusReason === "opt-in"), true);
});

