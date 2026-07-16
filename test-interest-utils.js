const assert = require('assert');
const { sanitizeInterests, MAX_INTERESTS, MAX_INTEREST_LENGTH } = require('./public/js/interest-utils');

const good = sanitizeInterests(['  Gaming  ', '  Music  ', 'Movies']);
assert.deepStrictEqual(good.interests, ['gaming', 'music', 'movies']);
assert.strictEqual(good.error, null);

const tooMany = sanitizeInterests(Array.from({ length: MAX_INTERESTS + 1 }, (_, index) => `item${index}`));
assert.strictEqual(tooMany.error, `You can add up to ${MAX_INTERESTS} interests.`);
assert.strictEqual(tooMany.interests.length, MAX_INTERESTS);

const tooLong = sanitizeInterests([`${'x'.repeat(MAX_INTEREST_LENGTH + 1)}`]);
assert.strictEqual(tooLong.error, `Each interest must be ${MAX_INTEREST_LENGTH} characters or less.`);
assert.deepStrictEqual(tooLong.interests, []);

console.log('interest-utils tests passed');
