const fs = require('node:fs/promises');
const path = require('node:path');

const tables = [
  'message_receipts',
  'saved_chats',
  'messages',
  'conversation_participants',
  'conversations',
  'chat_requests',
  'friend_requests',
  'friendships',
  'notifications',
  'blocked_users',
  'reports',
  'bans',
  'plan_price_history',
  'session',
  'users'
];

async function resetDatabase(db) {
  const quoted = tables.map((table) => `"${table}"`).join(', ');
  await db.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

async function expectedMigrations() {
  const directory = path.resolve(__dirname, '..', '..', 'database', 'migrations');
  return (await fs.readdir(directory)).filter((filename) => filename.endsWith('.sql')).sort();
}

module.exports = { expectedMigrations, resetDatabase };
