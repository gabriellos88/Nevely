const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createPublicId,
  isPublicId,
  nextAvailablePublicId
} = require('../../lib/public-identifiers');

test('canonical public IDs use the exact lowercase principal formats', () => {
  const userId = createPublicId('user');
  const guestId = createPublicId('guest');
  const friendRequestId = createPublicId('friendRequest');
  const notificationId = createPublicId('notification');
  const chatRequestId = createPublicId('chatRequest');
  const conversationId = createPublicId('conversation');
  const messageId = createPublicId('message');
  assert.match(userId, /^nvy_[0-9a-f]{12}$/);
  assert.match(guestId, /^gst_[0-9a-f]{12}$/);
  assert.match(friendRequestId, /^frq_[0-9a-f]{24}$/);
  assert.match(notificationId, /^ntf_[0-9a-f]{24}$/);
  assert.match(chatRequestId, /^crq_[0-9a-f]{24}$/);
  assert.match(conversationId, /^cnv_[0-9a-f]{24}$/);
  assert.match(messageId, /^msg_[0-9a-f]{24}$/);
  assert.equal(isPublicId(userId, 'user'), true);
  assert.equal(isPublicId(guestId, 'guest'), true);
  assert.equal(isPublicId(friendRequestId, 'friendRequest'), true);
  assert.equal(isPublicId(notificationId, 'notification'), true);
  assert.equal(isPublicId(chatRequestId, 'chatRequest'), true);
  assert.equal(isPublicId(conversationId, 'conversation'), true);
  assert.equal(isPublicId(messageId, 'message'), true);
  assert.equal(isPublicId('nvy_ABCDEF123456', 'user'), false);
  assert.equal(isPublicId('gst_0123456789ab', 'user'), false);
});

test('public ID allocation retries a collision before returning a free value', async () => {
  const firstCandidate = 'nvy_000000000000';
  const candidates = [firstCandidate, 'nvy_abcdefabcdef'];
  const executor = {
    async query(_sql, [value]) {
      return { rowCount: value === firstCandidate ? 1 : 0, rows: [] };
    }
  };
  const allocated = await nextAvailablePublicId(executor, 'user', {
    generate: () => candidates.shift()
  });
  assert.equal(allocated, 'nvy_abcdefabcdef');
});
