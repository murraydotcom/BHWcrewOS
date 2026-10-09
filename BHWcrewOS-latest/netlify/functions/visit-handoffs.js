const crypto = require('node:crypto');
const { getSession } = require('./_lib');
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) });
const COMMAND_KEYS = new Set(['action', 'commandId', 'expectedRevision', 'resultId', 'assignee', 'dueAt']);
function handoffToken(session, secret, now) {
  if (!secret || !session?.staffId) throw Error('Visit handoff access is unavailable.');
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'bhw-crewhq', aud: 'bhw-rcm-cloud', sub: `crew:${session.staffId}`, staffId: session.staffId,
    role: session.healthRole || session.role || 'staff', scope: 'visit-handoff-metadata', iat, exp: iat + 60 })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function createVisitHandoffsHandler({ sessionImpl = getSession, fetchImpl = fetch, environment = process.env, now = Date.now } = {}) {
  return async event => {
    if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { ok: false, error: 'GET or POST only.' });
    const session = sessionImpl(event);
    if (!session?.staffId) return json(401, { ok: false, error: 'Sign in to CrewHQ again.' });
    if (environment.SYNTHETIC_VISIT_HANDOFFS_ENABLED !== 'true') return json(503, { ok: false, error: 'Synthetic visit handoffs are not enabled.' });
    if (event.queryStringParameters?.patient && event.queryStringParameters.patient !== 'BHW0000') return json(403, { ok: false, error: 'Real-patient handoffs are disabled.' });
    let base, command;
    try {
      base = new URL(environment.HEALTH_CORE_API_URL);
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw Error();
    } catch { return json(503, { ok: false, error: 'Visit handoffs are unavailable.' }); }
    if (event.httpMethod === 'POST') {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
      if (Buffer.byteLength(raw, 'utf8') > 1500) return json(413, { ok: false, error: 'Handoff metadata request is too large.' });
      try { command = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'Invalid handoff metadata request.' }); }
      if (!command || Array.isArray(command) || typeof command !== 'object' || Object.keys(command).some(key => !COMMAND_KEYS.has(key))
        || !['assign-follow-up', 'complete-follow-up'].includes(command.action)) return json(400, { ok: false, error: 'Only follow-up metadata is accepted here.' });
      if (command.action === 'complete-follow-up' && ('assignee' in command || 'dueAt' in command)) return json(400, { ok: false, error: 'Unsupported completion metadata.' });
    }
    try {
      const response = await fetchImpl(base.origin + '/v1/visit-handoffs/inbox', { method: event.httpMethod, redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${handoffToken(session, environment.CREWHQ_CLOUD_TOKEN_SECRET, now())}`, Accept: 'application/json', ...(command ? { 'Content-Type': 'application/json' } : {}) },
        ...(command ? { body: JSON.stringify(command) } : {}) });
      const data = await response.json().catch(() => null);
      if (!response.ok) return json([400, 401, 403, 404, 409, 413, 429, 503].includes(response.status) ? response.status : 502,
        { ok: false, error: response.status < 500 ? data?.error || 'Visit handoff denied.' : 'Visit handoffs are unavailable.', ...(command && response.status >= 500 ? { saveUnconfirmed: true } : {}) });
      if (data?.ok !== true || !data.inbox || data.inbox.patientReference !== 'BHW0000' || !Number.isSafeInteger(data.inbox.revision)
        || !Array.isArray(data.inbox.results) || data.inbox.results.length > 30 || command && data.commandId !== command.commandId) throw Error('Unconfirmed response');
      // Rebuild the response from an explicit metadata allowlist, even if Health Core adds fields later.
      const inbox = { schemaVersion: 'bhw.synthetic-visit-handoffs.v1', patientReference: 'BHW0000', revision: data.inbox.revision,
        results: data.inbox.results.map(r => {
          if (!/^result-[a-f0-9]{40}$/.test(r.resultId) || !['reviewed', 'needs-review'].includes(r.reviewStatus)) throw Error('Invalid result metadata');
          return { resultId: r.resultId, receivedAt: r.receivedAt, reviewStatus: r.reviewStatus,
            followUp: r.followUp ? { status: r.followUp.status, assignee: r.followUp.assignee, dueAt: r.followUp.dueAt,
              ...(r.followUp.completedAt ? { completedAt: r.followUp.completedAt } : {}) } : null };
        }) };
      const staff = (Array.isArray(data.staff) ? data.staff : []).slice(0, 100).map(s => ({ id: s.id, name: s.name, role: s.role }));
      return json(200, { ok: true, inbox, ...(command ? { commandId: command.commandId, replayed: data.replayed === true } : { staff }) });
    } catch { return json(502, { ok: false, saveUnconfirmed: Boolean(command), error: command ? 'Save could not be confirmed. Retry the same submission.' : 'Visit handoffs could not be loaded.' }); }
  };
}
exports.handler = createVisitHandoffsHandler();
exports._test = { createVisitHandoffsHandler, handoffToken };
