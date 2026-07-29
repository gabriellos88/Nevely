require('dotenv').config();

const db = require('../db');
const {
  bootstrapFirstAdministrator
} = require('../lib/admin-bootstrap');
const safeLog = require('../lib/safe-log');

async function run() {
  await bootstrapFirstAdministrator({
    db,
    environment: process.env
  });
  safeLog.info('admin.first_bootstrap_completed');
  console.log(
    'First administrator bootstrap completed. '
    + 'Remove all ADMIN_BOOTSTRAP_* variables before continuing.'
  );
}

run()
  .catch((error) => {
    safeLog.error('admin.first_bootstrap_failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close().catch(() => {});
  });
