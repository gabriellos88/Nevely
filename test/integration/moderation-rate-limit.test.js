const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { createModerationRateLimiter } = require('../../lib/moderation-rate-limit');
const { createMessageAbuseProtector } = require('../../lib/message-abuse');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (hasDatabase) {
    await require('../../db').close();
  }
});

test('distributed moderation rate limits survive replica handoff and expire escalation', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);

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

test('progressive skip cooldown is shared across replicas and reconnects without counting the retry twice', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);

  const replicaOne = createModerationRateLimiter({ db });
  const replicaTwo = createModerationRateLimiter({ db });
  const principal = { principalType: 'guest', principalId: '8d44a01d-8a5d-4b4d-83b8-70e4f3eb40e3', action: 'skip' };

  for (let count = 1; count <= 3; count += 1) {
    const allowed = await replicaOne.consume(principal);
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.count, count);
  }

  const fourth = await replicaTwo.consume(principal);
  assert.deepEqual(
    { allowed: fourth.allowed, count: fourth.count, retryAfterSeconds: fourth.retryAfterSeconds },
    { allowed: false, count: 4, retryAfterSeconds: 1 }
  );

  const reconnectDuringCooldown = await replicaOne.consume(principal);
  assert.equal(reconnectDuringCooldown.allowed, false);
  assert.equal(reconnectDuringCooldown.count, 4);
  assert.ok(reconnectDuringCooldown.retryAfterSeconds > 0);

  await db.query(
    `UPDATE moderation_rate_windows
     SET window_started_at = NOW() - INTERVAL '2 seconds',
         cooldown_expires_at = NOW() - INTERVAL '1 second'
     WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
    [principal.principalType, principal.principalId, principal.action]
  );
  const retryAfterReconnect = await replicaTwo.consume(principal);
  assert.deepEqual(
    { allowed: retryAfterReconnect.allowed, count: retryAfterReconnect.count, retryAfterSeconds: retryAfterReconnect.retryAfterSeconds },
    { allowed: true, count: 4, retryAfterSeconds: 0 }
  );

  for (let count = 5; count <= 11; count += 1) {
    const expectedDelay = count <= 6 ? 1 : count <= 10 ? 2 : 5;
    const blocked = await (count % 2 ? replicaOne : replicaTwo).consume(principal);
    assert.deepEqual(
      { allowed: blocked.allowed, count: blocked.count, retryAfterSeconds: blocked.retryAfterSeconds },
      { allowed: false, count, retryAfterSeconds: expectedDelay }
    );
    await db.query(
      `UPDATE moderation_rate_windows
       SET window_started_at = NOW() - INTERVAL '2 seconds',
           cooldown_expires_at = NOW() - INTERVAL '1 second'
       WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
      [principal.principalType, principal.principalId, principal.action]
    );
    const granted = await (count % 2 ? replicaTwo : replicaOne).consume(principal);
    assert.equal(granted.allowed, true);
    assert.equal(granted.count, count);
  }

  await db.query(
    `UPDATE moderation_rate_windows
     SET expires_at = NOW() - INTERVAL '1 second',
         cooldown_expires_at = NULL,
         cooldown_grant_available = FALSE
     WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
    [principal.principalType, principal.principalId, principal.action]
  );
  const expiredWindow = await replicaTwo.consume(principal);
  assert.deepEqual(
    { allowed: expiredWindow.allowed, count: expiredWindow.count, retryAfterSeconds: expiredWindow.retryAfterSeconds },
    { allowed: true, count: 1, retryAfterSeconds: 0 }
  );

  const concurrentPrincipal = {
    principalType: 'guest',
    principalId: '9a64a01d-8a5d-4b4d-83b8-70e4f3eb40e4',
    action: 'skip'
  };
  const concurrent = await Promise.all([
    replicaOne.consume(concurrentPrincipal),
    replicaTwo.consume(concurrentPrincipal),
    replicaOne.consume(concurrentPrincipal),
    replicaTwo.consume(concurrentPrincipal)
  ]);
  assert.deepEqual(concurrent.map((result) => result.count).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(concurrent.filter((result) => result.allowed).length, 3);
  assert.deepEqual(
    concurrent.find((result) => !result.allowed),
    { allowed: false, count: 4, retryAfterSeconds: 1, escalationLevel: 0 }
  );
});

test('message abuse buckets are pseudonymous, shared across replicas and do not retain message text', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const policies = {
    'message-duplicate': { limit: 1, windowSeconds: 60, escalationSeconds: [15] },
    'message-link-flood': { limit: 1, windowSeconds: 60, escalationSeconds: [15] },
    'message-repeated-character-flood': { limit: 1, windowSeconds: 60, escalationSeconds: [15] }
  };
  const first = createMessageAbuseProtector({ rateLimiter: createModerationRateLimiter({ db, policies }), hmacSecret: 'test-only-shared-message-hmac-secret' });
  const second = createMessageAbuseProtector({ rateLimiter: createModerationRateLimiter({ db, policies }), hmacSecret: 'test-only-shared-message-hmac-secret' });
  const input = { principalType: 'guest', principalId: '8d44a01d-8a5d-4b4d-83b8-70e4f3eb40e3', text: 'HＥllo\u200b   WORLD' };
  assert.equal((await first.consume(input)).allowed, true);
  const duplicate = await second.consume({ ...input, text: ' hello world ' });
  assert.equal(duplicate.allowed, false);
  assert.ok(duplicate.retryAfterSeconds > 0);
  const rows = await db.query("SELECT principal_type, principal_id, action FROM moderation_rate_windows WHERE action LIKE 'message-%'");
  assert.deepEqual(rows.rows.map((row) => row.principal_type), ['signal']);
  assert.equal(rows.rows.some((row) => row.principal_id.includes('hello')), false);
  assert.equal(rows.rows.some((row) => row.principal_id === input.principalId), false);

  const concurrent = await Promise.all([
    first.consume({ ...input, text: 'Concurrent normalized duplicate' }),
    second.consume({ ...input, text: ' concurrent  normalized duplicate ' })
  ]);
  assert.equal(concurrent.filter((result) => result.allowed).length, 1);
  assert.equal(concurrent.filter((result) => !result.allowed).length, 1);
});
