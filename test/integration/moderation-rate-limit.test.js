const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createModerationRateLimiter } = require('../../lib/moderation-rate-limit');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

test('distributed moderation rate limits survive replica handoff and expire escalation', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  t.after(() => db.close());

  const policies = {
    message: { limit: 2, windowSeconds: 60, escalationSeconds: [30, 120] }
  };
  const replicaOne = createModerationRateLimiter({ db, policies });
  const replicaTwo = createModerationRateLimiter({ db, policies });
  const principal = { principalType: 'guest', principalId: '0f5de810-0a9c-4f0d-84c7-9ed9d0d5e9b1', action: 'message' };

  assert.equal((await replicaOne.consume(principal)).allowed, true);
  assert.equal((await replicaTwo.consume(principal)).allowed, true);
  const blocked = await replicaOne.consume(principal);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.escalationLevel, 1);
  assert.equal(blocked.retryAfterSeconds, 30);

  const handedOff = await replicaTwo.consume(principal);
  assert.equal(handedOff.allowed, false);
  assert.equal(handedOff.escalationLevel, 1);
  assert.ok(handedOff.retryAfterSeconds > 0);

  await db.query(
    `UPDATE moderation_rate_windows
     SET window_started_at = NOW() - INTERVAL '2 seconds',
         expires_at = NOW() - INTERVAL '1 second',
         escalation_expires_at = NOW() - INTERVAL '1 second'
     WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
    [principal.principalType, principal.principalId, principal.action]
  );
  const expired = await replicaTwo.consume(principal);
  assert.equal(expired.allowed, true);
  assert.equal(expired.count, 1);
  assert.equal(expired.escalationLevel, 0);
});
