const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createModerationService } = require('../../lib/moderation');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function createUser(db, suffix, role = 'user') {
  const result = await db.query(
    `INSERT INTO users (username, email, password_hash, public_id, display_name, role)
     VALUES ($1, $2, 'synthetic-hash', $3, $4, $5) RETURNING id, session_version`,
    [`n4_${suffix}`, `n4-${suffix}@example.test`, `nvy_${Buffer.from(suffix).toString('hex').padEnd(12, '0').slice(0, 12)}`, `N4 ${suffix}`, role]
  );
  return result.rows[0];
}

test('N4 moderation bans are auditable, transactional and network-separated', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const actor = await createUser(db, 'moderator', 'admin');
  const reviewer = await createUser(db, 'reviewer', 'admin');
  const target = await createUser(db, 'target');
  const disconnected = [];
  const restrictedGuests = [];
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

  const guest = (await db.query(
    `INSERT INTO guest_principals
       (public_id, display_alias, name, gender, age, country, country_code, avatar_id)
     VALUES ('gst_a4b0c0d00001', 'gst_N4GUEST001', 'N4 Guest', 'any', 28, 'Switzerland', 'ch', 'astra')
     RETURNING id`
  )).rows[0];
  const guestModeration = createModerationService({
    db,
    chat: { async terminateGuest(guestId, payload) { restrictedGuests.push({ guestId, payload }); } },
    environment: { NETWORK_BAN_HMAC_KEY: 'integration-only-network-fingerprint-secret' }
  });
  const guestBan = await guestModeration.banGuest({
    actorUserId: Number(actor.id), targetGuestId: guest.id, type: 'temporary', hours: 12,
    reason: 'Documented guest moderation decision'
  });
  assert.equal(guestBan.idempotent, false);
  assert.equal(await guestModeration.isGuestBlocked(guest.id), true);
  assert.equal(restrictedGuests.length, 1);
  const guestAudit = (await db.query(
    `SELECT reason, before_state, after_state FROM audit_log WHERE target_guest_id = $1`, [guest.id]
  )).rows[0];
  assert.equal(guestAudit.reason, 'Documented guest moderation decision');
  assert.equal(Object.hasOwn(guestAudit.after_state, 'message'), false);
  assert.equal(Object.hasOwn(guestAudit.after_state, 'name'), false);
  await guestModeration.revokeGuestBan({
    actorUserId: Number(actor.id), banId: Number(guestBan.id), reason: 'Guest restriction review completed'
  });
  assert.equal(await guestModeration.isGuestBlocked(guest.id), false);

  const permanentGuest = (await db.query(
    `INSERT INTO guest_principals
       (public_id, display_alias, device_principal_fingerprint, name, gender, age, country, country_code, avatar_id)
     VALUES ('gst_a4b0c0d00002', 'gst_N4GUEST002', repeat('a', 64), 'N4 Permanent Guest', 'any', 28, 'Switzerland', 'ch', 'astra')
     RETURNING id`
  )).rows[0];
  const permanentBan = await guestModeration.banGuest({
    actorUserId: Number(actor.id), targetGuestId: permanentGuest.id, type: 'permanent',
    reason: 'Documented permanent guest moderation decision'
  });
  assert.equal(await guestModeration.isGuestDeviceRestricted('a'.repeat(64)), true);
  await guestModeration.revokeGuestBan({
    actorUserId: Number(actor.id), banId: Number(permanentBan.id), reason: 'Device restriction review completed'
  });
  assert.equal(await guestModeration.isGuestDeviceRestricted('a'.repeat(64)), false);

  const revoked = await moderation.revokeAccountBan({
    actorUserId: Number(actor.id), banId: Number(ban.id), reason: 'Appeal accepted'
  });
  assert.equal(revoked.idempotent, false);
  assert.notEqual(revoked.revoked_at, null);

  const privacyApproval = await moderation.requestNetworkBanPrivacyApproval({
    actorUserId: Number(actor.id), cidr: '203.0.113.0/24',
    reason: 'Request an independent privacy review'
  });
  await assert.rejects(
    moderation.approveNetworkBanPrivacyApproval({
      reviewerUserId: Number(actor.id), approvalId: privacyApproval.id,
      reason: 'Self review is prohibited', reviewReference: 'privacy-review-N4-self'
    }),
    (error) => error.code === 'PRIVACY_REVIEW_REQUIRED'
  );
  await moderation.approveNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: privacyApproval.id,
    reason: 'Scope and expiry are proportionate', reviewReference: 'privacy-review-N4-001'
  });
  const networkBan = await moderation.createNetworkBan({
    actorUserId: Number(actor.id), cidr: '203.0.113.0/24', hours: 12,
    reason: 'Reviewed network abuse pattern', privacyApprovalId: privacyApproval.id
  });
  assert.equal(networkBan.idempotent, false);
  assert.equal(await moderation.isNetworkBlocked('203.0.113.99'), true);
  assert.equal(await moderation.isNetworkBlocked('203.0.114.1'), false);
  const storedNetwork = (await db.query('SELECT network_fingerprint, reason FROM network_bans WHERE id = $1', [networkBan.id])).rows[0];
  assert.match(storedNetwork.network_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(storedNetwork.network_fingerprint.includes('203.0.113'), false);
  const consumedApproval = (await db.query(
    `SELECT approved_by, consumed_by, review_reference FROM network_ban_privacy_approvals WHERE id = $1`,
    [privacyApproval.id]
  )).rows[0];
  assert.equal(Number(consumedApproval.approved_by), Number(reviewer.id));
  assert.equal(Number(consumedApproval.consumed_by), Number(actor.id));
  assert.equal(consumedApproval.review_reference, 'privacy-review-N4-001');
  await assert.rejects(
    moderation.createNetworkBan({
      actorUserId: Number(actor.id), cidr: '203.0.113.0/24', hours: 12,
      reason: 'A consumed approval cannot be reused', privacyApprovalId: privacyApproval.id
    }),
    (error) => error.code === 'PRIVACY_REVIEW_REQUIRED'
  );
});

test('a valid login receives only the limited suspension mode and an idempotent appeal path', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db, closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'n4-suspension-integration-secret' },
    log: { info() {}, warn() {}, error() {} }
  });
  t.after(async () => { await runtime.shutdown(); await db.close(); });
  const account = request.agent(runtime.app);
  await account.post('/register').set('Accept', 'application/json').send({
    username: 'suspended_member', email: 'suspended-member@example.test', password: 'SyntheticPassword123!',
    birthDate: '1990-06-15', gender: 'non-binary', countryCode: 'ch'
  }).expect(201);
  const user = (await db.query('SELECT id FROM users WHERE email = $1', ['suspended-member@example.test'])).rows[0];
  const ban = (await db.query(
    `INSERT INTO account_bans (user_id, type, reason, ends_at, created_by)
     VALUES ($1, 'temporary', 'Documented suspension reason', NOW() + INTERVAL '4 hours', $1) RETURNING id`,
    [user.id]
  )).rows[0];
  const suspended = await account.post('/login').set('Accept', 'application/json').send({
    email: 'suspended-member@example.test', password: 'SyntheticPassword123!'
  }).expect(403);
  assert.equal(suspended.body.code, 'ACCOUNT_SUSPENDED');
  assert.equal(suspended.body.suspension.reason, 'Documented suspension reason');
  assert.equal(suspended.body.suspension.type, 'temporary');
  await account.get('/api/account').expect(403);
  const appeal = await account.post('/api/suspension/appeals').send({ reason: 'Please review this documented decision.' }).expect(201);
  const repeat = await account.post('/api/suspension/appeals').send({ reason: 'Please review this documented decision.' }).expect(200);
  assert.equal(repeat.body.appealId, appeal.body.appealId);
  assert.equal(repeat.body.idempotent, true);
  const audit = (await db.query('SELECT after_state FROM audit_log WHERE action = $1', ['account_ban_appeal_created'])).rows[0];
  assert.equal(Object.hasOwn(audit.after_state, 'message'), false);
  assert.equal(Number((await db.query('SELECT count(*) AS count FROM moderation_appeals WHERE account_ban_id = $1', [ban.id])).rows[0].count), 1);
});
