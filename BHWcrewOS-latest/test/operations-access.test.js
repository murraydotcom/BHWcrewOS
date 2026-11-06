const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessOperationsOverview } = require('../netlify/functions/lib/staff-access');
const { sign } = require('../netlify/functions/_lib');
const { handler: action } = require('../netlify/functions/action');
const lead = { staffId: 'synthetic-operations-lead', name: 'Synthetic operations lead',
  role: 'Operations and Coordination Lead', access: 'Division Admin', divisions: ['All'], canSchedule: true };

test('operations oversight requires the assigned role, delegated access, and all-program scope', () => {
  assert.equal(canAccessOperationsOverview(lead), true);
  assert.equal(canAccessOperationsOverview({ access: 'Admin' }), true);
  for (const session of [{}, { ...lead, access: 'Division' }, { ...lead, role: 'BH Coordinator' },
    { ...lead, divisions: ['Mind & Mood Recovery'] }, { ...lead, divisions: [] }]) {
    assert.equal(canAccessOperationsOverview(session), false);
  }
});

test('an operations lead cannot sign clinical documentation', async () => {
  const old = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'synthetic-test-secret';
  try {
    const token = sign({ ...lead, exp: Date.now() + 60000 });
    const response = await action({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'awv-sign', id: 'synthetic-encounter' }) });
    assert.equal(response.statusCode, 403);
    assert.match(JSON.parse(response.body).error, /Only a provider/);
  } finally {
    if (old === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = old;
  }
});
