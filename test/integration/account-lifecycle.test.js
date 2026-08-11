const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { deleteAccountLifecycle, purgeDueAccountsBatch } = require('../../lib/account-lifecycle');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function createUser(db, suffix, role = 'user') {
  return (await db.query(
    `INSERT INTO users
       (username, email, password_hash, public_id, display_name, role, birth_date,
        age, gender, country, country_code, profile_image_url, email_verified_at)
     VALUES ($1, $2, 'synthetic-password-hash', $3, $4, $5, DATE '1990-06-15',
             36, 'non-binary', 'Switzerland', 'ch', '/img/profile.webp', NOW())
     RETURNING id, public_id, username, email`,
    [suffix, `${suffix}@example.test`, `nvy_${crypto.createHash('sha256').update(suffix).digest('hex').slice(0, 12)}`,
      `Display ${suffix}`, role]
  )).rows[0];
}

async function purgeBatch(db, options) {
  const client = await db.getClient();
  try {
    return await purgeDueAccountsBatch(client, options);
  } finally {
    client.release();
  }
}

test('registered account deletion retains identity for 30 days then purges PII into an idempotent tombstone', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async () => {
  const db = require('../../db');
  await resetDatabase(db);
  const admin = await createUser(db, 'lifecycle_admin', 'admin');
  const target = await createUser(db, 'lifecycle_target');
  await db.query(
    `INSERT INTO account_identities (user_id, provider, provider_subject, provider_email)
     VALUES ($1, 'google', 'lifecycle-google-subject', $2)`,
    [target.id, target.email]
  );
  await db.query(
    `INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, 'verify_email', repeat('a', 64), NOW() + INTERVAL '1 day')`,
    [target.id]
  );
  const report = (await db.query(
    `INSERT INTO reports (reporter_user_id, reported_user_id, reason)
     VALUES ($1, $2, 'lifecycle-reference') RETURNING id`,
    [admin.id, target.id]
  )).rows[0];
  const conversation = (await db.query(
    `INSERT INTO conversations (status) VALUES ('ended') RETURNING id`
  )).rows[0];
  const message = (await db.query(
    `INSERT INTO messages (conversation_id, sender_user_id, sender_display_name, body)
     VALUES ($1, $2, 'Display lifecycle_target', 'synthetic message body') RETURNING id`,
    [conversation.id, target.id]
  )).rows[0];

  const deleted = await deleteAccountLifecycle({
    db,
    targetUserId: Number(target.id),
    actorUserId: Number(admin.id),
    adminAction: true,
    reason: 'Documented lifecycle deletion'
  });
  assert.equal(deleted.idempotent, false);
  assert.equal(
    new Date(deleted.retention_until).getTime() - new Date(deleted.deleted_at).getTime(),
    30 * 24 * 60 * 60 * 1000
  );
  let retained = (await db.query(
    `SELECT id, public_id, username, email, display_name, deleted_at, retention_until,
            pii_purged_at, session_version
     FROM users WHERE id = $1`,
    [target.id]
  )).rows[0];
  assert.equal(Number(retained.id), Number(target.id));
  assert.equal(retained.public_id, target.public_id);
  assert.equal(retained.username, target.username);
  assert.equal(retained.email, target.email);
  assert.equal(retained.pii_purged_at, null);
  assert.equal(await purgeBatch(db, { batchSize: 10 }), 0);
  await assert.rejects(
    db.query(
      `INSERT INTO users (username, email, password_hash, public_id, display_name)
       VALUES ($1, 'other-lifecycle@example.test', 'hash', 'nvy_abcdefabcdef', 'Conflict')`,
      [target.username]
    ),
    (error) => error.code === '23505'
  );
  await assert.rejects(
    db.query(
      `INSERT INTO users (username, email, password_hash, public_id, display_name)
       VALUES ('other_lifecycle', $1, 'hash', 'nvy_abcdefabcdea', 'Conflict')`,
      [target.email]
    ),
    (error) => error.code === '23505'
  );

  const constraintClient = await db.getClient();
  try {
    await constraintClient.query('BEGIN');
    await assert.rejects(
      constraintClient.query(
        `UPDATE users SET retention_until = deleted_at + INTERVAL '29 days' WHERE id = $1`,
        [target.id]
      ),
      (error) => error.code === '23514'
    );
    await constraintClient.query('ROLLBACK');
  } finally {
    constraintClient.release();
  }
  retained = (await db.query('SELECT retention_until FROM users WHERE id = $1', [target.id])).rows[0];
  assert.equal(new Date(retained.retention_until).getTime(), new Date(deleted.retention_until).getTime());

  const permanentlyBanned = await createUser(db, 'lifecycle_banned');
  await deleteAccountLifecycle({ db, targetUserId: Number(permanentlyBanned.id) });
  await db.query(
    `INSERT INTO account_bans (user_id, type, reason, created_by)
     VALUES ($1, 'permanent', 'Permanent tombstone preservation', $2)`,
    [permanentlyBanned.id, admin.id]
  );
  await db.query(
    `UPDATE users
     SET deleted_at = NOW() - INTERVAL '31 days',
         retention_until = NOW() - INTERVAL '1 day'
     WHERE id = ANY($1::bigint[])`,
    [[target.id, permanentlyBanned.id]]
  );

  assert.equal(await purgeBatch(db, { batchSize: 10 }), 1);
  const purged = (await db.query(
    `SELECT id, public_id, legacy_public_id, username, email, display_name, password_hash,
            profile_image_url, birth_date, age, gender, country, country_code,
            pii_purged_at, retention_until
     FROM users WHERE id = $1`,
    [target.id]
  )).rows[0];
  assert.equal(Number(purged.id), Number(target.id));
  assert.match(purged.public_id, /^nvy_[0-9a-f]{12}$/);
  assert.notEqual(purged.public_id, target.public_id);
  assert.equal(purged.legacy_public_id, null);
  assert.match(purged.username, /^removed_\d+$/);
  assert.match(purged.email, /^removed_\d+@deleted\.nevely\.invalid$/);
  assert.equal(purged.display_name, 'Removed account');
  for (const value of [purged.password_hash, purged.profile_image_url, purged.birth_date,
    purged.age, purged.gender, purged.country, purged.country_code]) assert.equal(value, null);
  assert.notEqual(purged.pii_purged_at, null);
  assert.equal((await db.query('SELECT 1 FROM users WHERE public_id = $1', [target.public_id])).rowCount, 0);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) AS count FROM account_identities WHERE user_id = $1', [target.id]
  )).rows[0].count), 0);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) AS count FROM account_tokens WHERE user_id = $1', [target.id]
  )).rows[0].count), 0);
  assert.equal(Number((await db.query('SELECT reported_user_id FROM reports WHERE id = $1', [report.id])).rows[0].reported_user_id), Number(target.id));
  assert.equal(Number((await db.query('SELECT sender_user_id FROM messages WHERE id = $1', [message.id])).rows[0].sender_user_id), Number(target.id));
  assert.equal(Number((await db.query(
    `SELECT COUNT(*) AS count FROM audit_log
     WHERE target_user_id = $1 AND action IN ('account_deleted', 'account_pii_purged')`,
    [target.id]
  )).rows[0].count), 2);

  const rotatedPublicId = purged.public_id;
  assert.equal(await purgeBatch(db, { batchSize: 10 }), 0);
  assert.equal((await db.query('SELECT public_id FROM users WHERE id = $1', [target.id])).rows[0].public_id, rotatedPublicId);
  assert.equal((await db.query('SELECT pii_purged_at FROM users WHERE id = $1', [permanentlyBanned.id])).rows[0].pii_purged_at, null);
});

test('self deletion revokes the HTTP session and force-disconnects the active Socket.IO connection immediately', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'account-deletion-socket-session-secret' },
    log: { info() {}, warn() {}, error() {} }
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => runtime.shutdown());
  const agent = request.agent(baseUrl);
  const registration = await agent.post('/register').set('Accept', 'application/json').send({
    username: 'deletion_socket', email: 'deletion-socket@example.test',
    password: 'SyntheticPassword123!', birthDate: '1990-06-15',
    gender: 'non-binary', countryCode: 'ch'
  }).expect(201);
  await db.query('UPDATE users SET email_verified_at = NOW() WHERE public_id = $1', [registration.body.user.publicId]);
  const login = await agent.post('/login').set('Accept', 'application/json').send({
    email: 'deletion-socket@example.test', password: 'SyntheticPassword123!'
  }).expect(200);
  const cookie = (login.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
  const socket = createClient(baseUrl, {
    autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Cookie: cookie }
  });
  t.after(() => socket.disconnect());
  const connected = new Promise((resolve) => socket.once('connect', resolve));
  socket.connect();
  await connected;
  const revoked = new Promise((resolve) => socket.once('auth-required', resolve));
  await agent.delete('/api/account').send({ confirmation: 'DELETE' }).expect(204);
  assert.deepEqual(await revoked, {});
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(socket.connected, false);
  assert.equal((await agent.get('/api/auth/me').expect(200)).body.user, null);
  const stored = (await db.query(
    `SELECT deleted_at, retention_until, pii_purged_at FROM users WHERE public_id = $1`,
    [registration.body.user.publicId]
  )).rows[0];
  assert.equal(stored.pii_purged_at, null);
  assert.equal(
    new Date(stored.retention_until).getTime() - new Date(stored.deleted_at).getTime(),
    30 * 24 * 60 * 60 * 1000
  );
});
