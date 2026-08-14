const assert = require('node:assert/strict');
const { test } = require('node:test');
const { io: createClient } = require('socket.io-client');
const { createRuntime } = require('../../server');

const quietLog = {
  info() {},
  warn() {},
  error() {}
};

function disabledDb() {
  return {
    isConfigured: false,
    pool: null,
    query: async () => {
      throw new Error('Database disabled in guest socket test');
    },
    close: async () => {}
  };
}

function eventFrom(socket, eventName, timeoutMs = 3_000) {
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

async function connectSocket(baseUrl, options = {}) {
  const socket = createClient(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    ...options
  });
  const connected = eventFrom(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

function guest(name, interests = []) {
  return {
    interests,
    profile: {
      username: name,
      age: 28,
      gender: 'any',
      country: 'Switzerland'
    },
    waitingTimeSeconds: null
  };
}

function emitWithAck(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName} acknowledgement`)), 3_000);
    const acknowledge = (response) => {
      clearTimeout(timeout);
      resolve(response);
    };
    if (payload === undefined) socket.emit(eventName, acknowledge);
    else socket.emit(eventName, payload, acknowledge);
  });
}

test('two guest clients match, exchange a message, and end the pair once on skip', async (t) => {
  const runtime = createRuntime({
    db: disabledDb(),
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'socket-test-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const first = await connectSocket(baseUrl);
  const second = await connectSocket(baseUrl);

  t.after(async () => {
    first.disconnect();
    second.disconnect();
    await runtime.shutdown();
  });

  const waiting = eventFrom(first, 'waiting');
  const searchState = eventFrom(first, 'search-state');
  first.emit('find-partner', guest('First Guest', ['astronomy']));
  assert.deepEqual(await waiting, { status: 'searching' });
  assert.deepEqual(await searchState, { phase: 'topic-preference' });

  const firstMatched = eventFrom(first, 'matched');
  const secondMatched = eventFrom(second, 'matched');
  second.emit('find-partner', guest('Second Guest', ['astronomy']));
  const [firstMatch, secondMatch] = await Promise.all([firstMatched, secondMatched]);
  assert.deepEqual(firstMatch.sharedInterests, ['astronomy']);
  assert.deepEqual(secondMatch.sharedInterests, ['astronomy']);
  assert.equal(firstMatch.isGuest, true);
  assert.equal(firstMatch.canAddFriend, false);
  assert.equal(Object.hasOwn(firstMatch, 'durationSeconds'), false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(runtime.chat.getActiveConversationCount(), 1);

  const received = eventFrom(second, 'receive-message');
  first.emit('send-message', 'synthetic socket test message');
  assert.equal((await received).text, 'synthetic socket test message');

  const reportSubmitted = eventFrom(first, 'report-submitted');
  first.emit('report', { reason: 'spam', details: 'Synthetic test context' });
  assert.deepEqual(await reportSubmitted, { stored: false });

  const partnerLeftAfterSkip = eventFrom(second, 'partner-left');
  const leaveResult = await emitWithAck(first, 'leave-chat');
  assert.deepEqual(leaveResult, { ok: true, ended: true });
  assert.equal((await partnerLeftAfterSkip).conversationId, null);

  second.disconnect();
});

test('general search remains queued beyond the slider and cancel removes it server-side', async (t) => {
  const runtime = createRuntime({
    db: disabledDb(),
    strictPhaseDelayMs: () => 40,
    env: { NODE_ENV: 'test', SESSION_SECRET: 'socket-test-session-secret', SHUTDOWN_GRACE_MS: '1000' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const socket = await connectSocket(`http://127.0.0.1:${address.port}`);
  t.after(async () => {
    socket.disconnect();
    await runtime.shutdown();
  });

  let timedOut = false;
  socket.once('waiting-timeout', () => { timedOut = true; });
  const waiting = eventFrom(socket, 'waiting');
  const searchState = eventFrom(socket, 'search-state');
  socket.emit('find-partner', { ...guest('General Guest'), waitingTimeSeconds: 5 });
  assert.deepEqual(await waiting, { status: 'searching' });
  assert.deepEqual(await searchState, { phase: 'general' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(timedOut, false);

  const cancelled = eventFrom(socket, 'search-cancelled');
  assert.deepEqual(await emitWithAck(socket, 'cancel-search'), { ok: true, cancelled: true });
  await cancelled;
  assert.deepEqual(await emitWithAck(socket, 'cancel-search'), { ok: true, cancelled: false });
});

test('topic matching is strict first and relaxes in place without leaving the queue', async (t) => {
  const runtime = createRuntime({
    db: disabledDb(),
    strictPhaseDelayMs: () => 60,
    env: { NODE_ENV: 'test', SESSION_SECRET: 'socket-test-session-secret', SHUTDOWN_GRACE_MS: '1000' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const strictFirst = await connectSocket(baseUrl);
  const strictSecond = await connectSocket(baseUrl);
  const relaxedFirst = await connectSocket(baseUrl);
  const relaxedSecond = await connectSocket(baseUrl);
  const sockets = [strictFirst, strictSecond, relaxedFirst, relaxedSecond];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await runtime.shutdown();
  });

  const strictWaiting = eventFrom(strictFirst, 'waiting');
  const strictState = eventFrom(strictFirst, 'search-state');
  strictFirst.emit('find-partner', { ...guest('Strict First', ['astronomy']), waitingTimeSeconds: 5 });
  await strictWaiting;
  assert.deepEqual(await strictState, { phase: 'topic-preference' });
  const strictMatches = Promise.all([eventFrom(strictFirst, 'matched'), eventFrom(strictSecond, 'matched')]);
  strictSecond.emit('find-partner', { ...guest('Strict Second', ['astronomy']), waitingTimeSeconds: 5 });
  const [strictMatch] = await strictMatches;
  assert.deepEqual(strictMatch.sharedInterests, ['astronomy']);

  const relaxedWaiting = eventFrom(relaxedFirst, 'waiting');
  const relaxedFirstStrict = eventFrom(relaxedFirst, 'search-state');
  relaxedFirst.emit('find-partner', { ...guest('Relaxed First', ['astronomy']), waitingTimeSeconds: 5 });
  await relaxedWaiting;
  assert.deepEqual(await relaxedFirstStrict, { phase: 'topic-preference' });
  const relaxedFirstGeneral = eventFrom(relaxedFirst, 'search-state');
  const secondWaiting = eventFrom(relaxedSecond, 'waiting');
  const relaxedSecondStrict = eventFrom(relaxedSecond, 'search-state');
  const relaxedMatches = Promise.all([
    eventFrom(relaxedFirst, 'matched'),
    eventFrom(relaxedSecond, 'matched')
  ]);
  relaxedSecond.emit('find-partner', { ...guest('Relaxed Second', ['literature']), waitingTimeSeconds: 5 });
  await secondWaiting;
  assert.deepEqual(await relaxedSecondStrict, { phase: 'topic-preference' });
  const relaxedSecondGeneral = eventFrom(relaxedSecond, 'search-state');
  assert.deepEqual(await relaxedFirstGeneral, { phase: 'general' });
  assert.deepEqual(await relaxedSecondGeneral, { phase: 'general' });
  const [relaxedMatch] = await relaxedMatches;
  assert.deepEqual(relaxedMatch.sharedInterests, []);
});

test('draining sends only a generic notice and rejects new matching work', async (t) => {
  const runtime = createRuntime({
    db: disabledDb(),
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'socket-test-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const socket = await connectSocket(`http://127.0.0.1:${address.port}`);

  t.after(async () => {
    socket.disconnect();
    await runtime.shutdown();
  });

  const firstNotice = eventFrom(socket, 'release-draining');
  runtime.chat.beginDrain({ retryAfterSeconds: 7 });
  const firstPayload = await firstNotice;
  assert.deepEqual(firstPayload, { retryAfterSeconds: 7 });
  assert.deepEqual(Object.keys(firstPayload), ['retryAfterSeconds']);

  const rejectedNotice = eventFrom(socket, 'release-draining');
  socket.emit('find-partner', guest('Queued Guest'));
  assert.deepEqual(await rejectedNotice, { retryAfterSeconds: 7 });
  assert.equal(runtime.chat.getActiveConversationCount(), 0);
});

test('shutdown waits for active conversation persistence before closing resources', async (t) => {
  let releaseEndUpdate;
  let markEndUpdateStarted;
  const endUpdateStarted = new Promise((resolve) => {
    markEndUpdateStarted = resolve;
  });
  const endUpdateGate = new Promise((resolve) => {
    releaseEndUpdate = resolve;
  });
  let databaseClosed = false;

  const db = {
    isConfigured: true,
    pool: null,
    async getClient() {
      return {
        async query(sql) {
          if (sql.includes('INSERT INTO conversations')) {
            return { rowCount: 1, rows: [{ id: 1 }] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {}
      };
    },
    async query(sql) {
      if (sql.includes('FROM account_bans') || sql.includes('FROM network_bans')) return { rowCount: 0, rows: [] };
      if (sql.includes('UPDATE conversations SET status')) {
        markEndUpdateStarted();
        await endUpdateGate;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('UPDATE conversation_participants')) return { rowCount: 2, rows: [] };
      if (sql.includes('DELETE FROM conversations')) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT 1 AS ready')) return { rowCount: 1, rows: [{ ready: 1 }] };
      throw new Error('Unexpected database query in shutdown test');
    },
    async close() {
      databaseClosed = true;
    }
  };

  const runtime = createRuntime({
    db,
    enforcePersistentGuestOwnership: false,
    rateLimiter: { consume: async () => ({ allowed: true, count: 0, retryAfterSeconds: 0, escalationLevel: 0 }) },
    rateLimitPrincipalResolver: () => ({ principalType: 'guest', principalId: 'f5e6d52b-1bb5-4a5f-a636-13b56e92df68' }),
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'socket-test-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const first = await connectSocket(baseUrl);
  const second = await connectSocket(baseUrl);
  t.after(async () => {
    first.disconnect();
    second.disconnect();
    if (runtime.lifecycle.phase !== 'stopped') await runtime.shutdown();
  });

  const waiting = eventFrom(first, 'waiting');
  first.emit('find-partner', guest('First Account'));
  await waiting;
  const matched = Promise.all([eventFrom(first, 'matched'), eventFrom(second, 'matched')]);
  second.emit('find-partner', guest('Second Account'));
  await matched;

  let shutdownSettled = false;
  const shutdown = runtime.shutdown().then(() => {
    shutdownSettled = true;
  });
  await endUpdateStarted;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);
  assert.equal(databaseClosed, false);

  releaseEndUpdate();
  await shutdown;
  assert.equal(databaseClosed, true);
  assert.equal(runtime.lifecycle.phase, 'stopped');
});
