// Gaps in Care read-side. The Patient Registry owns identity and the RCM Cloud
// quality profile owns reviewed payer/preventive evidence. No patient roster or
// relationship is read from the retired Notion databases.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (value) => norm(String(value || "").split(",").reverse().join(" "));

function gapsFor(profile) {
  return (Array.isArray(profile.preventiveGaps) ? profile.preventiveGaps : [])
    .map((gap) => ({
      code: String(gap.code || ""),
      label: String(gap.label || gap.code || ""),
      hcpcs: String(gap.hcpcs || ""),
      state: String(gap.state || ""),
      open: gap.open === true,
      eligibleProf: String(gap.eligibleProf || ""),
      eligibleTech: String(gap.eligibleTech || ""),
    }))
    .sort((a, b) => Number(b.open) - Number(a.open) || a.label.localeCompare(b.label));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    const [panel, roster] = await Promise.all([
      cloudRequest("/v1/panel", { actor: session }),
      listCloudPatients(session),
    ]);
    const patientById = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
    const rows = (panel.profiles || []).map((profile) => {
      const patient = patientById.get(profile.bhwPatientId);
      return {
        bhwPatientId: profile.bhwPatientId,
        name: patient?.name || profile.bhwPatientId,
        memberId: patient?.memberId || "",
        payer: profile.payer || patient?.payer || "",
        gaps: gapsFor(profile),
        updatedAt: profile.coverageCheckedAt || profile.updatedAt || "",
      };
    }).filter((entry) => entry.gaps.length);

    if ((body.action || "list") === "for") {
      const requestedId = String(body.bhwPatientId || body.patientId || "").toUpperCase();
      const memberId = String(body.memberId || "").trim().toLowerCase();
      const requestedName = nameKey(body.name);
      const hits = rows.filter((entry) => (
        (requestedId && entry.bhwPatientId === requestedId)
        || (memberId && String(entry.memberId).toLowerCase() === memberId)
        || (!requestedId && !memberId && requestedName && nameKey(entry.name) === requestedName)
      ));
      if (hits.length !== 1) return json(200, { matched: false, ambiguous: hits.length > 1, gaps: [] });
      const match = hits[0];
      return json(200, {
        matched: true,
        patient: { bhwPatientId: match.bhwPatientId, name: match.name, memberId: match.memberId, payer: match.payer },
        gaps: match.gaps,
        openCount: match.gaps.filter((gap) => gap.open).length,
        storage: "BHW Cloud",
      });
    }

    if ((body.action || "list") === "list") {
      const patients = rows.sort((a, b) => a.name.localeCompare(b.name));
      const updated = patients.reduce((latest, entry) => entry.updatedAt > latest ? entry.updatedAt : latest, "");
      return json(200, {
        patients: patients.map(({ updatedAt, ...entry }) => entry),
        rows: patients.reduce((count, patient) => count + patient.gaps.length, 0),
        updated,
        storage: "BHW Cloud",
      });
    }
    return json(400, { error: "Unknown action" });
  } catch (error) {
    return json(502, { error: String(error.message || error) });
  }
};
