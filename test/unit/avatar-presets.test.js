const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PRESET_AVATAR_IDS,
  presetAvatarUrl,
  randomPresetAvatarId,
  randomPresetAvatarUrl
} = require('../../lib/avatar-presets');

test('registered avatar defaults use only self-hosted guest presets', () => {
  assert.equal(PRESET_AVATAR_IDS.length, 8);
  assert.equal(randomPresetAvatarId(() => Buffer.from([0])), 'astra');
  assert.equal(randomPresetAvatarId(() => Buffer.from([255])), 'elara');
  assert.equal(
    randomPresetAvatarUrl(() => Buffer.from([1])),
    '/vendor/dicebear-presets-10.2.0/nova.svg'
  );
  assert.equal(presetAvatarUrl('orion'), '/vendor/dicebear-presets-10.2.0/orion.svg');
  assert.equal(presetAvatarUrl('../outside'), null);
});
