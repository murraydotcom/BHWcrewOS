// Protected start-of-day list. Care-management records come from RCM Cloud;
// inbound requests come from the one Google Operations Patient Requests queue.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const { operationsRequest } = require("./lib/operations-cloud");

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function patientRequestView(request = {}) {
  return {
    id: request.id || request.requestId || "",
    type: request.requestType || request.type || "Patient request",
    source: request.source || request.sourceChannel || "",
    priority: request.priority || "routine",
    status: request.status || "open",
    sla: request.sla || request.slaStatus || "",
    received: request.receivedAt || request.createdAt || "",
    summary: request.summary || request.reason || "",
    name: request.patientLabel || request.patientName || request.bhwPatientId || "Protected patient",
    assigned: request.assignedTo || request.owner || "",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });

  const now = new Date();
  const today = iso(now);
  const endOfWeekDate = new Date(now);
  endOfWeekDate.setDate(endOfWeekDate.getDate() + ((7 - now.getDay()) % 7));
  const endOfWeek = iso(endOfWeekDate);
  const month = today.slice(0, 7);
  const done = new Set(["complete", "billed"]);

  try {
    const [logResult, roster, requestResult] = await Promise.all([
      cloudRequest("/v1/care-management/logs", { actor: session }),
      listCloudPatients(session),
      operationsRequest("/v1/patient-requests?status=open&limit=100", { actor: session })
        .catch(() => ({ requests: [] })),
    ]);
    const byId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
    const followups = [];
    const notStarted = [];
    for (const log of Array.isArray(logResult.logs) ? logResult.logs : []) {
      const patient = byId.get(log.bhwPatientId);
      const item = {
        ...log,
        name: patient?.name || log.entry || log.bhwPatientId,
        ctlNo: log.bhwPatientId,
        month: log.serviceMonth || "",
        stage: log.followUpStage || "",
        status: log.status || "Open",
        patientId: log.bhwPatientId,
        payer: patient?.payer || "",
        rosterLinked: Boolean(patient),
      };
      if (item.nextFollowUp && !done.has(item.status.toLowerCase()) && item.nextFollowUp <= endOfWeek) {
        item.bucket = item.nextFollowUp < today ? "overdue" : item.nextFollowUp === today ? "today" : "week";
        followups.push(item);
      } else if (["CCM", "APCM"].includes(item.program)
          && item.month.slice(0, 7) === month && !done.has(item.status.toLowerCase())
          && !item.nextFollowUp && !item.lastContact && !(item.minutes > 0)) {
        notStarted.push(item);
      }
    }
    const rank = { overdue: 0, today: 1, week: 2 };
    followups.sort((left, right) => rank[left.bucket] - rank[right.bucket]
      || left.nextFollowUp.localeCompare(right.nextFollowUp) || left.name.localeCompare(right.name));
    notStarted.sort((left, right) => left.name.localeCompare(right.name));

    const requestRows = Array.isArray(requestResult.requests)
      ? requestResult.requests : Array.isArray(requestResult.patientRequests) ? requestResult.patientRequests : [];
    const requests = requestRows.map(patientRequestView)
      .filter((request) => !["done", "resolved", "closed"].includes(String(request.status).toLowerCase()))
      .sort((left, right) => String(right.received).localeCompare(String(left.received)));

    return json(200, {
      today,
      endOfWeek,
      followups,
      notStarted,
      requests,
      counts: {
        overdue: followups.filter((item) => item.bucket === "overdue").length,
        today: followups.filter((item) => item.bucket === "today").length,
        week: followups.filter((item) => item.bucket === "week").length,
        notStarted: notStarted.length,
        requests: requests.length,
      },
      storage: "BHW Cloud",
    });
  } catch (error) {
    return json(500, { error: String(error.message || error) });
  }
};
