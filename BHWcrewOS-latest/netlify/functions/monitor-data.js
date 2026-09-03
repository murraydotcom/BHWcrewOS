// netlify/functions/monitor-data.js
// Live data for the Patient Monitor pages (bhw-patient-monitor-list.html and
// bhw-patient-monitor.html). Reads identity from the Cloud patient registry and
// activity from the Google Operations Patient Requests queue. Gated by the signed CrewOS session. Never
// accept a browser-visible shared key.
//
//   GET ?roster=1          -> { patients:[{id,name,mrn,program,phone,lastVisit,nextVisit,page}], capped }
//                             (patients enrolled in a monitoring program, A–Z, capped)
//   GET ?patient=<pageId>  -> { patient:{...identity + snapshot...}, activity:[...] }

const ROSTER_CAP = 150;
const { getSession } = require('./_lib');
const { listCloudPatients, findCloudPatient } = require('./lib/cloud-patients');
const { operationsRequest } = require('./lib/operations-cloud');
const j = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  try {
    const session = getSession(event);
    if (!session) return j(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};

    // ---- ROSTER: patients enrolled in a monitoring program ----
    if (qs.roster) {
      const all = (await listCloudPatients(session)).filter(p => p.name && p.programs.length);
      const capped = all.length > ROSTER_CAP;
      const patients = all.slice(0, ROSTER_CAP);
      return j(200, { patients, capped });
    }

    // ---- SINGLE PATIENT: identity + snapshot + activity ----
    if (qs.patient) {
      const patient = await findCloudPatient(qs.patient, session);
      if (!patient) return j(404, { error: 'patient not found' });
      const requestResult = await operationsRequest(
        `/v1/patient-requests?bhwPatientId=${encodeURIComponent(patient.bhwPatientId)}&limit=8`,
        { actor: session },
      );
      const activity = (requestResult.requests || requestResult.patientRequests || []).slice(0, 8).map((request) => ({
        type: request.requestType || 'general',
        source: request.source || 'crewos',
        status: request.statusLabel || request.status || '',
        received: request.createdAt || request.receivedAt || '',
        summary: request.summary || '',
      }));
      return j(200, { patient: { ...patient, program: patient.programs }, activity });
    }

    return j(400, { error: 'specify ?roster=1 or ?patient=<id>' });
  } catch (e) {
    return j(500, { error: String(e) });
  }
};
