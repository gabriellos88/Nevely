const BOOTSTRAP_LOCK = 'nevely:first-admin-bootstrap';
const DEPLOYED_ENVIRONMENTS = new Set(['staging', 'production']);

class AdminBootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdminBootstrapError';
    this.code = code;
  }
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new AdminBootstrapError(
      'ADMIN_BOOTSTRAP_CONFIG',
      `${name} is required for the first administrator bootstrap`
    );
  }
  return value;
}

function ensure(condition, code, message) {
  if (!condition) throw new AdminBootstrapError(code, message);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateBootstrapEnvironment(environment) {
  const appEnvironment = required(environment, 'APP_ENV').toLowerCase();
  ensure(
    DEPLOYED_ENVIRONMENTS.has(appEnvironment),
    'ADMIN_BOOTSTRAP_ENV',
    'The first administrator bootstrap is restricted to staging or production'
  );
  ensure(
    required(environment, 'NODE_ENV') === 'production',
    'ADMIN_BOOTSTRAP_ENV',
    'A deployed bootstrap requires NODE_ENV=production'
  );
  ensure(
    required(environment, 'RAILWAY_ENVIRONMENT_NAME').toLowerCase() === appEnvironment,
    'ADMIN_BOOTSTRAP_ENV',
    'RAILWAY_ENVIRONMENT_NAME must exactly match APP_ENV'
  );

  const railwayEnvironmentId = required(environment, 'RAILWAY_ENVIRONMENT_ID');
  const productionEnvironmentId = required(environment, 'PRODUCTION_RAILWAY_ENVIRONMENT_ID');
  if (appEnvironment === 'production') {
    ensure(
      railwayEnvironmentId === productionEnvironmentId,
      'ADMIN_BOOTSTRAP_ENV',
      'Production bootstrap requires the production Railway environment ID'
    );
  } else {
    ensure(
      railwayEnvironmentId !== productionEnvironmentId,
      'ADMIN_BOOTSTRAP_ENV',
      'Staging bootstrap must not target the production Railway environment'
    );
  }

  ensure(
    required(environment, 'ADMIN_BOOTSTRAP_ENABLED') === 'true',
    'ADMIN_BOOTSTRAP_DISABLED',
    'ADMIN_BOOTSTRAP_ENABLED must be explicitly set to true'
  );
  ensure(
    required(environment, 'ADMIN_BOOTSTRAP_CONFIRM')
      === `bootstrap-first-admin:${appEnvironment}`,
    'ADMIN_BOOTSTRAP_CONFIRM',
    'The bootstrap confirmation does not match the target environment'
  );
  required(environment, 'DATABASE_URL');

  const email = normalizeEmail(required(environment, 'ADMIN_BOOTSTRAP_EMAIL'));
  ensure(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    'ADMIN_BOOTSTRAP_TARGET',
    'ADMIN_BOOTSTRAP_EMAIL must be a valid email address'
  );

  return { appEnvironment, email };
}

async function bootstrapFirstAdministrator({ db, environment }) {
  ensure(
    db?.isConfigured,
    'ADMIN_BOOTSTRAP_DATABASE',
    'The administrator bootstrap requires a configured database'
  );
  const { appEnvironment, email } = validateBootstrapEnvironment(environment);
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [BOOTSTRAP_LOCK]
    );

    const administrators = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE role = 'admin' AND deleted_at IS NULL`
    );
    ensure(
      administrators.rows[0].count === 0,
      'ADMIN_BOOTSTRAP_EXISTS',
      'An active administrator already exists'
    );

    const target = await client.query(
      `SELECT u.id, u.role, u.password_hash, u.email_verified_at,
              u.profile_completed_at, u.deleted_at,
              EXISTS(
                SELECT 1
                FROM account_identities ai
                WHERE ai.user_id = u.id AND ai.provider = 'google'
              ) AS has_google
       FROM users u
       WHERE u.email = $1
       FOR UPDATE`,
      [email]
    );
    ensure(
      target.rowCount === 1,
      'ADMIN_BOOTSTRAP_TARGET',
      'The bootstrap target must be one existing account'
    );

    const account = target.rows[0];
    ensure(
      !account.deleted_at && account.role === 'user',
      'ADMIN_BOOTSTRAP_TARGET',
      'The bootstrap target must be an active user account'
    );
    ensure(
      Boolean(account.email_verified_at),
      'ADMIN_BOOTSTRAP_UNVERIFIED',
      'The bootstrap target must have a verified email'
    );
    ensure(
      Boolean(account.profile_completed_at),
      'ADMIN_BOOTSTRAP_PROFILE',
      'The bootstrap target must have a complete profile'
    );
    ensure(
      Boolean(account.password_hash || account.has_google),
      'ADMIN_BOOTSTRAP_SIGNIN',
      'The bootstrap target must have a working sign-in method'
    );

    const activeBan = await client.query(
      `SELECT 1
       FROM bans
       WHERE user_id = $1
         AND starts_at <= NOW()
         AND (type = 'permanent' OR ends_at IS NULL OR ends_at > NOW())
       LIMIT 1`,
      [account.id]
    );
    ensure(
      activeBan.rowCount === 0,
      'ADMIN_BOOTSTRAP_BANNED',
      'The bootstrap target must not have an active ban'
    );

    const promoted = await client.query(
      `UPDATE users
       SET role = 'admin',
           session_version = session_version + 1,
           updated_at = NOW()
       WHERE id = $1 AND role = 'user' AND deleted_at IS NULL`,
      [account.id]
    );
    ensure(
      promoted.rowCount === 1,
      'ADMIN_BOOTSTRAP_RACE',
      'The bootstrap target changed before promotion completed'
    );

    await client.query(
      `INSERT INTO security_events
         (actor_user_id, subject_user_id, event_type, metadata)
       VALUES
         (NULL, $1, 'first_admin_bootstrapped',
          jsonb_build_object(
            'environment', $2::text,
            'method', 'versioned_command'
          ))`,
      [account.id, appEnvironment]
    );
    await client.query('COMMIT');
    return { status: 'promoted' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  AdminBootstrapError,
  bootstrapFirstAdministrator,
  validateBootstrapEnvironment
};
