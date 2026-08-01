const safeLog = require('./safe-log');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES_PER_POLICY = 20;
const DEFAULT_MAX_UNSAVED_PER_USER = 50;
const DATABASE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;
const RETENTION_LOCK_ID = 1_851_907_221;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function workerConfig(environment = process.env) {
  return {
    enabled: environment.RETENTION_WORKER_ENABLED
      ? environment.RETENTION_WORKER_ENABLED !== 'false'
      : environment.NODE_ENV !== 'test',
    initialDelayMs: boundedInteger(
      environment.RETENTION_INITIAL_DELAY_MS,
      DEFAULT_INITIAL_DELAY_MS,
      1_000,
      DAY_MS
    ),
    intervalMs: boundedInteger(
      environment.RETENTION_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      60_000,
      7 * DAY_MS
    ),
    batchSize: boundedInteger(
      environment.RETENTION_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      10,
      5_000
    ),
    maxBatchesPerPolicy: boundedInteger(
      environment.RETENTION_MAX_BATCHES_PER_POLICY,
      DEFAULT_MAX_BATCHES_PER_POLICY,
      1,
      100
    ),
    maxUnsavedPerUser: boundedInteger(
      environment.RETENTION_MAX_UNSAVED_PER_USER,
      DEFAULT_MAX_UNSAVED_PER_USER,
      10,
      1_000
    ),
    databaseBudgetBytes: boundedInteger(
      environment.DATABASE_BUDGET_BYTES,
      DATABASE_BUDGET_BYTES,
      1024 * 1024,
      Number.MAX_SAFE_INTEGER
    )
  };
}

function addCounts(target, source) {
  for (const [name, value] of Object.entries(source)) {
    target[name] = (target[name] || 0) + Number(value || 0);
  }
}

async function deleteConversationBatch(client, candidateSql, candidateParams, reason) {
  await client.query('BEGIN');
  try {
    const candidates = await client.query(candidateSql, candidateParams);
    const ids = candidates.rows.map((row) => Number(row.id));
    if (!ids.length) {
      await client.query('COMMIT');
      return { conversations: 0, messages: 0, messageReceipts: 0, participants: 0, savedChats: 0 };
    }

    const related = (await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM messages WHERE conversation_id = ANY($1::bigint[])) AS messages,
         (SELECT COUNT(*)::int
          FROM message_receipts mr
          JOIN messages m ON m.id = mr.message_id
          WHERE m.conversation_id = ANY($1::bigint[])) AS message_receipts,
         (SELECT COUNT(*)::int
          FROM conversation_participants
          WHERE conversation_id = ANY($1::bigint[])) AS participants,
         (SELECT COUNT(*)::int
          FROM saved_chats
          WHERE conversation_id = ANY($1::bigint[])) AS saved_chats`,
      [ids]
    )).rows[0];

    const deleted = await client.query(
      'DELETE FROM conversations WHERE id = ANY($1::bigint[]) RETURNING id',
      [ids]
    );
    await client.query('COMMIT');
    return {
      conversations: deleted.rowCount,
      messages: Number(related.messages),
      messageReceipts: Number(related.message_receipts),
      participants: Number(related.participants),
      savedChats: Number(related.saved_chats),
      [`reason:${reason}`]: deleted.rowCount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function drainConversationPolicy(client, config) {
  const counts = {};
  const batch = config.batchSize;
  const policies = [
    {
      reason: 'deleted',
      sql: `SELECT c.id
            FROM conversations c
            WHERE c.status <> 'active'
              AND c.deleted_for_everyone_at <= NOW() - INTERVAL '24 hours'
            ORDER BY c.deleted_for_everyone_at, c.id
            FOR UPDATE OF c SKIP LOCKED
            LIMIT $1`,
      params: [batch]
    },
    {
      reason: 'saved_expired',
      sql: `SELECT c.id
            FROM conversations c
            WHERE c.status <> 'active'
              AND c.last_activity_at <= NOW() - INTERVAL '12 months'
              AND EXISTS (
                SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id
              )
            ORDER BY c.last_activity_at, c.id
            FOR UPDATE OF c SKIP LOCKED
            LIMIT $1`,
      params: [batch]
    },
    {
      reason: 'unsaved_expired',
      sql: `SELECT c.id
            FROM conversations c
            WHERE c.status <> 'active'
              AND c.last_activity_at <= NOW() - INTERVAL '7 days'
              AND NOT EXISTS (
                SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id
              )
            ORDER BY c.last_activity_at, c.id
            FOR UPDATE OF c SKIP LOCKED
            LIMIT $1`,
      params: [batch]
    },
    {
      reason: 'unsaved_over_user_limit',
      sql: `SELECT c.id
            FROM conversations c
            WHERE c.id IN (
              SELECT DISTINCT ranked.id
              FROM (
                SELECT c2.id,
                       ROW_NUMBER() OVER (
                         PARTITION BY cp.user_id
                         ORDER BY c2.last_activity_at DESC, c2.id DESC
                       ) AS user_rank
                FROM conversations c2
                JOIN conversation_participants cp ON cp.conversation_id = c2.id
                WHERE cp.user_id IS NOT NULL
                  AND c2.status <> 'active'
                  AND c2.deleted_for_everyone_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM saved_chats s WHERE s.conversation_id = c2.id
                  )
                  AND EXISTS (
                    SELECT 1 FROM messages m WHERE m.conversation_id = c2.id
                  )
              ) ranked
              WHERE ranked.user_rank > $1
            )
            ORDER BY c.last_activity_at, c.id
            FOR UPDATE OF c SKIP LOCKED
            LIMIT $2`,
      params: [config.maxUnsavedPerUser, batch]
    }
  ];

  for (const policy of policies) {
    for (let batchNumber = 0; batchNumber < config.maxBatchesPerPolicy; batchNumber += 1) {
      const result = await deleteConversationBatch(
        client,
        policy.sql,
        policy.params,
        policy.reason
      );
      addCounts(counts, result);
      if (result.conversations < batch) break;
    }
  }
  return counts;
}

const BOUNDED_DELETE_POLICIES = [
  {
    name: 'sessions',
    sql: `DELETE FROM session
          WHERE sid IN (
            SELECT sid FROM session WHERE expire <= NOW() ORDER BY expire LIMIT $1
          )`
  },
  {
    name: 'notifications',
    sql: `DELETE FROM notifications
          WHERE id IN (
            SELECT id FROM notifications
            WHERE (read_at IS NOT NULL AND read_at <= NOW() - INTERVAL '30 days')
               OR created_at <= NOW() - INTERVAL '90 days'
            ORDER BY created_at, id LIMIT $1
          )`
  },
  {
    name: 'friendRequests',
    sql: `DELETE FROM friend_requests
          WHERE id IN (
            SELECT id FROM friend_requests
            WHERE (status = 'pending' AND created_at <= NOW() - INTERVAL '90 days')
               OR (status <> 'pending' AND COALESCE(responded_at, created_at) <= NOW() - INTERVAL '30 days')
            ORDER BY created_at, id LIMIT $1
          )`
  },
  {
    name: 'chatRequests',
    sql: `DELETE FROM chat_requests
          WHERE id IN (
            SELECT id FROM chat_requests
            WHERE (status = 'pending' AND created_at <= NOW() - INTERVAL '90 days')
               OR (status <> 'pending' AND COALESCE(responded_at, created_at) <= NOW() - INTERVAL '30 days')
            ORDER BY created_at, id LIMIT $1
          )`
  },
  {
    name: 'accountTokens',
    sql: `DELETE FROM account_tokens
          WHERE id IN (
            SELECT id FROM account_tokens
            WHERE COALESCE(used_at, revoked_at, expires_at) <= NOW() - INTERVAL '30 days'
            ORDER BY created_at, id LIMIT $1
          )`
  },
  {
    name: 'emailOutbox',
    sql: `DELETE FROM email_outbox
          WHERE id IN (
            SELECT id FROM email_outbox
            WHERE status IN ('sent', 'failed')
              AND COALESCE(sent_at, next_attempt_at, created_at) <= NOW() - INTERVAL '30 days'
            ORDER BY created_at, id LIMIT $1
          )`
  },
  {
    name: 'googleTokenReplays',
    sql: `DELETE FROM google_token_replays
          WHERE token_hash IN (
            SELECT token_hash FROM google_token_replays
            WHERE expires_at <= NOW()
            ORDER BY expires_at, token_hash LIMIT $1
          )`
  },
  {
    name: 'expiredTemporaryBans',
    sql: `DELETE FROM bans
          WHERE id IN (
            SELECT id FROM bans
            WHERE type = 'temporary'
              AND ends_at <= NOW() - INTERVAL '24 months'
            ORDER BY ends_at, id LIMIT $1
          )`
  },
  {
    name: 'securityEvents',
    sql: `DELETE FROM security_events
          WHERE id IN (
            SELECT id FROM security_events
            WHERE created_at <= NOW() - INTERVAL '24 months'
            ORDER BY created_at, id LIMIT $1
          )`
  },
  {
    name: 'reportEvidence',
    sql: `DELETE FROM report_evidence_snapshots
          WHERE report_id IN (
            SELECT report_id FROM report_evidence_snapshots
            WHERE expires_at <= NOW()
            ORDER BY expires_at, report_id LIMIT $1
          )`
  },
  {
    name: 'resolvedReports',
    sql: `DELETE FROM reports
          WHERE id IN (
            SELECT id FROM reports
            WHERE status <> 'pending' AND retention_until <= NOW()
            ORDER BY retention_until, id LIMIT $1
          )`
  },
  {
    name: 'retentionRuns',
    sql: `DELETE FROM retention_runs
          WHERE id IN (
            SELECT id FROM retention_runs
            WHERE started_at <= NOW() - INTERVAL '90 days'
            ORDER BY started_at, id LIMIT $1
          )`
  },
  {
    name: 'capacitySnapshots',
    sql: `DELETE FROM database_capacity_snapshots
          WHERE id IN (
            SELECT id FROM database_capacity_snapshots
            WHERE captured_at <= NOW() - INTERVAL '400 days'
            ORDER BY captured_at, id LIMIT $1
          )`
  }
];

async function drainBoundedPolicies(client, batchSize, maxBatchesPerPolicy) {
  const counts = {};
  for (const policy of BOUNDED_DELETE_POLICIES) {
    for (let batchNumber = 0; batchNumber < maxBatchesPerPolicy; batchNumber += 1) {
      const result = await client.query(policy.sql, [batchSize]);
      counts[policy.name] = (counts[policy.name] || 0) + result.rowCount;
      if (result.rowCount < batchSize) break;
    }
  }
  return counts;
}

function reachedThreshold(usedPercent) {
  if (usedPercent >= 90) return 90;
  if (usedPercent >= 75) return 75;
  if (usedPercent >= 60) return 60;
  return null;
}

async function collectDatabaseCapacity(client, budgetBytes = DATABASE_BUDGET_BYTES) {
  const totals = (await client.query(
    `SELECT
       pg_database_size(current_database())::bigint AS database_bytes,
       COALESCE(SUM(pg_table_size(c.oid)), 0)::bigint AS table_bytes,
       COALESCE(SUM(pg_indexes_size(c.oid)), 0)::bigint AS index_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname = 'public'`
  )).rows[0];
  const largest = await client.query(
    `SELECT c.relname AS relation,
            pg_total_relation_size(c.oid)::bigint AS total_bytes,
            pg_table_size(c.oid)::bigint AS table_bytes,
            pg_indexes_size(c.oid)::bigint AS index_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname = 'public'
     ORDER BY pg_total_relation_size(c.oid) DESC, c.relname
     LIMIT 10`
  );
  const databaseBytes = Number(totals.database_bytes);
  const usedPercent = Number(((databaseBytes / budgetBytes) * 100).toFixed(2));
  const thresholdPercent = reachedThreshold(usedPercent);
  const snapshot = (await client.query(
    `INSERT INTO database_capacity_snapshots
       (database_bytes, table_bytes, index_bytes, budget_bytes, used_percent,
        threshold_percent, largest_relations)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      totals.database_bytes,
      totals.table_bytes,
      totals.index_bytes,
      budgetBytes,
      usedPercent,
      thresholdPercent,
      JSON.stringify(largest.rows)
    ]
  )).rows[0];
  return snapshot;
}

async function queueCapacityAlerts(client, snapshot, environment = process.env) {
  const deliveryMode = environment.EMAIL_DELIVERY_MODE;
  const currentPercent = Number(snapshot.used_percent);
  if (!['test', 'live'].includes(deliveryMode)) return [];

  const previous = (await client.query(
    `SELECT used_percent
     FROM database_capacity_snapshots
     WHERE id <> $1
     ORDER BY captured_at DESC, id DESC
     LIMIT 1`,
    [snapshot.id]
  )).rows[0];
  const previousPercent = previous ? Number(previous.used_percent) : 0;
  const crossedThresholds = [60, 75, 90].filter(
    (threshold) => previousPercent < threshold && currentPercent >= threshold
  );
  const recipient = environment.CAPACITY_ALERT_EMAIL || 'admin@nevely.app';
  const sender = environment.RESEND_FROM || 'Verify <noreply@notifications.nevely.app>';

  for (const threshold of crossedThresholds) {
    const subject = `Nevely PostgreSQL capacity reached ${threshold}%`;
    const body = [
      `The Nevely PostgreSQL database crossed the ${threshold}% capacity threshold.`,
      `Current logical database usage: ${currentPercent.toFixed(2)}%.`,
      'Open the Railway production environment and follow the N2 database capacity runbook.'
    ].join('\n');
    await client.query(
      `INSERT INTO email_outbox
         (purpose, idempotency_key, recipient, sender, subject, text_body, html_body)
       VALUES (
         'database_capacity',
         $1,
         $2,
         $3,
         $4,
         $5,
         $6
       )
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        `database-capacity:${threshold}:${snapshot.id}`,
        recipient,
        sender,
        subject,
        body,
        `<p>The Nevely PostgreSQL database crossed the <strong>${threshold}%</strong> capacity threshold.</p>`
          + `<p>Current logical database usage: <strong>${currentPercent.toFixed(2)}%</strong>.</p>`
          + '<p>Open the Railway production environment and follow the N2 database capacity runbook.</p>'
      ]
    );
  }
  return crossedThresholds;
}

function createRetentionWorker({
  db,
  environment = process.env,
  log = safeLog
}) {
  const config = workerConfig(environment);
  let timer = null;
  let running = null;
  let stopped = false;

  async function execute() {
    if (!db.isConfigured) return { skipped: 'database_not_configured' };
    const client = await db.getClient();
    let lockAcquired = false;
    let runId = null;
    const startedAt = Date.now();
    try {
      const lock = await client.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [RETENTION_LOCK_ID]
      );
      lockAcquired = Boolean(lock.rows[0]?.acquired);
      if (!lockAcquired) return { skipped: 'worker_lock_held' };

      runId = Number((await client.query(
        `INSERT INTO retention_runs (status) VALUES ('running') RETURNING id`
      )).rows[0].id);

      const deletedCounts = await drainConversationPolicy(client, config);
      addCounts(
        deletedCounts,
        await drainBoundedPolicies(
          client,
          config.batchSize,
          config.maxBatchesPerPolicy
        )
      );
      let capacity;
      let capacityAlerts;
      await client.query('BEGIN');
      try {
        capacity = await collectDatabaseCapacity(client, config.databaseBudgetBytes);
        capacityAlerts = await queueCapacityAlerts(client, capacity, environment);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      const durationMs = Date.now() - startedAt;
      await client.query(
        `UPDATE retention_runs
         SET status = 'completed', finished_at = NOW(), duration_ms = $2,
             deleted_counts = $3::jsonb
         WHERE id = $1`,
        [runId, durationMs, JSON.stringify(deletedCounts)]
      );
      log.info('retention.completed');
      if (capacity.threshold_percent) {
        log.warn(`database.capacity.threshold_${capacity.threshold_percent}`);
      }
      return { runId, deletedCounts, capacity, capacityAlerts, durationMs };
    } catch (error) {
      if (runId) {
        await client.query(
          `UPDATE retention_runs
           SET status = 'failed', finished_at = NOW(), duration_ms = $2,
               error_code = $3
           WHERE id = $1`,
          [
            runId,
            Date.now() - startedAt,
            typeof error.code === 'string' ? error.code.slice(0, 80) : 'RETENTION_FAILED'
          ]
        ).catch(() => {});
      }
      log.error('retention.failed', error);
      throw error;
    } finally {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1)', [RETENTION_LOCK_ID]).catch(() => {});
      }
      client.release();
    }
  }

  async function runOnce() {
    if (running) return running;
    running = execute().finally(() => {
      running = null;
    });
    return running;
  }

  function schedule(delay) {
    if (stopped || !config.enabled || !db.isConfigured) return;
    timer = setTimeout(() => {
      timer = null;
      void runOnce()
        .catch(() => {})
        .finally(() => schedule(config.intervalMs));
    }, delay);
    timer.unref?.();
  }

  return {
    config,
    runOnce,
    start() {
      stopped = false;
      if (!timer && !running) schedule(config.initialDelayMs);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running?.catch(() => {});
    }
  };
}

module.exports = {
  DATABASE_BUDGET_BYTES,
  collectDatabaseCapacity,
  createRetentionWorker,
  queueCapacityAlerts,
  workerConfig
};
