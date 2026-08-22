const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const { persistConversationMessage } = require('../../lib/conversation-messages');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = { info() {}, warn() {}, error() {} };

after(async () => {
  if (hasDatabase) await require('../../db').close();
});

function cookieFrom(response) {
  return (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}

async function registerVerified(baseUrl, db, name) {
  const email = `${name}@example.test`;
  const registration = await request(baseUrl).post('/register').set('Accept', 'application/json').send({
    username: name,
    email,
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch'
  }).expect(201);
  await db.query('UPDATE users SET email_verified_at = NOW() WHERE email = $1', [email]);
  const login = await request(baseUrl).post('/login').set('Accept', 'application/json').send({
    email,
    password: 'SyntheticPassword123!'
  }).expect(200);
  return { cookie: cookieFrom(login), publicId: registration.body.user.publicId };
}

test('standard saved chats and the direct inbox are capped at five with server capabilities', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'social-controls-test-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => runtime.shutdown());
  const owner = await registerVerified(baseUrl, db, 'social_limit_owner');
  const partner = await registerVerified(baseUrl, db, 'social_limit_partner');
  const ids = await db.query(
    'SELECT id, public_id FROM users WHERE public_id = ANY($1::text[])',
    [[owner.publicId, partner.publicId]]
  );
  const ownerId = Number(ids.rows.find((row) => row.public_id === owner.publicId).id);
  const partnerId = Number(ids.rows.find((row) => row.public_id === partner.publicId).id);
  const conversationIds = [];
  const conversationPublicIds = [];
  for (let index = 0; index < 7; index += 1) {
    const status = index < 3 ? 'active' : 'ended';
    const conversation = await db.query(
      `INSERT INTO conversations (type, status, ended_at, last_activity_at)
       VALUES ('direct', $1::varchar, CASE WHEN $1::varchar = 'ended' THEN NOW() ELSE NULL END, NOW() - ($2 * INTERVAL '1 minute'))
       RETURNING id, public_id`,
      [status, index]
    );
    const conversationId = Number(conversation.rows[0].id);
    conversationIds.push(conversationId);
    conversationPublicIds.push(conversation.rows[0].public_id);
    await db.query(
      `INSERT INTO conversation_participants (conversation_id, user_id, socket_id, display_name)
       VALUES ($1, $2, $3, 'Owner'), ($1, $4, $5, 'Partner')`,
      [conversationId, ownerId, `owner-${index}`, partnerId, `partner-${index}`]
    );
  }

  const inbox = await request(baseUrl).get('/api/conversations').set('Cookie', owner.cookie).expect(200);
  assert.equal(inbox.body.directInbox.limit, 5);
  assert.equal(inbox.body.directInbox.active.length, 3);
  assert.equal(inbox.body.directInbox.recent.length, 2);
  assert.equal(inbox.body.directInbox.active.concat(inbox.body.directInbox.recent).length, 5);
  assert.deepEqual(inbox.body.limits.saved, 5);
  assert.equal(inbox.body.conversations[0].capabilities.canSave, true);
  assert.equal(inbox.body.conversations[0].capabilities.canRemoveFromHistory, true);
  assert.equal(inbox.body.conversations[0].capabilities.canDeleteUnsavedMessages, true);
  assert.equal(inbox.body.conversations[0].capabilities.canAddFriend, true);
  assert.equal(inbox.body.conversations[0].capabilities.canBlock, true);

  await db.query(
    `INSERT INTO friendships (user_id, friend_id)
     VALUES ($1, $2), ($2, $1)`,
    [ownerId, partnerId]
  );
  const friendInbox = await request(baseUrl).get('/api/conversations').set('Cookie', owner.cookie).expect(200);
  assert.equal(friendInbox.body.conversations[0].capabilities.canAddFriend, false);
  assert.equal(friendInbox.body.conversations[0].capabilities.canBlock, true);
  await db.query(
    `DELETE FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [ownerId, partnerId]
  );

  for (const conversationId of conversationPublicIds.slice(0, 5)) {
    await request(baseUrl)
      .put(`/api/conversations/${conversationId}/saved`)
      .set('Cookie', owner.cookie)
      .send({})
      .expect((response) => assert.ok([200, 201].includes(response.status)));
  }
  await request(baseUrl)
    .put(`/api/conversations/${conversationPublicIds[5]}/saved`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(409);
  const saved = await request(baseUrl).get('/api/saved-chats').set('Cookie', owner.cookie).expect(200);
  assert.equal(saved.body.limit, 5);
  assert.equal(saved.body.used, 5);
  assert.equal(saved.body.chats.every((chat) => chat.capabilities.canUnsave === true), true);
  assert.equal(saved.body.chats.every((chat) => (
    chat.capabilities.canRemoveFromHistory === (chat.status !== 'active')
    && chat.capabilities.canDeleteUnsavedMessages === (chat.status !== 'active')
  )), true);
  assert.equal(saved.body.chats.every((chat) => chat.capabilities.canAddFriend === true), true);
  assert.equal(saved.body.chats.every((chat) => chat.capabilities.canBlock === true), true);

  const historyProfile = await request(baseUrl)
    .get(`/api/users/${partner.publicId}/profile?context=history&conversationId=${conversationPublicIds[0]}`)
    .set('Cookie', owner.cookie)
    .expect(200);
  assert.equal(historyProfile.body.presenceVisible, false);
  assert.equal(Object.hasOwn(historyProfile.body, 'online'), false);

  await persistConversationMessage(db, {
    conversationId: conversationIds[0],
    user: { userId: partnerId, guestId: null, displayName: 'Partner retained name' }
  }, 'partner-retention-test', 'retained saved message');
  await db.query(
    `UPDATE users
     SET deleted_at = NOW(), retention_until = NOW() + INTERVAL '30 days'
     WHERE id = $1`,
    [partnerId]
  );

  const anonymizedSaved = await request(baseUrl)
    .get('/api/saved-chats')
    .set('Cookie', owner.cookie)
    .expect(200);
  assert.equal(anonymizedSaved.body.used, 5);
  assert.equal(anonymizedSaved.body.chats.every((chat) => chat.partner_anonymized === true), true);
  assert.equal(anonymizedSaved.body.chats.every((chat) => chat.partner_name === 'Unavailable participant'), true);
  assert.equal(anonymizedSaved.body.chats.every((chat) => chat.partner_public_id === null), true);
  assert.equal(anonymizedSaved.body.chats.every((chat) => chat.profile_image_url === null), true);
  assert.equal(anonymizedSaved.body.chats.every((chat) => (
    chat.capabilities.canAddFriend === false
    && chat.capabilities.canBlock === false
    && chat.capabilities.canResumeDirect === false
    && chat.capabilities.canViewPartnerProfile === false
  )), true);

  const anonymizedHistory = await request(baseUrl)
    .get('/api/conversations')
    .set('Cookie', owner.cookie)
    .expect(200);
  assert.equal(anonymizedHistory.body.conversations.every((chat) => chat.partner_anonymized === true), true);
  assert.equal(anonymizedHistory.body.directInbox.active.every((chat) => chat.partner_anonymized === true), true);
  const anonymizedMessages = await request(baseUrl)
    .get(`/api/conversations/${conversationPublicIds[0]}/messages`)
    .set('Cookie', owner.cookie)
    .expect(200);
  const retainedMessage = anonymizedMessages.body.messages.find((message) => message.body === 'retained saved message');
  assert.ok(retainedMessage);
  assert.equal(retainedMessage.sender_public_id, null);
  assert.equal(retainedMessage.sender_display_name, 'Unavailable participant');
});

test('direct message history is bounded to 200 while saved and moderation-protected content is retained', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'message-cap-test-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => runtime.shutdown());
  const owner = await registerVerified(baseUrl, db, 'message_cap_owner');
  const partner = await registerVerified(baseUrl, db, 'message_cap_partner');
  const ids = await db.query(
    'SELECT id, public_id FROM users WHERE public_id = ANY($1::text[])',
    [[owner.publicId, partner.publicId]]
  );
  const ownerId = Number(ids.rows.find((row) => row.public_id === owner.publicId).id);
  const partnerId = Number(ids.rows.find((row) => row.public_id === partner.publicId).id);
  const conversation = await db.query(
    "INSERT INTO conversations (type, status) VALUES ('direct', 'active') RETURNING id, public_id"
  );
  const conversationId = Number(conversation.rows[0].id);
  const conversationPublicId = conversation.rows[0].public_id;
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, socket_id, display_name)
     VALUES ($1, $2, 'message-cap-owner', 'Owner'), ($1, $3, 'message-cap-partner', 'Partner')`,
    [conversationId, ownerId, partnerId]
  );
  const active = {
    conversationId,
    user: { userId: ownerId, guestId: null, displayName: 'Owner' }
  };
  for (let index = 1; index <= 205; index += 1) {
    await persistConversationMessage(db, active, 'message-cap-owner', `bounded message ${index}`);
  }
  assert.equal(Number((await db.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1',
    [conversationId]
  )).rows[0].count), 200);
  await Promise.all(Array.from({ length: 10 }, (_, index) => persistConversationMessage(
    db,
    active,
    `message-cap-concurrent-${index}`,
    `concurrent bounded message ${index}`
  )));
  assert.equal(Number((await db.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1',
    [conversationId]
  )).rows[0].count), 200);

  await db.query(
    'INSERT INTO saved_chats (user_id, conversation_id) VALUES ($1, $2)',
    [ownerId, conversationId]
  );
  for (let index = 206; index <= 210; index += 1) {
    await persistConversationMessage(db, active, 'message-cap-owner', `saved message ${index}`);
  }
  assert.equal(Number((await db.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1',
    [conversationId]
  )).rows[0].count), 205);

  let beforeMessageId = null;
  let visibleCount = 0;
  do {
    const suffix = beforeMessageId ? `&beforeMessageId=${beforeMessageId}` : '';
    const page = await request(baseUrl)
      .get(`/api/conversations/${conversationPublicId}/messages?limit=100${suffix}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    visibleCount += page.body.messages.length;
    beforeMessageId = page.body.page.nextBeforeMessageId;
  } while (beforeMessageId);
  assert.equal(visibleCount, 200);

  await db.query('DELETE FROM saved_chats WHERE user_id = $1 AND conversation_id = $2', [ownerId, conversationId]);
  await db.query(
    `INSERT INTO reports
       (reporter_user_id, reported_user_id, conversation_id, reason, retention_until)
     VALUES ($1, $2, $3, 'Synthetic retention guard', NOW() + INTERVAL '1 day')`,
    [ownerId, partnerId, conversationId]
  );
  await persistConversationMessage(db, active, 'message-cap-owner', 'moderation protected message');
  assert.equal(Number((await db.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1',
    [conversationId]
  )).rows[0].count), 206);
});
