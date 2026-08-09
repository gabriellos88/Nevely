const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const clientSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public', 'js', 'admin.js'),
  'utf8'
);

function createClient({ valid = true, status = 200 } = {}) {
  const requests = [];
  const feedback = { textContent: '' };
  const form = {
    addEventListener() {},
    reportValidity() {
      return valid;
    }
  };
  const window = {
    __ADMIN_CONFIG__: {
      csrfToken: 'synthetic-csrf-token',
      reauthMethod: 'google'
    },
    __COPY__: {
      admin: {
        actionFailed: 'Action failed.',
        reauthenticationComplete: 'High-risk actions unlocked.'
      }
    }
  };
  class SyntheticFormData {
    constructor() {
      this.entries = [['code', '123456']];
    }

    [Symbol.iterator]() {
      return this.entries[Symbol.iterator]();
    }
  }
  const context = vm.createContext({
    document: {
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
      addEventListener() {
        // The focused reauthentication test has no workspace DOM to bind.
      },
      getElementById(id) {
        if (id === 'adminReauthForm') return form;
        if (id === 'adminReauthFeedback') return feedback;
        return null;
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => status >= 200 && status < 300
          ? ({ expiresAt: '2026-08-09T12:10:00.000Z' })
          : ({ error: 'Rejected.' })
      };
    },
    FormData: SyntheticFormData,
    URLSearchParams,
    window
  });
  vm.runInContext(clientSource, context, { filename: 'admin.js' });
  return {
    feedback,
    handle: window.handleAdminGoogleReauth,
    requests
  };
}

test('Google-only admin reauthentication sends a fresh credential with the TOTP code', async () => {
  const client = createClient();
  await client.handle({ credential: 'synthetic-google-credential' });

  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].url, '/api/admin/reauth');
  assert.equal(client.requests[0].options.method, 'POST');
  assert.equal(
    client.requests[0].options.headers['X-CSRF-Token'],
    'synthetic-csrf-token'
  );
  assert.deepEqual(
    JSON.parse(client.requests[0].options.body),
    {
      code: '123456',
      credential: 'synthetic-google-credential'
    }
  );
  assert.equal(client.feedback.textContent, 'High-risk actions unlocked.');
});

test('Google-only admin reauthentication does not spend a credential without a valid TOTP form', async () => {
  const client = createClient({ valid: false });
  await client.handle({ credential: 'synthetic-google-credential' });
  assert.equal(client.requests.length, 0);
});
