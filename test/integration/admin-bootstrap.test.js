const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { test } = require('node:test');
const db = require('../../db');
const {
  bootstrapFirstAdministrator
} = require('../../lib/admin-bootstrap');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

function bootstrapEnvironment(email) {
  return {
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    DATABASE_URL: process.env.DATABASE_URL,
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    RAILWAY_ENVIRONMENT_ID: 'integration-staging',
    PRODUCTION_RAILWAY_ENVIRONMENT_ID: 'integration-production',
    ADMIN_BOOTSTRAP_ENABLED: 'true',
    ADMIN_BOOTSTRAP_CONFIRM: 'bootstrap-first-admin:staging',
    ADMIN_BOOTSTRAP_EMAIL: email
  };
}

test('first administrator bootstrap is transactional, audited and single-use', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async () => {
  await resetDatabase(db);
  const email = 'bootstrap-admin@example.test';
  const passwordHash = await bcrypt.hash('synthetic-bootstrap-password', 4);
  const created = await db.query(
    `INSERT INTO users
       (username, email, password_hash, public_id, display_alias, display_name,
        birth_date, gender, country, country_code, profile_completed_at,
        email_verified_at)
     VALUES
       ('bootstrap_admin', $1, $2, 'nvy_cccccccccccccccccccc',
        'Nevely#cccccc', 'Bootstrap Admin', '1990-01-01',
        'prefer-not-to-say', 'Switzerland', 'ch', NOW(), NOW())
     RETURNING id, session_version`,
    [email, passwordHash]
  );

  const result = await bootstrapFirstAdministrator({
    db,
    environment: bootstrapEnvironment(email)
  });
  assert.deepEqual(result, { status: 'promoted' });

  const promoted = await db.query(
    `SELECT role, session_version, admin_2fa_enabled_at
     FROM users WHERE id = $1`,
    [created.rows[0].id]
  );
  assert.equal(promoted.rows[0].role, 'admin');
  assert.equal(
    promoted.rows[0].session_version,
    created.rows[0].session_version + 1
  );
  assert.equal(promoted.rows[0].admin_2fa_enabled_at, null);

  const audit = await db.query(
    `SELECT actor_user_id, subject_user_id, event_type, metadata
     FROM security_events
     WHERE subject_user_id = $1`,
    [created.rows[0].id]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].actor_user_id, null);
  assert.equal(audit.rows[0].event_type, 'first_admin_bootstrapped');
  assert.deepEqual(audit.rows[0].metadata, {
    environment: 'staging',
    method: 'versioned_command'
  });

  await assert.rejects(
    bootstrapFirstAdministrator({
      db,
      environment: bootstrapEnvironment(email)
    }),
    (error) => error.code === 'ADMIN_BOOTSTRAP_EXISTS'
  );

  const auditsAfterRetry = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM security_events
     WHERE event_type = 'first_admin_bootstrapped'`
  );
  assert.equal(auditsAfterRetry.rows[0].count, 1);
});
