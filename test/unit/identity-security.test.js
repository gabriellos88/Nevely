const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const request = require('supertest');
const {
  ageFromBirthDate,
  makePublicId,
  normalizeRegisteredProfile
} = require('../../lib/auth');
const { createGoogleVerifier } = require('../../lib/google-auth');
const { totp, verifyTotp } = require('../../lib/totp');
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
      throw new Error('Database disabled');
    },
    close: async () => {}
  };
}

test('public account IDs contain 48 random bits, lowercase hex, and never expose a sequence', () => {
  const values = new Set(Array.from({ length: 100 }, () => makePublicId()));
  assert.equal(values.size, 100);
  for (const value of values) assert.match(value, /^nvy_[a-f0-9]{12}$/);
});

test('registered profiles use canonical birth, gender and country values', () => {
  assert.equal(ageFromBirthDate('2008-07-27', new Date('2026-07-27T12:00:00Z')), 18);
  assert.equal(ageFromBirthDate('2008-07-28', new Date('2026-07-27T12:00:00Z')), 17);
  const normalized = normalizeRegisteredProfile({
    birthDate: '1990-06-15',
    gender: 'NON-BINARY',
    countryCode: 'CH'
  });
  assert.equal(normalized.birthDate, '1990-06-15');
  assert.equal(normalized.gender, 'non-binary');
  assert.equal(normalized.countryCode, 'ch');
  assert.equal(normalized.country, 'Switzerland');
  assert.ok(normalized.age >= 18);
  assert.ok(normalizeRegisteredProfile({
    birthDate: '2010-01-01',
    gender: 'non-binary',
    countryCode: 'ch'
  }).error);
});

test('TOTP verification accepts the current window and rejects an incorrect code', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const timestamp = Date.UTC(2026, 6, 27, 12, 0, 0);
  const code = totp(secret, timestamp);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, timestamp), true);
  assert.equal(verifyTotp(secret, code === '000000' ? '000001' : '000000', timestamp), false);
});

test('Google verifier checks signature, issuer, audience, expiry, nonce and verified email', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'synthetic-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const now = Date.UTC(2026, 6, 27, 12, 0, 0);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: 'synthetic-client-id',
    sub: 'google-subject-123',
    email: 'member@example.test',
    email_verified: true,
    nonce: 'expected-nonce',
    iat: Math.floor(now / 1000) - 1,
    exp: Math.floor(now / 1000) + 300
  })).toString('base64url');
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey
  ).toString('base64url');
  const credential = `${header}.${payload}.${signature}`;
  const verify = createGoogleVerifier({
    clientId: 'synthetic-client-id',
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'max-age=300' },
      json: async () => ({ keys: [jwk] })
    })
  });
  const identity = await verify(credential, { nonce: 'expected-nonce' });
  assert.equal(identity.subject, 'google-subject-123');
  assert.equal(identity.email, 'member@example.test');
  await assert.rejects(
    verify(credential, { nonce: 'wrong-nonce' }),
    /validation failed/
  );
});

test('browser-origin state changes require the synchronizer token and responses set a CSP', async (t) => {
  const runtime = createRuntime({
    db: disabledDb(),
    env: {
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'https://nevely.example.test',
      SESSION_SECRET: 'csrf-unit-test-secret-32-characters'
    },
    log: quietLog
  });
  t.after(() => runtime.shutdown());
  const agent = request.agent(runtime.app);
  const page = await agent.get('/login').expect(200);
  const csrfToken = page.headers['x-csrf-token'];
  assert.equal(typeof csrfToken, 'string');
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.match(page.headers['content-security-policy'], /script-src[^;]*'nonce-/);
  assert.doesNotMatch(
    page.headers['content-security-policy'],
    /script-src[^;]*'unsafe-inline'/
  );
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  const registrationPage = await agent.get('/register').expect(200);
  assert.match(registrationPage.text, /name="birthDate"/);
  assert.match(registrationPage.text, /name="countryCode"/);
  assert.match(registrationPage.text, /name="_csrf"/);
  await agent.get('/forgot-password').expect(200);

  await agent
    .post('/login')
    .set('Origin', 'https://attacker.example')
    .send({ email: 'member@example.test', password: 'password' })
    .expect(403);

  await agent
    .post('/login')
    .set('Origin', 'https://nevely.example.test')
    .set('X-CSRF-Token', csrfToken)
    .send({ email: 'member@example.test', password: 'password' })
    .expect(503);
});

test('production refuses memory sessions and missing security secrets', () => {
  assert.throws(() => createRuntime({
    db: disabledDb(),
    env: {
      NODE_ENV: 'production',
      SESSION_SECRET: 'production-session-secret-32-characters',
      ADMIN_TOTP_ENCRYPTION_KEY: 'production-totp-secret-32-characters'
    },
    log: quietLog
  }), /DATABASE_URL/);

  assert.throws(() => createRuntime({
    db: {
      ...disabledDb(),
      isConfigured: true,
      pool: {}
    },
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://synthetic',
      SESSION_SECRET: 'production-session-secret-32-characters'
    },
    log: quietLog
  }), /ADMIN_TOTP_ENCRYPTION_KEY/);

  assert.throws(() => createRuntime({
    db: disabledDb(),
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'unit-test-session-secret',
      MODERATION_MESSAGE_HMAC_KEY: 'too-short'
    },
    log: quietLog
  }), /MODERATION_MESSAGE_HMAC_KEY/);
});
