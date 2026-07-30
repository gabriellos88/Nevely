const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const { createRetentionWorker } = require('../../lib/retention');
const { totp } = require('../../lib/totp');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error() {}
};

function guestPayload(name = 'Persistent Guest') {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    name,
    age: 28,
    gender: 'non-binary',
    country: { code: 'ch' },
    avatarId: 'astra'
  };
}

function registrationPayload() {
  return {
    username: 'guest_admin',
    email: 'guest-admin@example.test',
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch'
  };
}

test('persistent guest principals are session-bound, paginated and retained', {
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
      SESSION_SECRET: 'guest-principal-integration-secret'
    },
    log: quietLog
  });

  t.after(async () => {
    await runtime.shutdown();
    await db.close();
  });

  const guest = request.agent(runtime.app);
  const created = await guest
    .post('/api/guest-profile')
    .send(guestPayload())
    .expect(201);
  assert.match(created.body.guest.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(created.body.guest.id, guestPayload().id);
  assert.match(created.body.guest.displayAlias, /^gst_[0-9A-F]{10}$/);
  assert.equal(created.body.guest.status, 'active');

  const stored = (await db.query(
    `SELECT id, display_alias, status, last_seen_at, retention_until
     FROM guest_principals`
  )).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, created.body.guest.id);
  assert.equal(stored[0].display_alias, created.body.guest.displayAlias);
  assert.equal(stored[0].status, 'active');
  assert.equal(new Date(stored[0].retention_until) > new Date(stored[0].last_seen_at), true);

  const duplicate = await guest
    .post('/api/guest-profile')
    .send(guestPayload('Replacement Attempt'))
    .expect(200);
  assert.equal(duplicate.body.guest.id, created.body.guest.id);
  assert.equal(
    Number((await db.query('SELECT COUNT(*) AS count FROM guest_principals')).rows[0].count),
    1
  );

  const outsider = request.agent(runtime.app);
  await outsider
    .patch('/api/guest-profile')
    .send({ id: created.body.guest.id, name: 'Hijacked Guest' })
    .expect(404);
  assert.equal(
    (await db.query('SELECT name FROM guest_principals WHERE id = $1', [created.body.guest.id])).rows[0].name,
    'Persistent Guest'
  );

  const updated = await guest
    .patch('/api/guest-profile')
    .send({ name: 'Renamed Guest', avatarId: 'nova' })
    .expect(200);
  assert.equal(updated.body.guest.name, 'Renamed Guest');
  assert.equal(updated.body.guest.nameChanges, 1);
  assert.equal(updated.body.guest.avatarId, 'nova');
  await guest
    .patch('/api/guest-profile')
    .send({ name: 'Second Rename' })
    .expect(409);

  const secondGuest = request.agent(runtime.app);
  const secondCreated = await secondGuest
    .post('/api/guest-profile')
    .send(guestPayload('Second Guest'))
    .expect(201);

  const admin = request.agent(runtime.app);
  await admin
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload())
    .expect(201);
  await db.query(
    `UPDATE users SET role = 'admin', email_verified_at = NOW()
     WHERE email = 'guest-admin@example.test'`
  );
  await admin.post('/logout').set('Accept', 'application/json').expect(204);
  await admin
    .post('/login')
    .set('Accept', 'application/json')
    .send({
      email: 'guest-admin@example.test',
      password: 'SyntheticPassword123!'
    })
    .expect(200);
  const setup = await admin
    .post('/api/admin/2fa/setup')
    .send({ password: 'SyntheticPassword123!' })
    .expect(200);
  await admin
    .post('/api/admin/2fa/confirm')
    .send({ code: totp(setup.body.secret) })
    .expect(204);

  const firstPage = await admin
    .get('/api/admin/guests?limit=1')
    .expect(200);
  assert.equal(firstPage.body.guests.length, 1);
  assert.equal(firstPage.body.page.hasMore, true);
  assert.equal(typeof firstPage.body.page.nextCursor, 'string');
  assert.equal(Object.hasOwn(firstPage.body.guests[0], 'id'), false);
  assert.match(firstPage.body.guests[0].displayAlias, /^gst_[0-9A-F]{10}$/);

  const secondPage = await admin
    .get(`/api/admin/guests?limit=1&cursor=${encodeURIComponent(firstPage.body.page.nextCursor)}`)
    .expect(200);
  assert.equal(secondPage.body.guests.length, 1);
  assert.notEqual(
    secondPage.body.guests[0].displayAlias,
    firstPage.body.guests[0].displayAlias
  );
  await admin.get('/api/admin/guests?cursor=malformed').expect(400);

  await guest.delete('/api/guest-profile').expect(204);
  assert.equal((await guest.get('/api/guest-profile').expect(200)).body.guest, null);
  const tombstone = (await db.query(
    `SELECT status, deleted_at, retention_until
     FROM guest_principals WHERE id = $1`,
    [created.body.guest.id]
  )).rows[0];
  assert.equal(tombstone.status, 'deleted');
  assert.notEqual(tombstone.deleted_at, null);

  const retention = createRetentionWorker({
    db,
    environment: {
      NODE_ENV: 'test',
      RETENTION_BATCH_SIZE: '10',
      RETENTION_MAX_BATCHES_PER_POLICY: '2'
    },
    log: quietLog
  });
  const result = await retention.runOnce();
  assert.equal(result.deletedCounts.guestPrincipals, 1);
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM guest_principals WHERE id = $1',
      [created.body.guest.id]
    )).rows[0].count),
    0
  );
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM guest_principals WHERE id = $1',
      [secondCreated.body.guest.id]
    )).rows[0].count),
    1
  );
});
