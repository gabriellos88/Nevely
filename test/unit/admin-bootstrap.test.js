const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  AdminBootstrapError,
  bootstrapFirstAdministrator,
  validateBootstrapEnvironment
} = require('../../lib/admin-bootstrap');

function environment(overrides = {}) {
  return {
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://synthetic',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    RAILWAY_ENVIRONMENT_ID: 'railway-staging',
    PRODUCTION_RAILWAY_ENVIRONMENT_ID: 'railway-production',
    ADMIN_BOOTSTRAP_ENABLED: 'true',
    ADMIN_BOOTSTRAP_CONFIRM: 'bootstrap-first-admin:staging',
    ADMIN_BOOTSTRAP_EMAIL: 'first-admin@example.test',
    ...overrides
  };
}

function successfulClient(overrides = {}) {
  const queries = [];
  const client = {
    async query(text, parameters = []) {
      queries.push({ text, parameters });
      if (text.includes('COUNT(*)::int AS count')) {
        return { rowCount: 1, rows: [{ count: 0 }] };
      }
      if (text.includes('FROM users u')) {
        return {
          rowCount: 1,
          rows: [{
            id: 42,
            role: 'user',
            password_hash: null,
            email_verified_at: new Date(),
            profile_completed_at: new Date(),
            deleted_at: null,
            has_google: true
          }]
        };
      }
      if (text.includes('FROM bans')) return { rowCount: 0, rows: [] };
      if (text.includes('UPDATE users')) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
    ...overrides
  };
  return { client, queries };
}

test('bootstrap environment requires an explicit, environment-bound latch', () => {
  assert.deepEqual(validateBootstrapEnvironment(environment()), {
    appEnvironment: 'staging',
    email: 'first-admin@example.test'
  });

  for (const invalid of [
    { ADMIN_BOOTSTRAP_ENABLED: 'false' },
    { ADMIN_BOOTSTRAP_CONFIRM: 'bootstrap-first-admin:production' },
    { RAILWAY_ENVIRONMENT_ID: 'railway-production' },
    { RAILWAY_ENVIRONMENT_NAME: 'production' },
    { APP_ENV: 'local', RAILWAY_ENVIRONMENT_NAME: 'local' }
  ]) {
    assert.throws(
      () => validateBootstrapEnvironment(environment(invalid)),
      AdminBootstrapError
    );
  }
});

test('production bootstrap must match the recorded production Railway environment', () => {
  const accepted = environment({
    APP_ENV: 'production',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_ENVIRONMENT_ID: 'railway-production',
    ADMIN_BOOTSTRAP_CONFIRM: 'bootstrap-first-admin:production'
  });
  assert.equal(validateBootstrapEnvironment(accepted).appEnvironment, 'production');

  assert.throws(
    () => validateBootstrapEnvironment({
      ...accepted,
      RAILWAY_ENVIRONMENT_ID: 'railway-staging'
    }),
    AdminBootstrapError
  );
});

test('bootstrap promotes one eligible account, revokes sessions and records an audit event', async () => {
  const { client, queries } = successfulClient();
  const result = await bootstrapFirstAdministrator({
    db: {
      isConfigured: true,
      async getClient() {
        return client;
      }
    },
    environment: environment()
  });

  assert.deepEqual(result, { status: 'promoted' });
  assert.ok(queries.some(({ text }) => text.includes('pg_advisory_xact_lock')));
  assert.ok(queries.some(({ text }) => (
    text.includes("SET role = 'admin'")
    && text.includes('session_version = session_version + 1')
  )));
  assert.ok(queries.some(({ text, parameters }) => (
    text.includes("'first_admin_bootstrapped'")
    && parameters[0] === 42
    && parameters[1] === 'staging'
  )));
  assert.equal(queries.at(-1).text, 'COMMIT');
});

test('bootstrap refuses to act when an administrator already exists', async () => {
  const { client, queries } = successfulClient({
    async query(text, parameters = []) {
      queries.push({ text, parameters });
      if (text.includes('COUNT(*)::int AS count')) {
        return { rowCount: 1, rows: [{ count: 1 }] };
      }
      return { rowCount: 1, rows: [] };
    }
  });

  await assert.rejects(
    bootstrapFirstAdministrator({
      db: {
        isConfigured: true,
        async getClient() {
          return client;
        }
      },
      environment: environment()
    }),
    (error) => error.code === 'ADMIN_BOOTSTRAP_EXISTS'
  );
  assert.equal(queries.at(-1).text, 'ROLLBACK');
  assert.equal(queries.some(({ text }) => text.includes('UPDATE users')), false);
});

test('bootstrap refuses unverified, incomplete, banned or sign-in-less targets', async () => {
  const cases = [
    ['ADMIN_BOOTSTRAP_UNVERIFIED', { email_verified_at: null }],
    ['ADMIN_BOOTSTRAP_PROFILE', { profile_completed_at: null }],
    ['ADMIN_BOOTSTRAP_SIGNIN', { password_hash: null, has_google: false }]
  ];

  for (const [code, targetOverride] of cases) {
    const { client } = successfulClient({
      async query(text) {
        if (text.includes('COUNT(*)::int AS count')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        if (text.includes('FROM users u')) {
          return {
            rowCount: 1,
            rows: [{
              id: 42,
              role: 'user',
              password_hash: 'synthetic-hash',
              email_verified_at: new Date(),
              profile_completed_at: new Date(),
              deleted_at: null,
              has_google: false,
              ...targetOverride
            }]
          };
        }
        return { rowCount: 1, rows: [] };
      }
    });
    await assert.rejects(
      bootstrapFirstAdministrator({
        db: { isConfigured: true, getClient: async () => client },
        environment: environment()
      }),
      (error) => error.code === code
    );
  }

  const { client } = successfulClient({
    async query(text) {
      if (text.includes('COUNT(*)::int AS count')) {
        return { rowCount: 1, rows: [{ count: 0 }] };
      }
      if (text.includes('FROM users u')) {
        return {
          rowCount: 1,
          rows: [{
            id: 42,
            role: 'user',
            password_hash: 'synthetic-hash',
            email_verified_at: new Date(),
            profile_completed_at: new Date(),
            deleted_at: null,
            has_google: false
          }]
        };
      }
      if (text.includes('FROM bans')) return { rowCount: 1, rows: [{ present: 1 }] };
      return { rowCount: 1, rows: [] };
    }
  });
  await assert.rejects(
    bootstrapFirstAdministrator({
      db: { isConfigured: true, getClient: async () => client },
      environment: environment()
    }),
    (error) => error.code === 'ADMIN_BOOTSTRAP_BANNED'
  );
});
