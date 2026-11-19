const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessAdminMaster } = require('../netlify/functions/lib/staff-access');
const { sign } = require('../netlify/functions/_lib');
const { handler: opsData } = require('../netlify/functions/ops-data');
const { handler: action } = require('../netlify/functions/action');
const lead = { staffId: 'synthetic-operations-lead', name: 'Synthetic operations lead',
  role: 'Operations and Coordination Lead', access: 'Division Admin', divisions: ['All'], canSchedule: true };

const owner = { staffId: '39358075-8d30-81a2-9d5a-d2fbca3cf4b5', access: 'Admin' };
const margaret = { staffId: '39358075-8d30-8125-93b0-d54f9e1fb69b', access: 'Division' };

test('Admin Master uses signed staff IDs, independent of role labels or administrator status', () => {
  assert.equal(canAccessAdminMaster(owner), true);
  assert.equal(canAccessAdminMaster(margaret), true);
  for (const session of [undefined, {}, lead, { access: 'Admin' },
    { staffId: 'different-staff', access: 'Admin', name: 'Margaret' }]) {
    assert.equal(canAccessAdminMaster(session), false);
  }
});

test('direct Admin Master and legacy overview requests reject other signed-in staff', async () => {
  const old = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'synthetic-test-secret';
  try {
    for (const session of [lead, { staffId: 'another-admin', access: 'Admin' }]) {
      const token = sign({ ...session, exp: Date.now() + 60000 });
      for (const view of ['admin-master', 'operations-overview']) {
        const response = await opsData({
          httpMethod: 'GET', headers: { authorization: `Bearer ${token}` },
          queryStringParameters: { view },
        });
        assert.equal(response.statusCode, 403);
        assert.deepEqual(JSON.parse(response.body), { error: 'You do not have access to Admin Master.' });
      }
    }
  } finally {
    if (old === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = old;
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
