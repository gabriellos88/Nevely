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
  assert.match(client, /isChatRequestNotification[\s\S]*?openConversationsFromNotification/);
  assert.match(client, /item\.type === 'friend_accepted'[\s\S]*?dismissNotification/);
  assert.match(client, /item\.actor\?\.profileImageUrl/);
  assert.match(read('lib/api.js'), /actor\.public_id AS actor_public_id[\s\S]*?actor: actorPublicId/);
  assert.equal(copy.chat.feedback.friendRequestSent, 'Friend request sent');
  assert.equal(copy.chat.feedback.chatRequestSent, 'Chat request sent');
  assert.equal(copy.chat.feedback.openConversations, 'Open Conversations');
});

test('direct End is a confirmed overflow action while Skip stays left of Send', () => {
  const view = read('views/chat.ejs');
  const css = read('public/css/style.css');
  const input = view.indexOf('id="messageInput"');
  const send = view.indexOf('id="sendBtn"');
  const next = view.indexOf('id="newBtn"');
  const end = view.indexOf('id="endDirectChatBtn"');
  assert.ok(end > 0 && end < next && next < input && input < send);
  assert.match(view, /id="conversationMenu"[\s\S]*?id="endDirectChatBtn"/);
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.next-chat-group \.skip-btn\s*\{[\s\S]*?min-width: var\(--spacing-28\);/);
  assert.doesNotMatch(css, /\.chat-app-page \.end-chat-btn span,\s*\.chat-app-page \.skip-btn span,/);
});

test('direct request updates refresh the server-authoritative Messages badge', () => {
  const client = read('public/js/chat-client.js');
  assert.match(
    client,
    /socket\.on\('direct-chat-request-updated', \(\) => \{\s*loadChatRequestsPanel\(\);\s*refreshTopbarBadges\(\);/
  );
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

test('conversation history keeps its actions in one accessible overflow and retains the end date', () => {
  const client = read('public/js/chat-client.js');
  const copy = JSON.parse(read('public/i18n/en.json'));
  assert.match(client, /conversation-actions-trigger[\s\S]*?aria-haspopup.*menu/);
  assert.match(client, /conversation-actions-menu[\s\S]*?role.*menu/);
  assert.match(client, /ended_at[\s\S]*?endedOn/);
  assert.equal(copy.chat.dynamic.endedOn, 'Ended {date}');
});

test('recent and saved conversations replace the composer with server-capability actions', () => {
  const view = read('views/chat.ejs');
  const client = read('public/js/chat-client.js');
  const api = read('lib/api.js');
  assert.match(view, /id="liveComposerBar"[\s\S]*?id="historyActionBar"/);
  assert.match(view, /id="historyAddFriendBtn"[\s\S]*?data-lucide="user-plus"/);
  assert.match(view, /id="historySaveBtn"[\s\S]*?data-lucide="bookmark"/);
  assert.match(view, /id="historyBlockBtn"[\s\S]*?data-lucide="shield-off"/);
  assert.match(client, /function applyStoredConversationCapabilities\(capabilities = \{\}\)/);
  assert.match(client, /capabilities\.canAddFriend === true/);
  assert.match(client, /capabilities\.canBlock === true/);
  assert.match(client, /liveComposerBar\?\.classList\.toggle\('hidden', isHistory\)/);
  assert.match(api, /conversationSocialCapabilities[\s\S]*?can_add_friend[\s\S]*?can_block/);
  assert.doesNotMatch(client, /partner_public_id[\s\S]{0,120}canAddFriend/);
});

test('direct conversations can be parked for random matching and resumed only by server capability', () => {
  const view = read('views/chat.ejs');
  const client = read('public/js/chat-client.js');
  const chat = read('lib/chat.js');
  const messages = read('lib/conversation-messages.js');
  assert.match(view, /id="newRandomChatBtn"/);
  assert.match(client, /capabilities\.canResumeDirect === true/);
  assert.match(client, /socket\.timeout\(6000\)\.emit\([\s\S]*?'resume-direct-chat'[\s\S]*?partnerPublicId/);
  assert.doesNotMatch(client, /currentConversationType === 'direct' && chatComposerMode === 'live'\) return/);
  assert.match(chat, /currentPair\?\.type === 'direct'\) detachDirectPair/);
  assert.match(chat, /consumeRateLimit\(profileForSocket\(socket\), 'direct-chat-resume'\)/);
  assert.doesNotMatch(chat, /setImmediate\(\(\) => void resumeDirectConversation\(socket\)\)/);
  assert.match(chat, /directMessageContext\(socket, requestedConversationId\)/);
  assert.match(chat, /validateDirectMessageParticipant/);
  assert.match(messages, /MAX_VISIBLE_CONVERSATION_MESSAGES = 200/);
  assert.match(messages, /saved_chats[\s\S]*?reports[\s\S]*?retention_until/);
  assert.doesNotMatch(messages, /console\.|safeLog|body\s*:/);
});

test('end, personal history removal and retained message deletion are distinct confirmed operations', () => {
  const view = read('views/chat.ejs');
  const client = read('public/js/chat-client.js');
  const api = read('lib/api.js');
  const copy = JSON.parse(read('public/i18n/en.json'));
  assert.match(view, /id="removeConversationHistoryBtn"[\s\S]*?data-lucide="trash-2"/);
  assert.match(view, /id="deleteUnsavedMessagesBtn"[\s\S]*?data-lucide="eraser"/);
  assert.match(client, /confirmEndConversation[\s\S]*?action: endDirectConversation/);
  assert.match(client, /capabilities\.canRemoveFromHistory === true/);
  assert.match(client, /capabilities\.canDeleteUnsavedMessages === true/);
  assert.match(client, /REMOVE FROM MY HISTORY/);
  assert.match(client, /DELETE UNSAVED MESSAGES/);
  assert.doesNotMatch(client, /\bconfirm\(/);
  assert.match(api, /confirmation !== 'REMOVE FROM MY HISTORY'/);
  assert.match(api, /confirmation !== 'DELETE UNSAVED MESSAGES'/);
  assert.match(api, /saved_chats[\s\S]*?reports[\s\S]*?retention_until/);
  assert.equal(
    copy.chat.feedback.removeHistoryConfirm,
    'Remove this conversation from your history? This won’t affect the other person.'
  );
  assert.equal(
    copy.chat.feedback.deleteUnsavedMessagesConfirm,
    'Delete unsaved messages for both participants? Safety records may be retained.'
  );
});

test('saved history keeps content but removes unavailable partner identity and capabilities', () => {
  const api = read('lib/api.js');
  const client = read('public/js/chat-client.js');
  const copy = JSON.parse(read('public/i18n/en.json'));
  assert.equal(copy.common.unavailableParticipant, 'Unavailable participant');
  assert.match(api, /partner_anonymized/);
  assert.match(api, /COALESCE\(u\.deleted_at IS NULL, FALSE\) AS account_available/);
  assert.match(api, /guest\.status = 'active' AND guest\.retention_until > NOW\(\)/);
  assert.match(api, /canViewPartnerProfile: Boolean\(chat\.partner_public_id\)/);
  assert.match(api, /ELSE \$7[\s\S]*?AS sender_display_name/);
  assert.match(client, /capabilities\.canViewPartnerProfile === true/);
  assert.match(client, /partnerProfileBtn\.disabled = !currentConversationCapabilities\.canViewPartnerProfile/);
});

test('product conversation and message actions use only opaque public identifiers', () => {
  const api = read('lib/api.js');
  const chat = read('lib/chat.js');
  const client = read('public/js/chat-client.js');
  const migration = read('database/migrations/026_n5_public_message_identifiers.sql');
  assert.match(migration, /messages_public_id_unique/);
  assert.match(api, /conversationIdFromPublicId/);
  assert.match(api, /c\.public_id AS id/);
  assert.match(api, /m\.public_id AS id/);
  assert.match(api, /ORDER BY c\.created_at DESC, c\.public_id DESC/);
  assert.match(api, /boundary\.public_id = \$4/);
  assert.match(chat, /conversationId: conversationPublicId/);
  assert.match(chat, /active\.conversationPublicId !== conversationPublicId/);
  assert.match(client, /PUBLIC_CONVERSATION_ID_PATTERN/);
  assert.match(client, /PUBLIC_MESSAGE_ID_PATTERN/);
  assert.doesNotMatch(client, /Number\(response\.id\)/);
  assert.doesNotMatch(client, /Number\(conversationId\)/);
  assert.doesNotMatch(chat, /log\.(?:info|warn|error)\([^\n]*(?:payload|text|body)/);
});
