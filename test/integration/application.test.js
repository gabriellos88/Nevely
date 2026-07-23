const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const safeLog = require('../../lib/safe-log');
const { expectedMigrations, resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error(event, error) {
    safeLog.error(event, error);
  }
};

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
    .send({
      username: 'primary_user',
      email: 'primary-user@example.test',
      password: 'SyntheticPassword123!'
    })
    .expect(201);
  const primaryId = registration.body.user.id;
  assert.equal(Number.isSafeInteger(primaryId), true);
  assert.equal(Object.hasOwn(registration.body.user, 'password'), false);
  assert.equal(Object.hasOwn(registration.body.user, 'password_hash'), false);

  await primary
    .patch('/api/account')
    .send({
      displayName: 'Primary User',
      email: 'primary-user@example.test',
      age: 17,
      gender: 'non-binary',
      country: 'Switzerland'
    })
    .expect(400);

  const profile = await primary
    .patch('/api/account')
    .send({
      displayName: 'Primary User',
      email: 'primary-user@example.test',
      age: 28,
      gender: 'non-binary',
      country: 'Switzerland'
    })
    .expect(200);
  assert.equal(profile.body.user.age, 28);
  assert.equal(profile.body.user.displayName, 'Primary User');

  await primary.post('/logout').set('Accept', 'application/json').expect(204);
  assert.equal((await primary.get('/api/auth/me').expect(200)).body.user, null);
  await primary
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'primary-user@example.test', password: 'SyntheticPassword123!' })
    .expect(200);
  assert.equal((await primary.get('/api/auth/me').expect(200)).body.user.id, primaryId);

  const member = request.agent(runtime.app);
  const memberRegistration = await member
    .post('/register')
    .set('Accept', 'application/json')
    .send({
      username: 'ordinary_member',
      email: 'ordinary-member@example.test',
      password: 'SyntheticPassword123!'
    })
    .expect(201);
  const memberId = memberRegistration.body.user.id;

  const adminRoutes = [
    { method: 'get', path: '/admin' },
    { method: 'post', path: `/api/admin/users/${memberId}/ban`, body: { type: 'temporary', hours: 24 } },
    { method: 'delete', path: `/api/admin/users/${memberId}`, body: { confirmation: 'BAN AND DELETE' } },
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

  const admin = request.agent(runtime.app);
  const adminRegistration = await admin
    .post('/register')
    .set('Accept', 'application/json')
    .send({
      username: 'admin_member',
      email: 'admin-member@example.test',
      password: 'SyntheticPassword123!'
    })
    .expect(201);
  await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', adminRegistration.body.user.id]);
  await admin.post('/logout').set('Accept', 'application/json').expect(204);
  await admin
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'admin-member@example.test', password: 'SyntheticPassword123!' })
    .expect(200);

  await admin.get('/admin').expect(200);
  const ban = await admin
    .post(`/api/admin/users/${memberId}/ban`)
    .send({ type: 'temporary', hours: 24, reason: 'Synthetic authorization test' })
    .expect(201);
  assert.equal(Number.isSafeInteger(ban.body.banId), true);
  assert.equal(
    Number((await db.query('SELECT COUNT(*) AS count FROM bans WHERE user_id = $1', [memberId])).rows[0].count),
    1
  );

  await admin
    .delete(`/api/admin/users/${memberId}`)
    .send({ confirmation: 'wrong value' })
    .expect(400);
  await admin
    .post('/api/admin/prices')
    .send({ price: 0, currency: 'USD' })
    .expect(201);
});

test.todo('retention worker acceptance is added with N2.2 implementation');
test.todo('cursor pagination acceptance is added with N2.4 implementation');
