(function (root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.InterestUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_INTERESTS = 5;
  const MAX_INTEREST_LENGTH = 30;

  function normalizeInterest(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function sanitizeInterests(values, options = {}) {
    const maxInterests = options.maxInterests || MAX_INTERESTS;
    const maxLength = options.maxLength || MAX_INTEREST_LENGTH;
    const normalized = [];
    const seen = new Set();
    let error = null;

    const rawValues = Array.isArray(values) ? values : [values];

    rawValues.forEach((entry) => {
      if (error) return;

      const items = Array.isArray(entry) ? entry : String(entry || '').split(/[\n,]/);

      items.forEach((item) => {
        if (error) return;

        const normalizedItem = normalizeInterest(item);
        if (!normalizedItem) return;

        if (normalizedItem.length > maxLength) {
          error = `Each interest must be ${maxLength} characters or less.`;
          return;
        }

        if (normalized.length >= maxInterests) {
          error = `You can add up to ${maxInterests} interests.`;
          return;
        }

        if (!seen.has(normalizedItem)) {
          seen.add(normalizedItem);
          normalized.push(normalizedItem);
        }
      });
    });

    return { interests: normalized, error };
  }

  return {
    MAX_INTERESTS,
    MAX_INTEREST_LENGTH,
    normalizeInterest,
    sanitizeInterests
  };
});
