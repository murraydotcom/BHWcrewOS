// A production-scoped digest authorizes exactly one reviewed export body.
// Removing the digest disables this recovery endpoint.
const crypto = require("crypto");
const { DB, P, json } = require("./_lib");
const { getOperationalPool, recordsHash } = require("./lib/operational-store");
const { SOURCE_DEFINITIONS, sanitizePage } = require("./notion-cutover")._test;

function verifyRequest(event, expected = process.env.CREWOS_STAFF_RECOVERY_SHA256) {
  if (!/^[a-f0-9]{64}$/.test(expected || "")) {
    throw Object.assign(new Error("Staff export recovery is disabled."), { status: 503 });
  }
  const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected))) {
    throw Object.assign(new Error("This recovery file is not authorized."), { status: 403 });
  }
  const bundle = JSON.parse(body.toString("utf8"));
  if (bundle.format !== "crewos-staff-recovery-v1" || bundle.sourceDatabaseId !== DB.staff
    || !/^\d{4}-\d{2}-\d{2}$/.test(bundle.sourceDate) || !/^[a-f0-9]{64}$/.test(bundle.nonce)
    || !Array.isArray(bundle.pages) || !bundle.pages.length || bundle.pages.length > 200) {
    throw Object.assign(new Error("Invalid staff recovery file."), { status: 400 });
  }
  const pages = bundle.pages.map((page) => sanitizePage(page, SOURCE_DEFINITIONS.staff));
  const ids = new Set();
  let administrators = 0;
  for (const page of pages) {
    const p = page.properties;
    if (!/^[a-f0-9-]{32,36}$/.test(page.id || "") || ids.has(page.id) || !P.title(p.Name)
      || typeof p.Active?.checkbox !== "boolean" || typeof p["Can Schedule"]?.checkbox !== "boolean") {
      throw Object.assign(new Error("Invalid or duplicate staff record."), { status: 400 });
    }
    ids.add(page.id);
    const pin = P.text(p["PIN Hash"]);
    if (pin && !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(pin)) {
      throw Object.assign(new Error("Invalid saved staff credential."), { status: 400 });
    }
    if (P.check(p.Active) && P.sel(p["Access Level"]).toLowerCase() === "admin" && pin) administrators++;
  }
  if (!administrators) throw Object.assign(new Error("The export requires an active administrator with a saved PIN."), { status: 400 });
  return { pages, sourceDate: bundle.sourceDate, digest };
}

async function recoverStaff(bundle, dbPool) {
  const client = await dbPool.connect();
  const marker = `staff-export:${bundle.sourceDate}:${bundle.digest}`;
  try {
    await client.query("BEGIN");
    // Serialize recovery, normal staff edits, and the full cutover import.
    await client.query("LOCK TABLE crewos_cutover_state, crewos_operational_records, crewos_operational_sources IN SHARE ROW EXCLUSIVE MODE");
    const states = await client.query("SELECT state_key, mode, finalized_by FROM crewos_cutover_state WHERE state_key IN ($1, $2)", ["notion-exit", "staff-export-recovery"]);
    const state = states.rows.find((row) => row.state_key === "notion-exit");
    const recovery = states.rows.find((row) => row.state_key === "staff-export-recovery");
    if (recovery?.mode === "database" && recovery.finalized_by === marker) {
      await client.query("COMMIT");
      return { ok: true, alreadyRecovered: true, staffCount: bundle.pages.length, sourceDate: bundle.sourceDate };
    }
    if (state?.mode !== "notion" || recovery) {
      throw Object.assign(new Error("A different staff recovery or full cutover is already active. Review the database before proceeding."), { status: 409 });
    }
    const existing = await client.query("SELECT payload FROM crewos_operational_records WHERE namespace = $1", ["staff"]);
    const byId = new Map(bundle.pages.map((page) => [page.id, page]));
    if (existing.rows.some(({ payload }) => !byId.has(payload.id) || recordsHash([payload]) !== recordsHash([byId.get(payload.id)]))) {
      throw Object.assign(new Error("Stored staff records differ from the export. Review is required to preserve current accounts."), { status: 409 });
    }
    for (const page of bundle.pages) {
      await client.query("INSERT INTO crewos_operational_records (namespace, record_id, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (namespace, record_id) DO NOTHING", ["staff", page.id, JSON.stringify(page)]);
    }
    const readBack = await client.query("SELECT payload FROM crewos_operational_records WHERE namespace = $1", ["staff"]);
    if (readBack.rows.length !== bundle.pages.length || recordsHash(readBack.rows.map((row) => row.payload)) !== recordsHash(bundle.pages)) {
      throw new Error("Staff recovery failed transactional read-back verification.");
    }
    await client.query(
      `INSERT INTO crewos_operational_sources (namespace, source_database_id, source_count, imported_count, source_hash, schema_properties, imported_at, imported_by)
       VALUES ($1, $2, $3, $3, $4, $5::jsonb, NOW(), $6)
       ON CONFLICT (namespace) DO UPDATE SET source_database_id=EXCLUDED.source_database_id, source_count=EXCLUDED.source_count,
       imported_count=EXCLUDED.imported_count, source_hash=EXCLUDED.source_hash, schema_properties=EXCLUDED.schema_properties, imported_at=NOW(), imported_by=EXCLUDED.imported_by`,
      ["staff", DB.staff, bundle.pages.length, recordsHash(bundle.pages), JSON.stringify(SOURCE_DEFINITIONS.staff.properties), marker],
    );
    await client.query("INSERT INTO crewos_cutover_state (state_key, mode, finalized_at, finalized_by) VALUES ($1, 'database', NOW(), $2)", ["staff-export-recovery", marker]);
    await client.query("COMMIT");
    return { ok: true, staffCount: bundle.pages.length, sourceDate: bundle.sourceDate, staffAuthority: "CrewHQ Database", fullCutoverComplete: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  try {
    const bundle = verifyRequest(event);
    return json(200, await recoverStaff(bundle, await getOperationalPool()));
  } catch (error) {
    // Database errors can contain record values. Only deliberate safe messages leave the function.
    return json(Number(error.status) || 500, { error: error.status ? error.message : "Staff recovery could not complete. The transaction was rolled back." });
  }
};
exports._test = { verifyRequest, recoverStaff };
