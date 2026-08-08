const fs = require('node:fs/promises');
const path = require('node:path');

const tables = [
  'report_evidence_access_log',
  'moderation_appeals',
  'moderation_rate_windows',
  'network_bans',
  'account_bans',
  'audit_log',
  'database_capacity_snapshots',
  'retention_runs',
  'guest_account_claims',
  'guest_principals',
  'report_evidence_snapshots',
  'google_token_replays',
  'email_outbox',
  'account_tokens',
  'account_identities',
  'security_events',
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
