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

test('chat client applies only the generic server retry interval to message controls', () => {
  assert.match(
    source,
    /socket\.on\('message-error',[\s\S]*startMessageCooldown\(data\.retryAfterSeconds\)/
  );
  assert.match(
    source,
    /const canSend = isLive && Date\.now\(\) >= messageCooldownUntil;[\s\S]*messageInput\.disabled = !canSend;[\s\S]*sendBtn\.disabled = !canSend;/
  );
  assert.match(
    source,
    /const pendingMessage = addMessage\(text, 'me'\);[\s\S]*socket\.emit\('send-message', text, \(response = \{\}\) => \{[\s\S]*pendingMessage\.remove\(\)/
  );
  assert.doesNotMatch(source, /pendingSentMessages/);
  assert.doesNotMatch(source, /data\.(?:signal|threshold|normalized|counter)/);
});

test('chat search and ended-conversation UI follow authoritative lifecycle events', () => {
  const startSearchSource = source.slice(source.indexOf('function startSearch()'), source.indexOf('// Aggiunge un messaggio'));
  const partnerLeftSource = source.slice(source.indexOf("socket.on('partner-left'"), source.indexOf("socket.on('message-error'"));

  assert.match(source, /socket\.on\('search-state',[\s\S]*phase !== 'topic-preference'[\s\S]*phase !== 'general'/);
  assert.doesNotMatch(startSearchSource, /showSearchView\(/);
  assert.doesNotMatch(source, /guest-time-expired|durationSeconds|startCountdown/);
  assert.match(partnerLeftSource, /statusText\.textContent = chatCopy\.feedback\.chatEnded/);
  assert.doesNotMatch(partnerLeftSource, /resetPartnerBar|currentPartner = null|currentConversationId = null/);
});
