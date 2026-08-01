const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { COOKIE_NAME, safeReturnTo } = require('../../lib/private-preview');
const { createRuntime } = require('../../server');

const PREVIEW_PASSWORD = 'temporary-preview-password';
const PREVIEW_HASH = bcrypt.hashSync(PREVIEW_PASSWORD, 10);
const PUBLIC_ORIGIN = 'http://localhost:3000';

const quietLog = {
  info() {},
  warn() {},
  error() {}
};

function mockDb() {
  return {
    isConfigured: true,
    pool: null,
    query: async () => ({ rowCount: 1, rows: [{ ready: 1 }] }),
    getClient: async () => {
      throw new Error('Unexpected client request');
    },
    close: async () => {}
  };
}

function previewEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN,
    SESSION_SECRET: 'private-preview-unit-test-secret',
    ROBOTS_INDEXING: 'enabled',
    PRIVATE_PREVIEW_ENABLED: 'true',
    PRIVATE_PREVIEW_PASSWORD_HASH: PREVIEW_HASH,
    SHUTDOWN_GRACE_MS: '1000',
    ...overrides
  };
}

function csrfToken(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'Preview page must include a CSRF token');
  return match[1];
}

test('preview redirects remain on the current origin', () => {
  assert.equal(safeReturnTo('/chat?guest=1'), '/chat?guest=1');
  assert.equal(safeReturnTo('/preview-access?returnTo=%2Fchat'), '/');
  assert.equal(safeReturnTo('//example.test/path'), '/');
  assert.equal(safeReturnTo('/\\example.test/path'), '/');
  assert.equal(safeReturnTo('https://example.test/path'), '/');
});

test('private preview gates pages, APIs and sockets while leaving operational routes public', async (t) => {
  const runtime = createRuntime({
    db: mockDb(),
    env: previewEnvironment(),
    log: quietLog
  });
  t.after(() => runtime.shutdown());

  const page = await request(runtime.app)
    .get('/about?from=manual-test')
    .expect(401);
  assert.match(page.text, /Something thoughtful is taking shape/);
  assert.match(page.text, /name="returnTo" value="\/about\?from=manual-test"/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.text.includes(PREVIEW_PASSWORD), false);
  assert.equal(page.text.includes(PREVIEW_HASH), false);

  const api = await request(runtime.app).get('/api/database-health').expect(401);
  assert.deepEqual(api.body, {
    error: 'Private preview access is required.',
    code: 'PRIVATE_PREVIEW_REQUIRED'
  });

  await request(runtime.app).get('/health/live').expect(200);
  await request(runtime.app).get('/health/ready').expect(200);
  assert.equal(
    (await request(runtime.app).get('/robots.txt').expect(200)).text,
    'User-agent: *\nAllow: /\n'
  );
  await request(runtime.app).get('/css/style.css').expect(200);

  const socketError = await new Promise((resolve) => {
    runtime.privatePreview.requireSocketAccess(
      { handshake: { headers: {} } },
      resolve
    );
  });
  assert.equal(socketError.data.code, 'PRIVATE_PREVIEW_REQUIRED');
});

test('preview password grants a browser-session cookie and preserves the requested URL', async (t) => {
  const runtime = createRuntime({
    db: mockDb(),
    env: previewEnvironment(),
    log: quietLog
  });
  t.after(() => runtime.shutdown());

  const browser = request.agent(runtime.app);
  const initial = await browser.get('/preview-access?returnTo=%2Fchat%3Fguest%3D1').expect(401);
  const token = csrfToken(initial.text);

  const rejected = await browser
    .post('/preview-access')
    .set('Origin', PUBLIC_ORIGIN)
    .type('form')
    .send({
      _csrf: token,
      password: 'wrong-password',
      returnTo: '/chat?guest=1'
    })
    .expect(401);
  assert.match(rejected.text, /That password isn’t right/);

  const accepted = await browser
    .post('/preview-access')
    .set('Origin', PUBLIC_ORIGIN)
    .type('form')
    .send({
      _csrf: csrfToken(rejected.text),
      password: PREVIEW_PASSWORD,
      returnTo: '/chat?guest=1'
    })
    .expect(303);
  assert.equal(accepted.headers.location, '/chat?guest=1');

  const previewCookie = accepted.headers['set-cookie']
    .find((value) => value.startsWith(`${COOKIE_NAME}=`));
  assert.ok(previewCookie, 'Successful unlock must set the preview cookie');
  assert.match(previewCookie, /HttpOnly/);
  assert.match(previewCookie, /SameSite=Lax/);
  assert.doesNotMatch(previewCookie, /Max-Age|Expires/);

  await browser.get('/').expect(200);
  const socketResult = await new Promise((resolve) => {
    runtime.privatePreview.requireSocketAccess(
      { handshake: { headers: { cookie: previewCookie.split(';')[0] } } },
      resolve
    );
  });
  assert.equal(socketResult, undefined);
});

test('private preview is off by default and fails closed when enabled without a valid hash', async (t) => {
  const runtime = createRuntime({
    db: mockDb(),
    env: previewEnvironment({
      PRIVATE_PREVIEW_ENABLED: 'false',
      PRIVATE_PREVIEW_PASSWORD_HASH: ''
    }),
    log: quietLog
  });
  t.after(() => runtime.shutdown());
  assert.equal(runtime.privatePreview.enabled, false);
  await request(runtime.app).get('/').expect(200);

  assert.throws(() => createRuntime({
    db: mockDb(),
    env: previewEnvironment({ PRIVATE_PREVIEW_PASSWORD_HASH: '' }),
    log: quietLog
  }), /PRIVATE_PREVIEW_PASSWORD_HASH/);
  assert.throws(() => createRuntime({
    db: mockDb(),
    env: previewEnvironment({ PRIVATE_PREVIEW_ENABLED: 'yes' }),
    log: quietLog
  }), /PRIVATE_PREVIEW_ENABLED/);
});

test('production validation requires an explicit preview mode and a bcrypt hash when enabled', () => {
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'validate-environment.mjs');
  const environment = {
    ...process.env,
    APP_ENV: 'production',
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://nevely.app',
    DATABASE_URL: 'postgres://production:production@database.internal:5432/nevely',
    SESSION_SECRET: 'production-session-secret-32-characters-minimum',
    ADMIN_TOTP_ENCRYPTION_KEY: 'production-totp-secret-32-characters-minimum',
    GOOGLE_CLIENT_ID: 'production-client-id.apps.googleusercontent.com',
    SUPPORT_EMAIL: 'support@nevely.app',
    CAPACITY_ALERT_EMAIL: 'admin@nevely.app',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_ENVIRONMENT_ID: 'railway-production-id',
    EMAIL_DELIVERY_MODE: 'live',
    RESEND_API_KEY: 're_synthetic_test_value',
    RESEND_FROM: 'Verify <noreply@notifications.nevely.app>',
    ROBOTS_INDEXING: 'enabled',
    PRIVATE_PREVIEW_ENABLED: 'true',
    PRIVATE_PREVIEW_PASSWORD_HASH: PREVIEW_HASH
  };

  const accepted = spawnSync(process.execPath, [script, 'production'], {
    env: environment,
    encoding: 'utf8'
  });
  assert.equal(accepted.status, 0);

  const rejected = spawnSync(process.execPath, [script, 'production'], {
    env: {
      ...environment,
      PRIVATE_PREVIEW_PASSWORD_HASH: 'not-a-bcrypt-hash'
    },
    encoding: 'utf8'
  });
  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout.includes(PREVIEW_HASH), false);
  assert.equal(rejected.stderr.includes(PREVIEW_HASH), false);

  const disabled = spawnSync(process.execPath, [script, 'production'], {
    env: {
      ...environment,
      PRIVATE_PREVIEW_ENABLED: 'false',
      PRIVATE_PREVIEW_PASSWORD_HASH: ''
    },
    encoding: 'utf8'
  });
  assert.equal(disabled.status, 0);
});
