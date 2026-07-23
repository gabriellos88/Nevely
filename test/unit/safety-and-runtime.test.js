const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const request = require('supertest');
const safeLog = require('../../lib/safe-log');
const { createRuntime } = require('../../server');

const quietLog = {
  info() {},
  warn() {},
  error() {}
};

function mockDb(overrides = {}) {
  return {
    isConfigured: true,
    pool: null,
    query: async () => ({ rowCount: 1, rows: [{ ready: 1 }] }),
    getClient: async () => {
      throw new Error('Unexpected client request');
    },
    close: async () => {},
    ...overrides
  };
}

test('safe logger removes messages, stack traces and sensitive values', () => {
  const original = console.error;
  const output = [];
  console.error = (value) => output.push(value);

  try {
    const error = new Error(
      'password=secret token=raw-token email=person@example.test '
      + 'guestId=00000000-0000-4000-8000-000000000000 message=private'
    );
    error.code = '23505';
    safeLog.error('test.sanitized_error', error);
  } finally {
    console.error = original;
  }

  assert.equal(output.length, 1);
  const record = JSON.parse(output[0]);
  assert.deepEqual(Object.keys(record).sort(), [
    'errorCode',
    'errorType',
    'event',
    'level',
    'timestamp'
  ]);
  assert.equal(record.event, 'test.sanitized_error');
  assert.equal(record.errorCode, '23505');
  for (const forbidden of ['secret', 'raw-token', 'person@example.test', '00000000-', 'private', 'stack']) {
    assert.equal(output[0].includes(forbidden), false);
  }
});

test('liveness, readiness and no-index responses expose only fixed status data', async (t) => {
  const runtime = createRuntime({
    db: mockDb(),
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'unit-test-session-secret',
      ROBOTS_INDEXING: 'disabled',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: quietLog
  });
  t.after(() => runtime.shutdown());

  const live = await request(runtime.app).get('/health/live').expect(200);
  assert.deepEqual(live.body, { status: 'live' });

  const ready = await request(runtime.app).get('/health/ready').expect(200);
  assert.deepEqual(ready.body, { status: 'ready' });
  assert.equal(ready.headers['x-robots-tag'], 'noindex, nofollow');

  runtime.lifecycle.phase = 'draining';
  const drainingLive = await request(runtime.app).get('/health/live').expect(200);
  const drainingReady = await request(runtime.app).get('/health/ready').expect(503);
  assert.deepEqual(drainingLive.body, { status: 'live' });
  assert.deepEqual(drainingReady.body, { status: 'not-ready' });
});

test('readiness fails closed when PostgreSQL is absent or fails', async (t) => {
  const absentRuntime = createRuntime({
    db: mockDb({ isConfigured: false }),
    env: { NODE_ENV: 'test', SESSION_SECRET: 'unit-test-session-secret' },
    log: quietLog
  });
  const failedRuntime = createRuntime({
    db: mockDb({ query: async () => {
      const error = new Error('contains connection context that must not reach the response');
      error.code = 'ECONNREFUSED';
      throw error;
    } }),
    env: { NODE_ENV: 'test', SESSION_SECRET: 'unit-test-session-secret' },
    log: quietLog
  });
  t.after(async () => {
    await absentRuntime.shutdown();
    await failedRuntime.shutdown();
  });

  assert.deepEqual(
    (await request(absentRuntime.app).get('/health/ready').expect(503)).body,
    { status: 'not-ready' }
  );
  assert.deepEqual(
    (await request(failedRuntime.app).get('/health/ready').expect(503)).body,
    { status: 'not-ready' }
  );
});

test('staging validator accepts isolated safe configuration and rejects production reuse', () => {
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'validate-environment.mjs');
  const baseEnvironment = {
    ...process.env,
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://staging.example.test',
    DATABASE_URL: 'postgres://staging:staging@127.0.0.1:5432/nevely_staging',
    SESSION_SECRET: 'staging-contract-secret-32-characters-minimum',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    RAILWAY_ENVIRONMENT_ID: 'railway-staging-id',
    PRODUCTION_RAILWAY_ENVIRONMENT_ID: 'railway-production-id',
    EMAIL_DELIVERY_MODE: 'test',
    RESEND_API_KEY: 're_synthetic_test_value',
    RESEND_FROM: 'Nevely Staging <noreply@notifications.nevely.app>',
    RESEND_TEST_RECIPIENT: 'delivered+staging@resend.dev',
    ANALYTICS_MODE: 'disabled',
    ROBOTS_INDEXING: 'disabled'
  };

  const accepted = spawnSync(process.execPath, [script, 'staging'], {
    env: baseEnvironment,
    encoding: 'utf8'
  });
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /No configuration values were printed/);

  const rejected = spawnSync(process.execPath, [script, 'staging'], {
    env: {
      ...baseEnvironment,
      PRODUCTION_RAILWAY_ENVIRONMENT_ID: baseEnvironment.RAILWAY_ENVIRONMENT_ID
    },
    encoding: 'utf8'
  });
  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout.includes(baseEnvironment.RAILWAY_ENVIRONMENT_ID), false);
  assert.equal(rejected.stderr.includes(baseEnvironment.DATABASE_URL), false);
});
