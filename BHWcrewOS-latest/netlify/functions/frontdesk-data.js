// netlify/functions/frontdesk-data.js
// Live patient lookup for bhw-front-desk.html
// Patient identity and Patient Requests come from protected Google Cloud.
// Notion remains only for the non-patient specialist reference directory.

const NOTION = 'https://api.notion.com/v1';
const H = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

const { listCloudPatients, findCloudPatient, searchCloudPatients } = require('./lib/cloud-patients');
const { createIFaxClient } = require('./lib/ifax');
const { getSession } = require('./_lib');
const { operationsRequest } = require('./lib/operations-cloud');
const crypto = require('crypto');
const digits = s => (s || '').replace(/\D/g, '');
const text = p => (p?.rich_text?.[0]?.plain_text) || (p?.title?.[0]?.plain_text) || '';
const sel = p => p?.select?.name || p?.status?.name || '';

// Reserved, de-identified production smoke-test patient. This fixture is
// intentionally available only by its exact ID so it never appears in normal
// staff searches or patient lists.
const BHW0000 = Object.freeze({
  id: 'BHW0000',
  bhwPatientId: 'BHW0000',
  bhwId: 'BHW0000',
  ctl: 'BHW0000',
  name: 'Synthetic QA',
  dob: '1980-01-01',
  phone: '',
  payer: 'Synthetic test coverage',
  member: 'BHW0000',
  status: 'synthetic-test',
  allergies: 'Synthetic test record — no real patient data',
  meds: '',
  lastVisit: '',
  nextVisit: '',
  pageUrl: '',
});

const actionKey = (prefix) => `${prefix}:${crypto.randomUUID()}`;
const requestRows = (result) => result.requests || result.patientRequests || [];
const shapeRequest = (request) => ({
  id: request.id || request.patientRequestId,
  type: request.requestType || 'general',
  source: request.source || 'crewos',
  priority: request.priority || 'routine',
  status: request.statusLabel || request.status || '',
  statusCategory: request.statusCategory || '',
  sla: '',
  received: request.workflowContext?.historicalReceivedAt || request.createdAt || request.receivedAt || '',
  summary: request.summary || '',
  sourceUrl: '',
  name: request.patientName || request.bhwPatientId || '',
  canSms: Boolean(request.canSms),
  assigned: request.assignedToName || '',
});

async function fetchRequests(bhwPatientId, session) {
  const result = await operationsRequest(`/v1/patient-requests?bhwPatientId=${encodeURIComponent(bhwPatientId)}&limit=100`, { actor: session });
  return requestRows(result).slice(0, 8).map(shapeRequest);
}

exports.handler = async (event) => {
  try {
    const session = getSession(event);
    if (!session) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in to CrewOS again' }) };

    // ---- WRITE-BACK: Patient Requests update the protected Operations queue ----
    if (event.httpMethod === 'POST') {
      const { pageId, action } = JSON.parse(event.body || '{}');
      if (!action) return { statusCode: 400, body: JSON.stringify({ error: 'missing action' }) };
      // Fax can be sent without a request row for authorized ad-hoc work.
      if (!pageId && !['sms', 'fax', 'fax_status'].includes(action)) return { statusCode: 400, body: JSON.stringify({ error: 'missing pageId' }) };
      if (['start', 'done', 'reopen'].includes(action)) {
        const current = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(pageId)}`, { actor: session });
        const request = current.request || current.patientRequest || {};
        const requestAction = action === 'done' ? 'resolve' : action;
        const body = {
          action: requestAction,
          idempotencyKey: actionKey(`frontdesk-${action}`),
          ...(requestAction === 'resolve' ? { outcome: request.requestType === 'referral' ? 'referral_completed' : 'completed' } : {}),
        };
        const result = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(pageId)}/actions`, { actor: session, method: 'POST', body });
        return { statusCode: 200, body: JSON.stringify({ ok: true, savedAt: result.request?.updatedAt, storage: 'BHW Cloud' }) };
      } else if (action === 'sms') {
        const { text: msg } = JSON.parse(event.body || '{}');
        if (!pageId || !msg) return { statusCode: 400, body: JSON.stringify({ error: 'missing request/text' }) };
        const result = await operationsRequest(`/v1/patient-requests/${encodeURIComponent(pageId)}/messages`, {
          actor: session,
          method: 'POST',
          body: { message: msg, noPhiAttestation: true, idempotencyKey: actionKey('frontdesk-sms') },
        });
        return { statusCode: result.status === 'sent' ? 200 : 202, body: JSON.stringify({ ok: true, ...result }) };
      } else if (action === 'fax') {
        // Fax a document through iFax. Two inputs:
        //   pdf  — base64 of a real PDF (referral, filled paperwork, uploaded doc)
        //   text — a short typed note, rendered onto a 1-page BHW cover sheet
        // `pdf` wins when both are present. Acceptance creates an iFax job; callers
        // must use fax_status and wait for `delivered` before advancing a referral.
        const { to, text: msg, pdf: pdfB64, filename, subject, fromName, toName } = JSON.parse(event.body || '{}');
        if (!to) return { statusCode: 400, body: JSON.stringify({ error: 'missing to' }) };
        if (!pdfB64 && !msg) return { statusCode: 400, body: JSON.stringify({ error: 'missing pdf/text' }) };
        if (!process.env.IFAX_API_KEY) return { statusCode: 503, body: JSON.stringify({ ok: false, detail: 'IFAX_API_KEY not set' }) };
        let pdfBytes, faxName = filename || 'document.pdf';
        if (pdfB64) {
          try { pdfBytes = Buffer.from(String(pdfB64).replace(/^data:.*?;base64,/, ''), 'base64'); }
          catch (e) { return { statusCode: 400, body: JSON.stringify({ ok: false, detail: 'bad pdf base64' }) }; }
        } else {
          try {
            const { PDFDocument, StandardFonts } = require('pdf-lib');
            const doc = await PDFDocument.create();
            const page = doc.addPage([612, 792]);
            const font = await doc.embedFont(StandardFonts.Helvetica);
            const bold = await doc.embedFont(StandardFonts.HelveticaBold);
            page.drawText('BHW Medical Group', { x: 54, y: 726, size: 20, font: bold });
            page.drawText('443-762-5343', { x: 54, y: 706, size: 11, font });
            const words = String(msg).split(/\s+/); const maxW = 500, size = 12; const lines = []; let line = '';
            for (const w of words) { const t = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW) { lines.push(line); line = w; } else line = t; }
            if (line) lines.push(line);
            let y = 656; for (const ln of lines) { if (y < 60) break; page.drawText(ln, { x: 54, y, size, font }); y -= 18; }
            pdfBytes = await doc.save();
            faxName = 'cover.pdf';
          } catch (e) { return { statusCode: 500, body: JSON.stringify({ ok: false, detail: 'pdf: ' + String(e.message || e) }) }; }
        }
        try {
          const ifax = createIFaxClient({
            apiKey: process.env.IFAX_API_KEY,
            callerId: process.env.IFAX_CALLER_ID,
          });
          const accepted = await ifax.sendPdf({
            to,
            pdfBytes,
            filename: faxName,
            subject,
            fromName,
            toName,
            message: msg,
          });
          return { statusCode: 202, body: JSON.stringify({ ok: true, accepted: true, delivered: false, provider: 'iFax', ...accepted }) };
        } catch (e) { return { statusCode: 502, body: JSON.stringify({ ok: false, detail: 'fax: ' + String(e.message || e) }) }; }
      } else if (action === 'fax_status') {
        const { jobId } = JSON.parse(event.body || '{}');
        if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'missing jobId' }) };
        if (!process.env.IFAX_API_KEY) return { statusCode: 503, body: JSON.stringify({ ok: false, detail: 'IFAX_API_KEY not set' }) };
        try {
          const ifax = createIFaxClient({ apiKey: process.env.IFAX_API_KEY });
          const status = await ifax.getStatus(jobId);
          return { statusCode: 200, body: JSON.stringify({ ok: true, provider: 'iFax', ...status }) };
        } catch (e) { return { statusCode: 502, body: JSON.stringify({ ok: false, detail: 'fax status: ' + String(e.message || e) }) }; }
      } else if (action === 'publish') {
        return { statusCode: 410, body: JSON.stringify({ ok: false, error: 'The retired patient-page publisher is disabled. Use the protected Patient Requests communication workflow.' }) };
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: 'unknown action' }) };
      }
    }

    // ---- SPECIALIST DIRECTORY: ?dir=1 -> the referral directory (live from Notion) ----
    if (event.queryStringParameters?.dir) {
      const SPEC_DB = process.env.SPECIALIST_DB_ID || '8ae69b6a2f1a42679848744f3a17acb6';
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

    // BHW0000 is reserved outside the live patient registry. Expose it only
    // for an exact protected smoke test so Front Desk can exercise the same
    // Health Core referral path without creating a duplicate patient record.
    if (pid.toUpperCase() === 'BHW0000') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ patient: BHW0000, requests: [] }),
      };
    }
    if (q.toUpperCase() === 'BHW0000') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          matches: [{ id: BHW0000.id, name: BHW0000.name, ctl: BHW0000.ctl, dob: BHW0000.dob, phone: '', status: BHW0000.status }],
          patient: BHW0000,
          requests: [],
        }),
      };
    }

    // ---- DIRECT PATIENT: ?pid=<pageId> -> full detail for one chosen match ----
    if (pid) {
      const patient = await findCloudPatient(pid, session);
      if (!patient) return { statusCode: 200, body: JSON.stringify({ patient: null }) };
      const requests = await fetchRequests(patient.bhwPatientId, session);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ patient, requests }),
      };
    }

    // ---- INBOX MODE: no q -> return the live activity feed ----
    if (!q) {
      const result = await operationsRequest('/v1/patient-requests?limit=100', { actor: session });
      const items = requestRows(result).map(shapeRequest);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ items }),
      };
    }

    const results = searchCloudPatients(await listCloudPatients(session), q, 25).filter(r => r.name);
    if (!results.length) return { statusCode: 200, body: JSON.stringify({ matches: [], patient: null }) };

    // Return EVERY match so the desk can pick the right person when names
    // collide (e.g. two "Amaris"). Sorted by name for a stable chooser.
    const matches = results.map(p => ({
      id: p.id,
      name: p.name,
      ctl: p.bhwPatientId,
      dob: p.dob || '',
      phone: p.phone || '',
      status: p.status || '',
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Exactly one match -> include full detail, so single-hit search is unchanged.
    if (results.length === 1) {
      const patient = results[0];
      const requests = await fetchRequests(patient.bhwPatientId, session);
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
