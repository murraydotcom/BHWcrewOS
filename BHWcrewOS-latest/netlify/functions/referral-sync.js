const crypto = require("crypto");
const { configured, createReferral, updateReferral } = require("./lib/referral-cloud");

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const response = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return response(405, { ok: false, error: "POST only" });
  if (process.env.DASH_KEY && event.queryStringParameters?.key !== process.env.DASH_KEY) {
    return response(401, { ok: false, error: "unauthorized" });
  }
  if (!configured()) return response(503, { ok: false, error: "Front Desk referral tracking is not configured" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return response(400, { ok: false, error: "Bad JSON" }); }
  const action = clean(body.action, 40);
  const idempotencyKey = clean(body.idempotencyKey, 128) || `front-desk-referral:${crypto.randomUUID()}`;
  try {
    if (action === "create") {
      const bhwPatientId = clean(body.bhwPatientId, 16).toUpperCase();
      if (!/^BHW\d{4}$/.test(bhwPatientId)) return response(400, { ok: false, error: "Select a patient with a BHW ID before saving the referral" });
      const destination = clean(body.destination || body.specialty || "Specialty referral", 160);
      const result = await createReferral({
        idempotencyKey,
        body: {
          bhwPatientId,
          priority: ["low", "routine", "high", "urgent"].includes(body.priority) ? body.priority : "routine",
          summary: `Referral coordination · ${destination}`,
          message: "Front Desk generated a referral document. Clinical indication remains in the authorized clinical record.",
          requester: { displayName: "Front Desk OS", preferredChannel: "internal" },
          sourceMetadata: {
            sourceRecordId: idempotencyKey,
            sourcePage: "bhw-front-desk",
            referralDestination: destination,
            referralDocumentState: "generated",
          },
        },
      });
      const request = result?.patientRequest || result?.request || {};
      return response(result?.replayed ? 200 : 201, {
        ok: true,
        replayed: Boolean(result?.replayed),
        requestId: request.patientRequestId || request.id || "",
        version: Number(request.version) || 1,
        status: request.status || "referral_received",
        savedAt: new Date().toISOString(),
      });
    }
    if (action === "milestone") {
      const allowed = new Set(["referral_sent", "ready_to_schedule", "scheduled", "referral_completed", "closed_without_scheduling"]);
      const status = clean(body.status, 80).toLowerCase();
      if (!allowed.has(status)) return response(400, { ok: false, error: "unsupported referral milestone" });
      const result = await updateReferral({
        requestId: clean(body.requestId, 100),
        idempotencyKey,
        body: { action: status === "scheduled" || status === "closed_without_scheduling" ? "resolve" : "milestone", status, expectedVersion: Number(body.expectedVersion) || undefined },
      });
      const request = result?.request || result?.patientRequest || {};
      return response(200, { ok: true, requestId: request.id || request.patientRequestId || body.requestId, version: request.version, status: request.status, savedAt: new Date().toISOString() });
    }
    return response(400, { ok: false, error: "unsupported action" });
  } catch (error) {
    return response(error.status || 502, { ok: false, error: clean(error.message || "Referral tracking failed", 240) });
  }
};
