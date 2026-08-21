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
  return { cookie: cookieFrom(login), publicId: registration.body.user.publicId, email };
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

test('friend requests use public IDs and remain transactional, idempotent and race-safe', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'friendship-integration-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const alice = await registerVerified(baseUrl, db, 'friend_alice');
  const bob = await registerVerified(baseUrl, db, 'friend_bob');
  const carol = await registerVerified(baseUrl, db, 'friend_carol');
  const dana = await registerVerified(baseUrl, db, 'friend_dana');
  const bobSocket = await connectAccount(baseUrl, bob.cookie);
  t.after(async () => {
    bobSocket.disconnect();
    await runtime.shutdown();
  });

  const pendingEvent = eventFrom(bobSocket, 'friend-request-updated');
  const created = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', alice.cookie)
    .send({ publicId: bob.publicId })
    .expect(201);
  assert.match(created.body.requestId, /^frq_[0-9a-f]{24}$/);
  const event = await pendingEvent;
  assert.deepEqual(event, { requestId: created.body.requestId, status: 'pending' });
  const committedAtEvent = await db.query(
    'SELECT status FROM friend_requests WHERE public_id = $1',
    [event.requestId]
  );
  assert.equal(committedAtEvent.rows[0].status, 'pending');

  const duplicate = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', alice.cookie)
    .send({ publicId: bob.publicId })
    .expect(200);
  assert.equal(duplicate.body.requestId, created.body.requestId);
  await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', bob.cookie)
    .send({ publicId: alice.publicId })
    .expect(409);

  const incoming = await request(baseUrl)
    .get('/api/friend-requests')
    .set('Cookie', bob.cookie)
    .expect(200);
  assert.equal(incoming.body.requests[0].id, created.body.requestId);
  assert.equal(incoming.body.requests[0].person_public_id, alice.publicId);
  const outgoing = await request(baseUrl)
    .get('/api/friend-requests?direction=outgoing')
    .set('Cookie', alice.cookie)
    .expect(200);
  assert.equal(outgoing.body.requests[0].id, created.body.requestId);
  assert.equal(outgoing.body.requests[0].person_public_id, bob.publicId);

  const notification = await db.query(
    `SELECT data FROM notifications
     WHERE user_id = (SELECT id FROM users WHERE public_id = $1)
       AND type = 'friend_request'`,
    [bob.publicId]
  );
  assert.equal(notification.rowCount, 1);
  assert.equal(notification.rows[0].data.requestPublicId, created.body.requestId);
  assert.equal(Object.hasOwn(notification.rows[0].data, 'requestId'), false);

  const inverse = await Promise.all([
    request(baseUrl)
      .post('/api/friend-requests')
      .set('Cookie', carol.cookie)
      .send({ publicId: dana.publicId }),
    request(baseUrl)
      .post('/api/friend-requests')
      .set('Cookie', dana.cookie)
      .send({ publicId: carol.publicId })
  ]);
  assert.deepEqual(inverse.map((response) => response.status).sort(), [201, 409]);
  const inverseWinner = inverse[0].status === 201
    ? { response: inverse[0], account: carol }
    : { response: inverse[1], account: dana };
  await request(baseUrl)
    .delete(`/api/friend-requests/${inverseWinner.response.body.requestId}`)
    .set('Cookie', inverseWinner.account.cookie)
    .send({})
    .expect(204);
  const carolId = Number((await db.query('SELECT id FROM users WHERE public_id = $1', [carol.publicId])).rows[0].id);
  const danaId = Number((await db.query('SELECT id FROM users WHERE public_id = $1', [dana.publicId])).rows[0].id);
  await db.query(
    `INSERT INTO friendships (user_id, friend_id)
     VALUES ($1, $2), ($2, $1)`,
    [carolId, danaId]
  );
  await request(baseUrl)
    .put(`/api/blocks/${carol.publicId}`)
    .set('Cookie', dana.cookie)
    .send({})
    .expect(201);
  await request(baseUrl)
    .put(`/api/blocks/${carol.publicId}`)
    .set('Cookie', dana.cookie)
    .send({})
    .expect(200);
  const blockedFriendship = await db.query(
    `SELECT COUNT(*)::int AS count FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [carolId, danaId]
  );
  assert.equal(blockedFriendship.rows[0].count, 0);

  await request(baseUrl)
    .delete(`/api/friend-requests/${created.body.requestId}`)
    .set('Cookie', alice.cookie)
    .send({})
    .expect(204);
  await request(baseUrl)
    .delete(`/api/friend-requests/${created.body.requestId}`)
    .set('Cookie', alice.cookie)
    .send({})
    .expect(204);

  const recreated = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', alice.cookie)
    .send({ publicId: bob.publicId })
    .expect(201);
  const accepts = await Promise.all([
    request(baseUrl)
      .patch(`/api/friend-requests/${recreated.body.requestId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept' }),
    request(baseUrl)
      .patch(`/api/friend-requests/${recreated.body.requestId}`)
      .set('Cookie', bob.cookie)
      .send({ action: 'accept' })
  ]);
  assert.deepEqual(accepts.map((response) => response.status).sort(), [200, 200]);
  const friendships = await db.query(
    `SELECT COUNT(*)::int AS count FROM friendships
     WHERE (user_id = (SELECT id FROM users WHERE public_id = $1)
            AND friend_id = (SELECT id FROM users WHERE public_id = $2))
        OR (user_id = (SELECT id FROM users WHERE public_id = $2)
            AND friend_id = (SELECT id FROM users WHERE public_id = $1))`,
    [alice.publicId, bob.publicId]
  );
  assert.equal(friendships.rows[0].count, 2);
  const acceptedNotifications = await db.query(
    `SELECT COUNT(*)::int AS count FROM notifications
     WHERE user_id = (SELECT id FROM users WHERE public_id = $1)
       AND type = 'friend_accepted'`,
    [alice.publicId]
  );
  assert.equal(acceptedNotifications.rows[0].count, 1);

  const friendList = await request(baseUrl)
    .get('/api/friends')
    .set('Cookie', alice.cookie)
    .expect(200);
  assert.equal(friendList.body.friends.length, 1);
  assert.equal(friendList.body.friends[0].public_id, bob.publicId);
  assert.equal(Object.hasOwn(friendList.body.friends[0], 'id'), false);
  assert.deepEqual(friendList.body.friends[0].capabilities, {
    canStartDirectChat: true,
    canOpenDirectChat: false,
    canRemoveFriend: true,
    canBlock: true,
    activeDirectConversationId: null
  });
  const aliceId = Number((await db.query('SELECT id FROM users WHERE public_id = $1', [alice.publicId])).rows[0].id);
  const bobId = Number((await db.query('SELECT id FROM users WHERE public_id = $1', [bob.publicId])).rows[0].id);
  await db.query(
    'INSERT INTO chat_requests (sender_user_id, receiver_user_id) VALUES ($1, $2)',
    [aliceId, bobId]
  );
  const removedEvent = eventFrom(bobSocket, 'friendship-updated');
  const removals = await Promise.all([
    request(baseUrl).delete(`/api/friends/${bob.publicId}`).set('Cookie', alice.cookie).send({}),
    request(baseUrl).delete(`/api/friends/${bob.publicId}`).set('Cookie', alice.cookie).send({})
  ]);
  assert.deepEqual(removals.map((response) => response.status), [204, 204]);
  assert.deepEqual(await removedEvent, { userPublicId: alice.publicId, status: 'removed' });
  const removedState = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM friendships
        WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AS friendships,
       (SELECT status FROM chat_requests
        WHERE sender_user_id = $1 AND receiver_user_id = $2) AS chat_status`,
    [aliceId, bobId]
  );
  assert.equal(removedState.rows[0].friendships, 0);
  assert.equal(removedState.rows[0].chat_status, 'cancelled');

  const declined = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', alice.cookie)
    .send({ publicId: carol.publicId })
    .expect(201);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(baseUrl)
      .patch(`/api/friend-requests/${declined.body.requestId}`)
      .set('Cookie', carol.cookie)
      .send({ action: 'decline' })
      .expect(200);
    assert.equal(response.body.status, 'declined');
  }

  const blocked = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', alice.cookie)
    .send({ publicId: dana.publicId })
    .expect(201);
  await request(baseUrl)
    .put(`/api/blocks/${alice.publicId}`)
    .set('Cookie', dana.cookie)
    .send({})
    .expect(201);
  await request(baseUrl)
    .patch(`/api/friend-requests/${blocked.body.requestId}`)
    .set('Cookie', dana.cookie)
    .send({ action: 'accept' })
    .expect(409);

  const unverified = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', alice.cookie)
    .send({ publicId: carol.publicId })
    .expect(201);
  await db.query('UPDATE users SET email_verified_at = NULL WHERE public_id = $1', [alice.publicId]);
  await request(baseUrl)
    .patch(`/api/friend-requests/${unverified.body.requestId}`)
    .set('Cookie', carol.cookie)
    .send({ action: 'accept' })
    .expect(409);

  const banned = await request(baseUrl)
    .post('/api/friend-requests')
    .set('Cookie', bob.cookie)
    .send({ publicId: carol.publicId })
    .expect(201);
  await db.query(
    `INSERT INTO account_bans (user_id, type, reason, starts_at, ends_at, created_by)
     VALUES ((SELECT id FROM users WHERE public_id = $1), 'temporary', $2,
             NOW(), NOW() + INTERVAL '1 hour',
             (SELECT id FROM users WHERE public_id = $3))`,
    [bob.publicId, 'Synthetic friendship eligibility test', carol.publicId]
  );
  await request(baseUrl)
    .patch(`/api/friend-requests/${banned.body.requestId}`)
    .set('Cookie', carol.cookie)
    .send({ action: 'accept' })
    .expect(409);
});
