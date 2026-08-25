import http from "node:http";
import { createOperationsApp } from "./app.mjs";
import { FirestoreOperationsRepository } from "./firestore-repository.mjs";

const repository = new FirestoreOperationsRepository();
const app = createOperationsApp({ repository });
const port = Number(process.env.PORT || 8080);

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) {
        outgoing.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        outgoing.end(JSON.stringify({ ok: false, code: "payload_too_large", error: "request body is too large" }));
        return;
      }
      chunks.push(chunk);
    }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://${incoming.headers.host || "localhost"}${incoming.url || "/"}`, {
      method: incoming.method,
      headers: incoming.headers,
      body: ["GET", "HEAD"].includes(incoming.method || "GET") ? undefined : body,
    });
    const response = await app(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("operations-api server", error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    outgoing.end(JSON.stringify({ ok: false, code: "internal_error", error: "internal server error" }));
  }
});

server.listen(port, "0.0.0.0", () => console.log(`bhw-operations-api listening on ${port}`));
