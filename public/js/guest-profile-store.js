(function exposeGuestProfileStore(root, factory) {
  const store = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = store;
  if (root) root.NevelyGuestProfileStore = store;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createGuestProfileStore(root) {
  const uiCopy = root?.__COPY__ || (typeof require === 'function' ? require('../i18n/en.json') : {});
  const STORAGE_KEY = 'nevely.guestPassport.v1';
  const PROFILE_VERSION = 1;
  const GENDERS = Object.freeze([
    { value: 'any', label: uiCopy.common.anyone },
    { value: 'male', label: uiCopy.common.male },
    { value: 'female', label: uiCopy.common.female },
    { value: 'non-binary', label: uiCopy.common.nonBinary },
    { value: 'other', label: uiCopy.common.other }
  ]);
  const AVATAR_PRESETS = Object.freeze([
    { id: 'astra', src: '/vendor/dicebear-presets-10.2.0/astra.svg' },
    { id: 'nova', src: '/vendor/dicebear-presets-10.2.0/nova.svg' },
    { id: 'lyra', src: '/vendor/dicebear-presets-10.2.0/lyra.svg' },
    { id: 'vega', src: '/vendor/dicebear-presets-10.2.0/vega.svg' },
    { id: 'sol', src: '/vendor/dicebear-presets-10.2.0/sol.svg' },
    { id: 'mira', src: '/vendor/dicebear-presets-10.2.0/mira.svg' },
    { id: 'orion', src: '/vendor/dicebear-presets-10.2.0/orion.svg' },
    { id: 'elara', src: '/vendor/dicebear-presets-10.2.0/elara.svg' }
  ]);
  const genderValues = new Set(GENDERS.map(({ value }) => value));
  const avatarIds = new Set(AVATAR_PRESETS.map(({ id }) => id));
  const GUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function normalizeName(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
  }

  function normalizeProfile(value, countryCatalog = []) {
    if (!value || typeof value !== 'object') return null;
    const name = normalizeName(value.name);
    const gender = genderValues.has(value.gender) ? value.gender : '';
    const age = Number(value.age);
    const avatarId = avatarIds.has(value.avatarId) ? value.avatarId : '';
    const guestId = typeof value.guestId === 'string' && GUEST_ID_PATTERN.test(value.guestId)
      ? value.guestId
      : null;
    const nameChanges = Number(value.nameChanges) >= 1 ? 1 : 0;
    const accountNotificationRead = value.accountNotificationRead === true;
    const suppliedCountry = value.country && typeof value.country === 'object' ? value.country : null;
    const countryCode = typeof suppliedCountry?.code === 'string' ? suppliedCountry.code.toLowerCase() : '';
    const catalogCountry = Array.isArray(countryCatalog)
      ? countryCatalog.find((country) => country.code === countryCode)
      : null;
    const country = catalogCountry
      ? { code: catalogCountry.code, name: catalogCountry.name }
      : suppliedCountry && /^[a-z]{2}$/.test(countryCode) && typeof suppliedCountry.name === 'string'
        ? { code: countryCode, name: suppliedCountry.name.trim().slice(0, 80) }
        : null;

    if (!name || !gender || !Number.isInteger(age) || age < 18 || age > 99 || !country?.name || !avatarId) {
      return null;
    }

    return {
      version: PROFILE_VERSION,
      name,
      gender,
      age,
      country,
      avatarId,
      guestId,
      nameChanges,
      accountNotificationRead
    };
  }

  function read(storage, countryCatalog = []) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== PROFILE_VERSION) return null;
      return normalizeProfile(parsed, countryCatalog);
    } catch (error) {
      return null;
    }
  }

  function save(storage, profile, countryCatalog = []) {
    if (!storage || typeof storage.setItem !== 'function') throw new Error(uiCopy.errors.browserStorage);
    const normalized = normalizeProfile(profile, countryCatalog);
    if (!normalized) throw new Error(uiCopy.errors.guestProfileIncomplete);
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function remove(storage) {
    if (storage && typeof storage.removeItem === 'function') storage.removeItem(STORAGE_KEY);
  }

  function pickRandomAvatar(randomValue = Math.random()) {
    const safeValue = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999) : 0;
    return AVATAR_PRESETS[Math.floor(safeValue * AVATAR_PRESETS.length)].id;
  }

  function avatarUrl(avatarId) {
    return AVATAR_PRESETS.find(({ id }) => id === avatarId)?.src || '';
  }

  return Object.freeze({
    STORAGE_KEY,
    PROFILE_VERSION,
    GENDERS,
    AVATAR_PRESETS,
    normalizeProfile,
    read,
    save,
    remove,
    pickRandomAvatar,
    avatarUrl
  });
}));
