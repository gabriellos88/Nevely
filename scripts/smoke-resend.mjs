import assert from 'node:assert/strict';

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required for the staging email smoke test`);
  return value;
}

ensure(required('APP_ENV') === 'staging', 'Email smoke is restricted to staging');
ensure(required('EMAIL_DELIVERY_MODE') === 'test', 'Email smoke requires test delivery mode');

const apiKey = required('RESEND_API_KEY');
const from = required('RESEND_FROM');
const recipient = required('RESEND_TEST_RECIPIENT').toLowerCase();

ensure(
  from === 'Verify <noreply@notifications.nevely.app>',
  'Email smoke requires the verified Nevely verification sender'
);
ensure(
  recipient === 'delivered+staging@resend.dev',
  'Email smoke is restricted to the fixed Resend test recipient'
);

let response;
try {
  response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: 'Nevely staging delivery smoke',
      text: 'Synthetic staging delivery check. No user data is included.'
    }),
    signal: AbortSignal.timeout(15_000)
  });
} catch (error) {
  const safeType = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Resend staging smoke request failed before a response (${safeType}).`);
  process.exitCode = 1;
}

if (response && !response.ok) {
  console.error(`Resend staging smoke request failed with HTTP ${response.status}.`);
  process.exitCode = 1;
}

if (response?.ok) {
  console.log('Resend staging smoke request accepted. No configuration or provider identifiers were printed.');
}
