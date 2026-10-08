// Admin-only health and routing map for the BHW Intel transition.
//
// Notion remains live only where CrewOS intentionally depends on it for
// staff/operations configuration and non-patient reference data. The three
// historical patient-bearing workflow databases are inspected for schema
// availability only; their rows are never read or copied here. Current patient
// work stays in the protected BHW Cloud.

const {
  DB,
  LEGACY_WORKFLOW_DB,
  httpJson,
  P,
  getSession,
  json,
} = require("./_lib");
const { cutoverStatus, queryOperational } = require("./lib/operational-store");

const NOTION = "https://api.notion.com/v1";
const MAX_NOTION_PAGES = 10;

const LEGACY_WORKFLOWS = Object.freeze([
  {
    key: "operations-dashboard",
    name: "Healthcare Operations Dashboard",
    databaseId: LEGACY_WORKFLOW_DB.operationsDashboard,
    requiredProperties: ["Task Name", "Status", "Priority", "Patient", "Assignee"],
    authority: "BHW Operations Cloud",
    service: "operations",
    description: "New operational work is managed as protected Patient Requests and queue activity.",
    actions: [
      { label: "Open Patient Requests", href: "/bhw-requests.html" },
      { label: "Open crewOS", href: "/crewos" },
    ],
  },
  {
    key: "care-plan-lab",
    name: "Care-plan and lab-analysis workflow",
    databaseId: LEGACY_WORKFLOW_DB.carePlanLab,
    requiredProperties: ["Care Plan", "Comprehensive Lab Analysis", "Analysis Status", "Patient"],
    authority: "Health 360 / BHW Health Core",
    service: "rcm",
    description: "Care plans are protected in Health 360. The lab preview remains synthetic until controlled production activation is verified.",
    actions: [
      { label: "Open Health 360", href: "https://rcm.bhwmedical.org/provider/health-blueprint.html", external: true },
      { label: "Open lab preview", href: "/provider/lab-dashboard.html" },
    ],
  },
  {
    key: "clinical-actions",
    name: "Clinical Action Items Tracker",
    databaseId: LEGACY_WORKFLOW_DB.clinicalActions,
    requiredProperties: ["Task", "Status", "Priority", "Patient Name", "Assigned To"],
    authority: "BHW Operations Cloud / Health Core",
    service: "operations",
    description: "Current action ownership is handled in Patient Requests and the protected clinical workflow queue.",
    actions: [
      { label: "Open Patient Requests", href: "/bhw-requests.html" },
      { label: "Open clinical workflow", href: "/provider/workflow.html" },
    ],
  },
]);

const LIVE_CONTROLS = Object.freeze([
  {
    key: "employee-codes",
    namespace: "staff",
    name: "Employee codes",
    databaseId: DB.staff,
    mode: "read/write",
    requiredProperties: ["Name", "Active", "Access Level", "PIN Hash"],
    action: { label: "Manage employee codes", href: "/setup.html" },
    summarize(rows) {
      const active = rows.filter((row) => P.check(row.properties?.Active));
      return {
        activeStaff: active.length,
        codesConfigured: active.filter((row) => P.text(row.properties?.["PIN Hash"])).length,
      };
    },
  },
  {
    key: "referral-templates",
    namespace: "referralTemplates",
    name: "Referral templates",
    databaseId: DB.referralTemplates,
    mode: "read/write",
    requiredProperties: ["Name", "Active", "Destination", "Body"],
    action: { label: "Create a referral", href: "/crewos" },
    summarize(rows) {
      return { activeTemplates: rows.filter((row) => P.check(row.properties?.Active)).length };
    },
  },
  {
    key: "room-rules",
    namespace: "rooms",
    name: "Rooms and room rules",
    databaseId: DB.rooms,
    mode: "read",
    requiredProperties: ["Room", "Active", "Allowed Services", "Capacity"],
    action: { label: "Open scheduling", href: "/crewos" },
    summarize(rows) {
      return { activeRooms: rows.filter((row) => P.check(row.properties?.Active)).length };
    },
  },
  {
    key: "staff-availability",
    namespace: "availability",
    name: "Staff availability",
    databaseId: DB.availability,
    mode: "read/write",
    requiredProperties: ["Entry", "Staff", "Date", "Start Time", "End Time", "Status"],
    action: { label: "Open My Space", href: "/crewos" },
    summarize(rows) {
      return { submittedEntries: rows.filter((row) => P.sel(row.properties?.Status) === "Submitted").length };
    },
  },
  {
    key: "shared-schedule",
    namespace: "schedule",
    name: "Shared room schedule",
    databaseId: DB.schedule,
    mode: "read/write",
    requiredProperties: ["Booking", "Staff", "Service Type", "Room", "Date", "Start Time", "End Time", "Division", "Status"],
    action: { label: "Open scheduling", href: "/crewos" },
    summarize(rows) {
      return { scheduledBookings: rows.filter((row) => P.sel(row.properties?.Status) === "Scheduled").length };
    },
  },
  {
    key: "staff-resources",
    namespace: "resources",
    name: "Staff resources",
    databaseId: DB.resources,
    mode: "read",
    requiredProperties: ["Resource", "Division", "Category", "Link", "Pinned"],
    action: { label: "Open resources", href: "/crewos" },
    summarize(rows) {
      return { linkedResources: rows.filter((row) => row.properties?.Link?.url).length };
    },
  },
  {
    key: "crew-projects",
    namespace: "crewProjects",
    name: "Crew projects",
    databaseId: DB.crewProjects,
    mode: "read",
    requiredProperties: ["Project", "Staff", "Status", "Due Date", "Summary"],
    action: { label: "Open My Space", href: "/crewos" },
    summarize(rows) {
      return { openProjects: rows.filter((row) => P.sel(row.properties?.Status) !== "Complete").length };
    },
  },
  {
    key: "specialist-directory",
    namespace: "specialistDirectory",
    name: "Specialist referral directory",
    databaseId: process.env.SPECIALIST_DB_ID || DB.specialistDirectory,
    mode: "read",
    requiredProperties: ["Specialist", "Specialty", "Phone", "Accepting New Patients"],
    action: { label: "Open Front Desk", href: "/bhw-front-desk.html" },
    summarize(rows) {
      return { directoryEntries: rows.filter((row) => P.title(row.properties?.Specialist)).length };
    },
  },
]);

function notionUrl(databaseId) {
  return `https://www.notion.so/${databaseId}`;
}

function safeApiBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function conciseError(error) {
  const message = String(error?.message || error || "Unavailable").replace(/\s+/g, " ").trim();
  return message.slice(0, 180);
}

async function inspectNotionSchema(definition, { httpJsonImpl = httpJson } = {}) {
  if (!process.env.NOTION_TOKEN) {
    return { state: "blocked", label: "Notion token missing", missingProperties: definition.requiredProperties };
  }
  try {
    const response = await httpJsonImpl("GET", `${NOTION}/databases/${definition.databaseId}`, undefined, { timeoutMs: 6000 });
    if (!response.ok) throw new Error(`Notion returned ${response.status}`);
    const available = new Set(Object.keys(response.data?.properties || {}));
    const missingProperties = definition.requiredProperties.filter((property) => !available.has(property));
    return {
      state: missingProperties.length ? "degraded" : "connected",
      label: missingProperties.length ? "Schema needs attention" : "Notion schema connected",
      missingProperties,
      propertyCount: available.size,
    };
  } catch (error) {
    return { state: "blocked", label: "Notion unavailable", missingProperties: [], error: conciseError(error) };
  }
}

async function readNotionRows(databaseId, { httpJsonImpl = httpJson } = {}) {
  const rows = [];
  let cursor;
  for (let page = 0; page < MAX_NOTION_PAGES; page += 1) {
    const response = await httpJsonImpl("POST", `${NOTION}/databases/${databaseId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    }, { timeoutMs: 8000 });
    if (!response.ok) throw new Error(`Notion returned ${response.status}`);
    rows.push(...(response.data?.results || []));
    if (!response.data?.has_more || !response.data?.next_cursor) return rows;
    cursor = response.data.next_cursor;
  }
  throw new Error("Notion result exceeded the status page safety limit");
}

async function inspectLiveControl(definition, dependencies = {}, cutover = { mode: "notion", sources: [] }) {
  if (cutover.mode === "database") {
    const source = cutover.sources.find((entry) => entry.namespace === definition.namespace);
    try {
      const rows = await queryOperational(definition.namespace, definition.databaseId, undefined, undefined, dependencies);
      const missingProperties = definition.requiredProperties.filter((property) => !source?.schemaProperties?.includes(property));
      return {
        key: definition.key,
        name: definition.name,
        source: "CrewHQ Database",
        mode: definition.mode,
        state: source?.verified && !missingProperties.length ? "connected" : "degraded",
        label: source?.verified && !missingProperties.length ? "CrewHQ database connected" : "Imported data needs attention",
        missingProperties,
        metrics: definition.summarize(rows),
        action: definition.action,
      };
    } catch (error) {
      return { key: definition.key, name: definition.name, source: "CrewHQ Database", mode: definition.mode, state: "blocked", label: "CrewHQ database unavailable", missingProperties: [], metrics: {}, error: conciseError(error), action: definition.action };
    }
  }
  const schema = await inspectNotionSchema(definition, dependencies);
  if (schema.state === "blocked") {
    return { key: definition.key, name: definition.name, source: "Notion", mode: definition.mode, ...schema, metrics: {}, action: definition.action, sourceHref: notionUrl(definition.databaseId) };
  }
  try {
    const rows = await readNotionRows(definition.databaseId, dependencies);
    return {
      key: definition.key,
      name: definition.name,
      source: "Notion",
      mode: definition.mode,
      ...schema,
      metrics: definition.summarize(rows),
      action: definition.action,
      sourceHref: notionUrl(definition.databaseId),
    };
  } catch (error) {
    return {
      key: definition.key,
      name: definition.name,
      source: "Notion",
      mode: definition.mode,
      state: "blocked",
      label: "Notion data unavailable",
      missingProperties: schema.missingProperties,
      metrics: {},
      error: conciseError(error),
      action: definition.action,
      sourceHref: notionUrl(definition.databaseId),
    };
  }
}

async function probeCloudService(key, baseValue, { fetchImpl = fetch } = {}) {
  const base = safeApiBase(baseValue);
  if (!base) return { key, state: "blocked", label: "Not configured" };
  try {
    const response = await fetchImpl(`${base}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(`Health check returned ${response.status}`);
    return {
      key,
      state: "connected",
      label: "Cloud service connected",
      service: String(body.service || key).slice(0, 80),
      mode: String(body.mode || "").slice(0, 80),
    };
  } catch (error) {
    return { key, state: "blocked", label: "Cloud service unavailable", error: conciseError(error) };
  }
}

function workflowState(service) {
  return service?.state === "connected" ? "active" : "degraded";
}

async function buildReport({ httpJsonImpl = httpJson, fetchImpl = fetch, now = () => new Date(), cutoverStatusImpl = cutoverStatus, operationalDependencies = {} } = {}) {
  const cutover = await cutoverStatusImpl();
  const [controls, legacySchemas, operations, rcm] = await Promise.all([
    Promise.all(LIVE_CONTROLS.map((definition) => inspectLiveControl(definition, { httpJsonImpl, ...operationalDependencies }, cutover))),
    cutover.mode === "database"
      ? Promise.resolve(LEGACY_WORKFLOWS.map(() => ({ state: "retired", label: "Notion runtime retired", missingProperties: [] })))
      : Promise.all(LEGACY_WORKFLOWS.map((definition) => inspectNotionSchema(definition, { httpJsonImpl }))),
    probeCloudService("operations", process.env.OPERATIONS_CLOUD_API_URL, { fetchImpl }),
    probeCloudService("rcm", process.env.RCM_CLOUD_API_URL, { fetchImpl }),
  ]);
  const services = { operations, rcm };
  const labProductionReady = process.env.LAB_INTELLIGENCE_PRODUCTION_READY === "true"
    && Boolean(safeApiBase(process.env.LAB_INTELLIGENCE_API_URL));
  const workflows = LEGACY_WORKFLOWS.map((definition, index) => ({
    key: definition.key,
    name: definition.name,
    state: workflowState(services[definition.service]),
    authority: definition.authority,
    description: definition.description,
    actions: definition.actions,
    legacySource: {
      ...legacySchemas[index],
      label: legacySchemas[index].state === "connected" ? "Legacy source verified — read-only" : legacySchemas[index].label,
      ...(cutover.mode === "database" ? {} : { sourceHref: notionUrl(definition.databaseId) }),
      rowsRead: false,
    },
    ...(definition.key === "care-plan-lab" ? {
      labActivation: {
        state: labProductionReady ? "active" : "limited",
        label: labProductionReady ? "Controlled production lab service configured" : "Synthetic preview only",
      },
    } : {}),
  }));
  const websiteContent = {
    key: "website-content",
    name: "Website content",
    source: "BHW Operations Cloud",
    state: workflowState(operations),
    label: operations.state === "connected" ? "Cloud publishing workflow connected" : "Cloud publishing workflow needs attention",
    action: { label: "Manage website content", href: "/bhw-website-content.html" },
  };
  const activeCount = controls.filter((item) => item.state === "connected").length;
  const cloudCount = Object.values(services).filter((item) => item.state === "connected").length;
  return {
    ok: activeCount === controls.length && cloudCount === Object.keys(services).length,
    generatedAt: now().toISOString(),
    summary: {
      activeOperationalControls: activeCount,
      totalOperationalControls: controls.length,
      connectedCloudServices: cloudCount,
      totalCloudServices: Object.keys(services).length,
    },
    boundary: {
      notion: cutover.mode === "database"
        ? "Disconnected from CrewOS runtime. Active controls are owned by the CrewHQ Database."
        : cutover.mode === "cutover"
          ? "Final verified snapshot in progress. Operational writes are paused until the CrewHQ Database cutover completes or safely rolls back."
          : "Temporary source for employee codes, referral templates, room rules, availability, scheduling, staff resources, crew projects, and specialist reference data until the verified cutover is finalized.",
      cloud: "Authoritative for patient operations, clinical actions, care plans, and website publishing.",
      lab: labProductionReady
        ? "Controlled production lab service is configured."
        : "Real-patient lab analysis is not activated; the visible lab dashboard is a synthetic contract preview.",
    },
    controls: [...controls, websiteContent],
    workflows,
    services,
    cutover,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });
  if (String(session.access || "").toLowerCase() !== "admin") {
    return json(403, { error: "Administrator access is required." });
  }
  try {
    return json(200, await buildReport());
  } catch (error) {
    return json(500, { error: conciseError(error) });
  }
};

exports._test = {
  LIVE_CONTROLS,
  LEGACY_WORKFLOWS,
  safeApiBase,
  inspectNotionSchema,
  readNotionRows,
  probeCloudService,
  buildReport,
};
