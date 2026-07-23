const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createRuntime } = require('../../server');
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
  return (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}

async function register(baseUrl, username, email) {
  const response = await request(baseUrl)
    .post('/register')
    .set('Accept', 'application/json')
    .send({ username, email, password: 'SyntheticPassword123!' })
    .expect(201);
  return { cookie: cookieFrom(response), user: response.body.user };
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

test('account sockets persist messages, unread/read receipts and ban notifications', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'integration-socket-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstAccount = await register(baseUrl, 'socket_first', 'socket-first@example.test');
  const secondAccount = await register(baseUrl, 'socket_second', 'socket-second@example.test');
  let adminAccount = await register(baseUrl, 'socket_admin', 'socket-admin@example.test');

  await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', adminAccount.user.id]);
  await request(baseUrl)
    .post('/logout')
    .set('Accept', 'application/json')
    .set('Cookie', adminAccount.cookie)
    .expect(204);
  const adminLogin = await request(baseUrl)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'socket-admin@example.test', password: 'SyntheticPassword123!' })
    .expect(200);
  adminAccount = { ...adminAccount, cookie: cookieFrom(adminLogin) };

  const first = await connectAccount(baseUrl, firstAccount.cookie);
  const second = await connectAccount(baseUrl, secondAccount.cookie);
  t.after(async () => {
    first.disconnect();
    second.disconnect();
    await runtime.shutdown();
  });

  const waiting = eventFrom(first, 'waiting');
  first.emit('find-partner', {
    interests: ['astronomy'],
    profile: { username: 'First', age: 28, gender: 'non-binary', country: 'Switzerland' },
    waitingTimeSeconds: null
  });
  await waiting;

  const firstMatched = eventFrom(first, 'matched');
  const secondMatched = eventFrom(second, 'matched');
  second.emit('find-partner', {
    interests: ['astronomy'],
    profile: { username: 'Second', age: 29, gender: 'non-binary', country: 'Switzerland' },
    waitingTimeSeconds: null
  });
  const [firstMatch, secondMatch] = await Promise.all([firstMatched, secondMatched]);
  assert.equal(firstMatch.conversationId, secondMatch.conversationId);
  assert.equal(Number.isSafeInteger(firstMatch.conversationId), true);

  const received = eventFrom(second, 'receive-message');
  const sent = eventFrom(first, 'message-sent');
  first.emit('send-message', 'synthetic persisted message');
  const [receivedMessage, sentMessage] = await Promise.all([received, sent]);
  assert.equal(receivedMessage.id, sentMessage.id);
  assert.equal(Number.isSafeInteger(Number(receivedMessage.id)), true);

  const beforeRead = await request(baseUrl)
    .get('/api/conversations')
    .set('Cookie', secondAccount.cookie)
    .expect(200);
  const conversationBeforeRead = beforeRead.body.conversations
    .find((conversation) => Number(conversation.id) === Number(firstMatch.conversationId));
  assert.equal(conversationBeforeRead.unread_count, 1);

  const readEvent = eventFrom(first, 'message-read');
  const acknowledgement = await new Promise((resolve) => {
    second.emit('messages-read', {
      conversationId: firstMatch.conversationId,
      upToMessageId: receivedMessage.id
    }, resolve);
  });
  assert.equal(acknowledgement.ok, true);
  assert.equal(acknowledgement.updated, 1);
  const readPayload = await readEvent;
  assert.equal(Number(readPayload.conversationId), Number(firstMatch.conversationId));
  assert.equal(Number(readPayload.upToMessageId), Number(receivedMessage.id));

  const afterRead = await request(baseUrl)
    .get('/api/conversations')
    .set('Cookie', secondAccount.cookie)
    .expect(200);
  const conversationAfterRead = afterRead.body.conversations
    .find((conversation) => Number(conversation.id) === Number(firstMatch.conversationId));
  assert.equal(conversationAfterRead.unread_count, 0);

  const banned = eventFrom(second, 'account-banned');
  await request(baseUrl)
    .post(`/api/admin/users/${secondAccount.user.id}/ban`)
    .set('Cookie', adminAccount.cookie)
    .send({ type: 'temporary', hours: 24, reason: 'Synthetic socket ban test' })
    .expect(201);
  const banPayload = await banned;
  assert.deepEqual(Object.keys(banPayload).sort(), ['hours', 'type']);
  assert.equal(banPayload.type, 'temporary');
  assert.equal(banPayload.hours, 24);
});
