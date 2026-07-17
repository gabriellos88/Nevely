const { Pool } = require('pg');

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
    console.error('Unexpected PostgreSQL error:', error);
  });
} else {
  console.warn('DATABASE_URL is not configured. PostgreSQL features are disabled.');
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
  }
};
