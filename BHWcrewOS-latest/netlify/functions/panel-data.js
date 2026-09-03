// Protected Panel Performance bridge. This is a view over the authoritative
// Google Cloud Patient Registry plus patient-linked quality/utilization records;
// it does not maintain a separate patient list.

const { getSession, json } = require("./_lib");
const { cloudRequest, listCloudPatients } = require("./lib/cloud-patients");

function panelPatient(profile, patient) {
  return {
    ...profile,
    id: profile.bhwPatientId,
    label: patient?.mrn || patient?.bhwPatientId || profile.bhwPatientId,
    payer: profile.payer || patient?.payer || "Other",
    program: profile.program || "none",
    enrollDate: profile.enrollDate || null,
    hedis: profile.hedis || {},
    bhwPatientId: profile.bhwPatientId,
    rosterLinked: Boolean(patient),
  };
}

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "GET or POST only" });
  const session = getSession(event);
  if (!session) return json(401, { error: "Sign in to CrewOS again." });

  try {
    if (event.httpMethod === "GET") {
      const [panel, roster] = await Promise.all([
        cloudRequest("/v1/panel", { actor: session }),
        listCloudPatients(session),
      ]);
      const byId = new Map(roster.map((patient) => [patient.bhwPatientId, patient]));
      const patients = (panel.profiles || []).map((profile) => panelPatient(profile, byId.get(profile.bhwPatientId)));
      const profileIds = new Set(patients.map((patient) => patient.bhwPatientId));
      const events = (panel.events || []).filter((eventRecord) => profileIds.has(eventRecord.bhwPatientId)).map((eventRecord) => ({
        ...eventRecord,
        patientId: eventRecord.bhwPatientId,
      }));
      const registryPatients = roster.filter((patient) => patient.selectable).map((patient) => ({
        bhwPatientId: patient.bhwPatientId,
        name: patient.name,
        legalFirstName: patient.legalFirstName || "",
        legalLastName: patient.legalLastName || "",
        dob: patient.dob,
        payer: patient.payer,
        program: patient.program,
        alreadyInPanel: profileIds.has(patient.bhwPatientId),
      }));
      return json(200, { patients, events, registryPatients, rosterCount: roster.length, storage: "BHW Cloud" });
    }

    let input;
    try { input = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
    const { action, payload = {} } = input;
    if (action === "addPatient") {
      const bhwPatientId = String(payload.bhwPatientId || "").trim().toUpperCase();
      if (!/^BHW\d{4}$/.test(bhwPatientId)) return json(400, { error: "Choose a patient from the Patient Registry." });
      const result = await cloudRequest("/v1/panel/profiles", {
        actor: session,
        method: "POST",
        body: { ...payload, bhwPatientId },
      });
      return json(200, { id: bhwPatientId, savedAt: result.profile.updatedAt, storage: "BHW Cloud" });
    }
    if (action === "updatePatient") {
      const bhwPatientId = String(payload.bhwPatientId || payload.id || "").trim().toUpperCase();
      const result = await cloudRequest(`/v1/panel/profiles/${encodeURIComponent(bhwPatientId)}`, {
        actor: session,
        method: "PUT",
        body: payload,
      });
      return json(200, { ok: true, savedAt: result.profile.updatedAt, storage: "BHW Cloud" });
    }
    if (action === "deletePatient") {
      const bhwPatientId = String(payload.bhwPatientId || payload.id || "").trim().toUpperCase();
      const result = await cloudRequest(`/v1/panel/profiles/${encodeURIComponent(bhwPatientId)}`, {
        actor: session,
        method: "DELETE",
      });
      return json(200, { ok: true, savedAt: result.profile.updatedAt, archived: true, storage: "BHW Cloud" });
    }
    if (action === "addEvent") {
      const bhwPatientId = String(payload.bhwPatientId || payload.patientId || "").trim().toUpperCase();
      const result = await cloudRequest("/v1/panel/events", {
        actor: session,
        method: "POST",
        body: { ...payload, bhwPatientId },
      });
      return json(200, { id: result.event.id, savedAt: result.event.updatedAt, storage: "BHW Cloud" });
    }
    if (action === "updateEvent") {
      const result = await cloudRequest(`/v1/panel/events/${encodeURIComponent(payload.id || "")}`, {
        actor: session,
        method: "PUT",
        body: payload,
      });
      return json(200, { ok: true, savedAt: result.event.updatedAt, storage: "BHW Cloud" });
    }
    if (action === "deleteEvent") {
      const result = await cloudRequest(`/v1/panel/events/${encodeURIComponent(payload.id || "")}`, {
        actor: session,
        method: "DELETE",
      });
      return json(200, { ok: true, savedAt: result.event.updatedAt, archived: true, storage: "BHW Cloud" });
    }
    return json(400, { error: "Unknown action" });
  } catch (error) {
    return json(502, { error: String(error.message || error) });
  }
};
