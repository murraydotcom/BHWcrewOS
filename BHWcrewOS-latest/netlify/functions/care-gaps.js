// Gaps in Care read-side. The Patient Registry owns identity and the RCM Cloud
// quality profile owns reviewed payer/preventive evidence. No patient roster or
// relationship is read from the retired Notion databases.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");
const { normalizeHetsMeasures, preventiveCatalogForUi } = require("./lib/hets-preventive");

const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (value) => norm(String(value || "").split(",").reverse().join(" "));

function gapsFor(profile) {
  return normalizeHetsMeasures({
    preventiveGaps: profile.preventiveGaps,
    preventiveServices: profile.preventiveServices,
  });
}

function syntheticHetsAcceptanceProfile() {
  return {
    bhwPatientId: "BHW0000",
    name: "Synthetic Patient",
    memberId: "SYNTH-0000",
    payer: "Synthetic Medicare HETS fixture",
    preventiveGaps: [],
    preventiveServices: [
      { code: "G0438", info: "Synthetic initial Annual Wellness Visit benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "G0439", info: "Synthetic subsequent Annual Wellness Visit benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "81528", info: "Synthetic stool DNA screening benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "G0121", info: "Synthetic screening colonoscopy benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "G0328", info: "Synthetic fecal occult blood screening benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "92552", info: "Synthetic audiology benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "92557", info: "Synthetic audiology benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "92567", info: "Synthetic audiology benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
      { code: "92653", info: "Synthetic audiology benefit", dates: [{ kind: "benefit.start", date: "2026-01-01" }] },
    ],
    updatedAt: "2026-10-04T00:00:00.000Z",
  };
}

function syntheticHetsAcceptanceRow() {
  const profile = syntheticHetsAcceptanceProfile();
  return {
    bhwPatientId: profile.bhwPatientId,
    name: profile.name,
    memberId: profile.memberId,
    payer: profile.payer,
    gaps: gapsFor(profile),
    updatedAt: profile.updatedAt,
  };
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
      // BHW0000 must never be sent to CMS HETS. Expose a deterministic local
      // fixture only for an exact synthetic-ID request so production acceptance
      // can exercise normalization without touching a Registry patient, Stedi,
      // or the ordinary payer-gap list.
      if (!hits.length && requestedId === "BHW0000") hits.push(syntheticHetsAcceptanceRow());
      if (hits.length !== 1) return json(200, { matched: false, ambiguous: hits.length > 1, gaps: [] });
      const match = hits[0];
      return json(200, {
        matched: true,
        patient: { bhwPatientId: match.bhwPatientId, name: match.name, memberId: match.memberId, payer: match.payer },
        gaps: match.gaps,
        preventiveCatalog: preventiveCatalogForUi(),
        openCount: match.gaps.filter((gap) => gap.open).length,
        sourceUpdatedAt: match.updatedAt,
        storage: "BHW Cloud",
      });
    }

    if ((body.action || "list") === "list") {
      const patients = rows.sort((a, b) => a.name.localeCompare(b.name));
      const updated = patients.reduce((latest, entry) => entry.updatedAt > latest ? entry.updatedAt : latest, "");
      return json(200, {
        patients: patients.map(({ updatedAt, ...entry }) => entry),
        preventiveCatalog: preventiveCatalogForUi(),
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
