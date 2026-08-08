const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL,
  deleteExpiredPendingRegistrations,
  findActivePendingRegistration
} = require('../../lib/pending-registrations');

test('pending registration cleanup is bounded, session-aware and scoped to active verification tokens', async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    }
  };

  await deleteExpiredPendingRegistrations(executor, {
    limit: 2,
    userId: 42,
    email: 'pending@example.test',
    username: 'pending_member'
  });
  assert.deepEqual(calls[0].params, [2, 42, 'pending@example.test', 'pending_member']);
  assert.match(DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL, /registration_pending_at IS NOT NULL/);
  assert.match(DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL, /expires_at > NOW\(\)/);
  assert.match(DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL, /FOR UPDATE OF u SKIP LOCKED/);
  assert.match(DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL, /DELETE FROM session/);
  assert.match(DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL, /DELETE FROM users/);

  await findActivePendingRegistration(executor, {
    email: 'pending@example.test',
    username: 'pending_member'
  });
  assert.deepEqual(calls[1].params, ['pending@example.test', 'pending_member']);
  assert.match(calls[1].sql, /revoked_at IS NULL/);
  assert.match(calls[1].sql, /expires_at > NOW\(\)/);
});
