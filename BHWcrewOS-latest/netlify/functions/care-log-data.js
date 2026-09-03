// Protected read side for the Care Management board. The Google Cloud Patient
// Registry owns patient identity; the RCM Cloud API owns care-management logs.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

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
    const [result, roster] = await Promise.all([
      cloudRequest(`/v1/care-management/logs${suffix}`, { actor: session }),
      listCloudPatients(session),
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
    const updated = entries.reduce((latest, entry) => entry.edited > latest ? entry.edited : latest, "");
    return json(200, { entries, count: entries.length, updated, storage: "BHW Cloud" });
  } catch (error) {
    return json(500, { error: String(error.message || error) });
  }
};
