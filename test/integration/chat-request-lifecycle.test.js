const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = { info() {}, warn() {}, error() {} };

after(async () => {
  if (hasDatabase) await require('../../db').close();
});

function cookieFrom(response) {
  return (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}

function eventFrom(socket, eventName, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(eventName, handler);
  });
}

function emitWithAck(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${eventName} acknowledgement`)),
      4_000
    );
    socket.emit(eventName, payload, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
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

test('chat requests are durable, expiring, idempotent and rate-limited across replicas', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    SESSION_SECRET: 'chat-request-integration-session-secret',
    SHUTDOWN_GRACE_MS: '1000'
  };
  const firstRuntime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: environment,
    log: quietLog
  });
  const secondRuntime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: environment,
    log: quietLog
  });
  const firstAddress = await firstRuntime.start({ port: 0, host: '127.0.0.1' });
  const secondAddress = await secondRuntime.start({ port: 0, host: '127.0.0.1' });
  const firstUrl = `http://127.0.0.1:${firstAddress.port}`;
  const secondUrl = `http://127.0.0.1:${secondAddress.port}`;
  const alice = await registerVerified(firstUrl, db, 'chat_request_alice');
  const bob = await registerVerified(firstUrl, db, 'chat_request_bob');
  const identities = await db.query(
    'SELECT id, public_id FROM users WHERE public_id = ANY($1::text[])',
    [[alice.publicId, bob.publicId]]
  );
  const aliceId = Number(identities.rows.find((row) => row.public_id === alice.publicId).id);
  const bobId = Number(identities.rows.find((row) => row.public_id === bob.publicId).id);
  await db.query(
    `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)`,
    [aliceId, bobId]
  );

  const aliceFirst = await connectAccount(firstUrl, alice.cookie);
  const aliceSecond = await connectAccount(secondUrl, alice.cookie);
  const bobSecond = await connectAccount(secondUrl, bob.cookie);
  const sockets = [aliceFirst, aliceSecond, bobSecond];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await Promise.all([firstRuntime.shutdown(), secondRuntime.shutdown()]);
  });

  const created = await emitWithAck(aliceFirst, 'direct-chat-request', { publicId: bob.publicId });
  assert.equal(created.ok, true);
  assert.match(created.requestId, /^crq_[0-9a-f]{24}$/);
  assert.deepEqual(Object.keys(created).sort(), ['ok', 'requestId', 'status']);
  const duplicate = await emitWithAck(aliceSecond, 'direct-chat-request', { publicId: bob.publicId });
  assert.deepEqual(duplicate, created);
  const onePending = await db.query(
    `SELECT COUNT(*)::int AS count FROM chat_requests
     WHERE status = 'pending' AND LEAST(sender_user_id, receiver_user_id) = $1
       AND GREATEST(sender_user_id, receiver_user_id) = $2`,
    [Math.min(aliceId, bobId), Math.max(aliceId, bobId)]
  );
  assert.equal(onePending.rows[0].count, 1);
  const persistentNotification = await db.query(
    `SELECT type, data FROM notifications
     WHERE user_id = $1 AND type = 'chat_request'`,
    [bobId]
  );
  assert.equal(persistentNotification.rowCount, 1);
  assert.equal(persistentNotification.rows[0].data.requestPublicId, created.requestId);
  assert.deepEqual(Object.keys(persistentNotification.rows[0].data), ['requestPublicId']);
  const messageBadge = await request(secondUrl)
    .get('/api/conversations')
    .set('Cookie', bob.cookie)
    .expect(200);
  assert.equal(messageBadge.body.pendingChatRequestCount, 1);
  assert.equal(messageBadge.body.messageBadgeCount, 1);

  const incoming = await request(secondUrl)
    .get('/api/chat-requests')
    .set('Cookie', bob.cookie)
    .expect(200);
  assert.equal(incoming.body.direction, 'incoming');
  assert.equal(incoming.body.requests[0].id, created.requestId);
  assert.equal(incoming.body.requests[0].person_public_id, alice.publicId);
  assert.equal('sender_user_id' in incoming.body.requests[0], false);
  assert.equal('receiver_user_id' in incoming.body.requests[0], false);
  const outgoing = await request(secondUrl)
    .get('/api/chat-requests?direction=outgoing')
    .set('Cookie', alice.cookie)
    .expect(200);
  assert.equal(outgoing.body.requests[0].person_public_id, bob.publicId);

  const inverse = await emitWithAck(bobSecond, 'direct-chat-request', { publicId: alice.publicId });
  assert.equal(inverse.ok, false);
  assert.equal(inverse.requestId, undefined);
  assert.equal(inverse.error, require('../../public/i18n/en.json').errors.requestPending);

  const cancelled = await emitWithAck(aliceSecond, 'direct-chat-cancel', { requestId: created.requestId });
  assert.deepEqual(cancelled, { ok: true, status: 'cancelled' });
  assert.deepEqual(
    await emitWithAck(aliceFirst, 'direct-chat-cancel', { requestId: created.requestId }),
    cancelled
  );

  const requestedEvent = eventFrom(bobSecond, 'direct-chat-requested');
  const declinedRequest = await emitWithAck(aliceSecond, 'direct-chat-request', { publicId: bob.publicId });
  assert.deepEqual(await requestedEvent, { requestId: declinedRequest.requestId });
  const declined = await emitWithAck(bobSecond, 'direct-chat-response', {
    requestId: declinedRequest.requestId,
    action: 'decline'
  });
  assert.deepEqual(declined, { ok: true, status: 'declined' });
  assert.deepEqual(
    await emitWithAck(bobSecond, 'direct-chat-response', {
      requestId: declinedRequest.requestId,
      action: 'decline'
    }),
    { ok: true, status: 'declined', started: false }
  );

  const expiring = await emitWithAck(aliceFirst, 'direct-chat-request', { publicId: bob.publicId });
  await db.query(
    `UPDATE chat_requests
     SET created_at = NOW() - INTERVAL '16 minutes', expires_at = NOW() - INTERVAL '1 minute'
     WHERE public_id = $1`,
    [expiring.requestId]
  );
  const expiredList = await request(secondUrl)
    .get('/api/chat-requests')
    .set('Cookie', bob.cookie)
    .expect(200);
  assert.equal(expiredList.body.pendingCount, 0);
  assert.deepEqual(expiredList.body.requests, []);
  const expiredRow = await db.query('SELECT status FROM chat_requests WHERE public_id = $1', [expiring.requestId]);
  assert.equal(expiredRow.rows[0].status, 'expired');

  await db.query(
    `DELETE FROM moderation_rate_windows
     WHERE principal_type = 'user' AND principal_id = $1 AND action = 'chat-request'`,
    [String(aliceId)]
  );
  const concurrent = await Promise.all(Array.from({ length: 7 }, (_, index) => emitWithAck(
    index % 2 ? aliceFirst : aliceSecond,
    'direct-chat-request',
    { publicId: bob.publicId }
  )));
  assert.equal(concurrent.filter((response) => response.ok).length, 6);
  const cooldown = concurrent.find((response) => !response.ok);
  assert.equal(cooldown.error, require('../../public/i18n/en.json').errors.requestCooldown);
  assert.ok(cooldown.retryAfterSeconds > 0);
  const limiter = await db.query(
    `SELECT request_count FROM moderation_rate_windows
     WHERE principal_type = 'user' AND principal_id = $1 AND action = 'chat-request'`,
    [String(aliceId)]
  );
  assert.equal(limiter.rows[0].request_count, 7);
  const activeRequests = await db.query(
    `SELECT public_id FROM chat_requests
     WHERE sender_user_id = $1 AND receiver_user_id = $2 AND status = 'pending'`,
    [aliceId, bobId]
  );
  assert.equal(activeRequests.rowCount, 1);

  aliceFirst.disconnect();
  aliceSecond.disconnect();
  const accepted = await emitWithAck(bobSecond, 'direct-chat-response', {
    requestId: activeRequests.rows[0].public_id,
    action: 'accept'
  });
  assert.equal(accepted.ok, false);
  assert.equal(accepted.error, require('../../public/i18n/en.json').errors.chatRequestUnavailable);
  const afterReconnect = await connectAccount(firstUrl, alice.cookie);
  sockets.push(afterReconnect);
  const pendingAfterReconnect = await request(firstUrl)
    .get('/api/chat-requests?direction=outgoing')
    .set('Cookie', alice.cookie)
    .expect(200);
  assert.equal(pendingAfterReconnect.body.pendingCount, 1);
  assert.equal(pendingAfterReconnect.body.requests[0].id, activeRequests.rows[0].public_id);
});
