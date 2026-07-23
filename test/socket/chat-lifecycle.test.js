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

test('two guest clients match, exchange a message, respect cooldown and observe disconnect', async (t) => {
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
  first.emit('find-partner', guest('First Guest', ['astronomy']));
  assert.deepEqual(await waiting, { waitingTimeSeconds: null });

  const firstMatched = eventFrom(first, 'matched');
  const secondMatched = eventFrom(second, 'matched');
  second.emit('find-partner', guest('Second Guest', ['astronomy']));
  const [firstMatch, secondMatch] = await Promise.all([firstMatched, secondMatched]);
  assert.deepEqual(firstMatch.sharedInterests, ['astronomy']);
  assert.deepEqual(secondMatch.sharedInterests, ['astronomy']);
  assert.equal(firstMatch.isGuest, true);

  const received = eventFrom(second, 'receive-message');
  first.emit('send-message', 'synthetic socket test message');
  assert.equal((await received).text, 'synthetic socket test message');

  const cooldown = eventFrom(first, 'skip-cooldown');
  first.emit('leave-chat');
  const cooldownPayload = await cooldown;
  assert.ok(cooldownPayload.remainingMs > 0);
  assert.ok(cooldownPayload.remainingMs <= 10_000);

  const partnerLeft = eventFrom(first, 'partner-left');
  second.disconnect();
  assert.equal((await partnerLeft).conversationId, null);
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

test('shutdown waits for active conversation persistence before closing resources', async () => {
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
      if (sql.includes('SELECT 1 FROM bans')) return { rowCount: 0, rows: [] };
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
  first.disconnect();
  second.disconnect();
});
