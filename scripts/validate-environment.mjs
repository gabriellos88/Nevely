import assert from 'node:assert/strict';

const requestedProfile = process.argv[2] || process.env.APP_ENV || 'local';
const supportedProfiles = new Set(['local', 'test', 'staging', 'production']);
const deployedProfiles = new Set(['staging', 'production']);

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required for ${requestedProfile}`);
  return value;
}

function parseUrl(name, protocols) {
  const rawValue = required(name);
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    assert.fail(`${name} must be a valid URL`);
  }
  assert.ok(protocols.includes(parsed.protocol), `${name} must use ${protocols.join(' or ')}`);
  return parsed;
}

function optionalBoundedInteger(name, minimum, maximum) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return;
  assert.match(rawValue, /^\d+$/, `${name} must be an integer`);
  const value = Number(rawValue);
  assert.ok(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${name} must be between ${minimum} and ${maximum}`
  );
}

assert.ok(supportedProfiles.has(requestedProfile), `Unsupported environment profile: ${requestedProfile}`);
ensure(required('APP_ENV') === requestedProfile, 'APP_ENV must match the requested profile');

if (deployedProfiles.has(requestedProfile)) {
  ensure(
    required('NODE_ENV') === 'production',
    'Deployed environments must run with NODE_ENV=production'
  );

  const publicOrigin = parseUrl('PUBLIC_ORIGIN', ['https:']);
  ensure(publicOrigin.pathname === '/', 'PUBLIC_ORIGIN must not contain a path');
  ensure(publicOrigin.search === '', 'PUBLIC_ORIGIN must not contain a query');
  ensure(publicOrigin.hash === '', 'PUBLIC_ORIGIN must not contain a fragment');

  parseUrl('DATABASE_URL', ['postgres:', 'postgresql:']);

  const sessionSecret = required('SESSION_SECRET');
  assert.ok(sessionSecret.length >= 32, 'SESSION_SECRET must contain at least 32 characters');
  assert.ok(!sessionSecret.toLowerCase().includes('replace'), 'SESSION_SECRET still contains a placeholder');
  const totpEncryptionKey = required('ADMIN_TOTP_ENCRYPTION_KEY');
  assert.ok(
    totpEncryptionKey.length >= 32,
    'ADMIN_TOTP_ENCRYPTION_KEY must contain at least 32 characters'
  );
  assert.notEqual(
    totpEncryptionKey,
    sessionSecret,
    'ADMIN_TOTP_ENCRYPTION_KEY must be distinct from SESSION_SECRET'
  );
  assert.match(
    required('GOOGLE_CLIENT_ID'),
    /\.apps\.googleusercontent\.com$/,
    'GOOGLE_CLIENT_ID must be a Google OAuth web client ID'
  );
  assert.equal(
    required('SUPPORT_EMAIL').toLowerCase(),
    'support@nevely.app',
    'SUPPORT_EMAIL must use the verified support address'
  );

  const railwayName = required('RAILWAY_ENVIRONMENT_NAME').toLowerCase();
  assert.ok(
    railwayName.includes(requestedProfile),
    `RAILWAY_ENVIRONMENT_NAME must identify ${requestedProfile}`
  );
  required('RAILWAY_ENVIRONMENT_ID');

  optionalBoundedInteger('RETENTION_INTERVAL_MS', 60_000, 7 * 24 * 60 * 60 * 1000);
  optionalBoundedInteger('RETENTION_BATCH_SIZE', 10, 5_000);
  optionalBoundedInteger('RETENTION_MAX_BATCHES_PER_POLICY', 1, 100);
  optionalBoundedInteger('RETENTION_MAX_UNSAVED_PER_USER', 10, 1_000);
  optionalBoundedInteger('DATABASE_BUDGET_BYTES', 1024 * 1024, Number.MAX_SAFE_INTEGER);
  assert.match(
    required('CAPACITY_ALERT_EMAIL'),
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    'CAPACITY_ALERT_EMAIL must be an email address'
  );
}

if (requestedProfile === 'staging') {
  const publicOrigin = parseUrl('PUBLIC_ORIGIN', ['https:']);
  ensure(publicOrigin.hostname !== 'nevely.app', 'Staging must not use the production hostname');
  ensure(publicOrigin.hostname !== 'www.nevely.app', 'Staging must not use the production hostname');

  ensure(
    required('RAILWAY_ENVIRONMENT_ID') !== required('PRODUCTION_RAILWAY_ENVIRONMENT_ID'),
    'Staging and production must use different Railway environments'
  );

  ensure(
    required('EMAIL_DELIVERY_MODE') === 'test',
    'Staging email delivery must be in test mode'
  );
  required('RESEND_API_KEY');
  ensure(
    required('RESEND_FROM') === 'Verify <noreply@notifications.nevely.app>',
    'Staging must use the verified Nevely verification sender'
  );
  const testRecipient = required('RESEND_TEST_RECIPIENT').toLowerCase();
  ensure(
    testRecipient === 'delivered+staging@resend.dev',
    'Staging email must be forced to the fixed Resend test recipient'
  );

  ensure(required('ANALYTICS_MODE') === 'disabled', 'Staging analytics must remain disabled');
  ensure(required('ROBOTS_INDEXING') === 'disabled', 'Staging indexing must remain disabled');
}

if (requestedProfile === 'production') {
  ensure(required('EMAIL_DELIVERY_MODE') === 'live', 'Production email delivery must be live');
  required('RESEND_API_KEY');
  ensure(
    required('RESEND_FROM') === 'Verify <noreply@notifications.nevely.app>',
    'Production must use the verified Nevely verification sender'
  );
  ensure(
    required('ROBOTS_INDEXING') === 'enabled',
    'Production indexing must be explicitly enabled'
  );
  const privatePreviewEnabled = required('PRIVATE_PREVIEW_ENABLED').toLowerCase();
  ensure(
    privatePreviewEnabled === 'true' || privatePreviewEnabled === 'false',
    'PRIVATE_PREVIEW_ENABLED must be true or false'
  );
  if (privatePreviewEnabled === 'true') {
    ensure(
      /^\$2[aby]\$(1[0-5])\$[./A-Za-z0-9]{53}$/.test(required('PRIVATE_PREVIEW_PASSWORD_HASH')),
      'PRIVATE_PREVIEW_PASSWORD_HASH must be a bcrypt hash using 10 to 15 rounds'
    );
  }
}

console.log(`Environment validation passed for profile "${requestedProfile}". No configuration values were printed.`);
