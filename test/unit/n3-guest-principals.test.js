const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  GUEST_RETENTION_DAYS,
  guestAlias,
  publicGuestPrincipal
} = require('../../lib/guest-principals');

test('guest principals retain an internal UUID while exposing only a canonical public ID', () => {
  const id = 'b079ed5c-b2d8-49d4-9df3-169264d25e47';
  assert.equal(guestAlias(id), 'gst_B079ED5CB2');
  assert.equal(GUEST_RETENTION_DAYS, 30);
  assert.throws(() => guestAlias('browser-supplied-id'), /UUID/);

  const guest = publicGuestPrincipal({
    id,
    public_id: 'gst_b079ed5cb2d8',
    display_alias: guestAlias(id),
    name: 'Astra Guest',
    gender: 'non-binary',
    age: 28,
    country: 'Switzerland',
    country_code: 'ch',
    avatar_id: 'astra',
    name_changes: 0,
    status: 'active',
    created_at: '2026-07-30T10:00:00.000Z',
    updated_at: '2026-07-30T10:00:00.000Z',
    last_seen_at: '2026-07-30T10:01:00.000Z',
    retention_until: '2026-08-29T10:01:00.000Z',
    deleted_at: null
  });

  assert.equal(guest.id, id);
  assert.equal(guest.publicId, 'gst_b079ed5cb2d8');
  assert.equal(Object.keys(guest).includes('id'), false);
  assert.equal(Object.keys(guest).includes('displayAlias'), false);
  assert.deepEqual(guest.country, { code: 'ch', name: 'Switzerland' });
  assert.equal(guest.age, 28);
});
