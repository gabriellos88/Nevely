# PostgreSQL recovery runbook

Owner: Nevely administrator

Proposed objectives before launch:

- recovery point objective (RPO): at most 5 minutes;
- recovery time objective (RTO): at most 60 minutes;
- restore verification cadence: monthly and before a high-risk migration.

These objectives are not proven until a timed drill is recorded.

## Recovery architecture

Railway-managed backups and PITR require the Pro plan. On Hobby, Nevely uses
the pgBackRest support already included in Railway's
`ghcr.io/railwayapp-templates/postgres-ssl:18` image with a private
Cloudflare R2 bucket as S3-compatible storage.

The database image:

- archives WAL continuously with a 60-second `archive_timeout`;
- takes an initial full backup after the first successful WAL archive;
- takes a differential backup every 24 hours and a full backup every 168
  hours;
- keeps four full and fourteen differential backups by default;
- restores a selected point into a separate PostgreSQL service with a new,
  empty volume;
- leaves the source database and its volume untouched.

This is self-managed PITR. Railway does not display or restore this archive
through its native Backups tab. Archive health, the pgBackRest catalog and a
real isolated restore must all be verified independently.

Primary references:

- [Railway PostgreSQL image PITR contract](https://github.com/railwayapp-templates/postgres-ssl#point-in-time-recovery-opt-in)
- [Cloudflare R2 S3 authentication](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)

## Separation and access policy

Use distinct buckets and credentials:

- `nevely-staging-pitr`: staging only;
- `nevely-production-pitr`: production only, created only after the staging
  restore drill passes.

Each source PostgreSQL service receives an R2 `Object Read & Write` token
scoped to its own bucket. A restore receives a different `Object Read only`
token scoped to the source bucket. Never reuse the staging token, bucket or
archive path in production.

Keep both buckets private. Do not attach a public development URL or custom
domain. Do not configure an R2 lifecycle or bucket lock: pgBackRest owns
catalog updates and expiry, and an independent deletion or overwrite policy
can break a recovery chain.

Store R2 keys only in sealed Railway variables. Never put them in the
repository, commands recorded as evidence, screenshots, logs or this runbook.
The bucket contains a physical database backup and therefore must be treated
as production-sensitive when the production archive is enabled.

## Source archive configuration

Configure the following variables on the PostgreSQL service, not on the
application service:

```text
WAL_ARCHIVE_BUCKET=<environment-specific-private-bucket>
WAL_ARCHIVE_ENDPOINT=<R2 endpoint hostname without https://>
WAL_ARCHIVE_REGION=auto
WAL_ARCHIVE_KEY=<bucket-scoped Access Key ID>
WAL_ARCHIVE_SECRET=<bucket-scoped Secret Access Key>
WAL_ARCHIVE_PATH=/pgbackrest
WAL_ARCHIVE_S3_URI_STYLE=path
POSTGRES_ARCHIVE_TIMEOUT=60
WAL_BACKUP_FULL_INTERVAL_HOURS=168
WAL_BACKUP_DIFF_INTERVAL_HOURS=24
WAL_BACKUP_RETENTION_FULL=4
WAL_BACKUP_RETENTION_DIFF=14
```

For an EU-jurisdiction R2 bucket, the endpoint hostname has the form
`<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. Do not include a URL scheme.

Apply the variables in staging first. A PostgreSQL redeploy is expected.
Do not enable production until the staging archive health and restore drill
pass.

## Archive acceptance

All of these checks are required:

1. PostgreSQL deployment logs show pgBackRest configuration, successful
   `stanza-create` and a completed initial full backup.
2. Run the privacy-safe database-side check from the staging application
   service:

   ```sh
   PITR_ARCHIVE_ACK=isolated-staging-source \
   npm run recovery:archive:verify
   ```

   It runs read-only, requires `APP_ENV=staging`, verifies the archive command,
   timeout, commit timestamp tracking, a WAL archived within five minutes and
   the absence of an unrecovered archive failure. It prints no connection
   data, timestamps, identifiers or database contents.
3. From the authenticated PostgreSQL service shell, inspect the bucket-side
   catalog:

   ```sh
   gosu postgres pgbackrest --stanza=main --repo=1 info --output=json
   ```

   Confirm status code `0` and at least one backup with type `full`. Do not
   paste the complete JSON into an issue or evidence file.
4. In the R2 dashboard, confirm the private bucket has objects below a
   per-cluster pgBackRest prefix and that recent write operations succeed.
   Record only pass/fail and timings, not object keys.

Any `403`, signature error, failed or stale archive, missing full backup or
catalog error blocks the restore drill and production enablement.

## Safe R2 PITR drill

1. Run the drill against staging first. Use synthetic data only and record the
   start time in `recovery-drill-record.md`.
2. From the source PostgreSQL shell, read the exact recovery source path:

   ```sh
   cat "$PGDATA/.pgbackrest_repo_path"
   ```

   Keep this value in the authenticated console. Do not record it in public
   evidence.
3. On Railway Hobby, treat the 5 GB recovery-volume limit as a hard preflight
   gate. Confirm the source data is comfortably smaller than the empty target
   volume and take a fresh full backup immediately before creating the
   synthetic recovery boundary. A small database can still exhaust the target
   volume when an old base backup requires replaying a long WAL interval.
   Never reuse a volume from a failed restore.
4. Choose a target inside the confirmed archive window. On an idle database,
   prefer a deliberately created synthetic transaction boundary and record
   its transaction ID as `POSTGRES_RECOVERY_TARGET_XID`; the image gives that
   target precedence over time and can promote exactly at the commit.
5. In Cloudflare, create a separate R2 `Object Read only` token scoped only to
   `nevely-staging-pitr`. Store its values directly in the recovery service
   variables.
6. In the Railway staging environment, create a new PostgreSQL service from
   the same `postgres-ssl:18` image and attach a brand-new empty volume at
   `/var/lib/postgresql/data`. Do not clone or mount the source volume.
7. Before a successful first boot, configure:

   ```text
   PGDATA=/var/lib/postgresql/data/pgdata
   WAL_RECOVER_FROM_BUCKET=nevely-staging-pitr
   WAL_RECOVER_FROM_ENDPOINT=<R2 endpoint hostname without https://>
   WAL_RECOVER_FROM_REGION=auto
   WAL_RECOVER_FROM_KEY=<read-only Access Key ID>
   WAL_RECOVER_FROM_SECRET=<read-only Secret Access Key>
   WAL_RECOVER_FROM_PATH=<exact source per-cluster path>
   WAL_RECOVER_FROM_S3_URI_STYLE=path
   POSTGRES_RECOVERY_TARGET_TIME=<ISO 8601 target time>
   POSTGRES_RECOVERY_TARGET_XID=<synthetic target transaction ID when used>
   ```

   Omit `WAL_ARCHIVE_*` on this temporary recovery service. It reads the
   source archive during recovery and becomes a plain, non-archiving
   PostgreSQL service after promotion.
8. Deploy and time the restore. The logs must show an empty-volume pgBackRest
   restore, WAL replay to the selected target and successful promotion. The
   source service must remain online and unchanged.
9. Give the restored service a private `RECOVERY_DATABASE_URL` reference
   available only to a one-off verification shell. Do not change the staging
   application's normal `DATABASE_URL`.
10. Run the read-only verifier:

   ```sh
   RECOVERY_DRILL_ACK=isolated-non-production-target \
   RECOVERY_PGSSLMODE=require \
   npm run recovery:verify
   ```

   The verifier refuses an identical source/target host and database, checks
   the exact migration set, required tables and key referential integrity,
   and never prints either connection value or user data.
11. Run the active staging revision as a temporary, loopback-only process or
    non-public service. If the authenticated smoke suite mutates or truncates
    tables, first clone the promoted database inside the isolated sibling and
    point only that temporary process at the clone. Keep the verified restore
    itself unchanged. Disable analytics and real email delivery, use synthetic
    credentials only, then remove the smoke clone after the suite passes.
12. Record restore duration, verification duration, resulting RPO/RTO and
    every error state observed. Remove temporary connection variables after
    the check.
13. Keep the restored sibling until the drill record is reviewed. Remove it
    only after explicitly verifying the target service and volume; never
    alter the source service or its R2 bucket.

After the staging drill passes, repeat source archive enablement with a fresh
production-only bucket and token. Confirm archive health and the initial full
backup before launch. A production-source restore drill must always restore
to an isolated sibling and must never expose the restored data through a
public application service.

## Incident cutover

During a real data-loss incident:

1. stop writes by placing the application in maintenance mode;
2. record the incident time and identify the last known-good timestamp;
3. create an isolated empty-volume PostgreSQL sibling from the production R2
   archive;
4. run `npm run recovery:verify` and private synthetic smoke tests;
5. preserve the damaged source before any repair;
6. change the backend database reference only after two-person verification
   of source and target;
7. deploy, verify readiness, then reopen traffic;
8. keep the original source read-only until the incident review is complete.

If recovery cannot meet the RTO, keep the application unavailable rather than
accepting writes into an unverified or partially restored database.
