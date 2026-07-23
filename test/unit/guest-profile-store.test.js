const assert = require('node:assert/strict');
const { test } = require('node:test');
const store = require('../../public/js/guest-profile-store');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

const countries = [{
  code: 'ch',
  name: 'Switzerland',
  flag_4x3: 'flags/4x3/ch.svg'
}];

test('guest passport storage validates, normalizes and removes identity', () => {
  const storage = memoryStorage();
  const saved = store.save(storage, {
    name: '  Astra   Guest  ',
    gender: 'non-binary',
    age: 28,
    country: { code: 'CH', name: 'Untrusted label' },
    avatarId: 'astra',
    guestId: 'b079ed5c-b2d8-49d4-9df3-169264d25e47',
    nameChanges: 0,
    accountNotificationRead: false
  }, countries);

  assert.equal(saved.name, 'Astra Guest');
  assert.deepEqual(saved.country, { code: 'ch', name: 'Switzerland' });
  assert.deepEqual(store.read(storage, countries), saved);

  store.remove(storage);
  assert.equal(store.read(storage, countries), null);
});

test('guest passport rejects incomplete, underage and malformed identities', () => {
  assert.equal(store.normalizeProfile({}, countries), null);
  assert.equal(store.normalizeProfile({
    name: 'Guest',
    gender: 'any',
    age: 17,
    country: countries[0],
    avatarId: 'astra'
  }, countries), null);
  assert.equal(store.normalizeProfile({
    name: 'Guest',
    gender: 'unknown',
    age: 30,
    country: countries[0],
    avatarId: 'astra'
  }, countries), null);
});
