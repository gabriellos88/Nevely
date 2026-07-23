import assert from 'node:assert/strict';

const requestedProfile = process.argv[2] || process.env.APP_ENV || 'local';
const supportedProfiles = new Set(['local', 'test', 'staging', 'production']);
const deployedProfiles = new Set(['staging', 'production']);

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

assert.ok(supportedProfiles.has(requestedProfile), `Unsupported environment profile: ${requestedProfile}`);
assert.equal(required('APP_ENV'), requestedProfile, 'APP_ENV must match the requested profile');

if (deployedProfiles.has(requestedProfile)) {
  assert.equal(required('NODE_ENV'), 'production', 'Deployed environments must run with NODE_ENV=production');

  const publicOrigin = parseUrl('PUBLIC_ORIGIN', ['https:']);
  assert.equal(publicOrigin.pathname, '/', 'PUBLIC_ORIGIN must not contain a path');
  assert.equal(publicOrigin.search, '', 'PUBLIC_ORIGIN must not contain a query');
  assert.equal(publicOrigin.hash, '', 'PUBLIC_ORIGIN must not contain a fragment');

  parseUrl('DATABASE_URL', ['postgres:', 'postgresql:']);

  const sessionSecret = required('SESSION_SECRET');
  assert.ok(sessionSecret.length >= 32, 'SESSION_SECRET must contain at least 32 characters');
  assert.ok(!sessionSecret.toLowerCase().includes('replace'), 'SESSION_SECRET still contains a placeholder');

  const railwayName = required('RAILWAY_ENVIRONMENT_NAME').toLowerCase();
  assert.ok(
    railwayName.includes(requestedProfile),
    `RAILWAY_ENVIRONMENT_NAME must identify ${requestedProfile}`
  );
  required('RAILWAY_ENVIRONMENT_ID');
}

if (requestedProfile === 'staging') {
  const publicOrigin = parseUrl('PUBLIC_ORIGIN', ['https:']);
  assert.notEqual(publicOrigin.hostname, 'nevely.app', 'Staging must not use the production hostname');
  assert.notEqual(publicOrigin.hostname, 'www.nevely.app', 'Staging must not use the production hostname');

  assert.notEqual(
    required('RAILWAY_ENVIRONMENT_ID'),
    required('PRODUCTION_RAILWAY_ENVIRONMENT_ID'),
    'Staging and production must use different Railway environments'
  );

  assert.equal(required('EMAIL_DELIVERY_MODE'), 'test', 'Staging email delivery must be in test mode');
  required('RESEND_API_KEY');
  required('RESEND_FROM');
  const testRecipient = required('RESEND_TEST_RECIPIENT').toLowerCase();
  assert.ok(testRecipient.endsWith('@resend.dev'), 'Staging email must be forced to a Resend test recipient');

  assert.equal(required('ANALYTICS_MODE'), 'disabled', 'Staging analytics must remain disabled');
  assert.equal(required('ROBOTS_INDEXING'), 'disabled', 'Staging indexing must remain disabled');
}

if (requestedProfile === 'production') {
  assert.equal(required('EMAIL_DELIVERY_MODE'), 'live', 'Production email delivery must be live');
  required('RESEND_API_KEY');
  required('RESEND_FROM');
  assert.equal(required('ROBOTS_INDEXING'), 'enabled', 'Production indexing must be explicitly enabled');
}

console.log(`Environment validation passed for profile "${requestedProfile}". No configuration values were printed.`);
