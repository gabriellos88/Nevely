const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
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

async function seedConversation(db, firstUserId, secondUserId, { status = 'ended', savedBy = [] } = {}) {
  const conversation = await db.query(
    `INSERT INTO conversations (type, status, ended_at)
     VALUES ('direct', $1::varchar, CASE WHEN $1::varchar = 'ended' THEN NOW() ELSE NULL END)
     RETURNING id, public_id`,
    [status]
  );
  const id = Number(conversation.rows[0].id);
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, socket_id, display_name)
     VALUES ($1, $2, $3, 'History owner'), ($1, $4, $5, 'History partner')`,
    [id, firstUserId, `history-${id}-first`, secondUserId, `history-${id}-second`]
  );
  await db.query(
    `INSERT INTO messages (conversation_id, sender_user_id, sender_socket_id, sender_display_name, body)
     VALUES ($1, $2, $3, 'History owner', 'Synthetic history message')`,
    [id, firstUserId, `history-${id}-first`]
  );
  for (const userId of savedBy) {
    await db.query('INSERT INTO saved_chats (user_id, conversation_id) VALUES ($1, $2)', [userId, id]);
  }
  return { id, publicId: conversation.rows[0].public_id };
}

test('history removal is per-user and unsaved deletion preserves saved and moderation-retained data', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'history-actions-test-secret' },
    log: quietLog
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => runtime.shutdown());

  const owner = await registerVerified(baseUrl, db, 'history_action_owner');
  const partner = await registerVerified(baseUrl, db, 'history_action_partner');
  const ids = await db.query(
    'SELECT id, public_id FROM users WHERE public_id = ANY($1::text[])',
    [[owner.publicId, partner.publicId]]
  );
  const ownerId = Number(ids.rows.find((row) => row.public_id === owner.publicId).id);
  const partnerId = Number(ids.rows.find((row) => row.public_id === partner.publicId).id);

  const sharedSaved = await seedConversation(db, ownerId, partnerId, {
    savedBy: [ownerId, partnerId]
  });
  await request(baseUrl)
    .delete(`/api/conversations/${sharedSaved.publicId}/history`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(400);
  const removals = await Promise.all([
    request(baseUrl)
      .delete(`/api/conversations/${sharedSaved.publicId}/history`)
      .set('Cookie', owner.cookie)
      .send({ confirmation: 'REMOVE FROM MY HISTORY' }),
    request(baseUrl)
      .delete(`/api/conversations/${sharedSaved.publicId}/history`)
      .set('Cookie', owner.cookie)
      .send({ confirmation: 'REMOVE FROM MY HISTORY' })
  ]);
  assert.deepEqual(removals.map((response) => response.status), [204, 204]);

  const ownerHistory = await request(baseUrl).get('/api/conversations').set('Cookie', owner.cookie).expect(200);
  assert.equal(ownerHistory.body.conversations.some((item) => item.public_id === sharedSaved.publicId), false);
  const ownerSaved = await request(baseUrl).get('/api/saved-chats').set('Cookie', owner.cookie).expect(200);
  assert.equal(ownerSaved.body.chats.some((item) => item.conversation_public_id === sharedSaved.publicId), false);
  const partnerHistory = await request(baseUrl).get('/api/conversations').set('Cookie', partner.cookie).expect(200);
  assert.equal(partnerHistory.body.conversations.some((item) => item.public_id === sharedSaved.publicId), true);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1',
    [sharedSaved.id]
  )).rows[0].count), 1);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*)::int AS count FROM saved_chats WHERE conversation_id = $1',
    [sharedSaved.id]
  )).rows[0].count), 1);
  const historyAudit = await db.query(
    `SELECT actor_user_id, target_type, before_state, after_state
     FROM audit_log
     WHERE action = 'product.conversation_history_removed'
       AND actor_user_id = $1`,
    [ownerId]
  );
  assert.equal(historyAudit.rowCount, 1);
  assert.equal(historyAudit.rows[0].target_type, 'conversation');
  assert.deepEqual(historyAudit.rows[0].before_state, {
    conversationId: sharedSaved.id,
    visible: true
  });
  assert.deepEqual(historyAudit.rows[0].after_state, {
    conversationId: sharedSaved.id,
    visible: false
  });

  await request(baseUrl)
    .post(`/api/conversations/${sharedSaved.publicId}/delete-unsaved`)
    .set('Cookie', partner.cookie)
    .send({ confirmation: 'DELETE UNSAVED MESSAGES' })
    .expect(204);
  assert.equal((await db.query(
    'SELECT deleted_for_everyone_at FROM messages WHERE conversation_id = $1',
    [sharedSaved.id]
  )).rows[0].deleted_for_everyone_at, null);

  const unsaved = await seedConversation(db, ownerId, partnerId);
  await request(baseUrl)
    .post(`/api/conversations/${unsaved.publicId}/delete-unsaved`)
    .set('Cookie', owner.cookie)
    .send({})
    .expect(400);
  const concurrentDeletes = await Promise.all([
    request(baseUrl)
      .post(`/api/conversations/${unsaved.publicId}/delete-unsaved`)
      .set('Cookie', owner.cookie)
      .send({ confirmation: 'DELETE UNSAVED MESSAGES' }),
    request(baseUrl)
      .post(`/api/conversations/${unsaved.publicId}/delete-unsaved`)
      .set('Cookie', owner.cookie)
      .send({ confirmation: 'DELETE UNSAVED MESSAGES' })
  ]);
  assert.deepEqual(concurrentDeletes.map((response) => response.status), [204, 204]);
  assert.notEqual((await db.query(
    'SELECT deleted_for_everyone_at FROM messages WHERE conversation_id = $1',
    [unsaved.id]
  )).rows[0].deleted_for_everyone_at, null);
  const deleteAudit = await db.query(
    `SELECT actor_user_id, target_type, before_state, after_state
     FROM audit_log
     WHERE action = 'product.unsaved_messages_deleted'
       AND actor_user_id = $1`,
    [ownerId]
  );
  assert.equal(deleteAudit.rowCount, 1);
  assert.equal(deleteAudit.rows[0].target_type, 'conversation');
  assert.deepEqual(deleteAudit.rows[0].before_state, {
    conversationId: unsaved.id,
    deletedMessageCount: 0
  });
  assert.deepEqual(deleteAudit.rows[0].after_state, {
    conversationId: unsaved.id,
    deletedMessageCount: 1
  });
  const serializedAudit = JSON.stringify([historyAudit.rows[0], deleteAudit.rows[0]]);
  assert.equal(serializedAudit.includes('Synthetic history message'), false);
  assert.equal(serializedAudit.includes(sharedSaved.publicId), false);
  assert.equal(serializedAudit.includes(unsaved.publicId), false);

  const protectedConversation = await seedConversation(db, ownerId, partnerId);
  await db.query(
    `INSERT INTO reports (reporter_user_id, reported_user_id, conversation_id, reason, retention_until)
     VALUES ($1, $2, $3, 'Synthetic protected conversation', NOW() + INTERVAL '1 day')`,
    [ownerId, partnerId, protectedConversation.id]
  );
  await request(baseUrl)
    .post(`/api/conversations/${protectedConversation.publicId}/delete-unsaved`)
    .set('Cookie', partner.cookie)
    .send({ confirmation: 'DELETE UNSAVED MESSAGES' })
    .expect(204);
  assert.equal((await db.query(
    'SELECT deleted_for_everyone_at FROM messages WHERE conversation_id = $1',
    [protectedConversation.id]
  )).rows[0].deleted_for_everyone_at, null);

  const active = await seedConversation(db, ownerId, partnerId, { status: 'active' });
  await request(baseUrl)
    .post(`/api/conversations/${active.publicId}/delete-unsaved`)
    .set('Cookie', partner.cookie)
    .send({ confirmation: 'DELETE UNSAVED MESSAGES' })
    .expect(404);
  assert.equal((await db.query(
    'SELECT deleted_for_everyone_at FROM messages WHERE conversation_id = $1',
    [active.id]
  )).rows[0].deleted_for_everyone_at, null);
});
