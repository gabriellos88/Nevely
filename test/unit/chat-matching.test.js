const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  initialMatchingPhase,
  interestsAllowMatch,
  normalizeStrictPhaseSeconds,
  samePrincipal
} = require('../../lib/chat-matching');

test('matching without interests starts relaxed and the strict preference may be unlimited', () => {
  assert.equal(initialMatchingPhase([]), 'relaxed');
  assert.equal(normalizeStrictPhaseSeconds(5), 5);
  assert.equal(normalizeStrictPhaseSeconds(30), 30);
  assert.equal(normalizeStrictPhaseSeconds(null), null);
  assert.equal(normalizeStrictPhaseSeconds(35), 10);
});

test('strict matching requires a normalized shared interest from either participant', () => {
  const strict = { interests: ['astronomy'], matchingPhase: 'strict' };
  const compatible = { interests: ['astronomy', 'music'], matchingPhase: 'relaxed' };
  const incompatible = { interests: ['literature'], matchingPhase: 'relaxed' };
  assert.deepEqual(interestsAllowMatch(strict, compatible), { allowed: true, sharedCount: 1 });
  assert.deepEqual(interestsAllowMatch(strict, incompatible), { allowed: false, sharedCount: 0 });
});

test('relaxed matching permits no shared interests without weakening principal isolation', () => {
  const first = { guestId: 'guest-a', interests: ['astronomy'], matchingPhase: 'relaxed' };
  const second = { guestId: 'guest-b', interests: ['literature'], matchingPhase: 'relaxed' };
  assert.deepEqual(interestsAllowMatch(first, second), { allowed: true, sharedCount: 0 });
  assert.equal(samePrincipal(first, second), false);
  assert.equal(samePrincipal(first, { ...second, guestId: 'guest-a' }), true);
});
