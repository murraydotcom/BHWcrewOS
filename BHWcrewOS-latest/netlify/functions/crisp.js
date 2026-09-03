/*
 * CRISP CEND / ENS integration.
 *
 * - Signed-in CrewOS staff read the protected Google Cloud ADT event store.
 * - CRISP webhook deliveries require CRISP_INGEST_TOKEN and are forwarded to
 *   the RCM Cloud API with the CrewOS server credential.
 * - CEND exports are built only from the authoritative Cloud Patient Registry.
 *
 * No patient event is read from or written to Notion, and this function never
 * falls back to sample patients when protected configuration is unavailable.
 */

const { parseHL7ADT, parseDelimited } = require("./lib/adt");
const { getSession } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const method = event.httpMethod || "GET";
  const query = event.queryStringParameters || {};
  try {
    if (method === "POST") return await ingest(event);
    if (method !== "GET") return json(405, { ok: false, error: "GET or POST only" });
    const session = getSession(event);
    if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again" });
    if (query.action === "panel") return await panelCsv(query, session);
    return await adtFeed(session);
  } catch (error) {
    return json(error.status || 502, { ok: false, error: error.message || "CRISP Cloud request failed" });
  }
};

async function adtFeed(session) {
  const result = await cloudRequest("/v1/crisp-events", { actor: session });
  const snapshot = result.snapshot || { updatedAt: "", events: [] };
  return json(200, {
    ok: true,
    sampleMode: false,
    storage: "BHW Cloud",
    savedAt: snapshot.updatedAt || "",
    rosterSync: process.env.CRISP_ROSTER_SYNCED || "not-recorded",
    rows: Array.isArray(snapshot.events) ? snapshot.events : [],
  });
}

async function ingest(event) {
  if (!process.env.CRISP_INGEST_TOKEN) {
    return json(503, { ok: false, error: "CRISP ingest is not configured" });
  }
  const token = event.headers?.["x-crisp-token"] || event.headers?.["X-CRISP-Token"] || "";
  if (token !== process.env.CRISP_INGEST_TOKEN) {
    return json(401, { ok: false, error: "CRISP ingest authorization failed" });
  }
  const body = event.body || "";
  const normalized = body.trimStart().startsWith("MSH") ? parseHL7ADT(body) : parseDelimited(body);
  normalized.source = normalized.source || "CRISP ENS";
  normalized.receivedAt = new Date().toISOString();
  const result = await cloudRequest("/v1/crisp-events", {
    actor: { staffId: "crisp-ingest", name: "CRISP ENS", role: "system" },
    method: "POST",
    body: normalized,
  });
  return json(result.duplicate ? 200 : 201, {
    ok: true,
    duplicate: Boolean(result.duplicate),
    eventId: result.event?.id || "",
    savedAt: result.snapshot?.updatedAt || normalized.receivedAt,
    storage: "BHW Cloud",
  });
}

async function panelCsv(query, session) {
  const { buildCendRosterFile } = await import("../../engine/cend-roster.mjs");
  const patients = await listCloudPatients(session);
  const result = buildCendRosterFile(patients, { subscriberCode: query.subscriber || query.panelId || "" });
  if (!result.ok) {
    const messages = {
      "subscriber-required": "Enter the CRISP subscriber code supplied during CEND enrollment",
      "no-active-patients": "No active permanent patients are available for the CEND roster",
      "incomplete-demographics": `${result.incompleteCount} active patient records need complete demographics before export`,
    };
    return json(400, { ok: false, reason: result.reason, error: messages[result.reason] || "CEND roster could not be built" });
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
    body: result.csv,
  };
}
