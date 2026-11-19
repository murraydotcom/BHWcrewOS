const crypto = require("crypto");
const { getSession, json } = require("./_lib");
const { recordsHash, getOperationalPool, operationalStateKey } = require("./lib/operational-store");
const { SOURCE_DEFINITIONS } = require("./notion-cutover")._test;
const { DEFINITIONS } = require("./lib/operational-controls");

const EXPECTED = { referralTemplates: 11, rooms: 14, resources: 32, specialistDirectory: 117 };
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const failure = (status, message) => Object.assign(new Error(message), { status });

function verifyBundle(raw, approvedDigest) {
  if (!/^[a-f0-9]{64}$/.test(approvedDigest || "")) throw failure(503, "Export import is disabled.");
  if (raw.length > 300_000) throw failure(413, "Export file is too large.");
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(approvedDigest))) {
    throw failure(403, "This export file has not been approved.");
  }
  const bundle = JSON.parse(raw.toString("utf8"));
  if (bundle.format !== "crewos-operational-export-v1" || bundle.sourceDate !== "2026-10-08"
    || !/^[a-f0-9]{64}$/.test(bundle.nonce) || !Array.isArray(bundle.controls)
    || bundle.controls.length !== Object.keys(EXPECTED).length) {
    throw failure(400, "Unexpected operational export format.");
  }
  const namespaces = new Set();
  for (const control of bundle.controls) {
    const key = control.namespace;
    if (!Object.hasOwn(EXPECTED, key) || namespaces.has(key)
      || control.sourceDatabaseId !== SOURCE_DEFINITIONS[key].databaseId
      || !Array.isArray(control.pages) || control.pages.length !== EXPECTED[key]) {
      throw failure(400, "Unexpected source, duplicate control or record count.");
    }
    namespaces.add(key);
    const ids = new Set();
    const fields = DEFINITIONS[key].fields;
    const validFields = new Set(fields.map(([name]) => name));
    for (const page of control.pages) {
      const properties = page.properties;
      if (!UUID.test(page.id || "") || ids.has(page.id) || !properties
        || Object.keys(properties).length !== validFields.size
        || Object.keys(properties).some(name => !validFields.has(name))) {
        throw failure(400, "Invalid or duplicate operational record.");
      }
      ids.add(page.id);
      for (const [name, type] of fields) {
        if (!Object.hasOwn(properties[name] || {}, type)) throw failure(400, "Unexpected operational property type.");
        const value = properties[name][type];
        if (type === "title" && !value?.some?.(part => part.plain_text?.trim())) throw failure(400, "A record is missing its title.");
        if (type === "url" && !/^https:\/\//i.test(value || "")) throw failure(400, "An exported link must use HTTPS.");
      }
    }
  }
  return { ...bundle, digest };
}

async function importBundle(bundle, actor, dbPool) {
  const client = await dbPool.connect();
  const marker = ["operational-export", bundle.sourceDate, bundle.digest].join(":");
  try {
    await client.query("BEGIN");
    const global = await client.query("SELECT mode FROM crewos_cutover_state WHERE state_key = $1 FOR UPDATE", ["notion-exit"]);
    if (global.rows[0]?.mode !== "notion") throw failure(409, "An active or completed full cutover must be reviewed first.");
    const results = [];
    for (const { namespace, sourceDatabaseId, pages } of bundle.controls) {
      const sourceKey = operationalStateKey(namespace);
      const prior = await client.query("SELECT mode, finalized_by FROM crewos_cutover_state WHERE state_key = $1", [sourceKey]);
      if (prior.rows[0]?.mode === "database" && prior.rows[0]?.finalized_by === marker) {
        results.push({ namespace, recordCount: pages.length, alreadyImported: true });
        continue;
      }
      const existing = await client.query("SELECT 1 FROM crewos_operational_records WHERE namespace = $1 LIMIT 1", [namespace]);
      if (prior.rows.length || existing.rows.length) throw failure(409, "Existing operational records require reconciliation before import.");

      await client.query(
        "INSERT INTO crewos_operational_records (namespace, record_id, payload) SELECT $1, page->>'id', page FROM jsonb_array_elements($2::jsonb) AS page",
        [namespace, JSON.stringify(pages.map(({ id, properties }) => ({ id, properties })))],
      );
      const stored = await client.query("SELECT payload FROM crewos_operational_records WHERE namespace = $1", [namespace]);
      const contentHash = recordsHash(pages);
      if (stored.rows.length !== pages.length || recordsHash(stored.rows.map(row => row.payload)) !== contentHash) {
        throw new Error("Operational export read-back failed.");
      }
      await client.query(
        "INSERT INTO crewos_operational_sources (namespace, source_database_id, source_count, imported_count, source_hash, schema_properties, imported_at, imported_by) VALUES ($1, $2, $3, $3, $4, $5::jsonb, NOW(), $6)",
        [namespace, sourceDatabaseId, pages.length, contentHash, JSON.stringify(SOURCE_DEFINITIONS[namespace].properties), actor],
      );
      await client.query(
        "INSERT INTO crewos_cutover_state (state_key, mode, finalized_at, finalized_by) VALUES ($1, 'database', NOW(), $2)",
        [sourceKey, marker],
      );
      results.push({ namespace, recordCount: pages.length, alreadyImported: false });
    }
    await client.query("COMMIT");
    return { ok: true, sourceDate: bundle.sourceDate, controls: results };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });
  if (session.access !== "Admin" || !session.staffId) return json(403, { error: "Administrator access is required." });
  const raw = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
  try {
    const bundle = verifyBundle(raw, process.env.CREWOS_OPERATIONAL_EXPORT_SHA256);
    return json(200, await importBundle(bundle, session.staffId, await getOperationalPool()));
  } catch (error) {
    return json(Number(error.status) || 500, {
      error: error.status ? error.message : "Operational export could not be verified and imported.",
    });
  }
};
exports._test = { verifyBundle, importBundle, EXPECTED };
