// Admin-only, sealed preview/apply migration for historical patient-linked
// operational records. Preview never writes. Apply is dataset-scoped,
// requires an unchanged preview and refuses partial migration when rows remain
// blocked, so retiring a legacy relation cannot silently orphan history.

const { getSession, json } = require("./_lib");
const { cloudRequest } = require("./lib/cloud-patients");
const { operationsRequest, createFrontDeskIntake, createFrontDeskIntakeBulk } = require("./lib/operations-cloud");
const { prepareIdentity, prepareMigration, publicPreview, sealIdentity, verifyIdentity, signPreview, verifyPreview } = require("./lib/patient-cloud-migration");

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

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function writeDataset(records, session) {
  const frontDesk = records.filter((record) => record.target.kind === "frontdesk");
  const standard = records.filter((record) => record.target.kind !== "frontdesk");
  const receipts = await mapLimit(standard, 4, (record) => writeRecord(record, session));
  if (!frontDesk.length) return receipts;

  const batches = await mapLimit(chunks(frontDesk, 300), 6, async (batch) => {
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
    const identity = verifyIdentity(body.identityToken, session, process.env.SESSION_SECRET);
    if (body.action === "preview") {
      const datasetKeys = [...new Set((Array.isArray(body.datasets) ? body.datasets : []).map((value) => String(value || "")).filter(Boolean))];
      if (!datasetKeys.length) return json(400, { error: "Choose at least one migration section to preview." });
      const prepared = await prepareMigration(session, datasetKeys, identity);
      if (Object.keys(prepared.datasets).length !== datasetKeys.length) return json(400, { error: "An unknown migration section was requested." });
      return json(200, {
        ok: true,
        previewOnly: true,
        preview: publicPreview(prepared),
        previewToken: signPreview(prepared, session, process.env.SESSION_SECRET),
        expiresInMinutes: 30,
        confirmation: CONFIRMATION,
      });
    }

    if (body.action === "apply") {
      const key = datasetKey;
      // Applying one approved section rereads only that legacy source and its
      // required dependency, then verifies it against the section preview.
      const prepared = await prepareMigration(session, [key], identity);
      const dataset = prepared.datasets[key];
      if (!dataset) return json(400, { error: "Choose a migration section." });
      if (body.confirmation !== CONFIRMATION) return json(400, { error: `Type ${CONFIRMATION} exactly.` });
      verifyPreview(body.previewToken, prepared, session, process.env.SESSION_SECRET, key);
      if (dataset.sourceError) return json(409, { error: "The legacy source could not be read. Nothing was changed." });
      if (dataset.blocked.length) return json(409, { error: `${dataset.blocked.length} record(s) still need a verified patient match. Nothing was changed.` });

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
      });
    }
    return json(400, { error: "Choose preview or apply." });
  } catch (error) {
    return json(Number(error.status) || 500, { ok: false, error: String(error.message || error) });
  }
};
