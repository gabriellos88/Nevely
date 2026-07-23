# PostgreSQL recovery runbook

Owner: Nevely administrator

Proposed objectives before launch:

- recovery point objective (RPO): at most 5 minutes;
- recovery time objective (RTO): at most 60 minutes;
- restore verification cadence: monthly and before a high-risk migration.

These objectives are not proven until a timed drill is recorded.

## Backup policy

For the production Railway PostgreSQL service:

1. enable Railway point-in-time recovery (PITR) and wait for its first base
   backup to complete;
2. confirm the displayed recoverable time window every week;
3. enable daily and weekly native volume backups as an additional independent
   restore path;
4. take a manual backup immediately before a high-risk migration;
5. never treat application deployment rollback as database rollback.

PITR is the preferred drill path because Railway restores to a new sibling
Postgres service and does not modify the source. Native volume restore swaps
the mounted volume in the same project/environment and can remove backups
newer than the selected point, so do not use that path casually on the live
service.

## Safe PITR drill

1. Choose a target time inside the PITR window and record it in
   `recovery-drill-record.md`. Do not record user rows, messages, emails or
   connection strings.
2. In the production Postgres `Backups` tab, choose **Restore to this moment**.
   Confirm that Railway proposes a new sibling service and an empty new volume.
3. Deploy the staged restored service. Do not change the backend
   `DATABASE_URL`.
4. Give the restored service a private recovery connection variable available
   only to a one-off verification shell.
5. Run the read-only verifier:

   ```sh
   DATABASE_URL=<source target used only for inequality guard> \
   RECOVERY_DATABASE_URL=<restored sibling> \
   RECOVERY_DRILL_ACK=isolated-non-production-target \
   RECOVERY_PGSSLMODE=require \
   npm run recovery:verify
   ```

   The verifier refuses an identical source/target host and database, opens a
   read-only transaction, checks the exact migration set, required tables and
   key referential integrity. It never prints either connection value or any
   user data.
6. Deploy a temporary staging backend revision against the restored database
   and run the authenticated smoke suite with synthetic credentials only.
7. Record restore duration, verification duration, resulting RPO/RTO and any
   failure. Restore the staging backend connection afterward.
8. Keep the restored sibling until the drill record is reviewed. Then remove
   it through Railway using an explicitly verified target; do not alter the
   source service or its PITR bucket.

## Incident cutover

During a real data-loss incident:

1. stop writes by placing the application in maintenance mode;
2. record the incident time and identify the last known-good timestamp;
3. restore PITR to a sibling service;
4. run `npm run recovery:verify` and the synthetic smoke tests;
5. take a fresh snapshot of the damaged source before any repair;
6. change the backend database reference only after two-person verification of
   source and target;
7. deploy, verify readiness, then reopen traffic;
8. keep the original source read-only until the incident review is complete.

If the recovery cannot meet the RTO, keep the application unavailable rather
than accepting writes into an unverified or partially restored database.
