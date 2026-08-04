// netlify/functions/dialpad-events.js
// Receives Dialpad Event Subscription webhooks (SMS events) and creates
// entries in the Patient Request Triage Queue — patient-matched by phone.
// Env vars: NOTION_TOKEN, MASTER_DB_ID, QUEUE_DB_ID
// Optional:  DIALPAD_WEBHOOK_SECRET (set the same value when creating the webhook)

const NOTION = 'https://api.notion.com/v1';
const H = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});
const digits = s => (s || '').replace(/\D/g, '');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };

    // Dialpad sends the payload as a JWT when a secret is set, else raw JSON.
    let payload;
    const raw = event.body || '';
    if (raw.trim().startsWith('{')) {
      payload = JSON.parse(raw);
    } else if (process.env.DIALPAD_WEBHOOK_SECRET) {
      // JWT: header.payload.signature — verify signature (HS256) then decode
      const crypto = require('crypto');
      const [h, p, sig] = raw.trim().split('.');
      const expected = crypto.createHmac('sha256', process.env.DIALPAD_WEBHOOK_SECRET)
        .update(`${h}.${p}`).digest('base64url');
      if (sig !== expected) return { statusCode: 401, body: 'bad signature' };
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } else {
      return { statusCode: 400, body: 'unrecognized payload' };
    }

    // Only act on INBOUND SMS events
    const dir = (payload.direction || '').toLowerCase();
    if (dir && dir !== 'inbound') return { statusCode: 200, body: 'ignored outbound' };

    const from = payload.from_number || payload.contact?.phone || '';
    const text = payload.text || payload.text_content || '';
    if (!from && !text) return { statusCode: 200, body: 'no sms content' };

    // ---- try to match the sender to a patient on the master list ----
    let patientId = null, patientName = '';
    const last7 = digits(from).slice(-7);
    if (last7.length === 7) {
      const res = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
        method: 'POST', headers: H(),
        body: JSON.stringify({
          filter: { property: 'Phone', phone_number: { contains: last7.replace(/(\d{3})(\d{4})/, '$1-$2') } },
          page_size: 5,
        }),
      });
      let data = await res.json();
      let hits = data.results || [];
      if (!hits.length) {
        const res2 = await fetch(`${NOTION}/databases/${process.env.MASTER_DB_ID}/query`, {
          method: 'POST', headers: H(),
          body: JSON.stringify({
            filter: { property: 'Phone', phone_number: { contains: last7.slice(-4) } }, page_size: 10,
          }),
        });
        const d2 = await res2.json();
        hits = (d2.results || []).filter(r =>
          digits(r.properties?.Phone?.phone_number || '').endsWith(digits(from).slice(-10)));
      }
      if (hits.length === 1) {
        patientId = hits[0].id;
        patientName = hits[0].properties?.['Patient Name']?.title?.[0]?.plain_text || '';
      }
    }

    // ---- create the queue entry ----
    // Queue schema: title is "Request ID" (REQ-…); "Patient Name" is a text field.
    const nowD = new Date();
    const now = nowD.toISOString();
    const pad = (n) => String(n).padStart(2, '0');
    const requestId = `REQ-${nowD.getUTCFullYear()}${pad(nowD.getUTCMonth() + 1)}${pad(nowD.getUTCDate())}-${pad(nowD.getUTCHours())}${pad(nowD.getUTCMinutes())}${pad(nowD.getUTCSeconds())}`;
    const props = {
      'Request ID': { title: [{ text: { content: requestId } }] },
      'Patient Name': { rich_text: [{ text: { content: patientName || `Text from ${from || 'unknown number'}` } }] },
      'Callback Number': { phone_number: from || null },
      'Summary': { rich_text: [{ text: { content: (text || '(no text content)').slice(0, 1900) } }] },
      'Source': { select: { name: 'Text / SMS' } },
      'Received': { date: { start: now } },
      'Status': { status: { name: 'Not started' } },
    };
    if (patientId) props['Patient'] = { relation: [{ id: patientId }] };

    const cres = await fetch(`${NOTION}/pages`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ parent: { database_id: process.env.QUEUE_DB_ID }, properties: props }),
    });
    if (!cres.ok) {
      const detail = await cres.text();
      return { statusCode: 502, body: `notion error: ${detail.slice(0, 300)}` };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, matched: !!patientId }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
