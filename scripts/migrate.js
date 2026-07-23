require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const safeLog = require('../lib/safe-log');

async function migrate() {
  if (!db.isConfigured) throw new Error('DATABASE_URL is not configured.');
  const directory = path.join(__dirname, '..', 'database', 'migrations');
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const client = await db.getClient();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const filename of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
      if (applied.rowCount) {
        console.log(`skip ${filename}`);
        continue;
      }

      const sql = (await fs.readFile(path.join(directory, filename), 'utf8')).replace(/^\uFEFF/, '');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await db.pool.end();
  }
}

migrate().catch((error) => {
  safeLog.error('database.migration_failed', error);
  process.exit(1);
});
