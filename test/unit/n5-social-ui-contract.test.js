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

test('Inbox separates active and past direct chats and history uses contextual read-only status', () => {
  const view = read('views/chat.ejs');
  const client = read('public/js/chat-client.js');
  const copy = JSON.parse(read('public/i18n/en.json'));
  const inboxStart = view.indexOf('id="messagesInboxPanel"');
  const inboxEnd = view.indexOf('id="messagesRecentPanel"');
  const chatHeader = view.indexOf('class="chat-partner-bar"');
  const messages = view.indexOf('id="messages"');
  const pastSection = view.indexOf('id="directRecentSection"');
  assert.ok(inboxStart >= 0 && pastSection > inboxStart && pastSection < inboxEnd);
  assert.ok(chatHeader >= 0 && !(pastSection > chatHeader && pastSection < messages));
  assert.equal(copy.chat.drawers.messages.endedConversations, 'Past conversations');
  assert.equal(copy.chat.feedback.viewingRecentConversation, 'Viewing a recent conversation');
  assert.equal(copy.chat.feedback.viewingSavedConversation, 'Viewing a saved conversation');
  assert.equal(copy.chat.feedback.conversationHasEnded, 'This conversation has ended');
  assert.match(client, /sourceContext === 'saved'[\s\S]*?viewingSavedConversation/);
  assert.match(client, /sourceContext === 'history'[\s\S]*?viewingRecentConversation/);
  assert.match(client, /window\.lucide\?\.createIcons\(\);/);
  assert.doesNotMatch(view, />Recent Direct Chats</);
});
