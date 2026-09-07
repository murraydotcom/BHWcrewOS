const IFAX_API_BASE = 'https://api.ifaxapp.com/v1/customer';
const MAX_FAX_BYTES = 20 * 1024 * 1024;

function normalizeFaxNumber(value) {
  const raw = String(value || '').trim();
  const numeric = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && numeric.length >= 10 && numeric.length <= 15) return `+${numeric}`;
  if (numeric.length === 10) return `+1${numeric}`;
  if (numeric.length === 11 && numeric.startsWith('1')) return `+${numeric}`;
  throw new Error('invalid fax number');
}

function cleanFilename(value) {
  const safe = String(value || 'document.pdf').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

function assertPdf(pdfBytes) {
  const bytes = Buffer.from(pdfBytes || []);
  if (!bytes.length || bytes.length > MAX_FAX_BYTES) throw new Error('fax PDF must be between 1 byte and 20 MB');
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('fax attachment must be a PDF');
  return bytes;
}

function createIFaxClient({ apiKey, callerId, fetchImpl = fetch } = {}) {
  const token = String(apiKey || '').trim();
  const headers = () => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    accessToken: token,
  });

  async function post(path, body) {
    if (!token) throw new Error('IFAX_API_KEY not set');
    const response = await fetchImpl(`${IFAX_API_BASE}/${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || Number(payload.status) !== 1) {
      const error = new Error('iFax rejected the request');
      error.providerStatus = response.status;
      error.providerCode = payload?.data?.code ?? payload?.code ?? null;
      throw error;
    }
    return payload;
  }

  return {
    async sendPdf({ to, pdfBytes, filename, subject, fromName, toName, message }) {
      const bytes = assertPdf(pdfBytes);
      const body = {
        faxNumber: normalizeFaxNumber(to),
        subject: String(subject || 'BHW Medical Group referral').slice(0, 160),
        from_name: String(fromName || 'BHW Medical Group').slice(0, 120),
        to_name: String(toName || '').slice(0, 120),
        message: String(message || 'Protected clinical referral document.').slice(0, 500),
        faxQuality: 'Standard',
        faxData: [{ fileName: cleanFilename(filename), fileData: bytes.toString('base64') }],
      };
      if (callerId) body.callerId = normalizeFaxNumber(callerId);
      const payload = await post('fax-send', body);
      const jobId = payload?.data?.jobId;
      if (!jobId) throw new Error('iFax accepted the request without a job ID');
      return { jobId: String(jobId), faxStatus: 'sending' };
    },

    async getStatus(jobId) {
      const normalizedJobId = String(jobId || '').trim();
      if (!/^\d+$/.test(normalizedJobId)) throw new Error('invalid iFax job ID');
      const payload = await post('fax-status', { jobId: normalizedJobId });
      const data = payload?.data || {};
      const faxStatus = String(data.faxStatus || '').trim().toLowerCase();
      return {
        jobId: String(data.jobId || normalizedJobId),
        faxStatus,
        delivered: faxStatus === 'delivered',
        terminal: ['delivered', 'canceled', 'partially_cancelled', 'failed', 'failed_chargeable', 'blocked'].includes(faxStatus),
        pages: Number(data.faxTotalPages || 0),
        transferredPages: Number(data.faxTransferredPages || 0),
        code: data.code ?? null,
      };
    },
  };
}

module.exports = { createIFaxClient, normalizeFaxNumber };
