const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const clientSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public', 'js', 'auth-client.js'),
  'utf8'
);

function createClient({ mode = 'login', status = 200, body = {} } = {}) {
  const destinations = [];
  const feedback = {
    id: 'auth-error',
    textContent: '',
    setAttribute() {}
  };
  const window = {
    __AUTH_CONFIG__: { mode, csrfToken: 'synthetic-csrf-token' },
    location: {
      assign(destination) {
        destinations.push(destination);
      }
    },
    lucide: {
      createIcons() {}
    }
  };
  const context = vm.createContext({
    document: {
      querySelector() {
        return null;
      },
      getElementById() {
        return feedback;
      },
      createElement() {
        return feedback;
      }
    },
    fetch: async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    }),
    window
  });
  vm.runInContext(clientSource, context, { filename: 'auth-client.js' });
  return {
    destinations,
    feedback,
    handle: window.handleGoogleCredential
  };
}

test('Google auth client routes profile, admin and successful login outcomes', async () => {
  const cases = [
    {
      response: { status: 422, body: { code: 'GOOGLE_PROFILE_REQUIRED' } },
      destination: '/register?google=profile-required'
    },
    {
      response: { status: 202, body: { twoFactorRequired: true } },
      destination: '/login/2fa'
    },
    {
      response: { body: { profileCompletionRequired: true } },
      destination: '/complete-profile'
    },
    {
      response: { body: { adminTwoFactorSetupRequired: true } },
      destination: '/admin/security'
    },
    {
      response: { status: 201, body: { user: { displayName: 'Synthetic' } } },
      destination: '/chat'
    }
  ];

  for (const testCase of cases) {
    const client = createClient(testCase.response);
    await client.handle({ credential: 'synthetic-google-credential' });
    assert.deepEqual(client.destinations, [testCase.destination]);
    assert.equal(client.feedback.textContent, '');
  }
});

test('Google profile validation stays inline on the registration page', async () => {
  const client = createClient({
    mode: 'register',
    status: 422,
    body: {
      code: 'GOOGLE_PROFILE_REQUIRED',
      error: 'Complete the required profile.'
    }
  });
  await client.handle({ credential: 'synthetic-google-credential' });
  assert.deepEqual(client.destinations, []);
  assert.equal(client.feedback.textContent, 'Complete the required profile.');
});
