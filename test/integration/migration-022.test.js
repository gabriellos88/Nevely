const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const migrationDirectory = path.resolve(__dirname, '..', '..', 'database', 'migrations');

test('migration 022 expands the status constraint before expiring historical chat requests', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database',
  timeout: 60_000
}, async () => {
  const db = require('../../db');
  const schema = `migration_022_${process.pid}`;
  const client = await db.getClient();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const files = (await fs.readdir(migrationDirectory))
      .filter((filename) => filename.endsWith('.sql') && filename < '022_')
      .sort();
    for (const filename of files) {
      const sql = await fs.readFile(path.join(migrationDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql.replace(/^\uFEFF/, ''));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const users = (await client.query(
      `INSERT INTO users (username, email, password_hash, public_id, display_name)
       VALUES
         ('migration_022_sender', 'migration-022-sender@example.test', 'hash',
          'nvy_022022022021', 'Sender'),
         ('migration_022_receiver', 'migration-022-receiver@example.test', 'hash',
          'nvy_022022022022', 'Receiver')
       RETURNING id, username`
    )).rows;
    const sender = users.find((user) => user.username === 'migration_022_sender');
    const receiver = users.find((user) => user.username === 'migration_022_receiver');
    const historical = (await client.query(
      `INSERT INTO chat_requests (sender_user_id, receiver_user_id, status, created_at)
       VALUES ($1, $2, 'pending', NOW() - INTERVAL '16 minutes')
       RETURNING id, created_at`,
      [sender.id, receiver.id]
    )).rows[0];
    const migration = await fs.readFile(
      path.join(migrationDirectory, '022_n5_chat_request_lifecycle.sql'),
      'utf8'
    );

    await client.query('BEGIN');
    await client.query(migration.replace(/^\uFEFF/, ''));
    await client.query('COMMIT');

    const migrated = (await client.query(
      `SELECT status, public_id, expires_at, responded_at
       FROM chat_requests WHERE id = $1`,
      [historical.id]
    )).rows[0];
    assert.equal(migrated.status, 'expired');
    assert.match(migrated.public_id, /^crq_[0-9a-f]{24}$/);
    assert.equal(
      new Date(migrated.expires_at).getTime() - new Date(historical.created_at).getTime(),
      15 * 60 * 1000
    );
    assert.equal(
      new Date(migrated.responded_at).getTime(),
      new Date(migrated.expires_at).getTime()
    );
  } finally {
    await client.query('RESET search_path').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    client.release();
  }
});
