require('dotenv').config();

const db = require('../db');
const safeLog = require('../lib/safe-log');

const allowedEnvironments = new Set(['local', 'test', 'staging']);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

async function main() {
  const appEnvironment = process.env.APP_ENV || 'local';
  if (!allowedEnvironments.has(appEnvironment)) {
    throw new Error('The N2 load test is forbidden in production.');
  }
  if (process.env.N2_LOAD_TEST_CONFIRM !== 'ROLLBACK_SYNTHETIC_DATA') {
    throw new Error('Set N2_LOAD_TEST_CONFIRM=ROLLBACK_SYNTHETIC_DATA to run the rollback-only load test.');
  }
  if (!db.isConfigured) throw new Error('DATABASE_URL is not configured.');

  const conversations = boundedInteger(
    process.env.N2_LOAD_TEST_CONVERSATIONS,
    100,
    10,
    10_000
  );
  const messagesPerConversation = boundedInteger(
    process.env.N2_LOAD_TEST_MESSAGES_PER_CONVERSATION,
    100,
    10,
    1_000
  );
  const client = await db.getClient();
  const startedAt = Date.now();
  try {
    await client.query('BEGIN');
    await client.query(
      'CREATE TEMP TABLE n2_load_conversations (id BIGINT PRIMARY KEY) ON COMMIT DROP'
    );
    await client.query(
      `WITH inserted AS (
         INSERT INTO conversations (type, status, ended_at)
         SELECT 'random', 'ended', NOW()
         FROM generate_series(1, $1)
         RETURNING id
       )
       INSERT INTO n2_load_conversations (id)
       SELECT id FROM inserted`,
      [conversations]
    );
    await client.query(
      `INSERT INTO messages
         (conversation_id, sender_socket_id, sender_display_name, body)
       SELECT synthetic.id,
              'n2-load-test',
              'Synthetic load test',
              repeat('x', 240)
       FROM n2_load_conversations synthetic
       CROSS JOIN generate_series(1, $1)`,
      [messagesPerConversation]
    );
    const messagePlan = (await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, body, created_at
       FROM messages
       WHERE conversation_id = (SELECT MIN(id) FROM n2_load_conversations)
         AND deleted_for_everyone_at IS NULL
       ORDER BY id DESC
       LIMIT 31`
    )).rows[0]['QUERY PLAN'][0];
    const retentionPlan = (await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT c.id
       FROM conversations c
       WHERE c.status <> 'active'
         AND c.last_activity_at <= NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id
         )
       ORDER BY c.last_activity_at, c.id
       LIMIT 500`
    )).rows[0]['QUERY PLAN'][0];
    const storage = (await client.query(
      `SELECT COUNT(*)::int AS message_count,
              COALESCE(SUM(pg_column_size(m.*)), 0)::bigint AS message_row_bytes
       FROM messages m
       JOIN n2_load_conversations synthetic ON synthetic.id = m.conversation_id`
    )).rows[0];

    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      rolledBack: true,
      conversations,
      messages: Number(storage.message_count),
      messageRowBytes: Number(storage.message_row_bytes),
      durationMs: Date.now() - startedAt,
      messageQueryExecutionMs: Number(messagePlan['Execution Time']),
      retentionQueryExecutionMs: Number(retentionPlan['Execution Time'])
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    safeLog.error('database.n2_load_test_failed', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
