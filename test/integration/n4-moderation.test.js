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
     VALUES ($1, $2, 'synthetic-hash', $3, $4, $5) RETURNING id, public_id, session_version`,
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
  const networkTerminations = [];
  const moderation = createModerationService({
    db,
    chat: {
      async terminateUser(userId, payload) { disconnected.push({ userId, payload }); },
      async terminateNetwork(control) { networkTerminations.push(control); }
    },
    environment: { NETWORK_BAN_HMAC_KEY: 'integration-only-network-fingerprint-secret' }
  });

  const ban = await moderation.banAccount({
    actorUserId: Number(actor.id), targetUserId: Number(target.id), type: 'temporary', hours: 4,
    reason: 'Documented moderation decision'
  });
  assert.equal(ban.idempotent, false);
  assert.equal(disconnected.length, 1);
  assert.equal(disconnected[0].userId, Number(target.id));
  assert.deepEqual(disconnected[0].payload, {});
  assert.equal(Number((await db.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND type = 'account_ban'`,
    [target.id]
  )).rows[0].count), 0);
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

  await assert.rejects(
    moderation.requestNetworkBanPrivacyApproval({
      actorUserId: Number(actor.id), sourceType: 'account', publicId: target.public_id,
      hours: 12, reason: 'No network action without an active account restriction'
    }),
    (error) => error.code === 'ACTIVE_ACCOUNT_BAN_REQUIRED'
  );
  await moderation.banAccount({
    actorUserId: Number(actor.id), targetUserId: Number(target.id), type: 'permanent',
    reason: 'Account restriction remains separate from network review'
  });
  assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM network_bans')).rows[0].count), 0);
  await db.query(
    `UPDATE users SET last_ip = '203.0.113.77', last_network_seen_at = NOW() WHERE id = $1`,
    [target.id]
  );
  await assert.rejects(
    moderation.requestNetworkBanPrivacyApproval({
      actorUserId: Number(actor.id), sourceType: 'account', publicId: String(target.id),
      hours: 12, reason: 'An internal identifier is not a public target'
    }),
    (error) => error.code === 'TARGET_NOT_FOUND'
  );
  const privacyApproval = await moderation.requestNetworkBanPrivacyApproval({
    actorUserId: Number(actor.id), sourceType: 'account', publicId: target.public_id,
    hours: 12, reason: 'Request a narrow independent privacy review'
  });
  await assert.rejects(
    moderation.reviewNetworkBanPrivacyApproval({
      reviewerUserId: Number(actor.id), approvalId: privacyApproval.id,
      decision: 'approve', reason: 'Self review is prohibited'
    }),
    (error) => error.code === 'PRIVACY_REVIEW_REQUIRED'
  );
  const approved = await moderation.reviewNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: privacyApproval.id,
    decision: 'approve', reason: 'Scope and expiry are proportionate'
  });
  assert.equal(approved.idempotent, false);
  assert.equal(Number(approved.ban.prefix_length), 32);
  assert.equal(networkTerminations.length, 1);
  assert.equal(JSON.stringify(networkTerminations).includes('203.0.113'), false);
  const retry = await moderation.reviewNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: privacyApproval.id,
    decision: 'approve', reason: 'Scope and expiry are proportionate'
  });
  assert.equal(retry.idempotent, true);
  assert.equal(Number(retry.ban.id), Number(approved.ban.id));
  assert.equal(await moderation.isNetworkBlocked('203.0.113.77'), true);
  assert.equal(await moderation.isNetworkBlocked('203.0.113.99'), false);
  assert.equal(await moderation.isNetworkBlocked('203.0.114.1'), false);
  const storedNetwork = (await db.query(
    `SELECT network_fingerprint, reason, source_type, source_user_id, source_account_ban_id,
            privacy_approval_id FROM network_bans WHERE id = $1`,
    [approved.ban.id]
  )).rows[0];
  assert.match(storedNetwork.network_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(storedNetwork.network_fingerprint.includes('203.0.113'), false);
  assert.equal(storedNetwork.source_type, 'account');
  assert.equal(Number(storedNetwork.source_user_id), Number(target.id));
  assert.equal(storedNetwork.privacy_approval_id, privacyApproval.id);
  const consumedApproval = (await db.query(
    `SELECT approved_by, consumed_by, review_reference FROM network_ban_privacy_approvals WHERE id = $1`,
    [privacyApproval.id]
  )).rows[0];
  assert.equal(Number(consumedApproval.approved_by), Number(reviewer.id));
  assert.equal(Number(consumedApproval.consumed_by), Number(reviewer.id));
  assert.equal(consumedApproval.review_reference, `dual-control:${privacyApproval.id}`);

  await assert.rejects(
    moderation.requestNetworkBanPrivacyApproval({
      actorUserId: Number(actor.id), sourceType: 'manual', cidr: '198.51.100.0/23',
      hours: 8, reason: 'This requested scope is too broad'
    }),
    (error) => error.code === 'NETWORK_TOO_BROAD'
  );
  const manualApproval = await moderation.requestNetworkBanPrivacyApproval({
    actorUserId: Number(actor.id), sourceType: 'manual', cidr: '198.51.100.0/24',
    hours: 8,
    reason: `Manual review for 198.51.100.0/24 linked to ${target.public_id} and operator@example.test`
  });
  const pendingReviews = await moderation.listPendingNetworkBanPrivacyApprovals();
  const pendingManual = pendingReviews.find((review) => review.id === manualApproval.id);
  assert.equal(pendingManual.reason.includes('198.51.100'), false);
  assert.equal(pendingManual.reason.includes('[network]'), true);
  assert.equal(pendingManual.reason.includes(target.public_id), false);
  assert.equal(pendingManual.reason.includes('operator@example.test'), false);
  await assert.rejects(
    moderation.reviewNetworkBanPrivacyApproval({
      reviewerUserId: Number(reviewer.id), approvalId: manualApproval.id, decision: 'approve',
      cidr: '198.51.101.0/24', reason: 'The confirmation must match'
    }),
    (error) => error.code === 'NETWORK_CONFIRMATION_MISMATCH'
  );
  const manualBan = await moderation.reviewNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: manualApproval.id, decision: 'approve',
    cidr: '198.51.100.0/24', reason: 'The manual scope and duration are proportionate'
  });
  assert.equal(Number(manualBan.ban.prefix_length), 24);
  assert.equal(await moderation.isNetworkBlocked('198.51.100.42'), true);

  const rejectedApproval = await moderation.requestNetworkBanPrivacyApproval({
    actorUserId: Number(actor.id), sourceType: 'manual', cidr: '192.0.2.10/32',
    hours: 2, reason: 'Request to be rejected by independent review'
  });
  await moderation.reviewNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: rejectedApproval.id,
    decision: 'reject', reason: 'The evidence is insufficient'
  });
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) AS count FROM network_bans WHERE privacy_approval_id = $1', [rejectedApproval.id]
  )).rows[0].count), 0);

  const staleTarget = await createUser(db, 'stale');
  await moderation.banAccount({
    actorUserId: Number(actor.id), targetUserId: Number(staleTarget.id), type: 'temporary', hours: 2,
    reason: 'Synthetic stale signal account ban'
  });
  await db.query(
    `UPDATE users SET last_ip = '192.0.2.55', last_network_seen_at = NOW() - INTERVAL '25 hours' WHERE id = $1`,
    [staleTarget.id]
  );
  await assert.rejects(
    moderation.requestNetworkBanPrivacyApproval({
      actorUserId: Number(actor.id), sourceType: 'account', publicId: staleTarget.public_id,
      hours: 2, reason: 'A stale signal must fail closed'
    }),
    (error) => error.code === 'NETWORK_SIGNAL_STALE'
  );

  const ipv6Target = await createUser(db, 'ipv6');
  await moderation.banAccount({
    actorUserId: Number(actor.id), targetUserId: Number(ipv6Target.id), type: 'temporary', hours: 2,
    reason: 'Synthetic IPv6 account ban'
  });
  await db.query(
    `UPDATE users SET last_ip = '2001:db8::42', last_network_seen_at = NOW() WHERE id = $1`,
    [ipv6Target.id]
  );
  const ipv6Approval = await moderation.requestNetworkBanPrivacyApproval({
    actorUserId: Number(actor.id), sourceType: 'account', publicId: ipv6Target.public_id,
    hours: 2, reason: 'Narrow IPv6 review'
  });
  const ipv6Ban = await moderation.reviewNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: ipv6Approval.id,
    decision: 'approve', reason: 'The IPv6 host scope is proportionate'
  });
  assert.equal(Number(ipv6Ban.ban.prefix_length), 128);
  const networkAuditReason = (await db.query(
    `SELECT reason FROM audit_log WHERE action = 'network_privacy_review_requested' ORDER BY id DESC LIMIT 1`
  )).rows[0].reason;
  assert.equal(networkAuditReason.includes('2001:db8'), false);
  const auditStates = JSON.stringify((await db.query('SELECT before_state, after_state FROM audit_log')).rows);
  assert.equal(auditStates.includes('203.0.113'), false);
  assert.equal(auditStates.includes(target.public_id), false);
});

test('a valid login receives only the limited support-based suspension mode', {
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
  await db.query(
    `INSERT INTO account_bans (user_id, type, reason, ends_at, created_by)
     VALUES ($1, 'temporary', 'Documented suspension reason', NOW() + INTERVAL '4 hours', $1)`,
    [user.id]
  );
  const suspended = await account.post('/login').set('Accept', 'application/json').send({
    email: 'suspended-member@example.test', password: 'SyntheticPassword123!'
  }).expect(403);
  assert.equal(suspended.body.code, 'ACCOUNT_SUSPENDED');
  assert.equal(suspended.body.suspension.reason, 'Documented suspension reason');
  assert.equal(suspended.body.suspension.type, 'temporary');
  await account.get('/api/account').expect(403);
  const page = await account.get('/suspension').expect(200);
  assert.match(page.text, /Contact support/);
  assert.doesNotMatch(page.text, /Documented suspension reason|Submit appeal/);
  await account.get('/support').expect(200).expect(/account or guest access is restricted/i);
  const blockedAppeal = await account.post('/api/suspension/appeals').send({ reason: 'Retired workflow.' }).expect(403);
  assert.equal(blockedAppeal.body.code, 'ACCOUNT_SUSPENDED');
  assert.equal(Number((await db.query('SELECT count(*) AS count FROM moderation_appeals')).rows[0].count), 0);
  assert.equal(Number((await db.query(
    `SELECT count(*) AS count FROM notifications WHERE user_id = $1 AND type = 'account_ban'`, [user.id]
  )).rows[0].count), 0);
});
