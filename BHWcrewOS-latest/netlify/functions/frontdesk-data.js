// netlify/functions/frontdesk-data.js
// Live patient lookup for bhw-front-desk.html
// Env vars required: NOTION_TOKEN, MASTER_DB_ID, QUEUE_DB_ID  (optional: DASH_KEY)
// MASTER_DB_ID = Patients Master List data source id
// QUEUE_DB_ID  = Patient Request Triage Queue data source id

const NOTION = 'https://api.notion.com/v1';
const H = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

const QUEUE_DB = process.env.QUEUE_DB_ID || 'de7906906a134b65bb0fc6966ba20b13';
const digits = s => (s || '').replace(/\D/g, '');
const text = p => (p?.rich_text?.[0]?.plain_text) || (p?.title?.[0]?.plain_text) || '';
const sel = p => p?.select?.name || p?.status?.name || '';

// Full patient card from a Master List page (used for a single/selected match).
function shapePatient(page) {
  const P = page.properties;
  return {
    id: page.id,
    pageUrl: P['Patient Page']?.url || '',
    name: text(P['Patient Name']),
    ctl: text(P['Patient Ctl No']),
    dob: P['DOB']?.date?.start || '',
    phone: P['Phone']?.phone_number || '',
    payer: sel(P['Payer']) || text(P['Payer']),
    mco: sel(P['Medicaid MCO']) || sel(P['MCO']) || text(P['MCO']),
    member: text(P['MRN / Member ID']) || text(P['Member ID']),
    status: sel(P['Status']) || sel(P['Patient Status']) ||
            (P['Program Enrollment']?.multi_select || []).map(m => m.name).join(', '),
    allergies: text(P['Allergies']),
    meds: text(P['Medications']),
    lastVisit: P['Last Visit']?.date?.start || P['Last Visit Date']?.date?.start || '',
    nextVisit: P['Next Visit']?.date?.start || '',
    snapshot: P['Snapshot Updated']?.date?.start || '',
  };
}

// Lightweight row for the multi-match chooser.
function matchRow(page) {
  const P = page.properties;
  return {
    id: page.id,
    name: text(P['Patient Name']),
    ctl: text(P['Patient Ctl No']),
    dob: P['DOB']?.date?.start || '',
    phone: P['Phone']?.phone_number || '',
  };
}

// A patient's recent requests from the triage queue (via the Patient relation).
async function fetchRequests(pageId) {
  const qres = await fetch(`${NOTION}/databases/${QUEUE_DB}/query`, {
    method: 'POST', headers: H(),
    body: JSON.stringify({
      filter: { property: 'Patient', relation: { contains: pageId } },
      sorts: [{ property: 'Received', direction: 'descending' }],
      page_size: 8,
    }),
  });
  const qdata = await qres.json();
  return (qdata.results || []).map(r => {
    const p = r.properties;
    return {
      type: sel(p['Request Type']),
      source: sel(p['Source']),
      priority: sel(p['Priority']),
      status: sel(p['Status']),
      received: p['Received']?.date?.start?.slice(0, 10) || '',
      summary: text(p['Summary']),
    };
  });
}

exports.handler = async (event) => {
  try {
    if (process.env.DASH_KEY && (event.queryStringParameters?.key !== process.env.DASH_KEY))
      return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };

    // ---- WRITE-BACK: POST {pageId, action} -> updates Notion ----
    if (event.httpMethod === 'POST') {
      const { pageId, action } = JSON.parse(event.body || '{}');
      if (!pageId || !action) return { statusCode: 400, body: JSON.stringify({ error: 'missing pageId/action' }) };
      const now = new Date().toISOString();
      let properties = {};
      if (action === 'start') {
        properties = {
          'Status': { status: { name: 'In progress' } },
          'First Response': { date: { start: now } },
        };
      } else if (action === 'done') {
        properties = {
          'Status': { status: { name: 'Done' } },
          'Resolved': { date: { start: now } },
        };
      } else if (action === 'reopen') {
        properties = { 'Status': { status: { name: 'In progress' } } };
      } else if (action === 'sms') {
        // send a text from the practice line via Dialpad, then stamp First Response
        const { to, text: msg } = JSON.parse(event.body || '{}');
        if (!to || !msg) return { statusCode: 400, body: JSON.stringify({ error: 'missing to/text' }) };
        const dres = await fetch('https://dialpad.com/api/v2/sms', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.DIALPAD_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from_number: process.env.DIALPAD_FROM,   // your main line, e.g. +14108444696
            to_numbers: [to],
            text: msg,
          }),
        });
        if (!dres.ok) {
          const detail = await dres.text();
          return { statusCode: 502, body: JSON.stringify({ ok: false, detail }) };
        }
        if (pageId) {
          await fetch(`${NOTION}/pages/${pageId}`, {
            method: 'PATCH', headers: H(),
            body: JSON.stringify({ properties: { 'First Response': { date: { start: now } } } }),
          });
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      } else if (action === 'publish') {
        // post a dated update line onto the patient's Health Hub page (+ optional no-PHI text)
        const { masterId, text: updText, notify } = JSON.parse(event.body || '{}');
        if (!masterId || !updText) return { statusCode: 400, body: JSON.stringify({ error: 'missing masterId/text' }) };
        // 1. get the patient's page URL + phone from the master list
        const pres = await fetch(`${NOTION}/pages/${masterId}`, { headers: H() });
        const pdata = await pres.json();
        const pageUrl = pdata.properties?.['Patient Page']?.url || '';
        const phone = pdata.properties?.['Phone']?.phone_number || '';
        const m = pageUrl.replace(/-/g, '').match(/([0-9a-f]{32})/i);
        if (!m) return { statusCode: 400, body: JSON.stringify({ error: 'no Patient Page link on this patient' }) };
        const hubId = m[1];
        // 2. find the Updates heading so the line lands under it (falls back to end of page)
        let afterId = null;
        try {
          const cres = await fetch(`${NOTION}/blocks/${hubId}/children?page_size=50`, { headers: H() });
          const cdata = await cres.json();
          const hit = (cdata.results || []).find(b => {
            const t = b[b.type]?.rich_text?.map(r => r.plain_text).join('') || '';
            return /updates from your care team/i.test(t);
          });
          if (hit) afterId = hit.id;
        } catch (_) {}
        const today = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
        const block = {
          children: [{
            object: 'block', type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [
              { type: 'text', text: { content: `${today} — ` }, annotations: { bold: true } },
              { type: 'text', text: { content: updText } },
            ] },
          }],
        };
        if (afterId) block.after = afterId;
        const bres = await fetch(`${NOTION}/blocks/${hubId}/children`, {
          method: 'PATCH', headers: H(), body: JSON.stringify(block),
        });
        if (!bres.ok) return { statusCode: 502, body: JSON.stringify({ ok: false, detail: await bres.text() }) };
        // 3. optional no-PHI nudge from the practice line
        let texted = false;
        if (notify && phone && process.env.DIALPAD_TOKEN) {
          const nres = await fetch('https://dialpad.com/api/v2/sms', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.DIALPAD_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from_number: process.env.DIALPAD_FROM,
              to_numbers: [phone],
              text: 'You have a new update on your BHW health page. Sign in to take a look. — BHW Medical Group',
            }),
          });
          texted = nres.ok;
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true, texted }) };
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: 'unknown action' }) };
      }
      const ures = await fetch(`${NOTION}/pages/${pageId}`, {
        method: 'PATCH', headers: H(),
        body: JSON.stringify({ properties }),
      });
      const ok = ures.ok;
      return { statusCode: ok ? 200 : 502, body: JSON.stringify({ ok }) };
    }

    // ---- SPECIALIST DIRECTORY: ?dir=1 -> the referral directory (live from Notion) ----
    if (event.queryStringParameters?.dir) {
      const SPEC_DB = process.env.SPECIALIST_DB_ID || 'f4e144272dc842dc87d51f8f6f8f5e6c';
      const specialists = [];
      let cursor;
      do {
        const sres = await fetch(`${NOTION}/databases/${SPEC_DB}/query`, {
          method: 'POST', headers: H(),
          body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
        });
        const sdata = await sres.json();
        if (!sres.ok) return { statusCode: 502, body: JSON.stringify({ error: sdata.message || 'directory query failed' }) };
        for (const r of (sdata.results || [])) {
          const p = r.properties;
          const name = text(p['Specialist']);
          if (!name) continue;
          specialists.push({
            name,
            specialty: sel(p['Specialty']),
            org: text(p['Practice / Institution']),
            phone: p['Phone']?.phone_number || '',
            fax: p['Fax']?.phone_number || '',
            networks: (p['Networks Accepted']?.multi_select || []).map(m => m.name),
            preferred: !!p['⭐ Preferred']?.checkbox,
            accepting: !!p['Accepting New Patients']?.checkbox,
            wait: sel(p['Typical Wait']),
            notes: text(p['Notes']),
          });
        }
        cursor = sdata.has_more ? sdata.next_cursor : null;
      } while (cursor);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ specialists }),
      };
    }

    const q = (event.queryStringParameters?.q || '').trim();
    const pid = (event.queryStringParameters?.pid || '').trim();

    // ---- DIRECT PATIENT: ?pid=<pageId> -> full detail for one chosen match ----
    if (pid) {
      const pres = await fetch(`${NOTION}/pages/${pid}`, { headers: H() });
      if (!pres.ok) return { statusCode: 200, body: JSON.stringify({ patient: null }) };
      const page = await pres.json();
      const patient = shapePatient(page);
      const requests = await fetchRequests(page.id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ patient, requests }),
      };
    }

    // ---- INBOX MODE: no q -> return the live activity feed ----
    if (!q) {
      const ires = await fetch(`${NOTION}/databases/${QUEUE_DB}/query`, {
        method: 'POST', headers: H(),
        body: JSON.stringify({
          sorts: [{ property: 'Received', direction: 'descending' }],
          page_size: 40,
        }),
      });
      const idata = await ires.json();
      const items = (idata.results || []).map(r => {
        const p = r.properties;
        return {
          id: r.id,
          type: sel(p['Request Type']),
          source: sel(p['Source']),
          priority: sel(p['Priority']),
          status: sel(p['Status']),
          sla: p['⚠️ SLA']?.formula?.string || '',
          received: p['Received']?.date?.start || '',
          summary: text(p['Summary']),
          name: text(p['Patient Name']),
          phone: p['Callback Number']?.phone_number || '',
          assigned: sel(p['Assigned To']),
        };
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ items }),
      };
    }

    const isPhone = digits(q).length >= 7;

    // ---- find matching patients on the master list ----
    let filter;
    if (isPhone) {
      // phone stored as phone_number property "Phone"; match on digits via contains of last 7
      filter = { property: 'Phone', phone_number: { contains: digits(q).slice(-7).replace(/(\d{3})(\d{4})/, '$1-$2') } };
    } else {
      filter = { property: 'Patient Name', title: { contains: q } };
    }

    let res = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ filter, page_size: 25 }),
    });
    let data = await res.json();

    // phone fallback: try raw contains if formatted guess missed
    if (isPhone && (!data.results || !data.results.length)) {
      res = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
        method: 'POST', headers: H(),
        body: JSON.stringify({ filter: { property: 'Phone', phone_number: { contains: digits(q).slice(-4) } }, page_size: 25 }),
      });
      data = await res.json();
      // narrow client-side on full digit match
      data.results = (data.results || []).filter(r =>
        digits(r.properties?.Phone?.phone_number || '').endsWith(digits(q).slice(-10)));
    }

    const results = (data.results || []).filter(r => text(r.properties?.['Patient Name']));
    if (!results.length) return { statusCode: 200, body: JSON.stringify({ matches: [], patient: null }) };

    // Return EVERY match so the desk can pick the right person when names
    // collide (e.g. two "Amaris"). Sorted by name for a stable chooser.
    const matches = results.map(matchRow).sort((a, b) => a.name.localeCompare(b.name));

    // Exactly one match -> include full detail, so single-hit search is unchanged.
    if (results.length === 1) {
      const patient = shapePatient(results[0]);
      const requests = await fetchRequests(results[0].id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ matches, patient, requests }),
      };
    }

    // Multiple matches -> return the list; the page shows a chooser and then
    // requests full detail for the chosen patient via ?pid=<id>.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ matches, patient: null }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
