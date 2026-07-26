import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';

const EVENT_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 60_000;
let stage = 'configuration';

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required for the staging drain smoke test`);
  return value;
}

function eventFrom(socket, eventName, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`Timed out during ${stage}`));
    }, timeoutMs);
    const handleEvent = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(eventName, handleEvent);
  });
}

async function connectSocket(baseUrl) {
  const socket = createClient(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket']
  });
  const connected = eventFrom(socket, 'connect', 15_000);
  socket.connect();
  await connected;
  return socket;
}

function syntheticGuest(name) {
  return {
    interests: [],
    profile: {
      username: name,
      age: 28,
      gender: 'any',
      country: 'Switzerland'
    },
    waitingTimeSeconds: null
  };
}

function assertDrainNotice(payload) {
  assert.deepEqual(Object.keys(payload || {}), ['retryAfterSeconds']);
  assert.ok(Number.isInteger(payload.retryAfterSeconds));
  assert.ok(payload.retryAfterSeconds >= 0);
  assert.ok(payload.retryAfterSeconds <= 300);
}

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health/ready', baseUrl), {
        signal: AbortSignal.timeout(5_000)
      });
      if (response.status === 200) {
        assert.deepEqual(await response.json(), { status: 'ready' });
        return;
      }
    } catch {
      // A short routing gap is acceptable while Railway switches replicas.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Timed out during post-deploy readiness');
}

async function main() {
  const baseUrl = new URL(required('STAGING_BASE_URL'));
  assert.equal(baseUrl.protocol, 'https:');
  assert.notEqual(baseUrl.hostname, 'nevely.app');
  assert.notEqual(baseUrl.hostname, 'www.nevely.app');

  const sockets = [];
  try {
    stage = 'socket connection';
    const first = await connectSocket(baseUrl.href);
    const second = await connectSocket(baseUrl.href);
    sockets.push(first, second);

    stage = 'synthetic matching';
    const waiting = eventFrom(first, 'waiting', 10_000);
    first.emit('find-partner', syntheticGuest('Staging Drain A'));
    await waiting;

    const matched = Promise.all([
      eventFrom(first, 'matched', 10_000),
      eventFrom(second, 'matched', 10_000)
    ]);
    second.emit('find-partner', syntheticGuest('Staging Drain B'));
    await matched;

    stage = 'message persistence';
    const received = eventFrom(second, 'receive-message', 10_000);
    const persisted = eventFrom(first, 'message-sent', 10_000);
    first.emit('send-message', 'synthetic staging drain verification');
    const [receivedPayload, persistedPayload] = await Promise.all([received, persisted]);
    const persistedId = Number(persistedPayload?.id);
    assert.ok(Number.isSafeInteger(persistedId));
    assert.ok(persistedId > 0);
    assert.equal(String(receivedPayload?.id), String(persistedPayload.id));

    console.log('Staging drain smoke is ready. Trigger one Railway redeploy.');

    stage = 'drain notification';
    const notices = await Promise.all([
      eventFrom(first, 'release-draining'),
      eventFrom(second, 'release-draining')
    ]);
    notices.forEach(assertDrainNotice);

    const shutdownEvents = Promise.all([
      eventFrom(first, 'server-shutdown', SHUTDOWN_TIMEOUT_MS),
      eventFrom(second, 'server-shutdown', SHUTDOWN_TIMEOUT_MS)
    ]);
    const disconnectEvents = Promise.all([
      eventFrom(first, 'disconnect', SHUTDOWN_TIMEOUT_MS),
      eventFrom(second, 'disconnect', SHUTDOWN_TIMEOUT_MS)
    ]);

    stage = 'new-match rejection';
    const rejected = eventFrom(first, 'release-draining', 10_000);
    first.emit('find-partner', syntheticGuest('Staging Drain Rejected'));
    assertDrainNotice(await rejected);

    stage = 'clean socket shutdown';
    await shutdownEvents;
    await disconnectEvents;

    stage = 'post-deploy readiness';
    await waitForReady(baseUrl);

    console.log(
      'Staging drain smoke passed: persisted work, drain notices, match rejection, clean socket shutdown and new-release readiness were confirmed.'
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

try {
  await main();
} catch (error) {
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  console.error(JSON.stringify({
    event: 'staging.drain_smoke_failed',
    stage,
    errorType
  }));
  process.exitCode = 1;
}
