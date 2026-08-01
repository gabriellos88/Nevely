# Database retention, capacity and query bounds

This runbook is the implementation and operations source of truth for roadmap
phase N2. It deliberately separates ordinary chat content from moderation,
identity and security records.

## Approved retention matrix

| Data | Retention rule | Deletion behavior |
|---|---|---|
| Unsaved conversations | 7 days from `last_activity_at` | Hard-delete in bounded batches after the conversation ends. Messages, receipts and participants cascade with the conversation. |
| Unsaved conversations with messages | At most 50 per registered user, newest activity first | Hard-delete the oldest unsaved conversations above the limit, even if they are younger than 7 days. The default is configurable with `RETENTION_MAX_UNSAVED_PER_USER`. |
| Saved conversations | 12 months from `last_activity_at` | Hard-delete the conversation and every `saved_chats` reference. Opening or reading a chat does not silently extend retention. |
| User-deleted conversations | 24-hour operational grace | Hard-delete after the grace period. |
| Report evidence | 24 months from report submission | The last 50 non-deleted messages are copied into `report_evidence_snapshots` at submission. The snapshot can be deleted only when its policy expires and cannot be updated. Ordinary chat deletion keeps the snapshot. |
| Reports | Pending reports remain until review; reviewed reports remain until `retention_until` (24 months by default) | Reviewed report metadata and its evidence are deleted together. |
| Notifications | 30 days after being read, otherwise no more than 90 days | Hard-delete in batches. |
| Sessions | Cookie lifetime is 14 days; expired rows are removed | Only rows whose `expire` is in the past are deleted. |
| Friend and chat requests | Pending: 90 days. Accepted, declined or cancelled: 30 days after response | Hard-delete in batches. |
| Account tokens and final email outbox rows | 30 days after use, revocation, expiry, send or terminal failure | Hard-delete in batches. Pending delivery work is not removed. |
| Google replay guards | Until token expiry | Hard-delete after expiry. |
| Temporary bans | 24 months after the ban ended | Permanent and network bans do not inherit chat retention and are kept. |
| Security/audit events | 24 months | Hard-delete in batches. This policy is independent of chat deletion. |
| Active accounts and anonymized account tombstones | Not deleted by the retention worker | Account lifecycle remains an explicit identity operation. |
| Friendships and blocks | Until a user removes them or an account lifecycle action applies | They are not aged out as chat content. |
| Guest passport | Stored in the server session today, so it follows session expiry | The persistent guest table and its own cursor/retention metadata belong to N3.1. |
| Capacity samples | 400 days | Old aggregate samples are deleted in batches. |
| Retention run records | 90 days | Old aggregate run records are deleted in batches. |

`last_activity_at` advances when a conversation starts, receives a message or
ends. Saving, reading and merely opening history do not reset it.

## Worker controls

The application starts one embedded worker after a 30-second deployment delay.
A PostgreSQL advisory lock makes only one replica perform retention at a time.
Every statement handles at most `RETENTION_BATCH_SIZE` rows, and a policy can
run at most `RETENTION_MAX_BATCHES_PER_POLICY` batches per cycle. The default
cycle is six hours.

The defaults are:

```text
RETENTION_WORKER_ENABLED=true
RETENTION_INTERVAL_MS=21600000
RETENTION_BATCH_SIZE=500
RETENTION_MAX_BATCHES_PER_POLICY=20
RETENTION_MAX_UNSAVED_PER_USER=50
DATABASE_BUDGET_BYTES=5368709120
CAPACITY_ALERT_EMAIL=admin@nevely.app
```

Only `CAPACITY_ALERT_EMAIL` must be added to deployed environments. The other
values are safe application defaults and should be overridden only after a
reviewed capacity incident.

Add the required variable without exposing any database secret:

1. Open the Railway project and select the `staging` environment.
2. Select the Nevely application service, not the Postgres service.
3. Open **Variables** and choose **New Variable**.
4. Enter `CAPACITY_ALERT_EMAIL` as the name and `admin@nevely.app` as the value.
5. Add the variable, review the staged change and choose **Deploy**.
6. Repeat the same steps in `production`.
7. After deployment, confirm `npm run check:env:staging` or
   `npm run check:env:production` passes in the matching environment.

Each run writes status, duration and aggregate deleted-row counts to
`retention_runs`. It never copies chat content or user identifiers into the
run record or logs. Failures emit `retention.failed`; success emits
`retention.completed`.

Run one cycle manually:

```powershell
npm.cmd run retention:run
```

Emergency stop:

1. Set `RETENTION_WORKER_ENABLED=false` on the application service.
2. Review and deploy the staged Railway change.
3. Confirm no new `retention_runs` row appears after the current cycle.
4. Investigate before re-enabling. A hard deletion cannot be undone in place;
   use the documented PITR procedure if content was deleted incorrectly.

The migration is additive. Disabling the worker is the application rollback;
do not remove N2 columns, evidence or indexes during an incident.

## Capacity monitoring and alerts

Every retention cycle stores:

- total logical database bytes;
- table and index bytes;
- the ten largest public relations;
- percent of the 5 GiB budget;
- the highest reached threshold: 60%, 75% or 90%.

Crossing a threshold queues one operational email per crossing through the
existing Resend outbox. A later drop below a threshold allows a future crossing
to alert again. Staging keeps using the fixed Resend test recipient.

Inspect the current aggregate state:

```powershell
npm.cmd run db:capacity
```

Administrators can also read the last 30 samples and worker runs from
`GET /api/admin/database-capacity`.

Railway also exposes disk usage for the Postgres service. Its Observability
dashboard is environment-scoped, and configurable monitors can send email,
in-app notifications or webhooks. Railway currently documents custom monitors
as a Pro feature:

1. Open the Nevely project and select the `staging` environment.
2. Open **Observability** from the project top bar.
3. Choose **Add new item** and add a Disk Usage widget for the Postgres service.
4. Save the dashboard.
5. Open the widget's three-dot menu, choose **Add monitor**, select an
   above-threshold condition and create monitors at the 5 GiB budget
   equivalents: 3.0 GiB (60%), 3.75 GiB (75%) and 4.5 GiB (90%). If the
   widget displays bytes or another unit, enter the same values converted to
   that displayed unit.
6. Repeat in `production`; do not reuse a staging-scoped widget.
7. In account settings, confirm email and in-app alert notifications are on.
8. If a webhook is desired, open project **Settings → Webhooks**, add the
   receiver, restrict the event selection where possible, save it, then use
   **Test Webhook**.

If **Add monitor** is unavailable on the current plan, the application-level
Resend alerts remain mandatory. Railway's official references are
[Observability Dashboard](https://docs.railway.com/observability),
[Metrics](https://docs.railway.com/observability/metrics),
[Webhooks](https://docs.railway.com/observability/webhooks) and
[Variables](https://docs.railway.com/variables).

### Capacity response

- **60%:** verify the latest retention run, inspect the largest relations and
  the recent growth slope.
- **75%:** run retention once, confirm autovacuum progress, stop unexpected
  writers and prepare a volume/database capacity increase.
- **90%:** treat as an incident. Pause nonessential writes, keep the retention
  worker enabled unless it is failing, increase capacity, and prepare PITR
  recovery before any manual destructive SQL.

Autovacuum/bloat check:

```sql
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC, relname;
```

Dead tuples are expected briefly after batch deletion. Escalate when
`n_dead_tup` continues to grow across multiple cycles and `last_autovacuum`
does not advance. Never run `VACUUM FULL` during normal operation; it takes an
exclusive table lock.

## Pagination contract

All existing growing collections use a default page size of 30 and a hard
maximum of 100.

| Collection | Request cursor | Response |
|---|---|---|
| Conversations | `cursor` for `(created_at, id)` | `page.nextCursor` |
| Messages | `beforeMessageId` | `page.nextBeforeMessageId` |
| Friends, friend requests, chat requests, notifications and blocks | `cursor` for `(created_at, id)` | `page.nextCursor` |
| Admin users, reports and bans | `cursor` for `(created_at, id)` | `page.nextCursor` |

The cursor is an opaque API value. Invalid values return HTTP 400. Saved chats
remain inherently bounded to 2 for free accounts and 10 for premium accounts.
There is no persistent guest collection until N3.1; the in-session guest
passport therefore cannot be paginated yet.

The first page remains backward-compatible with the existing UI. Count fields
such as `unreadCount` and `pendingCount` are computed across the complete
collection rather than only the visible page.

## Query plans and load test

The N2 migration adds indexes for case-insensitive account lookup, every
cursor, conversation retention, messages, active bans and the report queue.

Run representative read-only plans:

```powershell
npm.cmd run db:explain:n2
```

Run the rollback-only synthetic message load test in staging:

```powershell
$env:APP_ENV='staging'
$env:N2_LOAD_TEST_CONFIRM='ROLLBACK_SYNTHETIC_DATA'
npm.cmd run test:n2-load
Remove-Item Env:N2_LOAD_TEST_CONFIRM
```

The load test defaults to 100 conversations and 10,000 messages, reports row
bytes and execution times, and rolls the transaction back. It refuses to run
with `APP_ENV=production`. Optional bounded controls are
`N2_LOAD_TEST_CONVERSATIONS` and
`N2_LOAD_TEST_MESSAGES_PER_CONVERSATION`.

Record staging output after the first N2 deployment. Investigate an unexpected
sequential scan only after using representative row counts; PostgreSQL may
correctly prefer a sequential scan on a tiny disposable database.

## Staging acceptance — 2026-07-30

Railway deployed `codex/n2-database-retention` at commit
`94bc650358d9f5099ab8fa7d3f37c1805a9b8a83` after the GitHub Actions migration
and test job passed. Deployment `83574d7d-b7fc-4939-92c4-0f5728903087`
successfully applied `005_retention_capacity_and_query_bounds.sql`, emitted
`server.listening`, returned HTTP 200 from both `/health/live` and
`/health/ready`, and completed the first worker cycle with
`retention.completed`.

The rollback-only load test ran against the staging database through its
existing Railway TCP proxy:

```json
{"rolledBack":true,"conversations":100,"messages":10000,"messageRowBytes":3280000,"durationMs":1425,"messageQueryExecutionMs":0.121,"retentionQueryExecutionMs":0.075}
```

The post-test readiness check still returned HTTP 200. The capacity snapshot
reported 10,876,607 database bytes, 376,832 table bytes and 1,810,432 index
bytes: 0.2% of the 5 GiB budget, below all alert thresholds.

Representative `EXPLAIN (ANALYZE, BUFFERS)` execution times were 0.047 ms for
case-insensitive user prefix search, 0.035 ms for both the conversation cursor
and message cursor, 0.031 ms for active bans and 0.019 ms for the pending report
cursor. The active-ban and pending-report queries used
`bans_user_active_lookup_idx` and `reports_status_cursor_idx`; PostgreSQL chose
small-table plans for the other three queries, as expected for the current
staging row counts.

The Railway staging Observability dashboard now includes the primary
`postgres-volume-RYjl` in the existing **Staging Postgres volumes** Disk Usage
widget while preserving the recovery-drill volume. Application sampling and
email alerts remain the source of truth for the 60%, 75% and 90% thresholds.
