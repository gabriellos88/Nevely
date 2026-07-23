import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import safeLog from '../lib/safe-log.js';

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredTables = [
  'users',
  'reports',
  'session',
  'friendships',
  'friend_requests',
  'chat_requests',
  'conversations',
  'conversation_participants',
  'messages',
  'saved_chats',
  'notifications',
  'blocked_users',
  'bans',
  'plan_price_history',
  'message_receipts',
  'schema_migrations'
];

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

function databaseTarget(rawUrl) {
  const parsed = new URL(rawUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol), 'Recovery URLs must use PostgreSQL');
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}${parsed.pathname}`;
}

async function verifyRecovery() {
  assert.equal(
    required('RECOVERY_DRILL_ACK'),
    'isolated-non-production-target',
    'RECOVERY_DRILL_ACK must confirm an isolated target'
  );

  const sourceUrl = required('DATABASE_URL');
  const recoveryUrl = required('RECOVERY_DATABASE_URL');
  assert.notEqual(
    databaseTarget(sourceUrl),
    databaseTarget(recoveryUrl),
    'Recovery verification refuses to run against the source database target'
  );

  const client = new Client({
    connectionString: recoveryUrl,
    ssl: process.env.RECOVERY_PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    application_name: 'nevely-recovery-verifier'
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '5s'`);

    const migrationFiles = (await readdir(path.join(root, 'database', 'migrations')))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();
    const appliedMigrations = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    assert.deepEqual(
      appliedMigrations.rows.map((row) => row.filename),
      migrationFiles,
      'The restored database does not contain the exact migration set'
    );

    for (const table of requiredTables) {
      const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${table}`]);
      assert.ok(result.rows[0]?.relation, `Missing required table: ${table}`);
    }

    const orphanChecks = [
      {
        name: 'messages_without_conversation',
        sql: `SELECT EXISTS (
          SELECT 1 FROM messages child
          LEFT JOIN conversations parent ON parent.id = child.conversation_id
          WHERE parent.id IS NULL
          LIMIT 1
        ) AS found`
      },
      {
        name: 'participants_without_conversation',
        sql: `SELECT EXISTS (
          SELECT 1 FROM conversation_participants child
          LEFT JOIN conversations parent ON parent.id = child.conversation_id
          WHERE parent.id IS NULL
          LIMIT 1
        ) AS found`
      },
      {
        name: 'saved_chats_without_owner_or_conversation',
        sql: `SELECT EXISTS (
          SELECT 1 FROM saved_chats child
          LEFT JOIN users owner ON owner.id = child.user_id
          LEFT JOIN conversations conversation ON conversation.id = child.conversation_id
          WHERE owner.id IS NULL OR conversation.id IS NULL
          LIMIT 1
        ) AS found`
      },
      {
        name: 'receipts_without_message_or_user',
        sql: `SELECT EXISTS (
          SELECT 1 FROM message_receipts child
          LEFT JOIN messages message ON message.id = child.message_id
          LEFT JOIN users recipient ON recipient.id = child.user_id
          WHERE message.id IS NULL OR recipient.id IS NULL
          LIMIT 1
        ) AS found`
      }
    ];

    for (const check of orphanChecks) {
      const result = await client.query(check.sql);
      assert.equal(result.rows[0]?.found, false, `Integrity check failed: ${check.name}`);
    }

    await client.query('COMMIT');
    console.log(
      `Recovery verification passed: ${migrationFiles.length} migrations, `
      + `${requiredTables.length} tables and ${orphanChecks.length} integrity checks.`
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

verifyRecovery().catch((error) => {
  safeLog.error('recovery.verification_failed', error);
  process.exitCode = 1;
});
