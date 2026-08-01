require('dotenv').config();

const db = require('../db');
const safeLog = require('../lib/safe-log');

function planSummary(name, plan) {
  const indexes = new Set();
  function visit(node) {
    if (node['Index Name']) indexes.add(node['Index Name']);
    for (const child of node.Plans || []) visit(child);
  }
  visit(plan.Plan);
  return {
    name,
    topNode: plan.Plan['Node Type'],
    planningMs: Number(plan['Planning Time']),
    executionMs: Number(plan['Execution Time']),
    indexes: [...indexes].sort()
  };
}

async function explain(client, name, sql, params) {
  const result = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    params
  );
  return planSummary(name, result.rows[0]['QUERY PLAN'][0]);
}

async function main() {
  if (!db.isConfigured) throw new Error('DATABASE_URL is not configured.');
  const client = await db.getClient();
  try {
    await client.query('BEGIN READ ONLY');
    const sample = (await client.query(
      `SELECT
         (SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1) AS user_id,
         (SELECT LOWER(LEFT(username, 3)) FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1) AS username_prefix,
         (SELECT id FROM conversations ORDER BY created_at DESC, id DESC LIMIT 1) AS conversation_id`
    )).rows[0];
    const plans = [];
    plans.push(await explain(
      client,
      'case-insensitive-user-prefix',
      `SELECT public_id, display_name, created_at
       FROM users
       WHERE deleted_at IS NULL
         AND LOWER(username) LIKE $1::text || '%'
       ORDER BY created_at DESC, id DESC
       LIMIT 31`,
      [sample.username_prefix || 'n2-no-match']
    ));
    plans.push(await explain(
      client,
      'conversation-cursor',
      `SELECT c.id, c.created_at
       FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
       WHERE cp.user_id = $1
         AND c.deleted_for_everyone_at IS NULL
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 31`,
      [sample.user_id]
    ));
    plans.push(await explain(
      client,
      'message-before-id',
      `SELECT id, body, created_at
       FROM messages
       WHERE conversation_id = $1
         AND deleted_for_everyone_at IS NULL
       ORDER BY id DESC
       LIMIT 31`,
      [sample.conversation_id]
    ));
    plans.push(await explain(
      client,
      'active-ban',
      `SELECT id
       FROM bans
       WHERE user_id = $1
         AND starts_at <= NOW()
         AND (type = 'permanent' OR ends_at > NOW())
       ORDER BY starts_at DESC, id DESC
       LIMIT 1`,
      [sample.user_id]
    ));
    plans.push(await explain(
      client,
      'pending-report-cursor',
      `SELECT id, created_at
       FROM reports
       WHERE status = 'pending'
       ORDER BY created_at DESC, id DESC
       LIMIT 31`,
      []
    ));
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ plans }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    safeLog.error('database.n2_explain_failed', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
