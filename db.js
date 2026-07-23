const { Pool } = require('pg');
const safeLog = require('./lib/safe-log');

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

if (pool) {
  pool.on('error', (error) => {
    safeLog.error('database.pool_error', error);
  });
} else {
  safeLog.warn('database.not_configured');
}

function ensurePool() {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }

  return pool;
}

module.exports = {
  isConfigured: Boolean(pool),
  pool,
  ensurePool,

  query(text, params) {
    return ensurePool().query(text, params);
  },

  getClient() {
    return ensurePool().connect();
  },

  async close() {
    if (pool) await pool.end();
  }
};
