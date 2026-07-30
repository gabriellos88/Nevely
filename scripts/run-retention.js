require('dotenv').config();

const db = require('../db');
const { createRetentionWorker } = require('../lib/retention');
const safeLog = require('../lib/safe-log');

async function main() {
  if (!db.isConfigured) throw new Error('DATABASE_URL is not configured.');
  const worker = createRetentionWorker({
    db,
    environment: {
      ...process.env,
      RETENTION_WORKER_ENABLED: 'false'
    },
    log: safeLog
  });
  const result = await worker.runOnce();
  if (result.skipped) {
    console.log(JSON.stringify({ status: 'skipped', reason: result.skipped }));
    return;
  }
  console.log(JSON.stringify({
    status: 'completed',
    runId: result.runId,
    durationMs: result.durationMs,
    deletedCounts: result.deletedCounts,
    capacity: {
      databaseBytes: Number(result.capacity.database_bytes),
      budgetBytes: Number(result.capacity.budget_bytes),
      usedPercent: Number(result.capacity.used_percent),
      thresholdPercent: result.capacity.threshold_percent
        ? Number(result.capacity.threshold_percent)
        : null
    }
  }));
}

main()
  .catch((error) => {
    safeLog.error('retention.command_failed', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
