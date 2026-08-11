const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessageAbuseProtector, hasRepeatedCharacterFlood, normalizeMessageForComparison } = require('../../lib/message-abuse');

test('message duplicate comparison normalizes Unicode, zero-width characters and whitespace server-side', () => {
  assert.equal(normalizeMessageForComparison('  HＥLLO\u200B   WORLD  '), 'hello world');
});

test('repeated character signal is tolerant of ordinary text and catches sustained runs', () => {
  assert.equal(hasRepeatedCharacterFlood('that is very nice'), false);
  assert.equal(hasRepeatedCharacterFlood('noooooooooooo'), true);
});

test('link and repeated-character signals use opaque buckets without exposing text', async () => {
  const consumed = [];
  const protector = createMessageAbuseProtector({
    hmacSecret: 'unit-test-message-abuse-secret',
    rateLimiter: {
      async consume(input) {
        consumed.push(input);
        return { allowed: true, retryAfterSeconds: 0 };
      }
    }
  });

  await protector.consume({
    principalType: 'guest',
    principalId: '8d44a01d-8a5d-4b4d-83b8-70e4f3eb40e3',
    text: 'https://example.test aaaaaaaaaaaa'
  });

  assert.deepEqual(consumed.map(({ action }) => action), [
    'message-duplicate',
    'message-link-flood',
    'message-repeated-character-flood'
  ]);
  assert.equal(consumed.every(({ principalType }) => principalType === 'signal'), true);
  assert.equal(consumed.every(({ principalId }) => /^[0-9a-f]{64}$/.test(principalId)), true);
  assert.equal(JSON.stringify(consumed).includes('example.test'), false);
});

test('link signal recognizes conservative bare-domain and Unicode-width variants', async () => {
  const actions = [];
  const protector = createMessageAbuseProtector({
    hmacSecret: 'unit-test-message-abuse-secret',
    rateLimiter: {
      async consume({ action }) {
        actions.push(action);
        return { allowed: true, retryAfterSeconds: 0 };
      }
    }
  });

  await protector.consume({ principalType: 'user', principalId: 42, text: 'example.com/path' });
  await protector.consume({ principalType: 'user', principalId: 42, text: 'visit ｅｘａｍｐｌｅ．ｃｏｍ now' });
  await protector.consume({ principalType: 'user', principalId: 42, text: 'ordinary prose version 2.0' });

  assert.equal(actions.filter((action) => action === 'message-link-flood').length, 2);
});
