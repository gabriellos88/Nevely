const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const safeLog = require('../../lib/safe-log');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error(event, error) {
    safeLog.error(event, error);
  }
};

function payload() {
  return {
    username: 'pending_member',
    email: 'pending-member@example.test',
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch'
  };
}

function tokenFromBody(body) {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  assert.ok(match, 'verification email contains a token');
  return match[1];
}

test('pending registrations rotate one-hour links, clean up atomically and release identifiers', {
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
      PUBLIC_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'pending-registration-integration-secret',
      EMAIL_DELIVERY_MODE: 'disabled'
    },
    log: quietLog
  });
  t.after(async () => {
    await runtime.shutdown();
    await db.close();
  });

  const pending = request.agent(runtime.app);
  await pending
    .post('/register')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.60')
    .send(payload())
    .expect(201);

  const stored = (await db.query(
    `SELECT id, registration_pending_at
     FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [payload().email]
  )).rows[0];
  assert.ok(stored.registration_pending_at);
  const initialToken = (await db.query(
    `SELECT token.id, token.token_hash, token.expires_at, token.created_at, outbox.text_body
     FROM account_tokens token
     JOIN email_outbox outbox ON outbox.account_token_id = token.id
     WHERE token.user_id = $1 AND token.purpose = 'verify_email'`,
    [stored.id]
  )).rows[0];
  const lifetimeSeconds = (
    new Date(initialToken.expires_at).getTime() - new Date(initialToken.created_at).getTime()
  ) / 1000;
  assert.ok(lifetimeSeconds >= 3599 && lifetimeSeconds <= 3601);

  const duplicate = await request(runtime.app)
    .post('/register')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.61')
    .send(payload())
    .expect(409);
  assert.match(duplicate.body.error, /waiting for email verification/i);
  assert.doesNotMatch(duplicate.body.error, /already taken/i);

  const loginDuringValidity = request.agent(runtime.app);
  const pendingRedirect = await loginDuringValidity
    .post('/login')
    .set('X-Forwarded-For', '198.51.100.62')
    .send({ email: payload().email, password: payload().password })
    .expect(302);
  assert.equal(pendingRedirect.headers.location, '/verify-email/pending');

  await pending
    .post('/verify-email/resend')
    .set('X-Forwarded-For', '198.51.100.63')
    .send({})
    .expect(200);
  const rotatedTokens = await db.query(
    `SELECT token.id, token.revoked_at, token.expires_at, token.created_at, outbox.text_body
     FROM account_tokens token
     JOIN email_outbox outbox ON outbox.account_token_id = token.id
     WHERE token.user_id = $1 AND token.purpose = 'verify_email'
     ORDER BY token.created_at DESC, token.id DESC`,
    [stored.id]
  );
  assert.equal(rotatedTokens.rowCount, 2);
  const previous = rotatedTokens.rows.find((row) => row.id === initialToken.id);
  const current = rotatedTokens.rows.find((row) => row.id !== initialToken.id);
  assert.ok(previous.revoked_at);
  assert.equal(current.revoked_at, null);
  await request(runtime.app)
    .post('/verify-email')
    .set('Accept', 'application/json')
    .send({ token: tokenFromBody(initialToken.text_body) })
    .expect(400);

  await db.query(
    `UPDATE account_tokens
     SET expires_at = NOW() - INTERVAL '1 second'
     WHERE user_id = $1 AND purpose = 'verify_email' AND revoked_at IS NULL`,
    [stored.id]
  );
  const retention = await runtime.retentionWorker.runOnce();
  assert.equal(retention.deletedCounts.unverifiedRegistrations, 1);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) AS count FROM users WHERE id = $1',
    [stored.id]
  )).rows[0].count), 0);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) AS count FROM account_tokens WHERE user_id = $1',
    [stored.id]
  )).rows[0].count), 0);
  assert.equal((await loginDuringValidity.get('/api/auth/me').expect(200)).body.user, null);

  await request(runtime.app)
    .post('/register')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.64')
    .send(payload())
    .expect(201);
  const replacementId = Number((await db.query(
    'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
    [payload().email]
  )).rows[0].id);
  await db.query(
    `UPDATE account_tokens
     SET expires_at = NOW() - INTERVAL '1 second'
     WHERE user_id = $1 AND purpose = 'verify_email' AND revoked_at IS NULL`,
    [replacementId]
  );
  await request(runtime.app)
    .post('/register')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.65')
    .send(payload())
    .expect(201);
  const immediatelyReused = await db.query(
    'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
    [payload().email]
  );
  assert.equal(immediatelyReused.rowCount, 1);
  assert.notEqual(Number(immediatelyReused.rows[0].id), replacementId);
});
