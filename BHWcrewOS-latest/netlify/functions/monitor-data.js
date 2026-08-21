// netlify/functions/monitor-data.js
// Live data for the Patient Monitor pages (bhw-patient-monitor-list.html and
// bhw-patient-monitor.html). Reads identity from the Cloud patient registry and
// activity from the triage queue. Gated by the signed CrewOS session. Never
// accept a browser-visible shared key.
//
//   GET ?roster=1          -> { patients:[{id,name,mrn,program,phone,lastVisit,nextVisit,page}], capped }
//                             (patients enrolled in a monitoring program, A–Z, capped)
//   GET ?patient=<pageId>  -> { patient:{...identity + snapshot...}, activity:[...] }

const NOTION = 'https://api.notion.com/v1';
const H = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});
const QUEUE_DB = process.env.QUEUE_DB_ID || 'de7906906a134b65bb0fc6966ba20b13';
const ROSTER_CAP = 150;
const { getSession } = require('./_lib');
const { listCloudPatients, findCloudPatient } = require('./lib/cloud-patients');

const text = p => (p?.rich_text?.[0]?.plain_text) || (p?.title?.[0]?.plain_text) || '';
const sel = p => p?.select?.name || p?.status?.name || '';
const multi = p => (p?.multi_select || []).map(o => o.name);
const dateOf = p => p?.date?.start || '';
const phoneOf = p => p?.phone_number || '';
const j = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  try {
    if (!getSession(event)) return j(401, { error: 'unauthorized' });

    const qs = event.queryStringParameters || {};

    // ---- ROSTER: patients enrolled in a monitoring program ----
    if (qs.roster) {
      const all = (await listCloudPatients()).filter(p => p.name && p.programs.length);
      const capped = all.length > ROSTER_CAP;
      const patients = all.slice(0, ROSTER_CAP);
      return j(200, { patients, capped });
    }

    // ---- SINGLE PATIENT: identity + snapshot + activity ----
    if (qs.patient) {
      const patient = await findCloudPatient(qs.patient);
      if (!patient) return j(404, { error: 'patient not found' });
      let activity = [];
      try {
        const qr = await fetch(`${NOTION}/databases/${QUEUE_DB}/query`, {
          method: 'POST', headers: H(),
          body: JSON.stringify({
            filter: { property: 'Patient', relation: { contains: patient.notionPageId } },
            sorts: [{ property: 'Received', direction: 'descending' }],
            page_size: 8,
          }),
        });
        const qd = await qr.json();
        activity = (qd.results || []).map(r => {
          const q = r.properties;
          return {
            type: sel(q['Request Type']),
            source: sel(q['Source']),
            status: sel(q['Status']),
            received: dateOf(q['Received']),
            summary: text(q['Summary']),
          };
        });
      } catch (_) { /* activity is best-effort */ }
      return j(200, { patient: { ...patient, program: patient.programs }, activity });
    }

    return j(400, { error: 'specify ?roster=1 or ?patient=<id>' });
  } catch (e) {
    return j(500, { error: String(e) });
  }
};
