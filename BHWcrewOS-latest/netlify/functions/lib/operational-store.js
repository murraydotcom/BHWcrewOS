const crypto = require("crypto");
const { queryDb, createPage, updatePage, P } = require("../_lib");

const REQUIRED_NAMESPACES = Object.freeze([
  "staff",
  "referralTemplates",
  "rooms",
  "availability",
  "schedule",
  "resources",
  "crewProjects",
  "specialistDirectory",
]);
const ALLOWED_NAMESPACES = new Set(REQUIRED_NAMESPACES);
let databasePromise;

function namespace(value) {
  const key = String(value || "");
  if (!ALLOWED_NAMESPACES.has(key)) throw new Error("Unsupported CrewOS operational namespace");
  return key;
}

async function getDatabaseClient() {
  if (!databasePromise) {
    databasePromise = import("@netlify/database").then(({ getDatabase }) => getDatabase(
      process.env.NETLIFY_DB_URL ? { connectionString: process.env.NETLIFY_DB_URL } : undefined,
    ));
  }
  return databasePromise;
}

async function pool(dependencies = {}) {
  if (dependencies.pool) return dependencies.pool;
  return (await getDatabaseClient()).pool;
}

async function cutoverMode(dependencies = {}) {
  const result = await (await pool(dependencies)).query(
    "SELECT mode FROM crewos_cutover_state WHERE state_key = $1",
    ["notion-exit"],
  );
  const mode = result.rows[0]?.mode;
  return ["notion", "cutover", "database"].includes(mode) ? mode : "notion";
}

function cutoverInProgressError() {
  return Object.assign(new Error("The protected Notion cutover is in progress. Operational writes will resume as soon as verification finishes."), { status: 503 });
}

function propertyValue(property) {
  if (property?.select) return property.select.name || "";
  if (property?.status) return property.status.name || "";
  if (property?.date) return property.date.start || "";
  if (property?.checkbox !== undefined) return Boolean(property.checkbox);
  return P.title(property) || P.text(property);
}

function matchesFilter(page, filter) {
  if (!filter) return true;
  if (Array.isArray(filter.and)) return filter.and.every((entry) => matchesFilter(page, entry));
  if (Array.isArray(filter.or)) return filter.or.some((entry) => matchesFilter(page, entry));
  const property = page?.properties?.[filter.property];
  if (filter.date?.equals !== undefined) return propertyValue(property) === filter.date.equals;
  if (filter.select?.equals !== undefined) return propertyValue(property) === filter.select.equals;
  if (filter.status?.equals !== undefined) return propertyValue(property) === filter.status.equals;
  if (filter.checkbox?.equals !== undefined) return propertyValue(property) === filter.checkbox.equals;
  return false;
}

async function listDatabasePages(key, filter, dependencies = {}) {
  const result = await (await pool(dependencies)).query(
    "SELECT payload FROM crewos_operational_records WHERE namespace = $1 ORDER BY created_at, record_id",
    [namespace(key)],
  );
  return result.rows.map((row) => row.payload).filter((page) => matchesFilter(page, filter));
}

async function queryOperational(key, notionDatabaseId, filter, sorts, dependencies = {}) {
  const mode = await cutoverMode(dependencies);
  if (mode === "database") return listDatabasePages(key, filter, dependencies);
  const queryDbImpl = dependencies.queryDbImpl || queryDb;
  return queryDbImpl(notionDatabaseId, filter, sorts);
}

async function insertDatabasePage(key, page, dependencies = {}) {
  await (await pool(dependencies)).query(
    `INSERT INTO crewos_operational_records (namespace, record_id, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (namespace, record_id) DO UPDATE
       SET payload = EXCLUDED.payload, version = crewos_operational_records.version + 1, updated_at = NOW()`,
    [namespace(key), page.id, JSON.stringify(page)],
  );
  return page;
}

async function createOperationalPage(key, notionDatabaseId, properties, dependencies = {}) {
  const mode = await cutoverMode(dependencies);
  if (mode === "cutover") throw cutoverInProgressError();
  if (mode !== "database") {
    const createPageImpl = dependencies.createPageImpl || createPage;
    return createPageImpl(notionDatabaseId, properties);
  }
  return insertDatabasePage(key, { id: `crew-${crypto.randomUUID()}`, properties }, dependencies);
}

async function updateDatabasePage(key, pageId, properties, dependencies = {}) {
  const dbPool = await pool(dependencies);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT payload FROM crewos_operational_records WHERE namespace = $1 AND record_id = $2 FOR UPDATE",
      [namespace(key), pageId],
    );
    if (!current.rows[0]) throw Object.assign(new Error("CrewOS operational record was not found"), { status: 404 });
    const page = current.rows[0].payload;
    const updated = { ...page, properties: { ...(page.properties || {}), ...properties } };
    await client.query(
      `UPDATE crewos_operational_records
       SET payload = $3::jsonb, version = version + 1, updated_at = NOW()
       WHERE namespace = $1 AND record_id = $2`,
      [namespace(key), pageId, JSON.stringify(updated)],
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateOperationalPage(key, pageId, properties, dependencies = {}) {
  const mode = await cutoverMode(dependencies);
  if (mode === "cutover") throw cutoverInProgressError();
  if (mode !== "database") {
    const updatePageImpl = dependencies.updatePageImpl || updatePage;
    return updatePageImpl(pageId, properties);
  }
  return updateDatabasePage(key, pageId, properties, dependencies);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function recordsHash(records) {
  return stableHash(records
    .map((page) => ({ id: page.id, properties: page.properties }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

async function replaceNamespace(key, pages, {
  sourceDatabaseId,
  schemaProperties = [],
  importedBy,
  ...dependencies
} = {}) {
  const checked = namespace(key);
  const records = Array.isArray(pages) ? pages : [];
  if (records.some((page) => !page?.id || !page?.properties)) throw new Error("Every imported CrewOS record requires an ID and properties");
  const dbPool = await pool(dependencies);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM crewos_operational_records WHERE namespace = $1", [checked]);
    for (const page of records) {
      await client.query(
        "INSERT INTO crewos_operational_records (namespace, record_id, payload) VALUES ($1, $2, $3::jsonb)",
        [checked, page.id, JSON.stringify({ id: page.id, properties: page.properties })],
      );
    }
    await client.query(
      `INSERT INTO crewos_operational_sources
        (namespace, source_database_id, source_count, imported_count, source_hash, schema_properties, imported_at, imported_by)
       VALUES ($1, $2, $3, $3, $4, $5::jsonb, NOW(), $6)
       ON CONFLICT (namespace) DO UPDATE SET
         source_database_id = EXCLUDED.source_database_id,
         source_count = EXCLUDED.source_count,
         imported_count = EXCLUDED.imported_count,
         source_hash = EXCLUDED.source_hash,
         schema_properties = EXCLUDED.schema_properties,
         imported_at = EXCLUDED.imported_at,
         imported_by = EXCLUDED.imported_by`,
      [checked, sourceDatabaseId, records.length, recordsHash(records), JSON.stringify(schemaProperties), importedBy],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const verification = await (await pool(dependencies)).query(
    "SELECT payload FROM crewos_operational_records WHERE namespace = $1 ORDER BY record_id",
    [checked],
  );
  const importedRecords = verification.rows.map((row) => row.payload);
  const importedCount = importedRecords.length;
  if (importedCount !== records.length) throw new Error(`CrewOS imported ${importedCount} of ${records.length} ${checked} records`);
  if (recordsHash(importedRecords) !== recordsHash(records)) throw new Error(`CrewOS ${checked} records failed content verification`);
  return { namespace: checked, sourceCount: records.length, importedCount, verified: true, contentVerified: true };
}

async function cutoverStatus(dependencies = {}) {
  const dbPool = await pool(dependencies);
  const [state, sources] = await Promise.all([
    dbPool.query("SELECT mode, cutover_started_at, finalized_at, finalized_by FROM crewos_cutover_state WHERE state_key = $1", ["notion-exit"]),
    dbPool.query("SELECT namespace, source_count, imported_count, schema_properties, imported_at FROM crewos_operational_sources ORDER BY namespace"),
  ]);
  const sourceByKey = Object.fromEntries(sources.rows.map((row) => [row.namespace, {
    namespace: row.namespace,
    sourceCount: Number(row.source_count),
    importedCount: Number(row.imported_count),
    importedAt: row.imported_at,
    schemaProperties: Array.isArray(row.schema_properties) ? row.schema_properties : [],
    verified: Number(row.source_count) === Number(row.imported_count),
  }]));
  const stateMode = ["notion", "cutover", "database"].includes(state.rows[0]?.mode) ? state.rows[0].mode : "notion";
  const startedAt = state.rows[0]?.cutover_started_at || null;
  const freshForLockedSnapshot = (source) => stateMode !== "cutover"
    || (startedAt && source?.importedAt && new Date(source.importedAt).getTime() >= new Date(startedAt).getTime());
  const complete = REQUIRED_NAMESPACES.every((key) => sourceByKey[key]?.verified && freshForLockedSnapshot(sourceByKey[key]));
  const reportedSources = REQUIRED_NAMESPACES.map((key) => {
    const source = sourceByKey[key] || { namespace: key, sourceCount: null, importedCount: null, schemaProperties: [], importedAt: null, verified: false };
    return { ...source, verified: Boolean(source.verified && freshForLockedSnapshot(source)) };
  });
  return {
    mode: stateMode,
    cutoverStartedAt: startedAt,
    finalizedAt: state.rows[0]?.finalized_at || null,
    finalizedBy: state.rows[0]?.finalized_by || "",
    complete,
    sources: reportedSources,
  };
}

async function beginCutover(actor, dependencies = {}) {
  const result = await (await pool(dependencies)).query(
    `UPDATE crewos_cutover_state
     SET mode = 'cutover',
         cutover_started_at = CASE WHEN mode = 'notion' THEN NOW() ELSE cutover_started_at END,
         finalized_by = $2,
         updated_at = NOW()
     WHERE state_key = $1 AND mode IN ('notion', 'cutover')
     RETURNING mode`,
    ["notion-exit", String(actor || "CrewOS administrator").slice(0, 160)],
  );
  if (!result.rows[0]) throw Object.assign(new Error("The Notion exit is already finalized"), { status: 409 });
  return cutoverStatus(dependencies);
}

async function abortCutover(dependencies = {}) {
  await (await pool(dependencies)).query(
    `UPDATE crewos_cutover_state
     SET mode = 'notion', cutover_started_at = NULL, finalized_by = NULL, updated_at = NOW()
     WHERE state_key = $1 AND mode = 'cutover'`,
    ["notion-exit"],
  );
  return cutoverStatus(dependencies);
}

async function finalizeCutover(actor, dependencies = {}) {
  const status = await cutoverStatus(dependencies);
  if (status.mode !== "cutover") throw Object.assign(new Error("Start the protected cutover before finalizing the Notion exit"), { status: 409 });
  if (!status.complete) throw Object.assign(new Error("Import and verify every Notion control before finalizing the exit"), { status: 409 });
  await (await pool(dependencies)).query(
    `UPDATE crewos_cutover_state
     SET mode = 'database', finalized_at = NOW(), finalized_by = $2, updated_at = NOW()
     WHERE state_key = $1`,
    ["notion-exit", String(actor || "CrewOS administrator").slice(0, 160)],
  );
  return cutoverStatus(dependencies);
}

module.exports = {
  REQUIRED_NAMESPACES,
  cutoverMode,
  cutoverStatus,
  beginCutover,
  abortCutover,
  finalizeCutover,
  queryOperational,
  createOperationalPage,
  updateOperationalPage,
  replaceNamespace,
  matchesFilter,
  stableHash,
  recordsHash,
  canonicalJson,
  _resetDatabaseForTests: () => { databasePromise = undefined; },
};
