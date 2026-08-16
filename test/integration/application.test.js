const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const safeLog = require('../../lib/safe-log');
const { totp } = require('../../lib/totp');
const { expectedMigrations, resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error(event, error) {
    safeLog.error(event, error);
  }
};

function registrationPayload(username, email) {
  return {
    username,
    email,
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch'
  };
}

async function verifyAccountEmail(db, agent, email) {
  const outbox = (await db.query(
    `SELECT text_body FROM email_outbox
     WHERE purpose = 'verify_email' AND recipient = $1
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  )).rows[0];
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(outbox?.text_body || '');
  assert.ok(match, 'verification outbox body contains a single-use token');
  await agent
    .post('/verify-email')
    .set('Accept', 'application/json')
    .send({ token: match[1] })
    .expect(200);
}

async function internalId(db, publicId) {
  return Number((await db.query(
    'SELECT id FROM users WHERE public_id = $1',
    [publicId]
  )).rows[0].id);
}

test('CI always supplies disposable PostgreSQL', () => {
  if (process.env.CI === 'true') assert.equal(hasDatabase, true);
});

test('migrations, authentication, profile validation and authorization contracts', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'integration-test-session-secret'
    },
    log: quietLog
  });

  t.after(async () => {
    await runtime.shutdown();
    await db.close();
  });

  const migrationRows = await db.query('SELECT filename FROM schema_migrations ORDER BY filename');
  assert.deepEqual(
    migrationRows.rows.map((row) => row.filename),
    await expectedMigrations()
  );

  const primary = request.agent(runtime.app);
  const registration = await primary
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('primary_user', 'primary-user@example.test'))
    .expect(201);
  const primaryPublicId = registration.body.user.publicId;
  const primaryId = await internalId(db, primaryPublicId);
  assert.equal(Number.isSafeInteger(primaryId), true);
  assert.match(primaryPublicId, /^nvy_[a-f0-9]{12}$/);
  assert.equal(Object.hasOwn(registration.body.user, 'id'), false);
  assert.equal(Object.hasOwn(registration.body.user, 'password'), false);
  assert.equal(Object.hasOwn(registration.body.user, 'password_hash'), false);
  await verifyAccountEmail(db, primary, 'primary-user@example.test');

  await primary
    .patch('/api/account')
    .send({
      displayName: 'Primary User',
      gender: 'invalid-value',
      countryCode: 'ch'
    })
    .expect(400);

  const profile = await primary
    .patch('/api/account')
    .send({
      displayName: 'Primary User',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(200);
  assert.equal(profile.body.user.birthDate, '1990-06-15');
  assert.equal(profile.body.user.displayName, 'Primary User');

  await primary.post('/logout').set('Accept', 'application/json').expect(204);
  assert.equal((await primary.get('/api/auth/me').expect(200)).body.user, null);
  await primary
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'primary-user@example.test', password: 'SyntheticPassword123!' })
    .expect(200);
  assert.equal((await primary.get('/api/auth/me').expect(200)).body.user.publicId, primaryPublicId);

  const member = request.agent(runtime.app);
  const memberRegistration = await member
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('ordinary_member', 'ordinary-member@example.test'))
    .expect(201);
  const memberPublicId = memberRegistration.body.user.publicId;
  const memberId = await internalId(db, memberPublicId);
  await verifyAccountEmail(db, member, 'ordinary-member@example.test');

  const outsider = request.agent(runtime.app);
  await outsider
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('outside_member', 'outside-member@example.test'))
    .expect(201);
  await verifyAccountEmail(db, outsider, 'outside-member@example.test');

  const adminRoutes = [
    { method: 'get', path: '/admin' },
    { method: 'get', path: '/api/admin/guests' },
    { method: 'get', path: '/api/admin/users' },
    { method: 'get', path: `/api/admin/users/${memberPublicId}` },
    { method: 'get', path: `/api/admin/users/${memberPublicId}/moderation` },
    { method: 'get', path: '/api/admin/reports' },
    { method: 'get', path: '/api/admin/bans' },
    { method: 'get', path: '/api/admin/network-bans/1' },
    { method: 'get', path: '/api/admin/audit' },
    { method: 'get', path: '/api/admin/database-capacity' },
    { method: 'post', path: `/api/admin/users/${memberPublicId}/ban`, body: { type: 'temporary', hours: 24 } },
    { method: 'delete', path: `/api/admin/users/${memberPublicId}`, body: { confirmation: 'BAN AND DELETE' } },
    { method: 'patch', path: '/api/admin/reports/1', body: { action: 'dismiss' } },
    { method: 'post', path: '/api/admin/reports/1/evidence', body: { reason: 'Synthetic authorization test' } },
    { method: 'post', path: '/api/admin/network-ban-privacy-approvals', body: { cidr: '203.0.113.0/24', reason: 'Synthetic privacy review request' } },
    { method: 'post', path: '/api/admin/network-ban-privacy-approvals/00000000-0000-4000-8000-000000000000/approve', body: { reason: 'Synthetic approval', reviewReference: 'synthetic-review' } },
    { method: 'post', path: '/api/admin/network-bans', body: { cidr: '203.0.113.0/24', reason: 'Synthetic network ban', privacyApprovalId: '00000000-0000-4000-8000-000000000000' } },
    { method: 'post', path: '/api/admin/prices', body: { price: 0, currency: 'USD' } }
  ];

  for (const route of adminRoutes) {
    const anonymousRequest = request(runtime.app)[route.method](route.path)
      .set('Accept', 'application/json');
    if (route.body) anonymousRequest.send(route.body);
    await anonymousRequest.expect(401);

    const memberRequest = member[route.method](route.path).set('Accept', 'application/json');
    if (route.body) memberRequest.send(route.body);
    await memberRequest.expect(403);
  }

  const destructiveMemberRoutes = [
    { method: 'delete', path: '/api/account', body: { confirmation: 'DELETE' } },
    { method: 'delete', path: '/api/conversations/cnv_000000000000000000000000/history', body: { confirmation: 'REMOVE FROM MY HISTORY' } },
    { method: 'post', path: '/api/conversations/cnv_000000000000000000000000/delete-unsaved', body: { confirmation: 'DELETE UNSAVED MESSAGES' } },
    { method: 'delete', path: '/api/conversations/1/saved' },
    { method: 'delete', path: '/api/friends/1' },
    { method: 'delete', path: '/api/blocks/1' }
  ];
  for (const route of destructiveMemberRoutes) {
    const action = request(runtime.app)[route.method](route.path).set('Accept', 'application/json');
    if (route.body) action.send(route.body);
    await action.expect(401);
  }

  const guest = request.agent(runtime.app);
  await guest
    .post('/api/guest-profile')
    .send({
      name: 'Synthetic Guest',
      age: 28,
      gender: 'non-binary',
      country: { code: 'ch' },
      avatarId: 'astra'
    })
    .expect(201);
  await guest.delete('/api/guest-profile').expect(204);
  assert.equal((await guest.get('/api/guest-profile').expect(200)).body.guest, null);
  await primary.delete('/api/guest-profile').expect(409);

  const conversation = await db.query(
    `INSERT INTO conversations (type, status, ended_at)
     VALUES ('random', 'ended', NOW()) RETURNING id, public_id`
  );
  const conversationId = Number(conversation.rows[0].id);
  const conversationPublicId = conversation.rows[0].public_id;
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, socket_id, display_name)
     VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)`,
    [conversationId, primaryId, 'synthetic-primary-socket', 'Primary User',
      memberId, 'synthetic-member-socket', 'Ordinary Member']
  );
  await db.query(
    'INSERT INTO saved_chats (user_id, conversation_id) VALUES ($1, $2)',
    [primaryId, conversationId]
  );
  await db.query(
    `INSERT INTO friendships (user_id, friend_id)
     VALUES ($1, $2), ($2, $1)`,
    [primaryId, memberId]
  );
  await db.query(
    'INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1, $2)',
    [primaryId, memberId]
  );

  await outsider
    .delete(`/api/conversations/${conversationPublicId}/history`)
    .send({ confirmation: 'REMOVE FROM MY HISTORY' })
    .expect(404);
  assert.equal(
    (await db.query('SELECT status FROM conversations WHERE id = $1', [conversationId])).rows[0].status,
    'ended'
  );

  await outsider.delete(`/api/conversations/${conversationId}/saved`).expect(204);
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM saved_chats WHERE user_id = $1 AND conversation_id = $2',
      [primaryId, conversationId]
    )).rows[0].count),
    1
  );

  await outsider.delete(`/api/friends/${memberPublicId}`).expect(204);
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM friendships WHERE user_id = $1 AND friend_id = $2',
      [primaryId, memberId]
    )).rows[0].count),
    1
  );

  await outsider.delete(`/api/blocks/${memberPublicId}`).expect(204);
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2',
      [primaryId, memberId]
    )).rows[0].count),
    1
  );

  await primary
    .delete(`/api/conversations/${conversationPublicId}/history`)
    .send({ confirmation: 'wrong value' })
    .expect(400);
  await primary.delete(`/api/conversations/${conversationId}/saved`).expect(204);
  await primary.delete(`/api/friends/${memberPublicId}`).expect(204);
  await primary.delete(`/api/blocks/${memberPublicId}`).expect(204);
  await primary
    .delete(`/api/conversations/${conversationPublicId}/history`)
    .send({ confirmation: 'REMOVE FROM MY HISTORY' })
    .expect(204);
  assert.deepEqual(
    (await db.query(
      `SELECT c.status, c.deleted_for_everyone_at IS NOT NULL AS deleted,
              EXISTS (
                SELECT 1 FROM conversation_history_visibility visibility
                WHERE visibility.conversation_id = c.id AND visibility.user_id = $2
              ) AS hidden
       FROM conversations c WHERE c.id = $1`,
      [conversationId, primaryId]
    )).rows[0],
    { status: 'ended', deleted: false, hidden: true }
  );
  assert.equal(
    Number((await db.query(
      `SELECT
         (SELECT COUNT(*) FROM saved_chats WHERE user_id = $1 AND conversation_id = $2)
         + (SELECT COUNT(*) FROM friendships WHERE user_id = $1 AND friend_id = $3)
         + (SELECT COUNT(*) FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $3)
         AS count`,
      [primaryId, conversationId, memberId]
    )).rows[0].count),
    0
  );

  const selfDelete = request.agent(runtime.app);
  const selfDeleteRegistration = await selfDelete
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('self_delete_member', 'self-delete-member@example.test'))
    .expect(201);
  const selfDeleteId = await internalId(db, selfDeleteRegistration.body.user.publicId);
  await verifyAccountEmail(db, selfDelete, 'self-delete-member@example.test');
  await selfDelete.delete('/api/account').send({ confirmation: 'wrong value' }).expect(400);
  await selfDelete.delete('/api/account').send({ confirmation: 'DELETE' }).expect(204);
  const deletedSelf = (await db.query(
    'SELECT username, email, public_id, deleted_at, retention_until, pii_purged_at FROM users WHERE id = $1',
    [selfDeleteId]
  )).rows[0];
  assert.equal(deletedSelf.username, 'self_delete_member');
  assert.equal(deletedSelf.email, 'self-delete-member@example.test');
  assert.equal(deletedSelf.public_id, selfDeleteRegistration.body.user.publicId);
  assert.notEqual(deletedSelf.deleted_at, null);
  assert.equal(deletedSelf.pii_purged_at, null);
  assert.equal(
    new Date(deletedSelf.retention_until).getTime() - new Date(deletedSelf.deleted_at).getTime(),
    30 * 24 * 60 * 60 * 1000
  );
  assert.equal((await selfDelete.get('/api/auth/me').expect(200)).body.user, null);

  const admin = request.agent(runtime.app);
  const adminRegistration = await admin
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('admin_member', 'admin-member@example.test'))
    .expect(201);
  const adminPublicId = adminRegistration.body.user.publicId;
  const adminId = await internalId(db, adminPublicId);
  await db.query(
    'UPDATE users SET role = $1, email_verified_at = NOW() WHERE id = $2',
    ['admin', adminId]
  );
  await admin.post('/logout').set('Accept', 'application/json').expect(204);
  await admin
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'admin-member@example.test', password: 'SyntheticPassword123!' })
    .expect(200);
  const setup = await admin
    .post('/api/admin/2fa/setup')
    .send({ password: 'SyntheticPassword123!' })
    .expect(200);
  await admin
    .post('/api/admin/2fa/confirm')
    .send({ code: totp(setup.body.secret) })
    .expect(204);
  const adminDeleteTarget = request.agent(runtime.app);
  const adminDeleteRegistration = await adminDeleteTarget
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('admin_delete_target', 'admin-delete-target@example.test'))
    .expect(201);
  const adminDeleteTargetPublicId = adminDeleteRegistration.body.user.publicId;
  const adminDeleteTargetId = await internalId(db, adminDeleteTargetPublicId);

  const report = await db.query(
    `INSERT INTO reports (reporter_user_id, reported_user_id, reason, details)
     VALUES ($1, $2, 'synthetic', 'Synthetic report details') RETURNING id`,
    [primaryId, memberId]
  );
  const reportId = Number(report.rows[0].id);
  await db.query(
    `INSERT INTO report_evidence_snapshots (report_id, expires_at, messages)
     VALUES ($1, NOW() + INTERVAL '24 hours',
       '[{"messageId":1,"senderRole":"reporter","body":"synthetic evidence one","createdAt":"2026-01-01T00:00:00Z"},{"messageId":2,"senderRole":"reported","body":"synthetic evidence two","createdAt":"2026-01-01T00:01:00Z"}]'::jsonb)`,
    [reportId]
  );

  const adminWorkspace = await admin.get('/admin').expect(200);
  assert.match(adminWorkspace.text, /value="deleted">Deleted/);
  assert.match(adminWorkspace.text, /value="banned">Banned/);
  assert.match(adminWorkspace.text, /networkApprovalRequestForm/);
  assert.match(adminWorkspace.text, /networkPendingReviews/);
  assert.match(adminWorkspace.text, /Advanced: enter CIDR manually/);
  assert.doesNotMatch(adminWorkspace.text, /networkBanCreateForm/);
  assert.doesNotMatch(adminWorkspace.text, />Appeals</);
  const ban = await admin
    .post(`/api/admin/users/${memberPublicId}/ban`)
    .send({ type: 'temporary', hours: 24, reason: 'Synthetic authorization test' })
    .expect(201);
  assert.equal(Number.isSafeInteger(ban.body.banId), true);
  assert.equal(
    Number((await db.query('SELECT COUNT(*) AS count FROM account_bans WHERE user_id = $1', [memberId])).rows[0].count),
    1
  );

  const pagedUsers = await admin.get('/api/admin/users?limit=2').expect(200);
  assert.equal(pagedUsers.body.users.length, 2);
  assert.equal(pagedUsers.body.page.limit, 2);
  assert.equal(pagedUsers.body.page.hasMore, true);
  assert.equal(Object.hasOwn(pagedUsers.body.users[0], 'id'), false);
  await db.query(`UPDATE users SET last_seen_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [memberId]);
  const searchedUser = await admin.get(`/api/admin/users?q=${encodeURIComponent(memberPublicId)}&limit=20`).expect(200);
  assert.notEqual(searchedUser.body.users.find((item) => item.public_id === memberPublicId).last_seen_at, null);
  await admin.get('/api/admin/users?cursor=invalid').expect(400);
  const bannedUsers = await admin.get('/api/admin/users?state=banned&limit=20').expect(200);
  assert.equal(bannedUsers.body.users.some((item) => item.public_id === memberPublicId && item.active_ban), true);

  const userDetail = await admin.get(`/api/admin/users/${memberPublicId}`).expect(200);
  assert.equal(userDetail.body.user.publicId, memberPublicId);
  assert.equal(userDetail.body.user.activeBan.id, ban.body.banId);
  const moderationHistory = await admin.get(`/api/admin/users/${memberPublicId}/moderation?limit=20`).expect(200);
  assert.equal(moderationHistory.body.moderation.some((item) => item.action === 'account_ban_created'), true);
  assert.equal(Object.hasOwn(moderationHistory.body.moderation[0], 'before_state'), false);

  const pagedReports = await admin.get('/api/admin/reports?limit=20').expect(200);
  assert.equal(pagedReports.body.reports.some((item) => Number(item.id) === reportId), true);
  assert.equal(pagedReports.body.page.limit, 20);
  assert.equal(Object.hasOwn(pagedReports.body.reports.find((item) => Number(item.id) === reportId), 'details'), false);

  const accountNetworkApproval = (await db.query(
    `INSERT INTO network_ban_privacy_approvals
       (requested_by, network_fingerprint, address_family, prefix_length, request_reason,
        status, approved_by, approved_at, approval_reason, review_reference, expires_at,
        consumed_at, consumed_by, source_type, source_user_id, source_account_ban_id,
        proposed_duration_hours)
     VALUES ($1, repeat('b', 64), 4, 32, 'Synthetic account-derived network review',
             'approved', $2, NOW(), 'Synthetic independent approval', 'synthetic-account-review',
             NOW() + INTERVAL '24 hours', NOW(), $2, 'account', $3, $4, 6)
     RETURNING id`,
    [adminId, primaryId, memberId, ban.body.banId]
  )).rows[0];
  const accountNetworkBan = (await db.query(
    `INSERT INTO network_bans
       (network_fingerprint, address_family, prefix_length, reason, ends_at, created_by,
        privacy_reviewed_by, privacy_review_reference, privacy_approval_id, source_type,
        source_user_id, source_account_ban_id)
     VALUES (repeat('b', 64), 4, 32, 'Synthetic account-derived network review',
             NOW() + INTERVAL '6 hours', $1, $1, 'synthetic-account-review', $2,
             'account', $3, $4)
     RETURNING id`,
    [primaryId, accountNetworkApproval.id, memberId, ban.body.banId]
  )).rows[0];
  const manualNetworkApproval = (await db.query(
    `INSERT INTO network_ban_privacy_approvals
       (requested_by, network_fingerprint, address_family, prefix_length, request_reason,
        status, approved_by, approved_at, approval_reason, review_reference, expires_at,
        consumed_at, consumed_by, source_type, proposed_duration_hours)
     VALUES ($1, repeat('c', 64), 6, 128, 'Synthetic manual network review',
             'approved', $2, NOW(), 'Synthetic independent approval', 'synthetic-manual-review',
             NOW() + INTERVAL '24 hours', NOW(), $2, 'manual', 4)
     RETURNING id`,
    [adminId, primaryId]
  )).rows[0];
  const manualNetworkBan = (await db.query(
    `INSERT INTO network_bans
       (network_fingerprint, address_family, prefix_length, reason, ends_at, created_by,
        privacy_reviewed_by, privacy_review_reference, privacy_approval_id, source_type)
     VALUES (repeat('c', 64), 6, 128, 'Synthetic manual network review',
             NOW() + INTERVAL '4 hours', $1, $1, 'synthetic-manual-review', $2, 'manual')
     RETURNING id`,
    [primaryId, manualNetworkApproval.id]
  )).rows[0];

  const pagedBans = await admin.get('/api/admin/bans?limit=20').expect(200);
  assert.equal(pagedBans.body.bans.some((item) => Number(item.id) === ban.body.banId), true);
  assert.equal(pagedBans.body.page.limit, 20);
  const accountNetworkRow = pagedBans.body.bans.find((item) => item.scope === 'network'
    && Number(item.ban_id) === Number(accountNetworkBan.id));
  const manualNetworkRow = pagedBans.body.bans.find((item) => item.scope === 'network'
    && Number(item.ban_id) === Number(manualNetworkBan.id));
  assert.equal(accountNetworkRow.target_label, `Public ID ${memberPublicId}`);
  assert.equal(manualNetworkRow.target_label, `Manual \u00b7 net_${'c'.repeat(12)}`);
  assert.equal(Object.hasOwn(accountNetworkRow, 'network_fingerprint'), false);

  const accountNetworkDetail = await admin
    .get(`/api/admin/network-bans/${accountNetworkBan.id}`)
    .expect(200);
  assert.deepEqual(accountNetworkDetail.body.networkBan.sourceAccountBan, {
    status: 'active', type: 'temporary', endsAt: accountNetworkDetail.body.networkBan.sourceAccountBan.endsAt
  });
  assert.equal(accountNetworkDetail.body.networkBan.networkReference, `net_${'b'.repeat(12)}`);
  assert.equal(accountNetworkDetail.body.networkBan.sourceType, 'account');
  assert.equal(accountNetworkDetail.body.networkBan.sourcePublicId, memberPublicId);
  assert.equal(accountNetworkDetail.body.networkBan.addressFamily, 4);
  assert.equal(accountNetworkDetail.body.networkBan.prefixLength, 32);
  assert.equal(accountNetworkDetail.body.networkBan.requestedByPublicId, adminPublicId);
  assert.equal(accountNetworkDetail.body.networkBan.privacyReviewerPublicId, primaryPublicId);
  assert.equal(accountNetworkDetail.body.networkBan.status, 'active');
  assert.equal(accountNetworkDetail.body.networkBan.revocation, null);
  assert.equal(Object.hasOwn(accountNetworkDetail.body.networkBan, 'networkFingerprint'), false);
  assert.equal(Object.hasOwn(accountNetworkDetail.body.networkBan, 'privacyApprovalId'), false);

  const manualNetworkDetail = await admin
    .get(`/api/admin/network-bans/${manualNetworkBan.id}`)
    .expect(200);
  assert.equal(manualNetworkDetail.body.networkBan.sourceType, 'manual');
  assert.equal(manualNetworkDetail.body.networkBan.sourcePublicId, null);
  assert.equal(manualNetworkDetail.body.networkBan.sourceAccountBan, null);
  assert.equal(manualNetworkDetail.body.networkBan.addressFamily, 6);
  assert.equal(manualNetworkDetail.body.networkBan.prefixLength, 128);

  await admin
    .patch(`/api/admin/network-bans/${accountNetworkBan.id}/revoke`)
    .send({ reason: `Synthetic 203.0.113.77 restriction for ${memberPublicId} no longer required` })
    .expect(200);
  const revokedNetworkDetail = await admin
    .get(`/api/admin/network-bans/${accountNetworkBan.id}`)
    .expect(200);
  assert.equal(revokedNetworkDetail.body.networkBan.status, 'revoked');
  assert.equal(revokedNetworkDetail.body.networkBan.revocation.revokedByPublicId, adminPublicId);
  assert.equal(revokedNetworkDetail.body.networkBan.revocation.reason, 'Synthetic [network] restriction for [principal] no longer required');
  assert.equal(JSON.stringify(revokedNetworkDetail.body).includes('203.0.113.77'), false);

  await admin.get('/api/admin/appeals?status=pending&limit=20').expect(404);

  const auditLog = await admin.get(`/api/admin/audit?target=${encodeURIComponent(memberPublicId)}&limit=20`).expect(200);
  assert.equal(auditLog.body.audit.some((item) => item.action === 'account_ban_created'), true);
  assert.equal(Object.hasOwn(auditLog.body.audit[0], 'after_state'), false);

  const evidenceCorrelationId = '8dcb1d04-9c45-4e4e-8f4f-39c31fa4e5f2';
  const evidence = await admin
    .post(`/api/admin/reports/${reportId}/evidence?limit=1`)
    .set('X-Correlation-Id', evidenceCorrelationId)
    .send({ reason: 'Review the captured report evidence' })
    .expect(200);
  assert.equal(evidence.body.evidence.messages.length, 1);
  assert.equal(evidence.body.evidence.messages[0].body, 'synthetic evidence one');
  assert.equal(evidence.body.evidence.page.hasMore, true);
  await admin.post(`/api/admin/reports/${reportId}/evidence?cursor=invalid`).send({ reason: 'Review the captured report evidence' }).expect(400);
  const evidenceAccess = (await db.query(
    'SELECT reason, correlation_id FROM report_evidence_access_log WHERE report_id = $1', [reportId]
  )).rows[0];
  assert.equal(evidenceAccess.reason, 'Review the captured report evidence');
  assert.equal(evidenceAccess.correlation_id, evidenceCorrelationId);
  const evidenceAudit = (await db.query(
    `SELECT after_state FROM audit_log WHERE action = 'report_evidence_accessed' ORDER BY id DESC LIMIT 1`
  )).rows[0];
  assert.equal(Object.hasOwn(evidenceAudit.after_state, 'body'), false);

  const databaseCapacity = await admin.get('/api/admin/database-capacity').expect(200);
  assert.equal(Array.isArray(databaseCapacity.body.capacity), true);
  assert.equal(Array.isArray(databaseCapacity.body.retention), true);

  await admin
    .delete(`/api/admin/users/${memberPublicId}`)
    .send({ confirmation: 'wrong value' })
    .expect(400);
  await admin.delete(`/api/admin/users/${adminPublicId}`)
    .send({ confirmation: 'BAN AND DELETE' })
    .expect(400);

  const reportResult = await admin
    .patch(`/api/admin/reports/${reportId}`)
    .send({ action: 'dismiss', resolution: 'Synthetic reviewed outcome' })
    .expect(200);
  assert.equal(reportResult.body.status, 'dismissed');
  const reviewedReport = (await db.query(
    'SELECT status, reviewed_by, reviewed_at, resolution FROM reports WHERE id = $1',
    [reportId]
  )).rows[0];
  assert.equal(reviewedReport.status, 'dismissed');
  assert.equal(Number(reviewedReport.reviewed_by), adminId);
  assert.notEqual(reviewedReport.reviewed_at, null);
  assert.equal(reviewedReport.resolution, 'Synthetic reviewed outcome');

  const price = await admin
    .post('/api/admin/prices')
    .send({ price: 0, currency: 'USD' })
    .expect(201);
  assert.equal(price.body.priceCents, 0);

  await admin
    .delete(`/api/admin/users/${adminDeleteTargetPublicId}`)
    .send({ confirmation: 'BAN AND DELETE', reason: 'Synthetic removal test' })
    .expect(204);
  const removedByAdmin = (await db.query(
    'SELECT username, email, public_id, deleted_at, retention_until, pii_purged_at FROM users WHERE id = $1',
    [adminDeleteTargetId]
  )).rows[0];
  assert.equal(removedByAdmin.username, 'admin_delete_target');
  assert.equal(removedByAdmin.email, 'admin-delete-target@example.test');
  assert.equal(removedByAdmin.public_id, adminDeleteTargetPublicId);
  assert.notEqual(removedByAdmin.deleted_at, null);
  assert.equal(removedByAdmin.pii_purged_at, null);
  assert.equal(
    new Date(removedByAdmin.retention_until).getTime() - new Date(removedByAdmin.deleted_at).getTime(),
    30 * 24 * 60 * 60 * 1000
  );
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE target_user_id = $1 AND action = 'account_deleted' AND actor_user_id = $2`,
      [adminDeleteTargetId, adminId]
    )).rows[0].count),
    1
  );
  const deletedUsers = await admin.get('/api/admin/users?state=deleted&limit=20').expect(200);
  const deletedUser = deletedUsers.body.users.find((item) => item.deleted_at);
  assert.notEqual(deletedUser, undefined);
  assert.match(deletedUser.public_id, /^nvy_[0-9a-f]{12}$/);
  assert.notEqual(deletedUser.username, null);
  assert.equal(deletedUser.email, null);
  assert.notEqual(deletedUser.deleted_at, null);
  assert.notEqual(deletedUser.retention_until, null);
  assert.equal(deletedUser.pii_purged_at, null);
  assert.equal(Object.hasOwn(deletedUser, 'id'), false);
  const deletedDetail = await admin.get(`/api/admin/users/${deletedUser.public_id}`).expect(200);
  assert.notEqual(deletedDetail.body.user.username, null);
  assert.notEqual(deletedDetail.body.user.email, null);
  assert.notEqual(deletedDetail.body.user.deletedAt, null);
  assert.notEqual(deletedDetail.body.user.retentionUntil, null);
  assert.equal(deletedDetail.body.user.piiPurgedAt, null);

  await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', adminId]);
  await admin.get('/admin').set('Accept', 'application/json').expect(403);
});
