// Admin-only CrewOS handoff for the reserved BHW0000 acceptance record.
// Real-patient batch rows are never accepted by this function.

const { getSession, json } = require("./_lib");
const { cloudRequest } = require("./lib/cloud-patients");

const CARE_CODES = new Set(["G0556", "G0557", "G0558", "G0570", "G0568", "G0569"]);
const APCM_CODES = new Set(["G0556", "G0557", "G0558"]);
const BHI_CODES = new Set(["G0570", "G0568", "G0569"]);

function clean(value, max = 100) {
  return String(value || "").trim().slice(0, max);
}

function inspectSyntheticEncounter(encounter = {}) {
  const invoice = encounter.invoiceDraft || {};
  const codes = [].concat(invoice.serviceLines || []).map((line) => clean(line?.cpt || line?.code, 32).toUpperCase()).filter(Boolean);
  const blockers = [];
  if (encounter.bhwPatientId !== "BHW0000") blockers.push("The RCM encounter must use reserved synthetic patient BHW0000.");
  if (invoice.claimReadinessStatus !== "claimable" || invoice.releaseStatus !== "claimable") blockers.push("The exact synthetic invoice must be authorized claimable in RCM.");
  if (invoice.claimStatus !== "not_created" || invoice.transmissionStatus !== "blocked") blockers.push("The invoice must still be not created with transmission blocked.");
  if (!codes.some((code) => APCM_CODES.has(code))) blockers.push("The synthetic invoice must include an APCM base line (G0556, G0557, or G0558).");
  if (!codes.some((code) => BHI_CODES.has(code))) blockers.push("The synthetic invoice must include a BHI or CoCM add-on line (G0570, G0568, or G0569).");
  if (codes.some((code) => !CARE_CODES.has(code))) blockers.push("The CrewOS APCM/BHI handoff accepts only reviewed APCM, BHI, and CoCM acceptance codes.");
  if (encounter.syntheticProfessionalClaim?.status === "created_not_transmitted") blockers.push("A synthetic professional claim already exists for this invoice.");
  return {
    ok: blockers.length === 0,
    blockers,
    encounterId: clean(encounter.id || encounter.encounterId),
    bhwPatientId: clean(encounter.bhwPatientId, 20),
    invoiceId: clean(invoice.invoiceId, 40),
    codes,
    updatedAt: clean(encounter.updatedAt, 40),
    transmissionStatus: "blocked",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Authentication required" });
  if (session.access !== "Admin") return json(403, { ok: false, error: "Administrator access is required for synthetic claim acceptance" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Bad JSON" }); }
  const action = body.action === "create" ? "create" : "preflight";
  const encounterId = clean(body.encounterId);
  if (!/^ENC-[A-Za-z0-9._-]{4,96}$/.test(encounterId)) return json(400, { ok: false, error: "A valid synthetic RCM encounter ID is required" });
  const actor = { ...session, role: "admin" };
  try {
    const current = await cloudRequest(`/v1/encounters/${encodeURIComponent(encounterId)}`, { actor });
    const preflight = inspectSyntheticEncounter(current.encounter || {});
    if (!preflight.ok || action === "preflight") return json(preflight.ok ? 200 : 409, { ok: preflight.ok, preflight });
    const created = await cloudRequest(`/v1/encounters/${encodeURIComponent(encounterId)}/synthetic-claim`, {
      actor,
      method: "POST",
      body: { expectedUpdatedAt: preflight.updatedAt },
    });
    if (created?.claim?.status !== "created_not_transmitted" || created?.claim?.transmissionStatus !== "blocked") {
      return json(502, { ok: false, error: "RCM did not return a blocked synthetic claim read-back" });
    }
    return json(201, {
      ok: true,
      claim: {
        encounterId,
        invoiceId: created.claim.invoiceId,
        claimControlNumber: created.claim.claimControlNumber,
        status: created.claim.status,
        validationStatus: created.claim.validation?.status || "not_run",
        transmissionStatus: "blocked",
      },
      message: "Synthetic APCM/BHI claim created in RCM. Open RCM to run Stedi validation-only processing.",
    });
  } catch (error) {
    return json(error.status || 500, {
      ok: false,
      error: error.message || "Synthetic RCM handoff failed",
      ...(Array.isArray(error.details?.details) ? { details: error.details.details } : {}),
    });
  }
};

exports._test = { inspectSyntheticEncounter };
