// CrewCare compatibility endpoint.
//
// The old Care Console appended results, Blueprint recommendations, and care
// plans to legacy patient pages. Those write routes are intentionally retired.
// The remaining roster response is session-gated and comes only from the
// authoritative Google Cloud Patient Registry.

const { getSession, json } = require("./_lib");
const { listCloudPatients } = require("./lib/cloud-patients");

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { ok: false, error: "Sign in to CrewOS again." });

  if (event.httpMethod !== "GET") {
    return json(410, {
      ok: false,
      error: "This legacy patient-content write path is retired. Use Health 360 Care Plans or Patient Requests.",
    });
  }

  const mode = event.queryStringParameters?.mode || "";
  if (mode !== "patients") return json(400, { ok: false, error: "Unknown mode" });

  try {
    const patients = (await listCloudPatients(session))
      .filter((patient) => patient.name)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((patient) => ({
        bhwPatientId: patient.bhwPatientId,
        bhwId: patient.bhwPatientId,
        ctl: patient.bhwPatientId,
        name: patient.name,
        dob: patient.dob,
        program: patient.program,
        programs: patient.programs,
        payer: patient.payer,
        status: patient.status,
        selectable: patient.selectable,
      }));
    return json(200, { ok: true, source: "BHW Cloud Patient Registry", patients });
  } catch (error) {
    return json(502, { ok: false, error: String(error.message || error) });
  }
};
