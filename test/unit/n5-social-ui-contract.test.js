const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_POLICIES } = require('../../lib/moderation-rate-limit');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('friendship surfaces require confirmation, exact feedback and a request-tab badge', () => {
  const view = read('views/chat.ejs');
  const client = read('public/js/chat-client.js');
  const copy = JSON.parse(read('public/i18n/en.json'));
  assert.match(view, /id="friendRequestsTabBadge"/);
  assert.match(view, /id="friendSafetyConfirmModal"[\s\S]*?aria-modal="true"[\s\S]*?inert/);
  assert.match(client, /confirmRemoveFriend/);
  assert.match(client, /confirmBlockFriend/);
  assert.match(client, /\['friend_request', 'friend_accepted'\][\s\S]*?return row;/);
  assert.equal(copy.chat.feedback.friendRequestSent, 'Friend request sent');
  assert.equal(copy.chat.feedback.chatRequestSent, 'Chat request sent');
});

test('direct End is left of the joined message and Send control', () => {
  const view = read('views/chat.ejs');
  const end = view.indexOf('id="endDirectChatBtn"');
  const input = view.indexOf('id="messageInput"');
  const send = view.indexOf('id="sendBtn"');
  const next = view.indexOf('id="newBtn"');
  assert.ok(end > 0 && end < input && input < send && send < next);
  assert.match(read('public/css/style.css'), /\.conversation-end-group[\s\S]*?border-inline-end/);
});

test('ordinary duplicate messages have a tolerant window while sustained repetition still escalates', () => {
  assert.deepEqual(DEFAULT_POLICIES['message-duplicate'], {
    limit: 4,
    windowSeconds: 30,
    escalationSeconds: [8, 30, 120]
  });
  assert.deepEqual(DEFAULT_POLICIES.message, {
    limit: 12,
    windowSeconds: 10,
    escalationSeconds: [30, 120, 600]
  });
});
