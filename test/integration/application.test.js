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
  assert.match(primaryPublicId, /^nvy_[a-f0-9]{20}$/);
  assert.equal(Object.hasOwn(registration.body.user, 'id'), false);
  assert.equal(Object.hasOwn(registration.body.user, 'password'), false);
  assert.equal(Object.hasOwn(registration.body.user, 'password_hash'), false);

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

  const outsider = request.agent(runtime.app);
  await outsider
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('outside_member', 'outside-member@example.test'))
    .expect(201);

  const adminRoutes = [
    { method: 'get', path: '/admin' },
    { method: 'get', path: '/api/admin/users' },
    { method: 'get', path: '/api/admin/reports' },
    { method: 'get', path: '/api/admin/bans' },
    { method: 'get', path: '/api/admin/database-capacity' },
    { method: 'post', path: `/api/admin/users/${memberPublicId}/ban`, body: { type: 'temporary', hours: 24 } },
    { method: 'delete', path: `/api/admin/users/${memberPublicId}`, body: { confirmation: 'BAN AND DELETE' } },
    { method: 'patch', path: '/api/admin/reports/1', body: { action: 'dismiss' } },
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
    { method: 'delete', path: '/api/conversations/1', body: { confirmation: true } },
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
    `INSERT INTO conversations (type) VALUES ('random') RETURNING id`
  );
  const conversationId = Number(conversation.rows[0].id);
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
    .delete(`/api/conversations/${conversationId}`)
    .send({ confirmation: 'DELETE FOR EVERYONE' })
    .expect(404);
  assert.equal(
    (await db.query('SELECT status FROM conversations WHERE id = $1', [conversationId])).rows[0].status,
    'active'
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
    .delete(`/api/conversations/${conversationId}`)
    .send({ confirmation: 'wrong value' })
    .expect(400);
  await primary.delete(`/api/conversations/${conversationId}/saved`).expect(204);
  await primary.delete(`/api/friends/${memberPublicId}`).expect(204);
  await primary.delete(`/api/blocks/${memberPublicId}`).expect(204);
  await primary
    .delete(`/api/conversations/${conversationId}`)
    .send({ confirmation: 'DELETE FOR EVERYONE' })
    .expect(204);
  assert.equal(
    (await db.query(
      'SELECT status, deleted_for_everyone_at IS NOT NULL AS deleted FROM conversations WHERE id = $1',
      [conversationId]
    )).rows[0].deleted,
    true
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
  await selfDelete.delete('/api/account').send({ confirmation: 'wrong value' }).expect(400);
  await selfDelete.delete('/api/account').send({ confirmation: 'DELETE' }).expect(204);
  const deletedSelf = (await db.query(
    'SELECT username, email, deleted_at FROM users WHERE id = $1',
    [selfDeleteId]
  )).rows[0];
  assert.match(deletedSelf.username, /^deleted_\d+$/);
  assert.match(deletedSelf.email, /^deleted_\d+@deleted\.nevely\.invalid$/);
  assert.notEqual(deletedSelf.deleted_at, null);
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
  await admin
    .post('/api/admin/reauth')
    .send({ password: 'SyntheticPassword123!', code: totp(setup.body.secret) })
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

  await admin.get('/admin').expect(200);
  const ban = await admin
    .post(`/api/admin/users/${memberPublicId}/ban`)
    .send({ type: 'temporary', hours: 24, reason: 'Synthetic authorization test' })
    .expect(201);
  assert.equal(Number.isSafeInteger(ban.body.banId), true);
  assert.equal(
    Number((await db.query('SELECT COUNT(*) AS count FROM bans WHERE user_id = $1', [memberId])).rows[0].count),
    1
  );

  const pagedUsers = await admin.get('/api/admin/users?limit=2').expect(200);
  assert.equal(pagedUsers.body.users.length, 2);
  assert.equal(pagedUsers.body.page.limit, 2);
  assert.equal(pagedUsers.body.page.hasMore, true);
  assert.equal(Object.hasOwn(pagedUsers.body.users[0], 'id'), false);
  await admin.get('/api/admin/users?cursor=invalid').expect(400);

  const pagedReports = await admin.get('/api/admin/reports?limit=20').expect(200);
  assert.equal(pagedReports.body.reports.some((item) => Number(item.id) === reportId), true);
  assert.equal(pagedReports.body.page.limit, 20);

  const pagedBans = await admin.get('/api/admin/bans?limit=20').expect(200);
  assert.equal(pagedBans.body.bans.some((item) => Number(item.id) === ban.body.banId), true);
  assert.equal(pagedBans.body.page.limit, 20);

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
    'SELECT username, email, deleted_at FROM users WHERE id = $1',
    [adminDeleteTargetId]
  )).rows[0];
  assert.match(removedByAdmin.username, /^deleted_\d+$/);
  assert.match(removedByAdmin.email, /^deleted_\d+@deleted\.nevely\.invalid$/);
  assert.notEqual(removedByAdmin.deleted_at, null);
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM bans
       WHERE user_id = $1 AND type = 'permanent' AND created_by = $2`,
      [adminDeleteTargetId, adminId]
    )).rows[0].count),
    1
  );

  await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', adminId]);
  await admin.get('/admin').set('Accept', 'application/json').expect(403);
});
