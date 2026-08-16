const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  cursorPage,
  decodeCursor,
  decodeUuidCursor,
  encodeCursor,
  encodeUuidCursor,
  messagePage,
  pageSize,
  uuidCursorPage
} = require('../../lib/pagination');
const {
  DATABASE_BUDGET_BYTES,
  collectDatabaseCapacity,
  queueCapacityAlerts,
  workerConfig
} = require('../../lib/retention');

test('page sizes and cursors are bounded, stable and reject malformed input', () => {
  assert.equal(pageSize(undefined), 30);
  assert.equal(pageSize('0'), 30);
  assert.equal(pageSize('12'), 12);
  assert.equal(pageSize('1000'), 100);

  const row = { id: 42, created_at: '2026-07-30T10:00:00.000Z' };
  const cursor = encodeCursor(row);
  assert.deepEqual(decodeCursor(cursor), {
    createdAt: '2026-07-30T10:00:00.000Z',
    id: 42
  });
  assert.equal(decodeCursor('not-a-cursor'), null);
  assert.equal(decodeCursor('x'.repeat(257)), null);

  const paged = cursorPage([
    row,
    { id: 41, created_at: '2026-07-30T09:00:00.000Z' }
  ], 1);
  assert.equal(paged.items.length, 1);
  assert.equal(paged.page.hasMore, true);
  assert.deepEqual(decodeCursor(paged.page.nextCursor), {
    createdAt: '2026-07-30T10:00:00.000Z',
    id: 42
  });

  const uuidRow = {
    id: 'b079ed5c-b2d8-49d4-9df3-169264d25e47',
    created_at: '2026-07-30T08:00:00.000Z'
  };
  const uuidCursor = encodeUuidCursor(uuidRow);
  assert.deepEqual(decodeUuidCursor(uuidCursor), {
    createdAt: '2026-07-30T08:00:00.000Z',
    id: uuidRow.id
  });
  assert.equal(decodeUuidCursor(cursor), null);
  const uuidPaged = uuidCursorPage([
    uuidRow,
    {
      id: 'aa832b4a-331d-4fe6-a05a-20810359c190',
      created_at: '2026-07-30T07:00:00.000Z'
    }
  ], 1);
  assert.equal(uuidPaged.items.length, 1);
  assert.equal(uuidPaged.page.hasMore, true);
  assert.deepEqual(decodeUuidCursor(uuidPaged.page.nextCursor), {
    createdAt: '2026-07-30T08:00:00.000Z',
    id: uuidRow.id
  });
});

test('message pages return chronological items and an older-message cursor', () => {
  const paged = messagePage([
    { id: 'msg_000000000000000000000005' },
    { id: 'msg_000000000000000000000004' },
    { id: 'msg_000000000000000000000003' }
  ], 2);
  assert.deepEqual(paged.items.map((item) => item.id), [
    'msg_000000000000000000000004',
    'msg_000000000000000000000005'
  ]);
  assert.deepEqual(paged.page, {
    limit: 2,
    hasMore: true,
    nextBeforeMessageId: 'msg_000000000000000000000004'
  });
});

test('retention defaults encode the approved seven-day, bounded policy controls', () => {
  const defaults = workerConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.batchSize, 500);
  assert.equal(defaults.maxBatchesPerPolicy, 20);
  assert.equal(defaults.maxUnsavedPerUser, 50);
  assert.equal(defaults.databaseBudgetBytes, DATABASE_BUDGET_BYTES);
  assert.equal(workerConfig({ NODE_ENV: 'test' }).enabled, false);

  const bounded = workerConfig({
    RETENTION_BATCH_SIZE: '999999',
    RETENTION_MAX_BATCHES_PER_POLICY: '0',
    RETENTION_MAX_UNSAVED_PER_USER: '2',
    RETENTION_INTERVAL_MS: '1'
  });
  assert.equal(bounded.batchSize, 5000);
  assert.equal(bounded.maxBatchesPerPolicy, 1);
  assert.equal(bounded.maxUnsavedPerUser, 10);
  assert.equal(bounded.intervalMs, 60000);
});

test('capacity collection records only aggregate relation data and threshold state', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('pg_database_size')) {
        return {
          rows: [{
            database_bytes: 4_100,
            table_bytes: 3_000,
            index_bytes: 1_000
          }]
        };
      }
      if (sql.includes('ORDER BY pg_total_relation_size')) {
        return {
          rows: [{
            relation: 'messages',
            total_bytes: 3000,
            table_bytes: 2200,
            index_bytes: 800
          }]
        };
      }
      if (sql.includes('INSERT INTO database_capacity_snapshots')) {
        return {
          rows: [{
            database_bytes: params[0],
            table_bytes: params[1],
            index_bytes: params[2],
            budget_bytes: params[3],
            used_percent: params[4],
            threshold_percent: params[5],
            largest_relations: JSON.parse(params[6])
          }]
        };
      }
      throw new Error('Unexpected capacity query');
    }
  };

  const snapshot = await collectDatabaseCapacity(client, 5_000);
  assert.equal(snapshot.used_percent, 82);
  assert.equal(snapshot.threshold_percent, 75);
  assert.deepEqual(snapshot.largest_relations.map((item) => item.relation), ['messages']);
  assert.equal(JSON.stringify(calls).includes('body'), false);
});

test('capacity alerts are queued once for every newly crossed threshold', async () => {
  const inserts = [];
  const client = {
    async query(sql, params) {
      if (sql.includes('FROM database_capacity_snapshots')) {
        return { rows: [{ used_percent: 59 }] };
      }
      if (sql.includes('INSERT INTO email_outbox')) {
        inserts.push(params);
        return { rowCount: 1, rows: [] };
      }
      throw new Error('Unexpected capacity alert query');
    }
  };
  const thresholds = await queueCapacityAlerts(client, {
    id: 99,
    used_percent: 91
  }, {
    EMAIL_DELIVERY_MODE: 'live',
    CAPACITY_ALERT_EMAIL: 'admin@example.test',
    RESEND_FROM: 'Verify <noreply@notifications.nevely.app>'
  });
  assert.deepEqual(thresholds, [60, 75, 90]);
  assert.equal(inserts.length, 3);
  assert.equal(inserts.every((params) => params[1] === 'admin@example.test'), true);
  assert.equal(JSON.stringify(inserts).includes('DATABASE_URL'), false);
});
