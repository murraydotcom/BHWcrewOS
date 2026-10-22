import http from "node:http";
import {syntheticAcceptanceBoundary} from './synthetic-acceptance-boundary.mjs';
import { Firestore } from '@google-cloud/firestore';
import { blueprintTaskConfiguration, createBlueprintTaskStore, createBlueprintWorkClient } from './blueprint-tasks.mjs';
import { createOperationsApp } from "./app.mjs";
import { createClinicalContextApp } from "./clinical-context-app.mjs";
import { ClinicalContextWorkflowRepository } from "./clinical-context-repository.mjs";
import { createDialpadService } from "./dialpad-service.mjs";
import { createGoogleChatService } from "./google-chat-service.mjs";
import { createWorkflowService } from "./workflow-service.mjs";
import { StaffChatRepository } from "./staff-chat.mjs";
import { createStaffChatApp } from "./staff-chat-app.mjs";

const repository = new ClinicalContextWorkflowRepository();
const dialpad = createDialpadService();
const chat = createGoogleChatService();
const workflow = createWorkflowService(repository, { dialpad, chat });
const blueprintConfig = blueprintTaskConfiguration(process.env);
const blueprintTasks = blueprintConfig ? { store: createBlueprintTaskStore(new Firestore({projectId:process.env.GOOGLE_CLOUD_PROJECT,databaseId:blueprintConfig.databaseId})), readSource:createBlueprintWorkClient(process.env) } : null;
const baseApp = createOperationsApp({ repository, workflow, blueprintTasks });
const app = createStaffChatApp({ baseApp: createClinicalContextApp({ baseApp, repository }), chat: new StaffChatRepository(repository.db) });
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
    const response = syntheticAcceptanceBoundary(request,process.env) || await app(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("operations-api server", error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    outgoing.end(JSON.stringify({ ok: false, code: "internal_error", error: "internal server error" }));
  }
});

server.listen(port, "0.0.0.0", () => console.log(`bhw-operations-api listening on ${port}`));
