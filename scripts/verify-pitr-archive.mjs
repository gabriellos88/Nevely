import assert from 'node:assert/strict';
import pg from 'pg';
import safeLog from '../lib/safe-log.js';

const { Client } = pg;
const maximumArchiveAgeSeconds = 300;

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

async function verifyPitrArchive() {
  assert.equal(
    required('APP_ENV'),
    'staging',
    'PITR archive verification must run from the staging application service'
  );
  assert.equal(
    required('PITR_ARCHIVE_ACK'),
    'isolated-staging-source',
    'PITR_ARCHIVE_ACK must confirm the isolated staging source'
  );

  const client = new Client({
    connectionString: required('DATABASE_URL'),
    ssl: process.env.PITR_PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    application_name: 'nevely-pitr-archive-verifier'
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '5s'`);

    const settingsResult = await client.query(`
      SELECT name, setting
      FROM pg_settings
      WHERE name = ANY($1::text[])
    `, [[
      'archive_command',
      'archive_mode',
      'archive_timeout',
      'track_commit_timestamp'
    ]]);
    const settings = Object.fromEntries(
      settingsResult.rows.map(({ name, setting }) => [name, setting])
    );

    assert.equal(settings.archive_mode, 'on', 'PostgreSQL WAL archiving is not active');
    assert.equal(
      settings.track_commit_timestamp,
      'on',
      'Commit timestamp tracking is not active'
    );
    assert.match(
      settings.archive_command ?? '',
      /pgbackrest-archive-push-wrapper\.sh/,
      'The pgBackRest archive command is not active'
    );

    const archiveTimeoutSeconds = Number.parseInt(settings.archive_timeout, 10);
    assert.ok(
      Number.isInteger(archiveTimeoutSeconds)
        && archiveTimeoutSeconds > 0
        && archiveTimeoutSeconds <= maximumArchiveAgeSeconds,
      'The archive timeout exceeds the recovery point objective'
    );

    const healthResult = await client.query(`
      SELECT
        archived_count,
        failed_count,
        last_archived_time IS NOT NULL AS has_archived,
        EXTRACT(EPOCH FROM (clock_timestamp() - last_archived_time)) AS archive_age_seconds,
        last_failed_time IS NULL
          OR last_archived_time > last_failed_time AS recovered_after_failure,
        pg_is_in_recovery() AS is_recovery
      FROM pg_stat_archiver
    `);
    const health = healthResult.rows[0];
    const archiveAgeSeconds = Number(health?.archive_age_seconds);

    assert.equal(health?.is_recovery, false, 'The source database is unexpectedly in recovery');
    assert.equal(health?.has_archived, true, 'No WAL segment has been archived');
    assert.ok(BigInt(health?.archived_count ?? 0) > 0n, 'No successful archive is recorded');
    assert.ok(
      Number.isFinite(archiveAgeSeconds)
        && archiveAgeSeconds >= -30
        && archiveAgeSeconds <= maximumArchiveAgeSeconds,
      'The most recent archived WAL is outside the recovery point objective'
    );
    assert.equal(
      health?.recovered_after_failure,
      true,
      'An archive failure has not been followed by a successful archive'
    );

    await client.query('COMMIT');
    console.log(
      'PITR archive verification passed: configuration active, recent WAL observed, '
      + 'and no unrecovered archive failure.'
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

verifyPitrArchive().catch((error) => {
  safeLog.error('pitr.archive_verification_failed', error);
  process.exitCode = 1;
});
