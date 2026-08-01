require('dotenv').config();

const db = require('../db');
const {
  DATABASE_BUDGET_BYTES,
  collectDatabaseCapacity
} = require('../lib/retention');
const safeLog = require('../lib/safe-log');

async function main() {
  if (!db.isConfigured) throw new Error('DATABASE_URL is not configured.');
  const configuredBudget = Number(process.env.DATABASE_BUDGET_BYTES);
  const budgetBytes = Number.isSafeInteger(configuredBudget) && configuredBudget > 0
    ? configuredBudget
    : DATABASE_BUDGET_BYTES;
  const client = await db.getClient();
  try {
    const snapshot = await collectDatabaseCapacity(client, budgetBytes);
    console.log(JSON.stringify({
      capturedAt: snapshot.captured_at,
      databaseBytes: Number(snapshot.database_bytes),
      tableBytes: Number(snapshot.table_bytes),
      indexBytes: Number(snapshot.index_bytes),
      budgetBytes: Number(snapshot.budget_bytes),
      usedPercent: Number(snapshot.used_percent),
      thresholdPercent: snapshot.threshold_percent
        ? Number(snapshot.threshold_percent)
        : null,
      largestRelations: snapshot.largest_relations
    }));
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    safeLog.error('database.capacity_check_failed', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
