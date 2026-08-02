// netlify/functions/console-data.js
// Care Console v1 — wired to Notion.
// GET  ?mode=patients            -> roster from Patients Master List
// GET  ?mode=plan&pid=<id>       -> care plan text for a patient (via Care Plans relation)
// GET  ?mode=inbox               -> triage queue items (provider lens)
// POST {action:'publishweek', pageId, week, title, body}   -> appends week to patient's page
// POST {action:'postresult', pageId, lab, value, meaning, provider} -> appends result callout
// POST {action:'publishblueprint', pageId, domain, rec, target, provider} -> appends Blueprint recommendation callout
// POST {action:'start'|'done', id}                          -> queue status (same as front desk)
// Env: NOTION_TOKEN, MASTER_DB_ID, QUEUE_DB_ID, DASH_KEY

const NOTION = 'https://api.notion.com/v1';
const H = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});
const J = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const text = f => (f?.rich_text?.[0]?.plain_text) || '';
const pageIdFromUrl = u => {
  const m = String(u || '').replace(/-/g, '').match(/([0-9a-f]{32})/i);
  return m ? m[1] : null;
};

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const key = qs.key || (event.body ? (JSON.parse(event.body).key) : '');
    if (process.env.DASH_KEY && key !== process.env.DASH_KEY) return J(401, { error: 'unauthorized' });

    // ---------------- POST actions ----------------
    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');

      if (b.action === 'publishweek') {
        if (!b.pageId) return J(400, { error: 'no patient page linked — add the Patient Page URL on the Master List' });
        const children = [
          { object: 'block', type: 'divider', divider: {} },
          { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: `🌿 Week ${b.week || '?'} — ${b.title || 'Your plan this week'}` } }] } },
        ];
        String(b.body || '').split('\n').filter(l => l.trim()).slice(0, 40).forEach(line => {
          children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: line.slice(0, 1900) } }] } });
        });
        if (b.providerNote) children.push({
          object: 'block', type: 'callout',
          callout: { icon: { emoji: '💛' }, rich_text: [{ text: { content: `${b.providerNote.slice(0, 1800)} — ${b.provider || 'your care team'}` } }] },
        });
        const res = await fetch(`${NOTION}/blocks/${b.pageId}/children`, { method: 'PATCH', headers: H(), body: JSON.stringify({ children }) });
        if (!res.ok) return J(502, { error: (await res.text()).slice(0, 300) });
        return J(200, { ok: true });
      }

      if (b.action === 'postresult') {
        if (!b.pageId) return J(400, { error: 'no patient page linked — add the Patient Page URL on the Master List' });
        const content = `🧪 ${b.lab || 'Result'}: ${b.value || ''}\nWhat this means for you: ${b.meaning || ''}\n— ${b.provider || 'your care team'}, ${new Date().toLocaleDateString('en-US')}`;
        const res = await fetch(`${NOTION}/blocks/${b.pageId}/children`, {
          method: 'PATCH', headers: H(),
          body: JSON.stringify({ children: [{ object: 'block', type: 'callout', callout: { icon: { emoji: '🧪' }, color: 'blue_background', rich_text: [{ text: { content: content.slice(0, 1900) } }] } }] }),
        });
        if (!res.ok) return J(502, { error: (await res.text()).slice(0, 300) });
        return J(200, { ok: true });
      }

      if (b.action === 'publishblueprint') {
        if (!b.pageId) return J(400, { error: 'no patient page linked — add the Patient Page URL on the Master List' });
        const ICONS = { Exercise: '🏃', Sleep: '😴', Social: '🤝', Coping: '🧭', Nutrition: '🍎' };
        const emoji = ICONS[b.domain] || '🧭';
        const parts = [
          `${emoji} ${b.domain || 'Blueprint'} — recommended by your care team`,
          b.rec || '',
        ];
        if (b.target) parts.push(`Target: ${b.target}`);
        parts.push(`— ${b.provider || 'your care team'}, ${new Date().toLocaleDateString('en-US')}`);
        const content = parts.filter(Boolean).join('\n');
        const res = await fetch(`${NOTION}/blocks/${b.pageId}/children`, {
          method: 'PATCH', headers: H(),
          body: JSON.stringify({ children: [{ object: 'block', type: 'callout', callout: { icon: { emoji }, color: 'green_background', rich_text: [{ text: { content: content.slice(0, 1900) } }] } }] }),
        });
        if (!res.ok) return J(502, { error: (await res.text()).slice(0, 300) });
        return J(200, { ok: true });
      }

      if (b.action === 'start' || b.action === 'done') {
        const now = new Date().toISOString();
        const props = b.action === 'start'
          ? { 'Status': { status: { name: 'In progress' } }, 'First Response': { date: { start: now } } }
          : { 'Status': { status: { name: 'Done' } }, 'Resolved': { date: { start: now } } };
        const res = await fetch(`${NOTION}/pages/${b.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ properties: props }) });
        if (!res.ok) return J(502, { error: (await res.text()).slice(0, 300) });
        return J(200, { ok: true });
      }
      return J(400, { error: 'unknown action' });
    }

    // ---------------- GET modes ----------------
    if (qs.mode === 'patients') {
      const res = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
        method: 'POST', headers: H(),
        body: JSON.stringify({ page_size: 100, sorts: [{ property: 'Patient Name', direction: 'ascending' }] }),
      });
      const d = await res.json();
      const patients = (d.results || []).map(r => {
        const P = r.properties || {};
        return {
          id: r.id,
          name: P['Patient Name']?.title?.[0]?.plain_text || '',
          ctl: text(P['Patient Ctl No']),
          program: P['Program Enrollment']?.multi_select?.map(m => m.name).join(', ') ||
                   P['APCM/CCM/RPM/CharmEd Status']?.select?.name || '',
          payer: P['Payer']?.select?.name || '',
          pageUrl: P['Patient Page']?.url || '',
          pageId: pageIdFromUrl(P['Patient Page']?.url),
          planIds: (P['Care Plans']?.relation || []).map(x => x.id),
        };
      }).filter(p => p.name);
      return J(200, { patients });
    }

    if (qs.mode === 'plan') {
      if (!qs.pid) return J(400, { error: 'pid required' });
      // fetch the master row to get Care Plans relation
      const pres = await fetch(`${NOTION}/pages/${qs.pid}`, { headers: H() });
      const pd = await pres.json();
      const rel = pd.properties?.['Care Plans']?.relation || [];
      if (!rel.length) return J(200, { plan: null, note: 'No care plan linked on the Master List for this patient.' });
      const planId = rel[0].id;
      // pull the plan page's blocks as readable text
      let cursor = null, lines = [], title = '';
      const tres = await fetch(`${NOTION}/pages/${planId}`, { headers: H() });
      const td = await tres.json();
      const tprop = Object.values(td.properties || {}).find(p => p.type === 'title');
      title = tprop?.title?.[0]?.plain_text || 'Care plan';
      for (let i = 0; i < 3; i++) {
        const url = `${NOTION}/blocks/${planId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
        const bres = await fetch(url, { headers: H() });
        const bd = await bres.json();
        (bd.results || []).forEach(bl => {
          const t = bl[bl.type]?.rich_text?.map(x => x.plain_text).join('') || '';
          if (t.trim()) {
            const prefix = bl.type.startsWith('heading') ? '\n## ' : bl.type === 'bulleted_list_item' ? '• ' : '';
            lines.push(prefix + t);
          }
        });
        if (!bd.has_more) break;
        cursor = bd.next_cursor;
      }
      return J(200, { plan: { id: planId, title, text: lines.join('\n').slice(0, 30000) } });
    }

    if (qs.mode === 'inbox') {
      const res = await fetch(`${NOTION}/databases/${process.env.QUEUE_DB_ID}/query`, {
        method: 'POST', headers: H(),
        body: JSON.stringify({ page_size: 30, sorts: [{ property: 'Received', direction: 'descending' }] }),
      });
      const d = await res.json();
      const items = (d.results || []).map(r => {
        const P = r.properties || {};
        return {
          id: r.id,
          who: P['Patient Name']?.title?.[0]?.plain_text || '',
          summary: text(P['Summary']),
          type: P['Request Type']?.select?.name || '',
          source: P['Source']?.select?.name || '',
          priority: P['Priority']?.select?.name || '',
          status: P['Status']?.status?.name || '',
          received: P['Received']?.date?.start || '',
          sla: '',
        };
      });
      return J(200, { items });
    }

    return J(400, { error: 'unknown mode' });
  } catch (e) {
    return J(500, { error: String(e) });
  }
};
