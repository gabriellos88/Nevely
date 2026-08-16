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

function eventFromAny(sockets, eventName, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const handlers = new Map();
    const cleanup = () => {
      clearTimeout(timeout);
      handlers.forEach((handler, socket) => socket.off(eventName, handler));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    sockets.forEach((socket) => {
      const handler = (payload) => {
        cleanup();
        resolve({ socket, payload });
      };
      handlers.set(socket, handler);
      socket.once(eventName, handler);
    });
  });
}

function emitWithAck(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${eventName} acknowledgement`)),
      4_000
    );
    const acknowledge = (response) => {
      clearTimeout(timeout);
      resolve(response);
    };
    if (payload === undefined) socket.emit(eventName, acknowledge);
    else socket.emit(eventName, payload, acknowledge);
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

test('direct friend chat reserves one conversation across replicas and never consumes random skip', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    SESSION_SECRET: 'direct-chat-integration-session-secret',
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
  const alice = await registerVerified(firstUrl, db, 'direct_chat_alice');
  const bob = await registerVerified(firstUrl, db, 'direct_chat_bob');
  const identities = await db.query(
    'SELECT id, public_id FROM users WHERE public_id = ANY($1::text[])',
    [[alice.publicId, bob.publicId]]
  );
  const aliceId = Number(identities.rows.find((row) => row.public_id === alice.publicId).id);
  const bobId = Number(identities.rows.find((row) => row.public_id === bob.publicId).id);
  await db.query(
    'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)',
    [aliceId, bobId]
  );

  const aliceFirst = await connectAccount(firstUrl, alice.cookie);
  const aliceSecond = await connectAccount(secondUrl, alice.cookie);
  const bobFirst = await connectAccount(firstUrl, bob.cookie);
  const bobSecond = await connectAccount(secondUrl, bob.cookie);
  const sockets = [aliceFirst, aliceSecond, bobFirst, bobSecond];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await Promise.all([firstRuntime.shutdown(), secondRuntime.shutdown()]);
  });

  const created = await emitWithAck(aliceFirst, 'direct-chat-request', { publicId: bob.publicId });
  assert.equal(created.ok, true);
  const aliceMatched = eventFromAny([aliceFirst, aliceSecond], 'matched');
  const bobMatched = eventFromAny([bobFirst, bobSecond], 'matched');
  const acceptPayload = { requestId: created.requestId, action: 'accept' };
  const responses = await Promise.all([
    emitWithAck(bobFirst, 'direct-chat-response', acceptPayload),
    emitWithAck(bobSecond, 'direct-chat-response', acceptPayload)
  ]);
  assert.equal(responses.filter((response) => response.ok && response.started).length, 1);
  assert.equal(responses.filter((response) => response.ok && !response.started).length, 1);
  const matchedAlice = await aliceMatched;
  const matchedBob = await bobMatched;
  for (const match of [matchedAlice.payload, matchedBob.payload]) {
    assert.equal(match.conversationType, 'direct');
    assert.deepEqual(match.capabilities, {
      canNext: false,
      canEnd: true,
      canReport: true,
      canAddFriend: false,
      canBlock: true
    });
    assert.equal(match.canAddFriend, false);
  }
  assert.equal(matchedAlice.payload.conversationId, matchedBob.payload.conversationId);

  const reserved = await db.query(
    `SELECT cr.status, cr.conversation_id, c.type, c.status AS conversation_status
     FROM chat_requests cr JOIN conversations c ON c.id = cr.conversation_id
     WHERE cr.public_id = $1`,
    [created.requestId]
  );
  assert.equal(reserved.rowCount, 1);
  assert.deepEqual(reserved.rows[0], {
    status: 'accepted',
    conversation_id: String(matchedAlice.payload.conversationId),
    type: 'direct',
    conversation_status: 'active'
  });
  assert.equal(Number((await db.query("SELECT COUNT(*)::int AS count FROM conversations WHERE type = 'direct'")).rows[0].count), 1);

  const directPaused = eventFrom(matchedBob.socket, 'direct-chat-paused');
  const randomWaiting = eventFrom(matchedAlice.socket, 'waiting');
  const randomSearchState = eventFrom(matchedAlice.socket, 'search-state');
  matchedAlice.socket.emit('find-partner', {
    interests: [],
    profile: { username: 'Browser supplied', age: 28, gender: 'non-binary', country: 'Switzerland' },
    waitingTimeSeconds: 5
  });
  assert.deepEqual(await randomWaiting, { status: 'searching' });
  assert.deepEqual(await randomSearchState, { phase: 'general' });
  assert.deepEqual(await directPaused, {});
  const stillReserved = await db.query(
    `SELECT c.status,
            EXISTS (SELECT 1 FROM direct_conversation_pairs pair WHERE pair.conversation_id = c.id) AS reserved
     FROM conversations c WHERE c.id = $1`,
    [matchedAlice.payload.conversationId]
  );
  assert.deepEqual(stillReserved.rows[0], { status: 'active', reserved: true });
  const randomCounters = await db.query(
    `SELECT action FROM moderation_rate_windows
     WHERE principal_type = 'user' AND principal_id = $1 AND action IN ('skip', 'match')`,
    [String(aliceId)]
  );
  assert.deepEqual(randomCounters.rows.map((row) => row.action), ['match']);

  assert.deepEqual(await emitWithAck(matchedAlice.socket, 'cancel-search'), { ok: true, cancelled: true });
  const resumedAlice = eventFrom(matchedAlice.socket, 'matched');
  const resumedBob = eventFromAny([bobFirst, bobSecond], 'matched');
  assert.deepEqual(
    await emitWithAck(matchedAlice.socket, 'resume-direct-chat', { partnerPublicId: bob.publicId }),
    { ok: true, resumed: true }
  );
  const [aliceResumePayload, bobResume] = await Promise.all([resumedAlice, resumedBob]);
  assert.equal(aliceResumePayload.conversationId, matchedAlice.payload.conversationId);
  assert.equal(bobResume.payload.conversationId, matchedAlice.payload.conversationId);
  assert.equal(aliceResumePayload.restored, true);

  const partnerLeft = eventFrom(bobResume.socket, 'partner-left');
  assert.deepEqual(
    await emitWithAck(matchedAlice.socket, 'end-direct-chat'),
    { ok: true, ended: true }
  );
  assert.equal((await partnerLeft).conversationId, matchedAlice.payload.conversationId);
  assert.deepEqual(
    await emitWithAck(matchedAlice.socket, 'end-direct-chat'),
    { ok: true, ended: false }
  );
  const endedConversation = await db.query('SELECT status FROM conversations WHERE id = $1', [matchedAlice.payload.conversationId]);
  assert.equal(endedConversation.rows[0].status, 'ended');
  assert.equal(Number((await db.query(
    `SELECT COUNT(*)::int AS count FROM moderation_rate_windows
     WHERE principal_type = 'user' AND principal_id = $1 AND action = 'skip'`,
    [String(aliceId)]
  )).rows[0].count), 0);

  const secondRequest = await emitWithAck(aliceFirst, 'direct-chat-request', { publicId: bob.publicId });
  const secondAliceMatch = eventFrom(aliceFirst, 'matched');
  const secondBobMatch = eventFrom(bobFirst, 'matched');
  const secondAccept = await emitWithAck(bobFirst, 'direct-chat-response', {
    requestId: secondRequest.requestId,
    action: 'accept'
  });
  assert.equal(secondAccept.started, true);
  await Promise.all([secondAliceMatch, secondBobMatch]);
  assert.deepEqual(await emitWithAck(aliceFirst, 'leave-chat'), {
    ok: false,
    error: require('../../public/i18n/en.json').errors.directChatEnd
  });
  const leftAfterExplicitEnd = eventFrom(bobFirst, 'partner-left');
  assert.deepEqual(await emitWithAck(aliceFirst, 'end-direct-chat'), { ok: true, ended: true });
  await leftAfterExplicitEnd;
  assert.equal(Number((await db.query(
    `SELECT COUNT(*)::int AS count FROM moderation_rate_windows
     WHERE principal_type = 'user' AND principal_id = $1 AND action = 'skip'`,
    [String(aliceId)]
  )).rows[0].count), 0);

  await db.query(
    'INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1, $2)',
    [bobId, aliceId]
  );
  const blocked = await emitWithAck(aliceSecond, 'direct-chat-request', { publicId: bob.publicId });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, require('../../public/i18n/en.json').errors.requestSend);
  await db.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2', [bobId, aliceId]);
  await db.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [aliceId, bobId]);
  const removed = await emitWithAck(aliceFirst, 'direct-chat-request', { publicId: bob.publicId });
  assert.equal(removed.ok, false);
  assert.equal(removed.error, require('../../public/i18n/en.json').errors.requestSend);
  await db.query('INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)', [aliceId, bobId]);
  await db.query(
    `INSERT INTO account_bans (user_id, type, reason, created_by)
     VALUES ($1, 'permanent', 'Synthetic policy fixture', $2)`,
    [bobId, aliceId]
  );
  const banned = await emitWithAck(aliceSecond, 'direct-chat-request', { publicId: bob.publicId });
  assert.equal(banned.ok, false);
  assert.equal(banned.error, require('../../public/i18n/en.json').errors.requestSend);

  matchedAlice.socket.disconnect();
  const reconnected = await connectAccount(firstUrl, alice.cookie);
  sockets.push(reconnected);
  const activeAfterReconnect = await db.query(
    `SELECT COUNT(*)::int AS count FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = $1 AND c.type = 'direct' AND c.status = 'active'`,
    [aliceId]
  );
  assert.equal(activeAfterReconnect.rows[0].count, 0);
});

test('direct friend chat survives disconnect, restores once and ends on friendship removal', {
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
      SESSION_SECRET: 'direct-chat-reconnect-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const alice = await registerVerified(baseUrl, db, 'direct_restore_alice');
  const bob = await registerVerified(baseUrl, db, 'direct_restore_bob');
  const identities = await db.query(
    'SELECT id, public_id FROM users WHERE public_id = ANY($1::text[])',
    [[alice.publicId, bob.publicId]]
  );
  const aliceId = Number(identities.rows.find((row) => row.public_id === alice.publicId).id);
  const bobId = Number(identities.rows.find((row) => row.public_id === bob.publicId).id);
  await db.query(
    'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)',
    [aliceId, bobId]
  );
  const aliceSocket = await connectAccount(baseUrl, alice.cookie);
  const bobSocket = await connectAccount(baseUrl, bob.cookie);
  const sockets = [aliceSocket, bobSocket];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await runtime.shutdown();
  });

  const created = await emitWithAck(aliceSocket, 'direct-chat-request', { publicId: bob.publicId });
  const aliceMatch = eventFrom(aliceSocket, 'matched');
  const bobMatch = eventFrom(bobSocket, 'matched');
  assert.equal((await emitWithAck(bobSocket, 'direct-chat-response', {
    requestId: created.requestId,
    action: 'accept'
  })).started, true);
  const initial = await aliceMatch;
  await bobMatch;

  const paused = eventFrom(bobSocket, 'direct-chat-paused');
  aliceSocket.disconnect();
  assert.deepEqual(await paused, {});
  const persisted = await db.query(
    `SELECT c.status, COUNT(pair.conversation_id)::int AS reservations
     FROM conversations c
     LEFT JOIN direct_conversation_pairs pair ON pair.conversation_id = c.id
     WHERE c.id = $1 GROUP BY c.status`,
    [initial.conversationId]
  );
  assert.deepEqual(persisted.rows[0], { status: 'active', reservations: 1 });

  const restoredAlice = createClient(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: alice.cookie }
  });
  sockets.push(restoredAlice);
  const connected = eventFrom(restoredAlice, 'connect');
  const restoredForAlice = eventFrom(restoredAlice, 'matched');
  const restoredForBob = eventFrom(bobSocket, 'matched');
  restoredAlice.connect();
  await connected;
  const [aliceRestored, bobRestored] = await Promise.all([restoredForAlice, restoredForBob]);
  assert.equal(aliceRestored.restored, true);
  assert.equal(bobRestored.restored, true);
  assert.equal(aliceRestored.conversationId, initial.conversationId);

  const duplicateTab = await connectAccount(baseUrl, alice.cookie);
  sockets.push(duplicateTab);
  const duplicateRequest = await emitWithAck(duplicateTab, 'direct-chat-request', { publicId: bob.publicId });
  assert.equal(duplicateRequest.ok, false);
  assert.equal(duplicateRequest.error, require('../../public/i18n/en.json').errors.requestSend);
  assert.equal(Number((await db.query(
    `SELECT COUNT(*)::int AS count FROM conversations
     WHERE type = 'direct' AND status = 'active'`
  )).rows[0].count), 1);

  const endedForAlice = eventFrom(restoredAlice, 'partner-left');
  const endedForBob = eventFrom(bobSocket, 'partner-left');
  await request(baseUrl)
    .delete(`/api/friends/${bob.publicId}`)
    .set('Cookie', alice.cookie)
    .send({})
    .expect(204);
  await Promise.all([endedForAlice, endedForBob]);
  const ended = await db.query(
    `SELECT c.status,
            EXISTS (SELECT 1 FROM direct_conversation_pairs pair WHERE pair.conversation_id = c.id) AS reserved
     FROM conversations c WHERE c.id = $1`,
    [initial.conversationId]
  );
  assert.deepEqual(ended.rows[0], { status: 'ended', reserved: false });
});
