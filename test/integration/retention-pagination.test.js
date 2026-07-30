const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error() {}
};

function registrationPayload(username) {
  return {
    username,
    email: `${username}@example.test`,
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch'
  };
}

async function register(runtime, username) {
  const agent = request.agent(runtime.app);
  const response = await agent
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload(username))
    .expect(201);
  const row = (await runtime.db.query(
    'SELECT id FROM users WHERE public_id = $1',
    [response.body.user.publicId]
  )).rows[0];
  return {
    agent,
    id: Number(row.id),
    publicId: response.body.user.publicId
  };
}

async function seedConversation(db, userId, {
  activity = 'NOW()',
  created = 'NOW()',
  saved = false,
  messageCount = 1,
  socketSuffix = Math.random().toString(16).slice(2)
} = {}) {
  const conversation = await db.query(
    `INSERT INTO conversations
       (type, status, started_at, ended_at, created_at, last_activity_at, expires_at)
     VALUES (
       'random',
       'ended',
       ${created},
       ${activity},
       ${created},
       ${activity},
       ${activity} + INTERVAL '7 days'
     )
     RETURNING id`,
    []
  );
  const conversationId = Number(conversation.rows[0].id);
  await db.query(
    `INSERT INTO conversation_participants
       (conversation_id, user_id, socket_id, display_name, left_at)
     VALUES ($1, $2, $3, 'Synthetic user', NOW())`,
    [conversationId, userId, `n2-${socketSuffix}`]
  );
  if (messageCount > 0) {
    await db.query(
      `INSERT INTO messages
         (conversation_id, sender_user_id, sender_socket_id, sender_display_name, body, created_at)
       SELECT $1, $2, $3, 'Synthetic user', 'synthetic retention message',
              ${activity} - make_interval(secs => ($4 - sequence)::int)
       FROM generate_series(1, $4) sequence`,
      [conversationId, userId, `n2-${socketSuffix}`, messageCount]
    );
  }
  if (saved) {
    await db.query(
      'INSERT INTO saved_chats (user_id, conversation_id) VALUES ($1, $2)',
      [userId, conversationId]
    );
  }
  return conversationId;
}

test('N2 retention, evidence, capacity and cursor contracts', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'n2-integration-session-secret-32-characters',
      EMAIL_DELIVERY_MODE: 'disabled',
      RETENTION_WORKER_ENABLED: 'false',
      RETENTION_BATCH_SIZE: '10',
      RETENTION_MAX_BATCHES_PER_POLICY: '20',
      RETENTION_MAX_UNSAVED_PER_USER: '10',
      DATABASE_BUDGET_BYTES: String(5 * 1024 * 1024 * 1024)
    },
    log: quietLog
  });
  runtime.db = db;

  t.after(async () => {
    await runtime.shutdown();
    await db.close();
  });

  const owner = await register(runtime, 'n2_owner');
  const cappedOwner = await register(runtime, 'n2_capped_owner');
  const paginationOwner = await register(runtime, 'n2_pagination_owner');

  const expiredUnsaved = await seedConversation(db, owner.id, {
    activity: "NOW() - INTERVAL '8 days'",
    created: "NOW() - INTERVAL '9 days'",
    socketSuffix: 'expired-unsaved'
  });
  const recentUnsaved = await seedConversation(db, owner.id, {
    activity: "NOW() - INTERVAL '6 days'",
    created: "NOW() - INTERVAL '6 days'",
    socketSuffix: 'recent-unsaved'
  });
  const expiredSaved = await seedConversation(db, owner.id, {
    activity: "NOW() - INTERVAL '13 months'",
    created: "NOW() - INTERVAL '13 months'",
    saved: true,
    socketSuffix: 'expired-saved'
  });
  const recentSaved = await seedConversation(db, owner.id, {
    activity: "NOW() - INTERVAL '11 months'",
    created: "NOW() - INTERVAL '11 months'",
    saved: true,
    socketSuffix: 'recent-saved'
  });

  const report = await db.query(
    `INSERT INTO reports
       (reporter_user_id, reported_user_id, conversation_id, reason, status)
     VALUES ($1, $1, $2, 'synthetic-retention', 'pending')
     RETURNING id, retention_until`,
    [owner.id, expiredUnsaved]
  );
  const reportId = Number(report.rows[0].id);
  await db.query(
    `INSERT INTO report_evidence_snapshots
       (report_id, conversation_id, expires_at, messages)
     VALUES (
       $1,
       $2,
       $3,
       '[{"messageId":1,"senderRole":"reported","body":"synthetic evidence","createdAt":"2026-01-01T00:00:00Z"}]'::jsonb
     )`,
    [reportId, expiredUnsaved, report.rows[0].retention_until]
  );
  await assert.rejects(
    db.query(
      `UPDATE report_evidence_snapshots SET messages = '[]'::jsonb WHERE report_id = $1`,
      [reportId]
    ),
    /immutable/
  );

  const cappedIds = [];
  for (let index = 0; index < 12; index += 1) {
    cappedIds.push(await seedConversation(db, cappedOwner.id, {
      activity: `NOW() - INTERVAL '${index + 1} hours'`,
      created: `NOW() - INTERVAL '${index + 1} hours'`,
      socketSuffix: `capped-${index}`
    }));
  }

  await db.query(
    `INSERT INTO notifications (user_id, type, title, read_at, created_at)
     VALUES ($1, 'synthetic', 'Expired notification',
             NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days')`,
    [owner.id]
  );
  await db.query(
    `INSERT INTO friend_requests
       (sender_user_id, receiver_user_id, status, created_at)
     VALUES ($1, $2, 'pending', NOW() - INTERVAL '91 days')`,
    [owner.id, cappedOwner.id]
  );

  const firstRun = await runtime.retentionWorker.runOnce();
  assert.equal(firstRun.deletedCounts['reason:unsaved_expired'], 1);
  assert.equal(firstRun.deletedCounts['reason:saved_expired'], 1);
  assert.equal(firstRun.deletedCounts['reason:unsaved_over_user_limit'], 2);
  assert.equal(firstRun.deletedCounts.notifications, 1);
  assert.equal(firstRun.deletedCounts.friendRequests, 1);
  assert.ok(Number(firstRun.capacity.database_bytes) > 0);

  const retainedConversationIds = (await db.query(
    `SELECT id FROM conversations
     WHERE id = ANY($1::bigint[])
     ORDER BY id`,
    [[expiredUnsaved, recentUnsaved, expiredSaved, recentSaved, ...cappedIds]]
  )).rows.map((row) => Number(row.id));
  assert.equal(retainedConversationIds.includes(expiredUnsaved), false);
  assert.equal(retainedConversationIds.includes(expiredSaved), false);
  assert.equal(retainedConversationIds.includes(recentUnsaved), true);
  assert.equal(retainedConversationIds.includes(recentSaved), true);
  assert.equal(cappedIds.filter((id) => retainedConversationIds.includes(id)).length, 10);

  const retainedEvidence = (await db.query(
    `SELECT r.conversation_id, evidence.conversation_id AS evidence_conversation_id,
            jsonb_array_length(evidence.messages) AS message_count
     FROM reports r
     JOIN report_evidence_snapshots evidence ON evidence.report_id = r.id
     WHERE r.id = $1`,
    [reportId]
  )).rows[0];
  assert.equal(retainedEvidence.conversation_id, null);
  assert.equal(Number(retainedEvidence.evidence_conversation_id), expiredUnsaved);
  assert.equal(Number(retainedEvidence.message_count), 1);

  const secondRun = await runtime.retentionWorker.runOnce();
  assert.equal(secondRun.deletedCounts.conversations || 0, 0);
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM retention_runs WHERE status = 'completed'`
    )).rows[0].count),
    2
  );
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM database_capacity_snapshots`
    )).rows[0].count),
    2
  );

  let messageConversationId;
  for (let index = 0; index < 35; index += 1) {
    const id = await seedConversation(db, paginationOwner.id, {
      activity: `NOW() - INTERVAL '${index} minutes'`,
      created: `NOW() - INTERVAL '${index} minutes'`,
      messageCount: index === 0 ? 35 : 1,
      socketSuffix: `page-${index}`
    });
    if (index === 0) messageConversationId = id;
  }

  const firstConversations = await paginationOwner.agent
    .get('/api/conversations?limit=20')
    .expect(200);
  assert.equal(firstConversations.body.conversations.length, 20);
  assert.equal(firstConversations.body.page.limit, 20);
  assert.equal(firstConversations.body.page.hasMore, true);
  assert.equal(typeof firstConversations.body.page.nextCursor, 'string');

  const secondConversations = await paginationOwner.agent
    .get(`/api/conversations?limit=20&cursor=${encodeURIComponent(firstConversations.body.page.nextCursor)}`)
    .expect(200);
  const firstIds = new Set(firstConversations.body.conversations.map((item) => item.id));
  assert.equal(
    secondConversations.body.conversations.some((item) => firstIds.has(item.id)),
    false
  );
  await paginationOwner.agent.get('/api/conversations?cursor=invalid').expect(400);

  const newestMessages = await paginationOwner.agent
    .get(`/api/conversations/${messageConversationId}/messages?limit=20`)
    .expect(200);
  assert.equal(newestMessages.body.messages.length, 20);
  assert.equal(newestMessages.body.page.hasMore, true);
  assert.ok(
    Number(newestMessages.body.messages[0].id)
      < Number(newestMessages.body.messages.at(-1).id)
  );
  const olderMessages = await paginationOwner.agent
    .get(
      `/api/conversations/${messageConversationId}/messages?limit=20`
      + `&beforeMessageId=${newestMessages.body.page.nextBeforeMessageId}`
    )
    .expect(200);
  assert.equal(olderMessages.body.messages.length, 15);

  await db.query(
    `INSERT INTO notifications (user_id, type, title, created_at)
     SELECT $1, 'synthetic', 'Synthetic notification',
            NOW() - make_interval(mins => sequence)
     FROM generate_series(1, 35) sequence`,
    [paginationOwner.id]
  );
  const notifications = await paginationOwner.agent
    .get('/api/notifications?limit=20')
    .expect(200);
  assert.equal(notifications.body.notifications.length, 20);
  assert.equal(notifications.body.page.hasMore, true);
  assert.equal(notifications.body.unreadCount, 35);

  for (const endpoint of [
    '/api/friends',
    '/api/friend-requests',
    '/api/chat-requests',
    '/api/blocks'
  ]) {
    const response = await paginationOwner.agent.get(`${endpoint}?limit=10`).expect(200);
    assert.deepEqual(response.body.page, {
      limit: 10,
      hasMore: false,
      nextCursor: null
    });
    await paginationOwner.agent.get(`${endpoint}?cursor=invalid`).expect(400);
  }
});
