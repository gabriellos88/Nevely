const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createRuntime } = require('../../server');
const { createRetentionWorker } = require('../../lib/retention');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error() {}
};

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

function cookieFrom(response) {
  return (response.headers['set-cookie'] || [])
    .map((value) => value.split(';')[0])
    .join('; ');
}

function profile(name, avatarId) {
  return {
    name,
    age: 28,
    gender: 'non-binary',
    country: { code: 'ch' },
    avatarId
  };
}

async function createGuest(baseUrl, name, avatarId) {
  const response = await request(baseUrl)
    .post('/api/guest-profile')
    .send(profile(name, avatarId))
    .expect(201);
  return {
    cookie: cookieFrom(response),
    guest: response.body.guest
  };
}

async function internalGuestId(db, guest) {
  return (await db.query('SELECT id FROM guest_principals WHERE public_id = $1', [guest.publicId])).rows[0].id;
}

async function connectGuest(baseUrl, cookie) {
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

function matchPayload(name) {
  return {
    interests: ['astronomy'],
    profile: {
      username: name,
      age: 28,
      gender: 'non-binary',
      country: 'Switzerland'
    },
    waitingTimeSeconds: null
  };
}

async function seedEndedConversation(db, guestId, suffix) {
  const conversation = await db.query(
    `INSERT INTO conversations (type, status, ended_at, last_activity_at, expires_at)
     VALUES ('random', 'ended', NOW(), NOW(), NOW() + INTERVAL '7 days')
     RETURNING id, public_id`
  );
  const conversationId = Number(conversation.rows[0].id);
  await db.query(
    `INSERT INTO conversation_participants
       (conversation_id, guest_id, socket_id, display_name, left_at)
     VALUES ($1, $2, $3, 'Owned Guest', NOW())`,
    [conversationId, guestId, `seed-${suffix}`]
  );
  await db.query(
    `INSERT INTO messages
       (conversation_id, sender_guest_id, sender_socket_id, sender_display_name, body)
     VALUES ($1, $2, $3, 'Owned Guest', $4)`,
    [conversationId, guestId, `seed-${suffix}`, `Synthetic guest history ${suffix}`]
  );
  return conversation.rows[0].public_id;
}

test('guest sessions own conversations, messages, receipts, reports and bounded saved history', {
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
      SESSION_SECRET: 'guest-product-integration-secret',
      RETENTION_MAX_UNSAVED_PER_USER: '10'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstGuest = await createGuest(baseUrl, 'First Persistent Guest', 'astra');
  const secondGuest = await createGuest(baseUrl, 'Second Persistent Guest', 'nova');
  const firstGuestId = await internalGuestId(db, firstGuest.guest);
  const secondGuestId = await internalGuestId(db, secondGuest.guest);
  const first = await connectGuest(baseUrl, firstGuest.cookie);
  const second = await connectGuest(baseUrl, secondGuest.cookie);
  const anonymous = await connectGuest(baseUrl, '');

  t.after(async () => {
    first.disconnect();
    second.disconnect();
    anonymous.disconnect();
    await runtime.shutdown();
    await db.close();
  });

  const rejectedAnonymous = eventFrom(anonymous, 'chat-error');
  anonymous.emit('find-partner', matchPayload('Browser Supplied Guest'));
  assert.equal(typeof (await rejectedAnonymous).message, 'string');

  const waiting = eventFrom(first, 'waiting');
  first.emit('find-partner', matchPayload(firstGuest.guest.name));
  await waiting;
  const firstMatched = eventFrom(first, 'matched');
  const secondMatched = eventFrom(second, 'matched');
  second.emit('find-partner', matchPayload(secondGuest.guest.name));
  const [firstMatch, secondMatch] = await Promise.all([firstMatched, secondMatched]);
  assert.equal(firstMatch.conversationId, secondMatch.conversationId);

  const received = eventFrom(second, 'receive-message');
  const sent = eventFrom(first, 'message-sent');
  first.emit('send-message', 'Synthetic guest-owned message');
  const [receivedMessage] = await Promise.all([received, sent]);

  const reportSubmitted = eventFrom(second, 'report-submitted');
  second.emit('report', {
    reason: 'synthetic-guest-report',
    details: 'Synthetic guest ownership evidence'
  });
  assert.deepEqual(await reportSubmitted, { stored: true });

  const participants = (await db.query(
    `SELECT user_id, guest_id FROM conversation_participants
     WHERE conversation_id = (SELECT id FROM conversations WHERE public_id = $1) ORDER BY joined_at`,
    [firstMatch.conversationId]
  )).rows;
  assert.deepEqual(
    new Set(participants.map((row) => row.guest_id)),
    new Set([firstGuestId, secondGuestId])
  );
  assert.equal(participants.every((row) => row.user_id === null), true);

  const storedMessage = (await db.query(
    `SELECT sender_user_id, sender_guest_id FROM messages WHERE public_id = $1`,
    [receivedMessage.id]
  )).rows[0];
  assert.equal(storedMessage.sender_user_id, null);
  assert.equal(storedMessage.sender_guest_id, firstGuestId);
  const receipt = (await db.query(
    `SELECT receipt.user_id, receipt.guest_id, receipt.read_at
     FROM message_receipts receipt JOIN messages message ON message.id = receipt.message_id
     WHERE message.public_id = $1`,
    [receivedMessage.id]
  )).rows[0];
  assert.equal(receipt.user_id, null);
  assert.equal(receipt.guest_id, secondGuestId);
  assert.equal(receipt.read_at, null);

  const storedReport = (await db.query(
    `SELECT reporter_user_id, reporter_guest_id, reported_user_id, reported_guest_id
     FROM reports WHERE conversation_id = (SELECT id FROM conversations WHERE public_id = $1)`,
    [firstMatch.conversationId]
  )).rows[0];
  assert.equal(storedReport.reporter_user_id, null);
  assert.equal(storedReport.reporter_guest_id, secondGuestId);
  assert.equal(storedReport.reported_user_id, null);
  assert.equal(storedReport.reported_guest_id, firstGuestId);

  const recent = await request(baseUrl)
    .get('/api/conversations')
    .set('Cookie', secondGuest.cookie)
    .expect(200);
  assert.equal(recent.body.limits.recentUnsaved, 10);
  assert.equal(recent.body.limits.saved, 2);
  assert.equal(recent.body.conversations[0].partner_name, firstGuest.guest.name);
  assert.equal(recent.body.conversations[0].unread_count, 1);

  const history = await request(baseUrl)
    .get(`/api/conversations/${firstMatch.conversationId}/messages`)
    .set('Cookie', secondGuest.cookie)
    .expect(200);
  assert.equal(history.body.messages[0].sender_is_owner, false);
  await request(baseUrl)
    .patch(`/api/conversations/${firstMatch.conversationId}/read`)
    .set('Cookie', secondGuest.cookie)
    .send({ upToMessageId: receivedMessage.id })
    .expect(200);
  const afterRead = await request(baseUrl)
    .get('/api/conversations')
    .set('Cookie', secondGuest.cookie)
    .expect(200);
  assert.equal(afterRead.body.unreadCount, 0);

  const seeded = [];
  for (let index = 0; index < 3; index += 1) {
    seeded.push(await seedEndedConversation(db, secondGuestId, `saved-${index}`));
  }
  await request(baseUrl)
    .put(`/api/conversations/${seeded[0]}/saved`)
    .set('Cookie', secondGuest.cookie)
    .send({})
    .expect(201);
  await request(baseUrl)
    .put(`/api/conversations/${seeded[1]}/saved`)
    .set('Cookie', secondGuest.cookie)
    .send({})
    .expect(201);
  await request(baseUrl)
    .put(`/api/conversations/${seeded[0]}/saved`)
    .set('Cookie', secondGuest.cookie)
    .send({})
    .expect(200);
  const atLimit = await request(baseUrl)
    .put(`/api/conversations/${seeded[2]}/saved`)
    .set('Cookie', secondGuest.cookie)
    .send({})
    .expect(409);
  assert.equal(atLimit.body.limit, 2);
  const saved = await request(baseUrl)
    .get('/api/saved-chats')
    .set('Cookie', secondGuest.cookie)
    .expect(200);
  assert.equal(saved.body.limit, 2);
  assert.equal(saved.body.used, 2);
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM saved_chats
       WHERE guest_id = $1 AND user_id IS NULL`,
      [secondGuestId]
    )).rows[0].count),
    2
  );
  await request(baseUrl)
    .delete(`/api/conversations/${seeded[0]}/saved`)
    .set('Cookie', secondGuest.cookie)
    .expect(204);
  await request(baseUrl)
    .put(`/api/conversations/${seeded[2]}/saved`)
    .set('Cookie', secondGuest.cookie)
    .send({})
    .expect(201);

  const outsider = await createGuest(baseUrl, 'Unrelated Guest', 'lyra');
  await request(baseUrl)
    .get(`/api/conversations/${firstMatch.conversationId}/messages`)
    .set('Cookie', outsider.cookie)
    .expect(404);
  await request(baseUrl)
    .put(`/api/conversations/${firstMatch.conversationId}/saved`)
    .set('Cookie', outsider.cookie)
    .send({ guestId: secondGuestId })
    .expect(404);

  for (let index = 0; index < 11; index += 1) {
    await seedEndedConversation(db, secondGuestId, `retention-${index}`);
  }
  const worker = createRetentionWorker({
    db,
    environment: {
      NODE_ENV: 'test',
      RETENTION_WORKER_ENABLED: 'true',
      RETENTION_BATCH_SIZE: '100',
      RETENTION_MAX_BATCHES_PER_POLICY: '2',
      RETENTION_MAX_UNSAVED_PER_USER: '10'
    },
    log: quietLog
  });
  const retention = await worker.runOnce();
  assert.equal(retention.deletedCounts['reason:unsaved_over_user_limit'], 2);
  const retainedUnsaved = await db.query(
    `SELECT COUNT(DISTINCT c.id)::int AS count
     FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.guest_id = $1
       AND c.status = 'ended'
       AND NOT EXISTS (
         SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id
       )
       AND EXISTS (
         SELECT 1 FROM messages m WHERE m.conversation_id = c.id
       )`,
    [secondGuestId]
  );
  assert.equal(retainedUnsaved.rows[0].count, 10);
});
