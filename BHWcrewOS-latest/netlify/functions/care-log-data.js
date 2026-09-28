// Protected read side for the Care Management board. The Google Cloud Patient
// Registry owns patient identity; the RCM Cloud API owns care-management logs.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const { operationsRequest } = require("./lib/operations-cloud");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if ((body.action || "list") !== "list") return json(400, { error: "Unknown action" });

  try {
    const params = new URLSearchParams();
    const program = String(body.program || "").trim();
    const month = String(body.month || "").trim();
    if (program && program !== "All") params.set("program", program);
    if (/^\d{4}-\d{2}$/.test(month)) params.set("month", month);
    const suffix = params.toString() ? `?${params}` : "";
    const [result, roster, activityResult] = await Promise.all([
      cloudRequest(`/v1/care-management/logs${suffix}`, { actor: session }),
      listCloudPatients(session),
      Promise.all([
        operationsRequest("/v1/patient-requests?source=care-connect&limit=100", { actor: session }),
        operationsRequest("/v1/patient-requests?source=patient-medication-html&limit=100", { actor: session }),
        operationsRequest("/v1/patient-requests?source=patient-content-html&limit=100", { actor: session }),
      ]).then((responses) => ({
        requests: responses.flatMap((response) => response.requests || response.patientRequests || []),
        warning: "",
      })).catch((error) => ({ requests: [], warning: String(error.message || error) })),
    ]);
    const byId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
    const entries = (Array.isArray(result.logs) ? result.logs : []).map((log) => {
      const patient = byId.get(log.bhwPatientId);
      return {
        ...log,
        month: log.serviceMonth || "",
        ctlNo: log.bhwPatientId,
        patientId: log.bhwPatientId,
        entry: log.entry || patient?.name || log.bhwPatientId,
        memberId: patient?.memberId || log.memberId || "",
        payer: patient?.payer || "",
        rosterLinked: Boolean(patient),
        edited: log.updatedAt || "",
      };
    });
    const activityById = new Map();
    for (const request of activityResult.requests) {
      if (request.source === "care-connect" && request.requestType !== "clinical_review") continue;
      const occurredAt = request.receivedAt || request.createdAt || request.updatedAt || "";
      if (/^\d{4}-\d{2}$/.test(month) && !String(occurredAt).startsWith(month)) continue;
      const patient = byId.get(request.bhwPatientId);
      activityById.set(request.id, {
        id: request.id,
        bhwPatientId: request.bhwPatientId,
        patientName: patient?.name || request.patientName || request.bhwPatientId,
        source: request.source,
        sourceLabel: request.source === "patient-medication-html" ? "Medication request"
          : request.source === "care-connect" ? "Patient check-in" : "Patient form response",
        status: request.statusLabel || String(request.status || "received").replaceAll("_", " "),
        statusCategory: request.statusCategory || "received",
        priority: request.priority || "routine",
        summary: request.summary || "Protected patient activity",
        sourceReference: request.sourceReference || "",
        occurredAt,
        updatedAt: request.updatedAt || occurredAt,
        requestsUrl: `/bhw-requests.html?request=${encodeURIComponent(request.id)}`,
      });
    }
    const activity = [...activityById.values()].sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
    const updated = [...entries.map((entry) => entry.edited), ...activity.map((item) => item.updatedAt)]
      .reduce((latest, value) => value > latest ? value : latest, "");
    return json(200, {
      entries,
      activity,
      count: entries.length,
      activityCount: activity.length,
      updated,
      activityWarning: activityResult.warning,
      storage: "BHW Cloud",
    });
  } catch (error) {
    return json(500, { error: String(error.message || error) });
  }
};
