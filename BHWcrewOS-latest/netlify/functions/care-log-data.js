// Protected read side for the Care Management board. The Google Cloud Patient
// Registry owns patient identity; the RCM Cloud API owns care-management logs.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const { operationsRequest } = require("./lib/operations-cloud");

function isoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function shiftDate(value, days) {
  const date = new Date(`${isoDate(value)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthOf(value) { return isoDate(value).slice(0, 7); }

function previousMonth(value) {
  const date = new Date(`${monthOf(value)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthEnd(month) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function monthsInWindow(start, end) {
  const months = [];
  const cursor = new Date(`${monthOf(start)}-01T12:00:00Z`);
  const last = monthOf(end);
  while (Number.isFinite(cursor.getTime())) {
    const month = cursor.toISOString().slice(0, 7);
    months.push(month);
    if (month === last || months.length >= 3) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function documentationGaps(log = {}) {
  const gaps = [];
  const program = String(log.program || "").toUpperCase();
  const status = String(log.status || "Open").toLowerCase();
  if (!String(log.activities || "").trim()) gaps.push("activity/documentation");
  if (["CCM", "PCM", "RPM", "RTM", "BHI", "COCM"].includes(program) && !(Number(log.minutes) > 0)) gaps.push("time");
  if (program === "TCM" && !isoDate(log.lastContact)) gaps.push("first contact");
  if (program === "TCM" && !isoDate(log.nextFollowUp)) gaps.push("visit date");
  if (!["complete", "billed"].includes(status) && !isoDate(log.nextFollowUp)) gaps.push("next follow-up");
  if (status === "complete") gaps.push("claim processing");
  return [...new Set(gaps)];
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if ((body.action || "list") !== "list") return json(400, { error: "Unknown action" });

  try {
    const program = String(body.program || "").trim();
    const month = String(body.month || "").trim();
    const requestedEnd = isoDate(body.windowEnd) || new Date().toISOString().slice(0, 10);
    const windowEnd = /^\d{4}-\d{2}$/.test(month) ? monthEnd(month) : requestedEnd;
    const windowStart = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : shiftDate(windowEnd, -29);
    const windowMonths = /^\d{4}-\d{2}$/.test(month) ? [month] : monthsInWindow(windowStart, windowEnd);
    const closeMonth = previousMonth(windowEnd);
    const requestedMonths = [...new Set([...windowMonths, closeMonth])];
    const logRequests = requestedMonths.map((requestedMonth) => {
      const params = new URLSearchParams({ month: requestedMonth });
      if (program && program !== "All") params.set("program", program);
      return cloudRequest(`/v1/care-management/logs?${params}`, { actor: session })
        .then((result) => [requestedMonth, Array.isArray(result.logs) ? result.logs : []]);
    });
    const [logResults, roster, activityResult] = await Promise.all([
      Promise.all(logRequests),
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
    const logsByMonth = new Map(logResults);
    const resultLogs = [...new Map(windowMonths.flatMap((value) => logsByMonth.get(value) || [])
      .map((log) => [log.id, log])).values()];
    const byId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
    const entries = resultLogs.map((log) => {
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
      const activityDate = isoDate(occurredAt);
      if (activityDate && (activityDate < windowStart || activityDate > windowEnd)) continue;
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
    const closeEntries = [...new Map((logsByMonth.get(closeMonth) || []).map((log) => [log.id, log])).values()].map((log) => {
      const patient = byId.get(log.bhwPatientId);
      return {
        ...log,
        ctlNo: log.bhwPatientId,
        entry: log.entry || patient?.name || log.bhwPatientId,
        gaps: documentationGaps(log),
      };
    });
    return json(200, {
      entries,
      activity,
      count: entries.length,
      activityCount: activity.length,
      updated,
      window: { start: windowStart, end: windowEnd, days: 30 },
      monthClose: {
        month: closeMonth,
        start: `${closeMonth}-01`,
        end: monthEnd(closeMonth),
        generatedAt: new Date().toISOString(),
        entries: closeEntries,
        counts: {
          tracked: closeEntries.length,
          complete: closeEntries.filter((entry) => ["complete", "billed"].includes(String(entry.status || "").toLowerCase())).length,
          missing: closeEntries.filter((entry) => entry.gaps.length).length,
          claimPending: closeEntries.filter((entry) => String(entry.status || "").toLowerCase() === "complete").length,
        },
      },
      activityWarning: activityResult.warning,
      storage: "BHW Cloud",
    });
  } catch (error) {
    return json(500, { error: String(error.message || error) });
  }
};

exports._test = { documentationGaps, isoDate, monthEnd, monthsInWindow, previousMonth, shiftDate };
