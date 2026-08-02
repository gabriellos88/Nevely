const crypto = require('crypto');

const PRESET_AVATAR_IDS = Object.freeze([
  'astra',
  'nova',
  'lyra',
  'vega',
  'sol',
  'mira',
  'orion',
  'elara'
]);
const PRESET_AVATAR_ID_SET = new Set(PRESET_AVATAR_IDS);
const PRESET_AVATAR_ROOT = '/vendor/dicebear-presets-10.2.0';

function presetAvatarUrl(avatarId) {
  return PRESET_AVATAR_ID_SET.has(avatarId)
    ? `${PRESET_AVATAR_ROOT}/${avatarId}.svg`
    : null;
}

function randomPresetAvatarId(randomBytes = crypto.randomBytes) {
  const value = randomBytes(1)[0];
  return PRESET_AVATAR_IDS[value % PRESET_AVATAR_IDS.length];
}

function randomPresetAvatarUrl(randomBytes) {
  return presetAvatarUrl(randomPresetAvatarId(randomBytes));
}

module.exports = {
  PRESET_AVATAR_IDS,
  PRESET_AVATAR_ID_SET,
  presetAvatarUrl,
  randomPresetAvatarId,
  randomPresetAvatarUrl
};
