const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public', 'js', 'chat-client.js'),
  'utf8'
);

test('chat client redirects revoked sessions and renders authoritative Google unlink state', () => {
  assert.match(
    source,
    /response\.status === 401[\s\S]*window\.location\.replace\('\/login'\)/
  );
  assert.match(
    source,
    /socket\.on\('auth-required',[\s\S]*window\.location\.replace\('\/login'\)/
  );
  assert.match(
    source,
    /const data = await api\('\/api\/account\/identities\/google',[\s\S]*renderAccountSecurity\(data\?\.user \|\| \{[\s\S]*hasGoogle: false/
  );
  assert.match(
    source,
    /api\('\/api\/account'\)[\s\S]*renderAccountSecurity\(account\.user\)/
  );
});
