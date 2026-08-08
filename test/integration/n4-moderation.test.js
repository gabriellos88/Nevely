const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createModerationService } = require('../../lib/moderation');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function createUser(db, suffix, role = 'user') {
  const result = await db.query(
    `INSERT INTO users (username, email, password_hash, public_id, display_name, role)
     VALUES ($1, $2, 'synthetic-hash', $3, $4, $5) RETURNING id, session_version`,
    [`n4_${suffix}`, `n4-${suffix}@example.test`, `nvy_${suffix.padEnd(20, '0').slice(0, 20)}`, `N4 ${suffix}`, role]
  );
  return result.rows[0];
}

test('N4 moderation bans are auditable, transactional and network-separated', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  t.after(() => db.close());
  const actor = await createUser(db, 'moderator', 'admin');
  const reviewer = await createUser(db, 'reviewer', 'admin');
  const target = await createUser(db, 'target');
  const disconnected = [];
  const moderation = createModerationService({
    db,
    chat: { async terminateUser(userId, payload) { disconnected.push({ userId, payload }); } },
    environment: { NETWORK_BAN_HMAC_KEY: 'integration-only-network-fingerprint-secret' }
  });

  const ban = await moderation.banAccount({
    actorUserId: Number(actor.id), targetUserId: Number(target.id), type: 'temporary', hours: 4,
    reason: 'Documented moderation decision'
  });
  assert.equal(ban.idempotent, false);
  assert.equal(disconnected.length, 1);
  assert.equal(disconnected[0].userId, Number(target.id));
  assert.equal(
    Number((await db.query('SELECT session_version FROM users WHERE id = $1', [target.id])).rows[0].session_version),
    Number(target.session_version) + 1
  );
  const audit = (await db.query(
    `SELECT action, reason, before_state, after_state, correlation_id
     FROM audit_log WHERE target_user_id = $1`, [target.id]
  )).rows[0];
  assert.equal(audit.action, 'account_ban_created');
  assert.equal(audit.reason, 'Documented moderation decision');
  assert.equal(Object.hasOwn(audit.after_state, 'message'), false);
  assert.match(audit.correlation_id, /^[0-9a-f-]{36}$/i);
  await assert.rejects(
    moderation.banAccount({
      actorUserId: Number(actor.id), targetUserId: Number(actor.id), type: 'permanent',
      reason: 'An administrator cannot self-ban'
    }),
    (error) => error.code === 'SELF_MODERATION_FORBIDDEN'
  );

  const repeat = await moderation.banAccount({
    actorUserId: Number(actor.id), targetUserId: Number(target.id), type: 'temporary', hours: 4,
    reason: 'Documented moderation decision'
  });
  assert.equal(repeat.idempotent, true);
  assert.equal(disconnected.length, 1);

  const revoked = await moderation.revokeAccountBan({
    actorUserId: Number(actor.id), banId: Number(ban.id), reason: 'Appeal accepted'
  });
  assert.equal(revoked.idempotent, false);
  assert.notEqual(revoked.revoked_at, null);

  const networkBan = await moderation.createNetworkBan({
    actorUserId: Number(actor.id), cidr: '203.0.113.0/24', hours: 12,
    reason: 'Reviewed network abuse pattern', privacyReviewedByUserId: Number(reviewer.id),
    privacyReviewReference: 'privacy-review-N4-001'
  });
  assert.equal(networkBan.idempotent, false);
  assert.equal(await moderation.isNetworkBlocked('203.0.113.99'), true);
  assert.equal(await moderation.isNetworkBlocked('203.0.114.1'), false);
  const storedNetwork = (await db.query('SELECT network_fingerprint, reason FROM network_bans WHERE id = $1', [networkBan.id])).rows[0];
  assert.match(storedNetwork.network_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(storedNetwork.network_fingerprint.includes('203.0.113'), false);
});
