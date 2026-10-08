// One-time, Admin-only migration of CrewOS's remaining operational Notion
// dependencies into the transactional Netlify Database. Import is namespace-
// scoped and read-back verified. Finalize is blocked until every namespace has
// a verified snapshot; after finalization runtime code no longer calls Notion.

const {
  DB,
  httpJson,
  queryDb,
  getSession,
  json,
} = require("./_lib");
const {
  cutoverStatus,
  beginCutover,
  abortCutover,
  replaceNamespace,
  finalizeCutover,
} = require("./lib/operational-store");

const NOTION = "https://api.notion.com/v1";
const IMPORT_CONFIRMATION = "IMPORT NOTION CONTROLS";
const FINALIZE_CONFIRMATION = "DISCONNECT NOTION";

const SOURCE_DEFINITIONS = Object.freeze({
  staff: {
    label: "Employee codes",
    databaseId: DB.staff,
    properties: ["Name", "Role", "Divisions", "Landing Page", "Access Level", "Can Schedule", "Active", "PIN Hash"],
  },
  referralTemplates: {
    label: "Referral templates",
    databaseId: DB.referralTemplates,
    properties: ["Name", "Destination", "Type", "Body", "Priority", "Needed By", "Sort", "Active"],
  },
  rooms: {
    label: "Rooms and room rules",
    databaseId: DB.rooms,
    properties: ["Room", "Allowed Services", "Capacity", "Active", "Equipment", "Floor", "Notes"],
  },
  availability: {
    label: "Staff availability",
    databaseId: DB.availability,
    properties: ["Entry", "Staff", "Date", "Start Time", "End Time", "Recurring", "Notes", "Status"],
  },
  schedule: {
    label: "Shared room schedule",
    databaseId: DB.schedule,
    properties: ["Booking", "Staff", "Service Type", "Room", "Date", "Start Time", "End Time", "Division", "Notes", "Status"],
  },
  resources: {
    label: "Staff resources",
    databaseId: DB.resources,
    properties: ["Resource", "Division", "Category", "Link", "Notes", "Pinned"],
  },
  crewProjects: {
    label: "Crew projects",
    databaseId: DB.crewProjects,
    properties: ["Project", "Staff", "Status", "Due Date", "Summary"],
  },
  specialistDirectory: {
    label: "Specialist referral directory",
    databaseId: process.env.SPECIALIST_DB_ID || DB.specialistDirectory,
    properties: ["Specialist", "Specialty", "Practice / Institution", "Address", "Phone", "Fax", "Networks Accepted", "⭐ Preferred", "Accepting New Patients", "Typical Wait", "Notes"],
  },
});

function sanitizePage(page, definition) {
  return {
    id: page.id,
    properties: Object.fromEntries(definition.properties
      .filter((name) => Object.hasOwn(page.properties || {}, name))
      .map((name) => [name, page.properties[name]])),
  };
}

async function importSource(key, session, dependencies = {}) {
  const definition = SOURCE_DEFINITIONS[key];
  if (!definition) throw Object.assign(new Error("Unknown Notion control"), { status: 400 });
  if (!process.env.NOTION_TOKEN) throw Object.assign(new Error("NOTION_TOKEN is unavailable; reconnect Notion long enough to run the verified import"), { status: 503 });
  const httpJsonImpl = dependencies.httpJsonImpl || httpJson;
  const queryDbImpl = dependencies.queryDbImpl || queryDb;
  const [metadata, sourcePages] = await Promise.all([
    httpJsonImpl("GET", `${NOTION}/databases/${definition.databaseId}`, undefined, { timeoutMs: 8000 }),
    queryDbImpl(definition.databaseId),
  ]);
  if (!metadata.ok) throw Object.assign(new Error(`Notion schema check failed (${metadata.status})`), { status: 502 });
  const schemaProperties = Object.keys(metadata.data?.properties || {});
  const missing = definition.properties.filter((property) => !schemaProperties.includes(property));
  if (missing.length) throw Object.assign(new Error(`${definition.label} is missing required properties: ${missing.join(", ")}`), { status: 409 });
  const pages = sourcePages.map((page) => sanitizePage(page, definition));
  return replaceNamespace(key, pages, {
    sourceDatabaseId: definition.databaseId,
    schemaProperties,
    importedBy: session.staffId || session.name,
    ...(dependencies.pool ? { pool: dependencies.pool } : {}),
  });
}

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });
  if (String(session.access || "").toLowerCase() !== "admin") return json(403, { error: "Administrator access is required." });

  try {
    if (event.httpMethod === "GET") return json(200, { ok: true, ...(await cutoverStatus()) });
    if (event.httpMethod !== "POST") return json(405, { error: "GET or POST only" });
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

    if (body.action === "import") {
      if (body.confirmation !== IMPORT_CONFIRMATION) return json(400, { error: `Type ${IMPORT_CONFIRMATION} to begin the protected import.` });
      const current = await cutoverStatus();
      if (current.mode === "database") return json(409, { error: "The Notion exit is already finalized." });
      const result = await importSource(String(body.namespace || ""), session);
      return json(200, { ok: true, result, status: await cutoverStatus() });
    }

    if (body.action === "begin") {
      if (body.confirmation !== FINALIZE_CONFIRMATION) return json(400, { error: `Type ${FINALIZE_CONFIRMATION} to pause writes and begin the final verified cutover.` });
      const status = await beginCutover(session.staffId || session.name);
      return json(200, { ok: true, status });
    }

    if (body.action === "finalize") {
      if (body.confirmation !== FINALIZE_CONFIRMATION) return json(400, { error: `Type ${FINALIZE_CONFIRMATION} to finalize the cutover.` });
      const status = await finalizeCutover(session.staffId || session.name);
      return json(200, { ok: true, status, notionRuntimeAccess: false });
    }

    if (body.action === "abort") {
      if (body.confirmation !== FINALIZE_CONFIRMATION) return json(400, { error: `Type ${FINALIZE_CONFIRMATION} to release a paused cutover.` });
      const status = await abortCutover();
      return json(200, { ok: true, status });
    }

    return json(400, { error: "Unknown cutover action" });
  } catch (error) {
    return json(Number(error.status) || 500, { error: String(error.message || error).slice(0, 400) });
  }
};

exports._test = { SOURCE_DEFINITIONS, sanitizePage, importSource, IMPORT_CONFIRMATION, FINALIZE_CONFIRMATION };
