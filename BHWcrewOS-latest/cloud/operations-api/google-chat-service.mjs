import crypto from "node:crypto";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { buildGoogleChatCard } from "./workflow-automation.mjs";

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
const CHAT_API = "https://chat.googleapis.com/v1";
const cleanText = (value, max = 1000) => String(value ?? "").trim().slice(0, max);

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function safeSpace(value) {
  const space = cleanText(value, 200);
  return /^spaces\/[A-Za-z0-9_-]+$/.test(space) ? space : "";
}

function safeMessageName(value) {
  const name = cleanText(value, 400);
  return /^spaces\/[A-Za-z0-9_-]+\/messages\/[A-Za-z0-9._~-]+$/.test(name) ? name : "";
}

function bearerToken(header) {
  const value = String(header || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function customMessageId(requestId) {
  return `client-bhw-${crypto.createHash("sha256").update(String(requestId)).digest("hex").slice(0, 32)}`;
}

export function chatActionParameters(event = {}) {
  const parameters = event.common?.parameters || event.action?.parameters || event.common?.invokedFunctionParameters || {};
  if (!Array.isArray(parameters)) return { ...parameters };
  return Object.fromEntries(parameters.map((entry) => [entry.key, entry.value]));
}

export function chatActor(event = {}, roleMap = {}) {
  const email = cleanText(event.user?.email || event.user?.emailAddress, 240).toLowerCase();
  const role = cleanText(roleMap[email], 80).toLowerCase();
  if (!email || !role) throw Object.assign(new Error("Google Chat user is not mapped to a CrewOS role"), { status: 403 });
  return {
    sub: `chat:${cleanText(event.user?.name || email, 200)}`,
    email,
    name: cleanText(event.user?.displayName || email, 160),
    role,
    source: "google-chat",
  };
}

export function createGoogleChatService(environment = process.env, fetchImpl = fetch) {
  const enabled = cleanText(environment.GOOGLE_CHAT_ENABLED, 10).toLowerCase() === "true";
  const authAudience = cleanText(environment.GOOGLE_CHAT_AUTH_AUDIENCE || environment.GOOGLE_CHAT_PROJECT_NUMBER, 1000);
  const crewOsUrl = cleanText(environment.CREWOS_REQUESTS_URL, 1000);
  const spaces = parseJsonObject(environment.GOOGLE_CHAT_SPACES_JSON);
  const defaultSpace = safeSpace(environment.GOOGLE_CHAT_DEFAULT_SPACE);
  const roleMap = Object.fromEntries(Object.entries(parseJsonObject(environment.GOOGLE_CHAT_STAFF_ROLES_JSON))
    .map(([email, role]) => [String(email).trim().toLowerCase(), String(role).trim().toLowerCase()]));
  const cardUpdatesEnabled = cleanText(environment.GOOGLE_CHAT_CARD_UPDATES_ENABLED, 10).toLowerCase() === "true";
  const oauthClient = new OAuth2Client();
  const auth = new GoogleAuth({ scopes: [CHAT_SCOPE] });

  function spaceFor(request) {
    return safeSpace(spaces[request.assignedTeam]) || safeSpace(spaces[request.serviceLine]) || defaultSpace;
  }

  async function verifyInteraction(header) {
    if (!enabled || !authAudience) throw Object.assign(new Error("Google Chat interaction verification is not configured"), { status: 503 });
    const token = bearerToken(header);
    if (!token) throw Object.assign(new Error("Google Chat bearer token is required"), { status: 401 });
    try {
      if (/^\d+$/.test(authAudience)) {
        const response = await fetchImpl(`https://www.googleapis.com/service_accounts/v1/metadata/x509/${CHAT_ISSUER}`);
        if (!response.ok) throw new Error("Chat signing certificates are unavailable");
        const certs = await response.json();
        return (await oauthClient.verifySignedJwtWithCertsAsync(token, certs, authAudience, [CHAT_ISSUER])).getPayload?.() || {};
      }
      const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: authAudience });
      const payload = ticket.getPayload() || {};
      if (payload.email_verified !== true || String(payload.email || "").toLowerCase() !== CHAT_ISSUER) {
        throw new Error("unexpected Chat token subject");
      }
      return payload;
    } catch {
      throw Object.assign(new Error("Google Chat request could not be verified"), { status: 401 });
    }
  }

  async function authorizedHeaders(url) {
    const client = await auth.getClient();
    const requestHeaders = await client.getRequestHeaders(url);
    return { ...Object.fromEntries(new Headers(requestHeaders).entries()), "Content-Type": "application/json" };
  }

  async function callChat(path, options = {}) {
    const url = `${CHAT_API}/${path}`;
    const response = await fetchImpl(url, {
      ...options,
      headers: { ...(await authorizedHeaders(url)), ...options.headers },
    });
    const raw = await response.text();
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    if (!response.ok) {
      const error = new Error(`Google Chat API failed (${response.status})`);
      error.status = 502;
      error.providerStatus = response.status;
      error.providerDetail = cleanText(body.error?.message || raw, 240);
      throw error;
    }
    return body;
  }

  async function sendRequestCard(request) {
    if (!enabled) throw Object.assign(new Error("Google Chat automation is not enabled"), { status: 503, code: "chat-not-configured" });
    const space = spaceFor(request);
    if (!space) throw Object.assign(new Error("Google Chat space is not configured for this service line"), { status: 503, code: "chat-space-not-configured" });
    const message = buildGoogleChatCard(request, { crewOsUrl });
    const result = await callChat(`${space}/messages?messageId=${encodeURIComponent(customMessageId(request.id))}`, {
      method: "POST",
      body: JSON.stringify(message),
    });
    return {
      provider: "google-chat",
      space,
      messageName: safeMessageName(result.name),
      providerMessageId: cleanText(result.name, 400),
      providerStatus: "sent",
    };
  }

  async function updateRequestCard(request, messageName) {
    if (!enabled) throw Object.assign(new Error("Google Chat automation is not enabled"), { status: 503, code: "chat-not-configured" });
    const name = safeMessageName(messageName);
    if (!name) return sendRequestCard(request);
    if (!cardUpdatesEnabled) {
      return { provider: "google-chat", messageName: name, providerMessageId: name, providerStatus: "update-gated" };
    }
    const message = { name, ...buildGoogleChatCard(request, { crewOsUrl }) };
    const result = await callChat(`${name}?updateMask=${encodeURIComponent("text,cardsV2")}`, {
      method: "PATCH",
      body: JSON.stringify(message),
    });
    return {
      provider: "google-chat",
      space: name.split("/messages/")[0],
      messageName: safeMessageName(result.name || name),
      providerMessageId: cleanText(result.name || name, 400),
      providerStatus: "updated",
    };
  }

  return {
    configured: enabled && Boolean(authAudience),
    enabled,
    cardUpdatesEnabled,
    roleMap,
    verifyInteraction,
    actor(event) { return chatActor(event, roleMap); },
    spaceFor,
    sendRequestCard,
    updateRequestCard,
    responseCard(request, text = "") {
      return {
        ...buildGoogleChatCard(request, { crewOsUrl }),
        ...(text ? { text } : {}),
        actionResponse: { type: "UPDATE_MESSAGE" },
      };
    },
  };
}

