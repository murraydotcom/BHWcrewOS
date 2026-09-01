import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import {
  applyPatientRequestAction,
  buildGoogleChatCard,
  canActOnRequest,
  defaultNotificationRules,
  deterministicId,
  isSmsOptIn,
  isSmsOptOut,
  normalizeStaffRole,
  quietHoursState,
  renderSmsTemplate,
  requiresSafetyHold,
  resolveNotificationRule,
  sanitizeManualSms,
  sanitizePatientRequest,
} from "./workflow-automation.mjs";
import { normalizeDialpadEvent } from "./dialpad-service.mjs";

const cleanText = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const iso = (value = new Date()) => (value instanceof Date ? value : new Date(value)).toISOString();
const dispatcherOauthClient = new OAuth2Client();

async function verifyGoogleOidcToken(token, audience) {
  const ticket = await dispatcherOauthClient.verifyIdToken({ idToken: token, audience });
  return ticket.getPayload() || {};
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function evaluatePortalConsent(consent, { bhwPatientId, channel } = {}) {
  if (!consent) return { eligible: false, reason: "not-found" };
  if (consent.bhwPatientId !== bhwPatientId || consent.channel !== channel) return { eligible: false, reason: "patient-or-channel-mismatch" };
  if (consent.status !== "current") return { eligible: false, reason: consent.status || "not-current" };
  if (!consent.verifiedAt || !consent.evidenceReference) return { eligible: false, reason: "verification-missing" };
  return { eligible: true, reason: "current" };
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch { return fallback; }
}

function safeHttpsUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.toString() : ""; }
  catch { return ""; }
}

function deliveryStatus(value) {
  const status = cleanText(value, 80).toLowerCase();
  if (/deliver/.test(status)) return "delivered";
  if (/fail|undeliver|reject|error/.test(status)) return "failed";
  if (/sent|accept|queued|pending/.test(status)) return status.includes("pending") || status.includes("queued") ? "pending" : "sent";
  return "unknown";
}

function parameterObject(parameters) {
  if (!parameters) return {};
  if (Array.isArray(parameters)) {
    return Object.fromEntries(parameters.filter((entry) => entry?.key).map((entry) => [entry.key, entry.value]));
  }
  return typeof parameters === "object" ? { ...parameters } : {};
}

function chatActionParameters(event = {}) {
  return {
    ...parameterObject(event.action?.parameters),
    ...parameterObject(event.common?.invokedFunctionParameters),
    ...parameterObject(event.common?.parameters),
  };
}

function notificationOverrideFromEnvironment(environment, ruleId) {
  const values = parseJson(environment.PATIENT_NOTIFICATION_RULES_JSON, {});
  if (Array.isArray(values)) return values.find((rule) => rule?.id === ruleId) || null;
  return values[ruleId] || null;
}

function sanitizeRuleOverride(input = {}, base = null, now = new Date(), actor = "system") {
  if (!base) throw Object.assign(new Error("notification rule was not found"), { status: 404 });
  const allowedPlaceholders = /^(?:(?!\{\{).|\{\{patientPortalUrl\}\})*$/s;
  const template = cleanText(input.template ?? base.template, 480);
  if (!template || !allowedPlaceholders.test(template)) {
    throw Object.assign(new Error("notification template may use only the secure patient-page link placeholder"), { status: 400 });
  }
  return {
    ...base,
    enabled: input.enabled === undefined ? base.enabled : input.enabled === true,
    template,
    respectQuietHours: input.respectQuietHours === undefined ? base.respectQuietHours : input.respectQuietHours !== false,
    minimumMinutesBetweenMessages: Math.max(0, Math.min(1440, Number(input.minimumMinutesBetweenMessages ?? base.minimumMinutesBetweenMessages) || 0)),
    updatedAt: iso(now),
    updatedBy: cleanText(actor, 200),
  };
}

export function createWorkflowService(repository, {
  environment = process.env,
  dialpad,
  chat,
  clock = () => new Date(),
  logger = console,
  verifyOidcToken = verifyGoogleOidcToken,
} = {}) {
  const patientPortalUrl = safeHttpsUrl(environment.PATIENT_PORTAL_URL);
  const quietHours = {
    timeZone: cleanText(environment.SMS_TIME_ZONE || "America/New_York", 100),
    start: cleanText(environment.SMS_QUIET_HOURS_START || "20:00", 20),
    end: cleanText(environment.SMS_QUIET_HOURS_END || "08:00", 20),
  };
  const automationEnabled = cleanText(environment.PATIENT_WORKFLOW_AUTOMATION_ENABLED, 10).toLowerCase() === "true";
  const dispatchSecret = cleanText(environment.WORKFLOW_DISPATCH_SECRET, 1000);
  const dispatchAudience = safeHttpsUrl(environment.WORKFLOW_DISPATCH_AUDIENCE);
  const dispatchServiceAccount = cleanText(environment.WORKFLOW_DISPATCH_SERVICE_ACCOUNT, 320).toLowerCase();

  async function verifyDispatcher(header) {
    const oidcConfigured = Boolean(dispatchAudience && dispatchServiceAccount);
    if (!dispatchSecret && !oidcConfigured) {
      throw Object.assign(new Error("workflow dispatcher is not configured"), { status: 503 });
    }
    const authorization = cleanText(header, 4000);
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) throw Object.assign(new Error("dispatcher authentication required"), { status: 401 });
    if (dispatchSecret && constantTimeEqual(token, dispatchSecret)) return { method: "shared-secret" };
    if (oidcConfigured) {
      try {
        const payload = await verifyOidcToken(token, dispatchAudience);
        const email = cleanText(payload.email, 320).toLowerCase();
        if (payload.email_verified !== true || email !== dispatchServiceAccount) throw new Error("unexpected dispatcher identity");
        return { method: "google-oidc", email };
      } catch {
        throw Object.assign(new Error("dispatcher authentication required"), { status: 401 });
      }
    }
    throw Object.assign(new Error("dispatcher authentication required"), { status: 401 });
  }

  async function ruleFor(request) {
    const ruleId = `${request.requestType}:${request.status}:sms`;
    const [stored, configured] = await Promise.all([
      typeof repository.getNotificationRule === "function" ? repository.getNotificationRule(ruleId) : null,
      Promise.resolve(notificationOverrideFromEnvironment(environment, ruleId)),
    ]);
    return resolveNotificationRule(request, configured, stored);
  }

  async function recordAudit(eventType, request, user, metadata = {}) {
    if (typeof repository.recordWorkflowAudit !== "function") return;
    await repository.recordWorkflowAudit({
      eventType,
      requestId: request?.id || "",
      bhwPatientId: request?.bhwPatientId || "",
      actor: cleanText(user?.sub || "system", 200),
      actorRole: cleanText(user?.role || "system", 80),
      metadata,
      occurredAt: iso(clock()),
    });
  }

  async function reserveCommunication(communication) {
    if (typeof repository.reserveCommunication !== "function") {
      throw Object.assign(new Error("communications store is unavailable"), { status: 503 });
    }
    return repository.reserveCommunication(communication);
  }

  async function updateCommunication(id, patch) {
    if (typeof repository.updateCommunication !== "function") return null;
    return repository.updateCommunication(id, patch);
  }

  function baseCommunication(request, {
    id,
    direction = "outbound",
    channel = "sms",
    transport = "dialpad",
    content = "",
    templateId = "",
    actor = "system",
    status = "pending",
    statusReason = "",
    sendAfter = "",
    destinationHash = "",
    providerMessageId = "",
    providerStatus = "",
    idempotencyKeyHash = "",
    containsPhi = false,
  } = {}) {
    const now = iso(clock());
    return {
      id,
      requestId: request?.id || "",
      bhwPatientId: request?.bhwPatientId || "",
      patientReference: request?.bhwPatientId ? deterministicId("patient", request.bhwPatientId) : "",
      direction,
      channel,
      transport,
      content,
      containsPhi,
      templateId,
      status,
      statusReason,
      sendAfter,
      destinationHash,
      providerMessageId,
      providerStatus,
      idempotencyKeyHash,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: cleanText(actor, 200),
    };
  }

  async function suppressedCommunication(request, rule, reason, user, idSuffix = "auto") {
    const id = deterministicId("sms", request.id, request.version, rule?.id || request.status, idSuffix);
    const result = await reserveCommunication(baseCommunication(request, {
      id,
      templateId: rule?.id || "",
      actor: user?.sub,
      status: "suppressed",
      statusReason: reason,
      idempotencyKeyHash: deterministicId(idSuffix),
    }));
    await recordAudit("patient-request.notification-suppressed", request, user, { reason, ruleId: rule?.id || "" });
    return { status: "suppressed", reason, duplicate: result.created === false, communication: result.communication };
  }

  async function deliverCommunication(communication, destination) {
    if (!dialpad?.configured) {
      const patch = { status: "suppressed", statusReason: "messaging-not-configured", updatedAt: iso(clock()) };
      await updateCommunication(communication.id, patch);
      return { ...communication, ...patch };
    }
    try {
      const delivery = await dialpad.sendSms({
        to: destination,
        text: communication.content,
        idempotencyKey: communication.id,
      });
      const patch = {
        status: "sent",
        statusReason: "",
        sentAt: iso(clock()),
        updatedAt: iso(clock()),
        attempts: Math.max(0, Number(communication.attempts) || 0) + 1,
        ...delivery,
      };
      await updateCommunication(communication.id, patch);
      return { ...communication, ...patch };
    } catch (error) {
      const patch = {
        status: "failed",
        statusReason: cleanText(error.code || "provider-error", 80),
        providerStatus: cleanText(error.providerStatus, 80),
        providerDetail: cleanText(error.providerDetail, 240),
        failedAt: iso(clock()),
        updatedAt: iso(clock()),
        attempts: Math.max(0, Number(communication.attempts) || 0) + 1,
      };
      await updateCommunication(communication.id, patch);
      return { ...communication, ...patch };
    }
  }

  async function messagingContext(request) {
    if (typeof repository.getPatientMessagingContext !== "function") {
      throw Object.assign(new Error("patient messaging context is unavailable"), { status: 503 });
    }
    return repository.getPatientMessagingContext(request.bhwPatientId);
  }

  async function dispatchRule(request, rule, user, {
    mode = "automatic",
    idempotencyKey = "",
    ignoreRuleDisabled = false,
  } = {}) {
    if (!rule) return { status: "not-applicable", reason: "no-rule" };
    if (!automationEnabled) return suppressedCommunication(request, rule, "automation-not-enabled", user, mode);
    if (mode === "automatic") {
      if (!rule.enabled && !ignoreRuleDisabled) return suppressedCommunication(request, rule, "rule-disabled", user, mode);
      if (request.notificationMode === "none") return suppressedCommunication(request, rule, "request-notifications-disabled", user, mode);
      if (request.manualNotifyOnly || request.notificationMode === "manual") return suppressedCommunication(request, rule, "manual-notify-required", user, mode);
    }
    if (requiresSafetyHold(request)) return suppressedCommunication(request, rule, "safety-manual-review", user, mode);

    let context;
    try { context = await messagingContext(request); }
    catch { return suppressedCommunication(request, rule, "messaging-context-unavailable", user, mode); }
    if (!context?.patient || context.patient.patientStatus !== "active") {
      return suppressedCommunication(request, rule, "patient-not-active", user, mode);
    }
    const consentState = evaluatePortalConsent(context.smsConsent, { bhwPatientId: request.bhwPatientId, channel: "sms" });
    if (!consentState.eligible) return suppressedCommunication(request, rule, `sms-consent-${consentState.reason}`, user, mode);
    if (context.smsSuppression?.active === true) return suppressedCommunication(request, rule, "sms-opted-out", user, mode);
    const destination = cleanText(context.contact?.phoneE164 || context.contact?.phone, 40);
    if (!destination || context.contact?.active === false) return suppressedCommunication(request, rule, "sms-destination-unavailable", user, mode);
    if (!dialpad?.configured) return suppressedCommunication(request, rule, "messaging-not-configured", user, mode);
    const minimumMinutes = Math.max(0, Number(rule.minimumMinutesBetweenMessages) || 0);
    if (minimumMinutes && typeof repository.getLatestOutboundCommunication === "function") {
      const latest = await repository.getLatestOutboundCommunication(request.id, "sms");
      const latestAt = new Date(latest?.sentAt || latest?.createdAt || 0).getTime();
      if (latestAt && clock().getTime() - latestAt < minimumMinutes * 60_000) {
        return suppressedCommunication(request, rule, "notification-cooldown", user, mode);
      }
    }

    const content = renderSmsTemplate(rule, { patientPortalUrl });
    const quiet = quietHoursState(clock(), quietHours);
    const idKey = idempotencyKey || `${request.id}:${request.version}:${rule.id}:${mode}`;
    const id = deterministicId("sms", request.id, rule.id, idKey);
    const queued = rule.respectQuietHours !== false && quiet.quiet;
    const reservation = await reserveCommunication(baseCommunication(request, {
      id,
      content,
      templateId: rule.id,
      actor: user?.sub,
      status: queued ? "queued" : "pending",
      statusReason: queued ? "quiet-hours" : "",
      sendAfter: queued ? quiet.sendAfter : iso(clock()),
      destinationHash: deterministicId("sms-destination", destination),
      idempotencyKeyHash: deterministicId(idKey),
      containsPhi: false,
    }));
    if (reservation.created === false) return { status: reservation.communication.status, duplicate: true, communication: reservation.communication };
    await recordAudit(queued ? "patient-request.notification-queued" : "patient-request.notification-requested", request, user, {
      ruleId: rule.id,
      communicationId: id,
      mode,
    });
    if (queued) return { status: "queued", duplicate: false, communication: reservation.communication };
    const delivered = await deliverCommunication(reservation.communication, destination);
    await recordAudit(`patient-request.notification-${delivered.status}`, request, user, { ruleId: rule.id, communicationId: id });
    return { status: delivered.status, duplicate: false, communication: delivered };
  }

  async function notifyForCurrentState(request, user, options = {}) {
    return dispatchRule(request, await ruleFor(request), user, options);
  }

  async function recordChatAttempt(request, user, status, reason = "", delivery = {}) {
    const id = deterministicId("google-chat", request.id, request.version, status === "sent" ? "sync" : reason || status);
    const result = await reserveCommunication(baseCommunication(request, {
      id,
      channel: "google_chat",
      transport: "google-chat",
      content: `${request.requestType}:${request.status}`,
      actor: user?.sub,
      status,
      statusReason: reason,
      providerMessageId: delivery.providerMessageId || delivery.messageName || "",
      providerStatus: delivery.providerStatus || "",
      containsPhi: false,
    }));
    return result.communication;
  }

  async function syncChat(request, user, { skipApi = false } = {}) {
    if (skipApi) {
      await recordChatAttempt(request, user, "sent", "interaction-response", { providerMessageId: request.chatMessageName || "" });
      return { status: "sent", reason: "interaction-response" };
    }
    if (!chat?.enabled) {
      await recordChatAttempt(request, user, "suppressed", "chat-not-configured");
      return { status: "suppressed", reason: "chat-not-configured" };
    }
    try {
      const delivery = request.chatMessageName
        ? await chat.updateRequestCard(request, request.chatMessageName)
        : await chat.sendRequestCard(request);
      if (delivery.messageName && delivery.messageName !== request.chatMessageName && typeof repository.attachChatDelivery === "function") {
        await repository.attachChatDelivery(request.id, delivery);
        request.chatMessageName = delivery.messageName;
        request.chatSpace = delivery.space || request.chatSpace || "";
      }
      await recordChatAttempt(request, user, delivery.providerStatus === "update-gated" ? "suppressed" : "sent",
        delivery.providerStatus === "update-gated" ? "card-updates-gated" : "", delivery);
      return { status: delivery.providerStatus === "update-gated" ? "suppressed" : "sent", delivery };
    } catch (error) {
      await recordChatAttempt(request, user, "failed", cleanText(error.code || "provider-error", 80), {
        providerStatus: error.providerStatus,
      });
      return { status: "failed", reason: cleanText(error.message, 200) };
    }
  }

  async function createRequest(input, user = {}) {
    const request = sanitizePatientRequest(input, { user, now: clock(), patientId: input.bhwPatientId });
    if (request.bhwPatientId !== "BHW0000" && typeof repository.patientExists === "function"
        && !(await repository.patientExists(request.bhwPatientId))) {
      throw Object.assign(new Error("BHW Patient ID was not found in the Patient Registry"), { status: 404 });
    }
    const sourceIsPatient = request.source === "patient-portal" || request.source === "care-connect" || request.source.startsWith("dialpad");
    if (!sourceIsPatient && !canActOnRequest(request, user)) {
      throw Object.assign(new Error("role is not authorized to create this service-line request"), { status: 403 });
    }
    const saved = await repository.createPatientRequest(request, user);
    await recordAudit("patient-request.created", saved, user, {
      requestType: saved.requestType,
      serviceLine: saved.serviceLine,
      source: saved.source,
    });
    const [chatResult, notification] = await Promise.all([
      syncChat(saved, user),
      notifyForCurrentState(saved, user),
    ]);
    return { request: saved, chat: chatResult, notification };
  }

  async function syncCreatedRequest(requestId, user = {}) {
    const request = await repository.getPatientRequest(requestId);
    if (!request) throw Object.assign(new Error("request was not found"), { status: 404 });
    const [chatResult, notification] = await Promise.all([
      syncChat(request, user),
      notifyForCurrentState(request, user),
    ]);
    return { request, chat: chatResult, notification };
  }

  async function action(requestId, input, user = {}) {
    const current = await repository.getPatientRequest(requestId);
    if (!current) throw Object.assign(new Error("request was not found"), { status: 404 });
    const result = applyPatientRequestAction(current, input, { user, now: clock() });
    if (result.duplicate) return { request: result.request, duplicate: true, notification: { status: "duplicate" } };
    if (input.expectedVersion && Number(input.expectedVersion) !== Number(current.version)) {
      throw Object.assign(new Error("request changed; refresh before applying this action"), { status: 409 });
    }
    const savedResult = await repository.commitPatientRequestAction({
      previousVersion: current.version,
      request: result.request,
      action: result.action,
      actionHash: result.actionHash,
      user,
    });
    if (savedResult.duplicate) return { request: savedResult.request, duplicate: true, notification: { status: "duplicate" } };
    const saved = savedResult.request;
    await recordAudit(`patient-request.${result.action}`, saved, user, {
      previousStatus: result.previousStatus,
      status: saved.status,
      version: saved.version,
    });
    const chatSource = user.source === "google-chat";
    const [chatResult, notification] = await Promise.all([
      syncChat(saved, user, { skipApi: chatSource }),
      result.statusChanged ? notifyForCurrentState(saved, user) : Promise.resolve({ status: "not-applicable", reason: "status-unchanged" }),
    ]);
    return { request: saved, duplicate: false, chat: chatResult, notification };
  }

  async function manualNotify(requestId, input, user = {}) {
    const request = await repository.getPatientRequest(requestId);
    if (!request) throw Object.assign(new Error("request was not found"), { status: 404 });
    if (!canActOnRequest(request, user)) throw Object.assign(new Error("role is not authorized for this service line"), { status: 403 });
    const idempotencyKey = cleanText(input.idempotencyKey, 160);
    if (!idempotencyKey) throw Object.assign(new Error("idempotency key is required"), { status: 400 });
    return notifyForCurrentState(request, user, { mode: "manual", idempotencyKey, ignoreRuleDisabled: true });
  }

  async function sendManualSms(requestId, input, user = {}) {
    const request = await repository.getPatientRequest(requestId);
    if (!request) throw Object.assign(new Error("request was not found"), { status: 404 });
    if (!canActOnRequest(request, user)) throw Object.assign(new Error("role is not authorized for this service line"), { status: 403 });
    const message = sanitizeManualSms(input.message || input.text, { noPhiAttestation: input.noPhiAttestation });
    const idempotencyKey = cleanText(input.idempotencyKey, 160);
    if (!idempotencyKey) throw Object.assign(new Error("idempotency key is required"), { status: 400 });
    if (!automationEnabled) return suppressedCommunication(request, null, "automation-not-enabled", user, `manual:${idempotencyKey}`);
    if (requiresSafetyHold(request)) return suppressedCommunication(request, null, "safety-manual-review", user, `manual:${idempotencyKey}`);
    const context = await messagingContext(request);
    const consentState = evaluatePortalConsent(context.smsConsent, { bhwPatientId: request.bhwPatientId, channel: "sms" });
    if (!consentState.eligible) return suppressedCommunication(request, null, `sms-consent-${consentState.reason}`, user, `manual:${idempotencyKey}`);
    if (context.smsSuppression?.active === true) return suppressedCommunication(request, null, "sms-opted-out", user, `manual:${idempotencyKey}`);
    const destination = cleanText(context.contact?.phoneE164 || context.contact?.phone, 40);
    if (!destination || context.contact?.active === false) return suppressedCommunication(request, null, "sms-destination-unavailable", user, `manual:${idempotencyKey}`);
    if (!dialpad?.configured) return suppressedCommunication(request, null, "messaging-not-configured", user, `manual:${idempotencyKey}`);
    const quiet = quietHoursState(clock(), quietHours);
    const id = deterministicId("sms-manual", request.id, idempotencyKey);
    const reservation = await reserveCommunication(baseCommunication(request, {
      id,
      content: message,
      templateId: "manual-no-phi",
      actor: user.sub,
      status: quiet.quiet ? "queued" : "pending",
      statusReason: quiet.quiet ? "quiet-hours" : "",
      sendAfter: quiet.quiet ? quiet.sendAfter : iso(clock()),
      destinationHash: deterministicId("sms-destination", destination),
      idempotencyKeyHash: deterministicId(idempotencyKey),
      containsPhi: false,
    }));
    if (reservation.created === false) return { status: reservation.communication.status, duplicate: true, communication: reservation.communication };
    if (quiet.quiet) return { status: "queued", duplicate: false, communication: reservation.communication };
    const communication = await deliverCommunication(reservation.communication, destination);
    await recordAudit(`patient-request.manual-sms-${communication.status}`, request, user, { communicationId: id });
    return { status: communication.status, duplicate: false, communication };
  }

  async function dispatchDue(header) {
    await verifyDispatcher(header);
    if (!automationEnabled) return { processed: 0, results: [] };
    const due = await repository.listDueCommunications(iso(clock()), 50);
    const results = [];
    for (const queued of due) {
      const claimed = await repository.claimCommunication(queued.id, iso(clock()));
      if (!claimed?.claimed) continue;
      const request = await repository.getPatientRequest(queued.requestId);
      if (!request) {
        await updateCommunication(queued.id, { status: "failed", statusReason: "request-not-found", updatedAt: iso(clock()) });
        continue;
      }
      const context = await messagingContext(request);
      const consent = evaluatePortalConsent(context.smsConsent, { bhwPatientId: request.bhwPatientId, channel: "sms" });
      if (!consent.eligible || context.smsSuppression?.active === true) {
        await updateCommunication(queued.id, { status: "suppressed", statusReason: context.smsSuppression?.active ? "sms-opted-out" : `sms-consent-${consent.reason}`, updatedAt: iso(clock()) });
        results.push({ id: queued.id, status: "suppressed" });
        continue;
      }
      const destination = cleanText(context.contact?.phoneE164 || context.contact?.phone, 40);
      const delivered = destination ? await deliverCommunication(claimed.communication, destination) : null;
      if (!delivered) await updateCommunication(queued.id, { status: "suppressed", statusReason: "sms-destination-unavailable", updatedAt: iso(clock()) });
      results.push({ id: queued.id, status: delivered?.status || "suppressed" });
    }
    return { processed: results.length, results };
  }

  async function handleDialpadWebhook(rawBody) {
    if (!dialpad?.webhookConfigured) throw Object.assign(new Error("Dialpad webhook is not configured"), { status: 503 });
    const payload = dialpad.verifyWebhook(rawBody);
    const event = normalizeDialpadEvent(payload, clock());
    if (!event) return { ok: true, ignored: true, reason: "non-actionable-event" };
    if (event.kind === "delivery-status" || event.direction === "outbound") {
      const updated = event.providerMessageId
        ? await repository.updateCommunicationDelivery(event.providerMessageId, {
          status: deliveryStatus(event.providerStatus),
          providerStatus: event.providerStatus,
          providerEventAt: event.occurredAt,
          updatedAt: iso(clock()),
        }) : 0;
      return { ok: true, deliveryUpdated: updated };
    }
    const phone = event.from;
    const optOut = event.kind === "sms" && isSmsOptOut(event.text);
    const optIn = event.kind === "sms" && isSmsOptIn(event.text);
    if ((optOut || optIn) && typeof repository.setPhoneSmsSuppression === "function") {
      await repository.setPhoneSmsSuppression(phone, {
        active: optOut,
        source: optOut ? "dialpad-stop" : "dialpad-start",
        occurredAt: event.occurredAt,
      });
    }
    const patients = phone && typeof repository.findPatientsByPhone === "function" ? await repository.findPatientsByPhone(phone) : [];
    const patient = patients.length === 1 ? patients[0] : null;
    const providerKey = event.providerMessageId || deterministicId(event.kind, phone, event.occurredAt, event.text);
    const communicationId = deterministicId("dialpad-inbound", providerKey);
    if (typeof repository.getCommunication === "function" && await repository.getCommunication(communicationId)) {
      return { ok: true, duplicate: true };
    }
    if (!patient) {
      await reserveCommunication(baseCommunication(null, {
        id: communicationId,
        direction: "inbound",
        content: event.text,
        actor: "dialpad",
        status: "unmatched",
        statusReason: optOut ? "opt-out-unmatched" : patients.length > 1 ? "shared-phone-number" : "patient-not-matched",
        destinationHash: phone ? deterministicId("sms-destination", phone) : "",
        providerMessageId: event.providerMessageId,
        providerStatus: event.providerStatus,
        containsPhi: true,
      }));
      return { ok: true, matched: false, optedOut: optOut, reason: optOut ? "opt-out-unmatched" : patients.length > 1 ? "shared-phone-number" : "patient-not-matched" };
    }

    const systemUser = { sub: "system:dialpad", role: "system", name: "Dialpad", source: "dialpad" };
    if (optOut) {
      await repository.setSmsSuppression(patient.bhwPatientId, { active: true, source: "dialpad-stop", occurredAt: event.occurredAt });
      await reserveCommunication(baseCommunication({ id: "", bhwPatientId: patient.bhwPatientId }, {
        id: communicationId,
        direction: "inbound",
        content: event.text,
        actor: "dialpad",
        status: "received",
        statusReason: "opt-out",
        destinationHash: deterministicId("sms-destination", phone),
        providerMessageId: event.providerMessageId,
        providerStatus: event.providerStatus,
        containsPhi: false,
      }));
      await recordAudit("patient.sms-opted-out", { id: "", bhwPatientId: patient.bhwPatientId }, systemUser, { source: "dialpad" });
      return { ok: true, matched: true, optedOut: true };
    }
    if (optIn) {
      await repository.setSmsSuppression(patient.bhwPatientId, { active: false, source: "dialpad-start", occurredAt: event.occurredAt });
      await reserveCommunication(baseCommunication({ id: "", bhwPatientId: patient.bhwPatientId }, {
        id: communicationId,
        direction: "inbound",
        content: event.text,
        actor: "dialpad",
        status: "received",
        statusReason: "opt-in",
        destinationHash: deterministicId("sms-destination", phone),
        providerMessageId: event.providerMessageId,
        providerStatus: event.providerStatus,
        containsPhi: false,
      }));
      await recordAudit("patient.sms-opted-in", { id: "", bhwPatientId: patient.bhwPatientId }, systemUser, { source: "dialpad" });
      return { ok: true, matched: true, optedIn: true };
    }

    let request = typeof repository.findLatestOpenPatientRequest === "function"
      ? await repository.findLatestOpenPatientRequest(patient.bhwPatientId) : null;
    if (!request) {
      const created = await createRequest({
        bhwPatientId: patient.bhwPatientId,
        requestType: "general",
        source: event.source,
        sourceReference: providerKey,
        summary: event.text,
        priority: "routine",
      }, systemUser);
      request = created.request;
    }
    const reservation = await reserveCommunication(baseCommunication(request, {
      id: communicationId,
      direction: "inbound",
      content: event.text,
      actor: "dialpad",
      status: "received",
      destinationHash: deterministicId("sms-destination", phone),
      providerMessageId: event.providerMessageId,
      providerStatus: event.providerStatus,
      containsPhi: true,
    }));
    await recordAudit("patient-request.communication-received", request, systemUser, {
      channel: event.kind === "sms" ? "sms" : "voice",
      communicationId,
      duplicate: reservation.created === false,
    });
    return { ok: true, matched: true, requestId: request.id, duplicate: reservation.created === false };
  }

  async function handleChatEvent(request) {
    await chat.verifyInteraction(request.headers.get("authorization"));
    const event = await request.json();
    const eventType = cleanText(event.type || event.eventType, 80).toUpperCase();
    if (eventType === "ADDED_TO_SPACE") {
      await recordAudit("google-chat.installed", null, { sub: "system:google-chat", role: "system" }, { space: cleanText(event.space?.name, 200) });
      return { text: "CrewOS is connected. New requests for this service line will appear here as actionable cards." };
    }
    if (eventType === "MESSAGE" || eventType === "APP_COMMAND") {
      return { text: "Use a CrewOS request card to assign, start, resolve, or escalate work. Detailed patient information stays in CrewOS." };
    }
    if (eventType !== "CARD_CLICKED") return { text: "CrewOS received the event." };
    const actor = chat.actor(event);
    const parameters = chatActionParameters(event);
    const requestId = cleanText(parameters.requestId, 100);
    const workflowAction = cleanText(parameters.workflowAction, 80);
    const providerEventId = cleanText(event.eventId, 200);
    const eventId = providerEventId || deterministicId(
      "chat-event",
      requestId,
      workflowAction,
      parameters.status,
      parameters.outcome,
      parameters.reason,
      parameters.requestVersion,
      event.eventTime,
      event.message?.name,
      actor.sub,
    );
    try {
      const result = await action(requestId, {
        action: workflowAction,
        status: parameters.status,
        outcome: parameters.outcome,
        reason: parameters.reason,
        idempotencyKey: eventId,
        expectedVersion: Number(parameters.requestVersion) || undefined,
      }, actor);
      return chat.responseCard(result.request, result.duplicate ? "This action was already applied." : "CrewOS status updated.");
    } catch (error) {
      const current = requestId ? await repository.getPatientRequest(requestId).catch(() => null) : null;
      if (current) {
        return {
          ...buildGoogleChatCard(current, { crewOsUrl: safeHttpsUrl(environment.CREWOS_REQUESTS_URL) }),
          text: cleanText(error.message, 240),
          actionResponse: { type: "UPDATE_MESSAGE" },
        };
      }
      return { text: cleanText(error.message || "CrewOS could not apply that action.", 240) };
    }
  }

  async function listNotificationRules() {
    const stored = typeof repository.listNotificationRules === "function" ? await repository.listNotificationRules() : [];
    const byId = new Map(stored.map((rule) => [rule.id, rule]));
    return defaultNotificationRules().map((base) => sanitizeRuleOverride(
      byId.get(base.id) || notificationOverrideFromEnvironment(environment, base.id) || {}, base, clock(), byId.get(base.id)?.updatedBy || "default",
    ));
  }

  async function saveNotificationRule(ruleId, input, user = {}) {
    if (!["executive", "operations-manager"].includes(normalizeStaffRole(user.role))) {
      throw Object.assign(new Error("operations role is required to change notification rules"), { status: 403 });
    }
    const base = defaultNotificationRules().find((rule) => rule.id === ruleId);
    const rule = sanitizeRuleOverride(input, base, clock(), user.sub);
    await repository.saveNotificationRule(rule, user);
    await recordAudit("notification-rule.updated", null, user, { ruleId });
    return rule;
  }

  return {
    automationEnabled,
    createRequest,
    syncCreatedRequest,
    action,
    manualNotify,
    sendManualSms,
    dispatchDue,
    handleDialpadWebhook,
    handleChatEvent,
    listNotificationRules,
    saveNotificationRule,
    async listRequests(filters, user) {
      const rows = await repository.listPatientRequests(filters, user);
      return rows.filter((request) => canActOnRequest(request, user));
    },
    async getRequest(id, user) {
      const request = await repository.getPatientRequest(id);
      if (!request) throw Object.assign(new Error("request was not found"), { status: 404 });
      if (!canActOnRequest(request, user)) throw Object.assign(new Error("role is not authorized for this service line"), { status: 403 });
      return request;
    },
    async listCommunications(id, user) {
      await this.getRequest(id, user);
      return repository.listRequestCommunications(id);
    },
  };
}
