// Admin-only, sealed preview/apply migration for historical patient-linked
// operational records. Preview never writes. Apply is dataset-scoped and
// writes only Cloud-verified rows; blocked rows remain in the legacy source and
// are reported as not saved so no unresolved history is silently orphaned.

const { getSession, json } = require("./_lib");
const { cloudRequest } = require("./lib/cloud-patients");
const { operationsRequest, createFrontDeskIntake, createFrontDeskIntakeBulk } = require("./lib/operations-cloud");
const { prepareIdentity, prepareMigration, publicPreview, sealIdentity, verifyIdentity, sealPreparedPreview, verifyPreparedPreview } = require("./lib/patient-cloud-migration");

const CONFIRMATION = "APPLY APPROVED CLOUD MIGRATION";

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function writeRecord(record, session) {
  const target = record.target;
  if (target.kind === "rcm") {
    const result = await cloudRequest(target.path, { actor: session, method: target.method, body: target.body });
    return { record, result, requestId: "" };
  }
  if (target.kind === "operations") {
    try {
      const result = await operationsRequest(target.path, { actor: session, method: target.method, body: target.body });
      return { record, result, requestId: result.request?.id || target.body.id || "" };
    } catch (error) {
      if (error.status !== 409) throw error;
      return { record, result: { replayed: true }, requestId: target.body.id };
    }
  }
  if (target.kind === "frontdesk") {
    const result = await createFrontDeskIntake({ submissionId: target.submissionId, body: target.body });
    if (!result) throw new Error("Front Desk Operations intake is not configured");
    return { record, result, requestId: result.patientRequest?.patientRequestId || result.patientRequest?.id || "" };
  }
  throw new Error("Unsupported migration target");
}

// Keep each protected batch below the smallest request gateway in the
// production path. The Operations API allows more, but its upstream ingress
// may enforce the standard 64 KiB body ceiling before that route is reached.
const FRONT_DESK_BULK_TARGET_BYTES = 48 * 1024;
const FRONT_DESK_BULK_MAX_RECORDS = 25;

function frontDeskBulkBody(records) {
  return {
    records: records.map((record) => ({
      submissionId: record.target.submissionId,
      body: record.target.body,
    })),
  };
}

function chunkFrontDeskRecords(records, { maxBytes = FRONT_DESK_BULK_TARGET_BYTES, maxRecords = FRONT_DESK_BULK_MAX_RECORDS } = {}) {
  const output = [];
  let batch = [];
  for (const record of records) {
    const candidate = [...batch, record];
    const tooMany = candidate.length > maxRecords;
    const tooLarge = Buffer.byteLength(JSON.stringify(frontDeskBulkBody(candidate)), "utf8") > maxBytes;
    if (!tooMany && !tooLarge) {
      batch = candidate;
      continue;
    }
    if (!batch.length) throw new Error("One approved Patient Request exceeds the protected Cloud migration size limit.");
    output.push(batch);
    batch = [record];
    if (Buffer.byteLength(JSON.stringify(frontDeskBulkBody(batch)), "utf8") > maxBytes) {
      throw new Error("One approved Patient Request exceeds the protected Cloud migration size limit.");
    }
  }
  if (batch.length) output.push(batch);
  return output;
}

function prepareApplyBatches(prepared, key) {
  const dataset = prepared.datasets[key];
  if (!dataset || !dataset.ready.length) return [];
  const readyBatches = key === "patientRequests" ? chunkFrontDeskRecords(dataset.ready) : [dataset.ready];
  return readyBatches.map((ready, batchIndex) => ({
    rosterCount: prepared.rosterCount,
    datasets: {
      [key]: {
        ...dataset,
        ready,
        blocked: [],
        blockedCount: dataset.blocked.length,
        applyBatchIndex: batchIndex,
        applyBatchCount: readyBatches.length,
      },
    },
  }));
}

async function writeDataset(records, session) {
  const frontDesk = records.filter((record) => record.target.kind === "frontdesk");
  const standard = records.filter((record) => record.target.kind !== "frontdesk");
  const receipts = await mapLimit(standard, 4, (record) => writeRecord(record, session));
  if (!frontDesk.length) return receipts;

  // Build every batch below the protected ingress ceiling before the first
  // write, with a count limit as a second guard for unusually small records.
  const batches = await mapLimit(chunkFrontDeskRecords(frontDesk), 6, async (batch) => {
    const result = await createFrontDeskIntakeBulk(batch.map((record) => record.target));
    if (!result || result.verifiedCount !== batch.length) {
      throw new Error(`BHW Cloud bulk read-back verified ${result?.verifiedCount || 0} of ${batch.length} Patient Requests.`);
    }
    return batch.map((record, index) => ({
      record,
      result: result.results[index],
      requestId: result.results[index]?.patientRequestId || "",
      verified: result.results[index]?.verified === true,
    }));
  });
  return receipts.concat(batches.flat());
}

function ids(rows, field = "id") {
  return new Set((rows || []).map((row) => row?.[field] || row?.id).filter(Boolean));
}

async function verifyReadback(key, records, receipts, session) {
  if (!records.length) return 0;
  if (key === "patientRequests") return receipts.filter((receipt) => receipt.verified).length;
  if (["referrals", "handoffs", "patientRequests"].includes(key)) {
    const checked = await mapLimit(receipts, 6, async (receipt) => {
      if (!receipt.requestId) return false;
      try {
        const result = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(receipt.requestId)}`, { actor: session });
        const request = result.request || result.patientRequest;
        return Boolean(request && (request.id === receipt.requestId || request.patientRequestId === receipt.requestId));
      } catch { return false; }
    });
    return checked.filter(Boolean).length;
  }

  let stored = new Set();
  if (["careLogs", "minutes"].includes(key)) stored = ids((await cloudRequest("/v1/care-management/logs", { actor: session })).logs);
  else if (key === "wellnessVisits") stored = ids((await cloudRequest("/v1/wellness-visits", { actor: session })).visits);
  else if (["charmedPeds", "charmedAdults"].includes(key)) stored = ids((await cloudRequest("/v1/charmed/assessments", { actor: session })).assessments);
  else if (key === "charmedPrograms") stored = ids((await cloudRequest("/v1/charmed/program-enrollments", { actor: session })).enrollments);
  else if (["programPlans", "porterCensus"].includes(key)) stored = ids((await cloudRequest("/v1/program-care-plans", { actor: session })).plans);
  else if (["prevention", "careGaps", "panelProfiles", "panelEvents"].includes(key)) {
    const panel = await cloudRequest("/v1/panel", { actor: session });
    stored = key === "panelEvents" ? ids(panel.events) : ids(panel.profiles, "bhwPatientId");
  } else if (["questionnaires", "screeners"].includes(key)) stored = ids((await cloudRequest("/v1/questionnaire-responses", { actor: session })).responses, "responseId");
  else if (key === "crispArchive") {
    const snapshot = (await cloudRequest("/v1/crisp-events", { actor: session })).snapshot;
    stored = ids(snapshot?.events);
    return receipts.filter((receipt) => stored.has(receipt.result?.event?.id)).length;
  }

  return records.filter((record) => {
    if (["prevention", "careGaps", "panelProfiles"].includes(key)) return stored.has(record.bhwPatientId);
    if (key === "porterCensus") return stored.has(record.target.body.id);
    if (["questionnaires", "screeners"].includes(key)) return stored.has(record.target.body.responseId);
    return stored.has(record.target.body.id || record.sourceId);
  }).length;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });
  if (String(session.access || "").toLowerCase() !== "admin") return json(403, { error: "Administrator access is required." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    if (body.action === "identity") {
      const identity = await prepareIdentity(session);
      return json(200, {
        ok: true,
        rosterCount: identity.roster.length,
        identityToken: sealIdentity(identity, session, process.env.SESSION_SECRET),
        expiresInMinutes: 30,
      });
    }

    const datasetKey = String(body.dataset || "");
    if (body.action === "preview") {
      const identity = verifyIdentity(body.identityToken, session, process.env.SESSION_SECRET);
      const datasetKeys = [...new Set((Array.isArray(body.datasets) ? body.datasets : []).map((value) => String(value || "")).filter(Boolean))];
      if (!datasetKeys.length) return json(400, { error: "Choose at least one migration section to preview." });
      const prepared = await prepareMigration(session, datasetKeys, identity);
      if (Object.keys(prepared.datasets).length !== datasetKeys.length) return json(400, { error: "An unknown migration section was requested." });
      const previewTokens = Object.fromEntries(datasetKeys.map((key) => [key,
        prepareApplyBatches(prepared, key).map((batch) => sealPreparedPreview(batch, session, process.env.SESSION_SECRET)),
      ]));
      return json(200, {
        ok: true,
        previewOnly: true,
        preview: publicPreview(prepared),
        // The exact approved write payload stays encrypted, authenticated,
        // session-bound, short-lived, and divided into ingress-safe batches.
        // Apply consumes these immutable seals instead of rereading a large
        // legacy source after approval.
        previewTokens,
        expiresInMinutes: 30,
        confirmation: CONFIRMATION,
      });
    }

    if (body.action === "apply") {
      const key = datasetKey;
      // Applying consumes the exact encrypted dataset shown during preview.
      // This prevents a slow legacy reread from timing out and also prevents
      // source changes from altering the administrator-approved write set.
      const prepared = verifyPreparedPreview(body.previewToken, session, process.env.SESSION_SECRET, key);
      const dataset = prepared.datasets[key];
      if (!dataset) return json(400, { error: "Choose a migration section." });
      if (body.confirmation !== CONFIRMATION) return json(400, { error: `Type ${CONFIRMATION} exactly.` });
      if (dataset.sourceError) return json(409, { error: "The legacy source could not be read. Nothing was changed." });
      if (!dataset.ready.length) return json(409, { error: "This section has no Cloud-verified records to save. Nothing was changed." });

      const receipts = await writeDataset(dataset.ready, session);
      const verifiedCount = await verifyReadback(key, dataset.ready, receipts, session);
      if (verifiedCount !== dataset.ready.length) {
        return json(502, { ok: false, error: `Cloud read-back verified ${verifiedCount} of ${dataset.ready.length} records. Stop and review before retrying.`, writtenCount: receipts.length, verifiedCount });
      }
      return json(200, {
        ok: true,
        storage: "BHW Cloud",
        dataset: key,
        savedAt: new Date().toISOString(),
        writtenCount: receipts.length,
        verifiedCount,
        blockedRemaining: Number.isFinite(dataset.blockedCount) ? dataset.blockedCount : dataset.blocked.length,
      });
    }
    return json(400, { error: "Choose preview or apply." });
  } catch (error) {
    return json(Number(error.status) || 500, { ok: false, error: String(error.message || error) });
  }
};

exports.chunkFrontDeskRecords = chunkFrontDeskRecords;
exports.prepareApplyBatches = prepareApplyBatches;
