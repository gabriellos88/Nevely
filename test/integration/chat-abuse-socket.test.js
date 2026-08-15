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

function eventsFrom(socket, eventName, count, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const payloads = [];
    const timeout = setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`Timed out waiting for ${count} ${eventName} events`));
    }, timeoutMs);
    const handleEvent = (payload) => {
      payloads.push(payload);
      if (payloads.length !== count) return;
      clearTimeout(timeout);
      socket.off(eventName, handleEvent);
      resolve(payloads);
    };
    socket.on(eventName, handleEvent);
  });
}

function emitWithAck(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName} acknowledgement`)), 4_000);
    const acknowledge = (response) => {
      clearTimeout(timeout);
      resolve(response);
    };
    if (payload === undefined) socket.emit(eventName, acknowledge);
    else socket.emit(eventName, payload, acknowledge);
  });
}

function cookieFrom(response) {
  return (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}

async function createGuest(baseUrl, name, avatarId) {
  const response = await request(baseUrl)
    .post('/api/guest-profile')
    .send({ name, age: 28, gender: 'non-binary', country: { code: 'ch' }, avatarId })
    .expect(201);
  return { cookie: cookieFrom(response), guest: response.body.guest };
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
    profile: { username: name, age: 28, gender: 'non-binary', country: 'Switzerland' },
    waitingTimeSeconds: null
  };
}

async function matchPair(first, second, firstName, secondName) {
  const waiting = eventFrom(first, 'waiting');
  first.emit('find-partner', matchPayload(firstName));
  await waiting;
  const matches = Promise.all([eventFrom(first, 'matched'), eventFrom(second, 'matched')]);
  second.emit('find-partner', matchPayload(secondName));
  return matches;
}

async function sendAccepted(sender, receiver, text) {
  const delivered = eventFrom(receiver, 'receive-message');
  const sent = eventFrom(sender, 'message-sent');
  sender.emit('send-message', text);
  return Promise.all([sent, delivered]);
}

test('Socket.IO skip cooldown survives reconnect and exposes only a generic retry', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'socket-abuse-integration-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstGuest = await createGuest(baseUrl, 'Skip First', 'astra');
  const secondGuest = await createGuest(baseUrl, 'Skip Second', 'nova');
  let first = await connectGuest(baseUrl, firstGuest.cookie);
  const second = await connectGuest(baseUrl, secondGuest.cookie);
  t.after(async () => {
    first.disconnect();
    second.disconnect();
    await runtime.shutdown();
  });

  for (let count = 1; count <= 3; count += 1) {
    await matchPair(first, second, firstGuest.guest.name, secondGuest.guest.name);
    const partnerLeft = eventFrom(second, 'partner-left');
    first.emit('leave-chat');
    await partnerLeft;
  }

  first.disconnect();
  first = await connectGuest(baseUrl, firstGuest.cookie);
  await matchPair(first, second, firstGuest.guest.name, secondGuest.guest.name);
  const cooldown = eventFrom(first, 'skip-cooldown');
  first.emit('leave-chat');
  const cooldownPayload = await cooldown;
  assert.deepEqual(Object.keys(cooldownPayload), ['retryAfterSeconds']);
  assert.equal(cooldownPayload.retryAfterSeconds, 1);

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const partnerLeft = eventFrom(second, 'partner-left');
  first.emit('leave-chat');
  first.emit('leave-chat');
  await partnerLeft;

  const internalId = (await db.query(
    'SELECT id FROM guest_principals WHERE public_id = $1',
    [firstGuest.guest.publicId]
  )).rows[0].id;
  const row = (await db.query(
    `SELECT request_count FROM moderation_rate_windows
     WHERE principal_type = 'guest' AND principal_id = $1 AND action = 'skip'`,
    [internalId]
  )).rows[0];
  assert.equal(Number(row.request_count), 4);
});

test('Socket.IO blocks normalized duplicates, link flood and repeated-character bypasses generically', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'socket-abuse-integration-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstGuest = await createGuest(baseUrl, 'Message First', 'astra');
  const secondGuest = await createGuest(baseUrl, 'Message Second', 'nova');
  const first = await connectGuest(baseUrl, firstGuest.cookie);
  const second = await connectGuest(baseUrl, secondGuest.cookie);
  t.after(async () => {
    first.disconnect();
    second.disconnect();
    await runtime.shutdown();
  });
  const [match] = await matchPair(first, second, firstGuest.guest.name, secondGuest.guest.name);

  await sendAccepted(first, second, '  ＨＥＬＬＯ   WORLD  ');
  await sendAccepted(first, second, 'hello world');
  await sendAccepted(first, second, 'hello\u200b world');
  await sendAccepted(first, second, ' HELLO WORLD ');
  const duplicateError = eventFrom(first, 'message-error');
  first.emit('send-message', 'hello\u200b  world');
  const duplicatePayload = await duplicateError;

  for (let index = 1; index <= 4; index += 1) {
    await sendAccepted(first, second, `https://example.test/path-${index}`);
  }
  const linkError = eventFrom(first, 'message-error');
  first.emit('send-message', 'https://example.test/path-5');
  const linkPayload = await linkError;

  await sendAccepted(first, second, 'aaaaaaaaaaaa one');
  await sendAccepted(first, second, 'bbbbbbbbbbbb two');
  const repeatedError = eventFrom(first, 'message-error');
  first.emit('send-message', 'cccccccccccc three');
  const repeatedPayload = await repeatedError;

  for (const payload of [duplicatePayload, linkPayload, repeatedPayload]) {
    assert.deepEqual(Object.keys(payload).sort(), ['message', 'retryAfterSeconds']);
    assert.equal(payload.message, duplicatePayload.message);
    assert.ok(payload.retryAfterSeconds > 0);
  }

  const stored = await db.query('SELECT COUNT(*)::integer AS count FROM messages WHERE conversation_id = $1', [match.conversationId]);
  assert.equal(stored.rows[0].count, 10);
  const signals = await db.query("SELECT principal_id FROM moderation_rate_windows WHERE principal_type = 'signal'");
  assert.ok(signals.rowCount > 0);
  assert.equal(signals.rows.every((row) => /^[0-9a-f]{64}$/.test(row.principal_id)), true);
});

test('Socket.IO message burst enforcement rejects flood at the server boundary', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'socket-abuse-integration-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstGuest = await createGuest(baseUrl, 'Flood First', 'astra');
  const secondGuest = await createGuest(baseUrl, 'Flood Second', 'nova');
  const first = await connectGuest(baseUrl, firstGuest.cookie);
  const second = await connectGuest(baseUrl, secondGuest.cookie);
  t.after(async () => {
    first.disconnect();
    second.disconnect();
    await runtime.shutdown();
  });
  const [match] = await matchPair(first, second, firstGuest.guest.name, secondGuest.guest.name);

  for (let index = 1; index <= 12; index += 1) {
    await sendAccepted(first, second, `unique flood message ${index}`);
  }
  const floodError = eventFrom(first, 'message-error');
  first.emit('send-message', 'unique flood message 13');
  const payload = await floodError;
  assert.deepEqual(Object.keys(payload).sort(), ['message', 'retryAfterSeconds']);
  assert.ok(payload.retryAfterSeconds > 0);

  const stored = await db.query('SELECT COUNT(*)::integer AS count FROM messages WHERE conversation_id = $1', [match.conversationId]);
  assert.equal(stored.rows[0].count, 12);
});

test('Socket.IO serializes concurrent rematch transitions without duplicate queue entries', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'socket-abuse-integration-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const guests = await Promise.all([
    createGuest(baseUrl, 'Concurrent First', 'astra'),
    createGuest(baseUrl, 'Concurrent Second', 'nova'),
    createGuest(baseUrl, 'Concurrent Third', 'lyra'),
    createGuest(baseUrl, 'Concurrent Fourth', 'vega')
  ]);
  const sockets = await Promise.all(guests.map((guest) => connectGuest(baseUrl, guest.cookie)));
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await runtime.shutdown();
  });

  await matchPair(sockets[0], sockets[1], guests[0].guest.name, guests[1].guest.name);
  const partnerLeft = eventFrom(sockets[1], 'partner-left');
  const waitingTwice = eventsFrom(sockets[0], 'waiting', 2);
  sockets[0].emit('find-partner', matchPayload(guests[0].guest.name));
  sockets[0].emit('find-partner', matchPayload(guests[0].guest.name));
  await Promise.all([partnerLeft, waitingTwice]);

  const rematched = Promise.all([eventFrom(sockets[0], 'matched'), eventFrom(sockets[2], 'matched')]);
  sockets[2].emit('find-partner', matchPayload(guests[2].guest.name));
  await rematched;
  const fourthWaiting = eventFrom(sockets[3], 'waiting');
  sockets[3].emit('find-partner', matchPayload(guests[3].guest.name));
  await fourthWaiting;

  const active = await db.query("SELECT COUNT(*)::integer AS count FROM conversations WHERE status = 'active'");
  assert.equal(active.rows[0].count, 1);
});

test('Socket.IO keeps general search queued, relaxes topic search and replaces same-principal tabs', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    strictPhaseDelayMs: () => 80,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'socket-matching-integration-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const generalGuest = await createGuest(baseUrl, 'General Queue Guest', 'astra');
  const reconnectProbeGuest = await createGuest(baseUrl, 'Reconnect Probe Guest', 'orion');
  const topicGuest = await createGuest(baseUrl, 'Topic Queue Guest', 'nova');
  const otherGuest = await createGuest(baseUrl, 'Other Topic Guest', 'lyra');
  const general = await connectGuest(baseUrl, generalGuest.cookie);
  const firstTopicTab = await connectGuest(baseUrl, topicGuest.cookie);
  const secondTopicTab = await connectGuest(baseUrl, topicGuest.cookie);
  const otherTopic = await connectGuest(baseUrl, otherGuest.cookie);
  const sockets = [general, firstTopicTab, secondTopicTab, otherTopic];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await runtime.shutdown();
  });

  let timedOut = false;
  general.once('waiting-timeout', () => { timedOut = true; });
  const generalWaiting = eventFrom(general, 'waiting');
  const generalState = eventFrom(general, 'search-state');
  general.emit('find-partner', {
    interests: [],
    profile: { username: generalGuest.guest.name },
    waitingTimeSeconds: 5
  });
  await generalWaiting;
  assert.deepEqual(await generalState, { phase: 'general' });
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(timedOut, false);

  general.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const reconnectedGeneral = await connectGuest(baseUrl, generalGuest.cookie);
  sockets.push(reconnectedGeneral);
  const reconnectedWaiting = eventFrom(reconnectedGeneral, 'waiting');
  reconnectedGeneral.emit('find-partner', {
    interests: [],
    profile: { username: generalGuest.guest.name },
    waitingTimeSeconds: 5
  });
  await reconnectedWaiting;
  const generalCancelled = eventFrom(reconnectedGeneral, 'search-cancelled');
  assert.deepEqual(await emitWithAck(reconnectedGeneral, 'cancel-search'), { ok: true, cancelled: true });
  await generalCancelled;

  const reconnectProbe = await connectGuest(baseUrl, reconnectProbeGuest.cookie);
  sockets.push(reconnectProbe);
  const probeWaiting = eventFrom(reconnectProbe, 'waiting');
  reconnectProbe.emit('find-partner', {
    interests: [],
    profile: { username: reconnectProbeGuest.guest.name },
    waitingTimeSeconds: 5
  });
  await probeWaiting;
  assert.deepEqual(await emitWithAck(reconnectProbe, 'cancel-search'), { ok: true, cancelled: true });

  const firstWaiting = eventFrom(firstTopicTab, 'waiting');
  const firstStrictState = eventFrom(firstTopicTab, 'search-state');
  firstTopicTab.emit('find-partner', {
    interests: ['astronomy'],
    profile: { username: topicGuest.guest.name },
    waitingTimeSeconds: 5
  });
  await firstWaiting;
  assert.deepEqual(await firstStrictState, { phase: 'topic-preference' });
  const replaced = eventFrom(firstTopicTab, 'search-cancelled');
  const secondWaiting = eventFrom(secondTopicTab, 'waiting');
  const secondStrictState = eventFrom(secondTopicTab, 'search-state');
  secondTopicTab.emit('find-partner', {
    interests: ['astronomy'],
    profile: { username: topicGuest.guest.name },
    waitingTimeSeconds: 5
  });
  await Promise.all([replaced, secondWaiting]);
  assert.deepEqual(await secondStrictState, { phase: 'topic-preference' });

  const otherWaiting = eventFrom(otherTopic, 'waiting');
  const otherStrictState = eventFrom(otherTopic, 'search-state');
  const relaxedMatches = Promise.all([
    eventFrom(secondTopicTab, 'matched'),
    eventFrom(otherTopic, 'matched')
  ]);
  otherTopic.emit('find-partner', {
    interests: ['literature'],
    profile: { username: otherGuest.guest.name },
    waitingTimeSeconds: 5
  });
  await otherWaiting;
  assert.deepEqual(await otherStrictState, { phase: 'topic-preference' });
  const generalizedStates = Promise.all([
    eventFrom(secondTopicTab, 'search-state'),
    eventFrom(otherTopic, 'search-state')
  ]);
  assert.deepEqual(await generalizedStates, [{ phase: 'general' }, { phase: 'general' }]);
  const [topicMatch] = await relaxedMatches;
  assert.deepEqual(topicMatch.sharedInterests, []);

  const active = await db.query("SELECT COUNT(*)::integer AS count FROM conversations WHERE status = 'active'");
  assert.equal(active.rows[0].count, 1);
});

test('Socket.IO acknowledgements correlate out-of-order message results', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const completionOrder = [];
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    messageAbuseProtector: {
      async consume({ text }) {
        if (text.startsWith('slow')) await new Promise((resolve) => setTimeout(resolve, 150));
        return { allowed: true, retryAfterSeconds: 0 };
      }
    },
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'socket-abuse-integration-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstGuest = await createGuest(baseUrl, 'Ack First', 'astra');
  const secondGuest = await createGuest(baseUrl, 'Ack Second', 'nova');
  const first = await connectGuest(baseUrl, firstGuest.cookie);
  const second = await connectGuest(baseUrl, secondGuest.cookie);
  t.after(async () => {
    first.disconnect();
    second.disconnect();
    await runtime.shutdown();
  });
  await matchPair(first, second, firstGuest.guest.name, secondGuest.guest.name);
  const received = eventsFrom(second, 'receive-message', 2);
  const send = (text) => new Promise((resolve) => {
    first.emit('send-message', text, (response) => {
      completionOrder.push(text);
      resolve(response);
    });
  });
  const slow = send('slow correlated message');
  const fast = send('fast correlated message');
  const [slowResponse, fastResponse, delivered] = await Promise.all([slow, fast, received]);

  assert.deepEqual(completionOrder, ['fast correlated message', 'slow correlated message']);
  assert.equal(slowResponse.ok, true);
  assert.equal(fastResponse.ok, true);
  const deliveredByText = new Map(delivered.map((message) => [message.text, Number(message.id)]));
  assert.equal(Number(slowResponse.id), deliveredByText.get('slow correlated message'));
  assert.equal(Number(fastResponse.id), deliveredByText.get('fast correlated message'));
});
