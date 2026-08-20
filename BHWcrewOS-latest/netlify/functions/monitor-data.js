// netlify/functions/monitor-data.js
// Live data for the Patient Monitor pages (bhw-patient-monitor-list.html and
// bhw-patient-monitor.html). Reads the Patients Master List (MASTER_DB_ID) and
// the triage queue (QUEUE_DB_ID) over raw Notion. Gated by DASH_KEY — the same
// signed CrewOS session. Never accept a browser-visible shared key.
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
const MASTER_DB = process.env.MASTER_DB_ID;
const QUEUE_DB = process.env.QUEUE_DB_ID || 'de7906906a134b65bb0fc6966ba20b13';
const ROSTER_CAP = 150;
const { getSession } = require('./_lib');

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
    if (!process.env.NOTION_TOKEN || !MASTER_DB)
      return j(503, { error: 'NOTION_TOKEN / MASTER_DB_ID not set on this site' });

    const qs = event.queryStringParameters || {};

    // ---- ROSTER: patients enrolled in a monitoring program ----
    if (qs.roster) {
      const patients = [];
      let cursor, capped = false;
      do {
        const r = await fetch(`${NOTION}/databases/${MASTER_DB}/query`, {
          method: 'POST', headers: H(),
          body: JSON.stringify({
            filter: { property: 'Program Enrollment', multi_select: { is_not_empty: true } },
            sorts: [{ property: 'Patient Name', direction: 'ascending' }],
            page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
          }),
        });
        const d = await r.json();
        if (!r.ok) return j(502, { error: d.message || 'roster query failed' });
        for (const pg of (d.results || [])) {
          const p = pg.properties;
          const name = text(p['Patient Name']);
          if (!name) continue;
          patients.push({
            id: pg.id,
            name,
            mrn: text(p['MRN']) || text(p['Patient Ctl No']),
            program: multi(p['Program Enrollment']).join(' · '),
            phone: phoneOf(p['Phone']) || text(p['Phone Number']),
            lastVisit: dateOf(p['Last Visit']) || dateOf(p['Last Visit Date']),
            nextVisit: dateOf(p['Next Visit']),
            page: p['Patient Page']?.url || '',
          });
          if (patients.length >= ROSTER_CAP) { capped = true; break; }
        }
        cursor = (!capped && d.has_more) ? d.next_cursor : null;
      } while (cursor);
      return j(200, { patients, capped });
    }

    // ---- SINGLE PATIENT: identity + snapshot + activity ----
    if (qs.patient) {
      const pr = await fetch(`${NOTION}/pages/${qs.patient}`, { headers: H() });
      const pd = await pr.json();
      if (!pr.ok) return j(404, { error: 'patient not found' });
      const p = pd.properties || {};
      const patient = {
        id: pd.id,
        name: text(p['Patient Name']),
        gender: sel(p['Gender']),
        dob: dateOf(p['DOB']),
        mrn: text(p['MRN']) || text(p['Patient Ctl No']),
        phone: phoneOf(p['Phone']) || text(p['Phone Number']),
        payer: sel(p['Payer']),
        mco: sel(p['Medicaid MCO']),
        member: text(p['Insurance Member ID']),
        address: text(p['Patient Address']),
        program: multi(p['Program Enrollment']),
        allergies: text(p['Allergies']),
        meds: text(p['Medications']),
        lastVisit: dateOf(p['Last Visit']) || dateOf(p['Last Visit Date']),
        nextVisit: dateOf(p['Next Visit']),
        page: p['Patient Page']?.url || '',
      };
      let activity = [];
      try {
        const qr = await fetch(`${NOTION}/databases/${QUEUE_DB}/query`, {
          method: 'POST', headers: H(),
          body: JSON.stringify({
            filter: { property: 'Patient', relation: { contains: pd.id } },
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
      return j(200, { patient, activity });
    }

    return j(400, { error: 'specify ?roster=1 or ?patient=<id>' });
  } catch (e) {
    return j(500, { error: String(e) });
  }
};
