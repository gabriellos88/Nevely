const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const migrationDirectory = path.resolve(__dirname, '..', '..', 'database', 'migrations');

test('migration 018 rolls back transactionally and marks historical anonymized accounts as already purged', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database',
  timeout: 60_000
}, async () => {
  const db = require('../../db');
  const schema = `migration_018_${process.pid}`;
  const client = await db.getClient();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const files = (await fs.readdir(migrationDirectory))
      .filter((filename) => filename.endsWith('.sql') && filename < '018_')
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
    const historical = (await client.query(
      `INSERT INTO users
         (username, email, password_hash, public_id, display_name, deleted_at)
       VALUES ('deleted_1', 'deleted_1@deleted.nevely.invalid', NULL,
               'nvy_018018018018', 'Deleted user', NOW() - INTERVAL '60 days')
       RETURNING id, deleted_at`
    )).rows[0];
    const retained = (await client.query(
      `INSERT INTO users
         (username, email, password_hash, public_id, display_name, deleted_at)
       VALUES ('retained_legacy', 'retained-legacy@example.test', 'hash',
               'nvy_018018018019', 'Retained legacy', NOW() - INTERVAL '5 days')
       RETURNING id, deleted_at`
    )).rows[0];
    const migration = await fs.readFile(
      path.join(migrationDirectory, '018_account_retention_and_network_review.sql'),
      'utf8'
    );

    await client.query('BEGIN');
    await client.query(migration);
    const insideTransaction = (await client.query(
      `SELECT id, retention_until, pii_purged_at FROM users WHERE id = $1`,
      [historical.id]
    )).rows[0];
    assert.equal(Number(insideTransaction.id), Number(historical.id));
    assert.equal(new Date(insideTransaction.retention_until).getTime(), new Date(historical.deleted_at).getTime());
    assert.equal(new Date(insideTransaction.pii_purged_at).getTime(), new Date(historical.deleted_at).getTime());
    await client.query('ROLLBACK');
    const rolledBackColumn = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'pii_purged_at'`,
      [schema]
    );
    assert.equal(rolledBackColumn.rowCount, 0);
    assert.equal(Number((await client.query('SELECT id FROM users WHERE id = $1', [historical.id])).rows[0].id), Number(historical.id));

    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');
    const migratedHistorical = (await client.query(
      `SELECT id, retention_until, pii_purged_at FROM users WHERE id = $1`,
      [historical.id]
    )).rows[0];
    assert.equal(Number(migratedHistorical.id), Number(historical.id));
    assert.equal(new Date(migratedHistorical.retention_until).getTime(), new Date(historical.deleted_at).getTime());
    assert.equal(new Date(migratedHistorical.pii_purged_at).getTime(), new Date(historical.deleted_at).getTime());
    const migratedRetained = (await client.query(
      `SELECT id, retention_until, pii_purged_at FROM users WHERE id = $1`,
      [retained.id]
    )).rows[0];
    assert.equal(Number(migratedRetained.id), Number(retained.id));
    assert.equal(migratedRetained.pii_purged_at, null);
    assert.equal(
      new Date(migratedRetained.retention_until).getTime() - new Date(retained.deleted_at).getTime(),
      30 * 24 * 60 * 60 * 1000
    );
  } finally {
    await client.query('RESET search_path').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    client.release();
  }
});
