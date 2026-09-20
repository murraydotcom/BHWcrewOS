import { verifyCrewToken } from "./auth.mjs";
import { chatActor, chatError } from "./staff-chat.mjs";

export function createStaffChatApp({ baseApp, chat, environment = process.env, now = () => Date.now() }) {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/staff-chat/")) return baseApp(request);
    const origin = request.headers.get("origin");
    const allowed = String(environment.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim());
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
    if (origin && allowed.includes(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
    try {
      if (origin && !allowed.includes(origin)) throw chatError(403, "Origin not allowed.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      const actor = chatActor(verifyCrewToken(request.headers.get("authorization"), environment.CREWOS_OPERATIONS_TOKEN_SECRET, { now: now() }));
      if (environment.STAFF_CHAT_ENABLED !== "true") throw chatError(503, "Staff Chat is not activated yet.");
      let body = {};
      if (request.method === "POST") {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 12000) throw chatError(413, "Message is too large.");
        try { body = JSON.parse(raw || "{}"); } catch { throw chatError(400, "Invalid message."); }
        if (!body || Array.isArray(body) || typeof body !== "object") throw chatError(400, "Invalid message.");
      }
      const action = url.pathname.slice("/v1/staff-chat/".length);
      let result;
      if (action === "session" && request.method === "POST") result = await chat.session(actor);
      else if (action === "preferences" && request.method === "POST") result = await chat.preferences(actor, body);
      else if (action === "directory" && request.method === "GET") result = await chat.directory(actor);
      else if (action === "rooms" && request.method === "GET") result = await chat.list(actor);
      else if (action === "direct" && request.method === "POST") result = await chat.direct(actor, body.recipientId);
      else {
        const match = action.match(/^rooms\/([^/]+)\/(messages|read)$/);
        if (!match) throw chatError(404, "Chat route not found.");
        if (match[2] === "messages" && request.method === "GET") result = await chat.messages(actor, match[1], url.searchParams.get("before") || "");
        else if (match[2] === "messages" && request.method === "POST") result = await chat.send(actor, match[1], body);
        else if (match[2] === "read" && request.method === "POST") result = await chat.read(actor, match[1], body.sequence);
        else throw chatError(405, "Method not allowed.");
      }
      return json(200, { ok: true, ...result });
    } catch (error) {
      return json(error.status || 500, { ok: false, error: error.status ? error.message : "Staff Chat is temporarily unavailable." });
    }
  };
}
