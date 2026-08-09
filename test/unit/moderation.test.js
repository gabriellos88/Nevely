const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ModerationError,
  canonicalNetwork,
  fingerprintsForAddress,
  requiredReason
} = require('../../lib/moderation');

test('network CIDRs are canonicalized without retaining the source address', () => {
  const first = canonicalNetwork('203.0.113.77/24');
  const second = canonicalNetwork('203.0.113.0/24');
  assert.deepEqual(first, second);
  assert.equal(canonicalNetwork('203.0.113.77'), null);
  assert.equal(canonicalNetwork('203.0.113.77/33'), null);
  assert.equal(canonicalNetwork('not-an-address/24'), null);
  assert.deepEqual(canonicalNetwork('::ffff:203.0.113.77/24'), canonicalNetwork('203.0.113.77/24'));
});

test('network fingerprints support IPv4 and IPv6 prefix matching without raw IP output', () => {
  const secret = 'synthetic-network-secret';
  const ipv4 = fingerprintsForAddress('203.0.113.77', secret);
  const ipv6 = fingerprintsForAddress('2001:db8::42', secret);
  assert.equal(ipv4.length, 33);
  assert.equal(ipv6.length, 129);
  for (const value of [...ipv4, ...ipv6]) assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(ipv4).includes('203.0.113.77'), false);
});

test('sensitive moderation actions require a bounded human reason', () => {
  assert.throws(() => requiredReason(''), (error) => error instanceof ModerationError
    && error.code === 'MODERATION_REASON_REQUIRED');
  assert.equal(requiredReason('  Clear and documented rationale  '), 'Clear and documented rationale');
});
