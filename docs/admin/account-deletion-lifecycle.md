# Registered-account deletion lifecycle

Registered account deletion is irreversible and has two database states. It is
not a recovery window and Support must not promise restoration.

## Delete and retain

Self-delete and admin-delete call `deleteAccountLifecycle`. In one transaction
the service locks the account, sets `deleted_at = NOW()` and
`retention_until = deleted_at + INTERVAL '30 days'`, removes product-only
relationships, revokes tokens and all sessions, and appends a minimized audit
event. After commit the moderation control channel force-disconnects sockets on
every replica. Login, Google login, chat and application APIs reject the row.

For 30 days the canonical `nvy_...`, username and email remain reserved.
Admin Details may show the retained display/profile fields and lifecycle
timestamps; the Users table does not return retained email. The internal
primary key is unchanged and remains the only relational key.

## Purge and tombstone

The retention worker selects due rows by `(retention_until, id)` with `FOR
UPDATE SKIP LOCKED`. It skips active permanent bans. In one transaction it:

- deletes credentials, tokens, queued account email and Google identities;
- clears profile, demographic, network and administrator-authentication data;
- replaces username/email/display name with synthetic values;
- rotates the canonical Public ID and clears legacy resolution;
- sets `pii_purged_at` and appends `account_pii_purged` without copied PII.

It does not null the account key from messages, reports, bans or audit. A second
run is a no-op. Historical `deleted_<id>` accounts migrated by 018 are marked
already purged at their original `deleted_at`; no future retention is invented.

## Rollout and rollback

Apply migration 018 transactionally and run the real PostgreSQL migration test.
Verify the lifecycle check constraint and the partial purge cursor index. If
the migration transaction fails, rollback leaves the pre-018 schema and rows
unchanged.

After commit, rollback the application only with the retention worker disabled
and account-delete routes blocked at ingress. A pre-018 binary anonymizes
immediately and is not a safe deletion writer. Prefer a roll-forward fix. Do
not drop lifecycle columns or restore an old Public ID while new tombstones or
audit references exist.
