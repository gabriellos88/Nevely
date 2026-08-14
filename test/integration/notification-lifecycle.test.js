const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = { info() {}, warn() {}, error() {} };

function cookieFrom(response) {
  return (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}

function eventFrom(socket, eventName, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const handleEvent = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(eventName, handleEvent);
  });
}

async function registerVerified(baseUrl, db, name) {
  const email = `${name}@example.test`;
  const registration = await request(baseUrl)
    .post('/register')
    .set('Accept', 'application/json')
    .send({
      username: name,
      email,
      password: 'SyntheticPassword123!',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(201);
  await db.query('UPDATE users SET email_verified_at = NOW() WHERE email = $1', [email]);
  const login = await request(baseUrl)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email, password: 'SyntheticPassword123!' })
    .expect(200);
  return { cookie: cookieFrom(login), publicId: registration.body.user.publicId };
}

async function connectAccount(baseUrl, cookie) {
  const socket = createClient(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie }
  });
  const connected = eventFrom(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

test('notifications use public IDs and persist read and dismiss state across tabs and reconnect', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'notification-integration-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const owner = await registerVerified(baseUrl, db, 'notify_owner');
  const other = await registerVerified(baseUrl, db, 'notify_other');
  const ownerId = Number((await db.query('SELECT id FROM users WHERE public_id = $1', [owner.publicId])).rows[0].id);
  const firstSocket = await connectAccount(baseUrl, owner.cookie);
  const secondSocket = await connectAccount(baseUrl, owner.cookie);
  t.after(async () => {
    firstSocket.disconnect();
    secondSocket.disconnect();
    await runtime.shutdown();
  });

  const older = await db.query(
    `INSERT INTO notifications (user_id, type, title, body, data, created_at)
     VALUES ($1, 'friend_accepted', 'Accepted', 'Older notification',
             jsonb_build_object('userPublicId', $2::text, 'internalId', 42, 'payload', 'private'),
             NOW() - INTERVAL '1 minute')
     RETURNING public_id`,
    [ownerId, other.publicId]
  );
  const newer = await db.query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1, 'report_processed', 'Reviewed', 'Newer notification',
             jsonb_build_object('internalId', 84, 'payload', 'private'))
     RETURNING public_id`,
    [ownerId]
  );
  const protectedRecord = await db.query(
    `INSERT INTO notifications (user_id, type, title, body)
     VALUES ($1, 'account_ban', 'Protected', 'Not a product notification')
     RETURNING public_id`,
    [ownerId]
  );

  const firstPage = await request(baseUrl)
    .get('/api/notifications?limit=1')
    .set('Cookie', owner.cookie)
    .expect(200);
  assert.equal(firstPage.body.notifications.length, 1);
  assert.match(firstPage.body.notifications[0].id, /^ntf_[0-9a-f]{24}$/);
  assert.equal(firstPage.body.notifications[0].id, newer.rows[0].public_id);
  assert.deepEqual(firstPage.body.notifications[0].data, {});
  assert.equal(firstPage.body.page.hasMore, true);
  assert.equal(typeof firstPage.body.page.nextCursor, 'string');
  assert.equal(firstPage.body.unreadCount, 2);

  const secondPage = await request(baseUrl)
    .get(`/api/notifications?limit=1&cursor=${encodeURIComponent(firstPage.body.page.nextCursor)}`)
    .set('Cookie', owner.cookie)
    .expect(200);
  assert.equal(secondPage.body.notifications[0].id, older.rows[0].public_id);
  assert.deepEqual(secondPage.body.notifications[0].data, { userPublicId: other.publicId });

  await request(baseUrl)
    .patch(`/api/notifications/${newer.rows[0].public_id}/read`)
    .set('Cookie', other.cookie)
    .send({})
    .expect(204);
  const beforeOwnerRead = await db.query(
    'SELECT read_at, dismissed_at FROM notifications WHERE public_id = $1',
    [newer.rows[0].public_id]
  );
  assert.equal(beforeOwnerRead.rows[0].read_at, null);

  const firstUpdate = eventFrom(firstSocket, 'notification-updated');
  const secondUpdate = eventFrom(secondSocket, 'notification-updated');
  await request(baseUrl)
    .patch(`/api/notifications/${newer.rows[0].public_id}/read`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(204);
  const expectedRead = { notificationId: newer.rows[0].public_id, status: 'read' };
  assert.deepEqual(await firstUpdate, expectedRead);
  assert.deepEqual(await secondUpdate, expectedRead);
  const committedRead = await db.query(
    'SELECT read_at FROM notifications WHERE public_id = $1',
    [newer.rows[0].public_id]
  );
  assert.ok(committedRead.rows[0].read_at);
  const firstReadAt = committedRead.rows[0].read_at.toISOString();
  await request(baseUrl)
    .patch(`/api/notifications/${newer.rows[0].public_id}/read`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(204);
  const repeatedRead = await db.query(
    'SELECT read_at FROM notifications WHERE public_id = $1',
    [newer.rows[0].public_id]
  );
  assert.equal(repeatedRead.rows[0].read_at.toISOString(), firstReadAt);

  const dismissEvent = eventFrom(firstSocket, 'notification-updated');
  await request(baseUrl)
    .delete(`/api/notifications/${newer.rows[0].public_id}`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(204);
  assert.deepEqual(await dismissEvent, {
    notificationId: newer.rows[0].public_id,
    status: 'dismissed'
  });
  await request(baseUrl)
    .delete(`/api/notifications/${newer.rows[0].public_id}`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(204);

  await request(baseUrl)
    .delete(`/api/notifications/${protectedRecord.rows[0].public_id}`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(204);
  const persisted = await db.query(
    `SELECT public_id, dismissed_at FROM notifications
     WHERE public_id = ANY($1::text[])
     ORDER BY public_id`,
    [[newer.rows[0].public_id, protectedRecord.rows[0].public_id]]
  );
  assert.equal(persisted.rowCount, 2);
  assert.ok(persisted.rows.find((row) => row.public_id === newer.rows[0].public_id).dismissed_at);
  assert.equal(persisted.rows.find((row) => row.public_id === protectedRecord.rows[0].public_id).dismissed_at, null);

  firstSocket.disconnect();
  secondSocket.disconnect();
  const afterReconnect = await request(baseUrl)
    .get('/api/notifications')
    .set('Cookie', owner.cookie)
    .expect(200);
  assert.deepEqual(afterReconnect.body.notifications.map((item) => item.id), [older.rows[0].public_id]);
  assert.equal(afterReconnect.body.unreadCount, 1);
});
