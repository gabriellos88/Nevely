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
  let feedback = null;
  let createdFeedbackCount = 0;
  const window = {
    __AUTH_CONFIG__: {
      mode,
      csrfToken: 'synthetic-csrf-token',
      googleProfileRequired: mode === 'register'
    },
    history: {},
    scrollTo() {},
    location: {
      replace(destination) {
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
        createdFeedbackCount += 1;
        feedback = {
          id: '',
          className: '',
          hidden: false,
          textContent: '',
          setAttribute() {}
        };
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
    createdFeedbackCount: () => createdFeedbackCount,
    feedbackText: () => feedback?.textContent || '',
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
    assert.equal(client.feedbackText(), '');
    assert.equal(client.createdFeedbackCount(), 0);
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
  assert.equal(client.feedbackText(), '');
  assert.equal(client.createdFeedbackCount(), 0);
});

test('Google auth creates an alert only for a real error with non-empty copy', async () => {
  const client = createClient({
    mode: 'login',
    status: 401,
    body: { error: 'Google could not verify this sign-in.' }
  });
  await client.handle({ credential: 'synthetic-google-credential' });
  assert.equal(client.createdFeedbackCount(), 1);
  assert.equal(client.feedbackText(), 'Google could not verify this sign-in.');
});
