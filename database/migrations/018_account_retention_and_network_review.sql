-- N4 final lifecycle: deleted registered accounts retain their canonical
-- administrative identity for exactly 30 days, then become anonymous
-- tombstones. Network privacy reviews freeze a pseudonymous scope and are
-- consumed atomically by the independent reviewer.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pii_purged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_network_seen_at TIMESTAMPTZ;

-- Older Nevely releases anonymized accounts at deletion time. Do not invent a
-- future retention window for those rows: record them as already purged.
UPDATE users
SET retention_until = deleted_at,
    pii_purged_at = deleted_at
WHERE deleted_at IS NOT NULL
  AND pii_purged_at IS NULL
  AND (username = 'deleted_' || id OR email = 'deleted_' || id || '@deleted.nevely.invalid');

-- Defensive compatibility for any historical tombstone that was marked
-- deleted without being anonymized by the old implementation.
UPDATE users
SET retention_until = deleted_at + INTERVAL '30 days'
WHERE deleted_at IS NOT NULL
  AND retention_until IS NULL
  AND pii_purged_at IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_deletion_lifecycle_check;
ALTER TABLE users ADD CONSTRAINT users_deletion_lifecycle_check CHECK (
  (deleted_at IS NULL AND retention_until IS NULL AND pii_purged_at IS NULL)
  OR
  (deleted_at IS NOT NULL AND pii_purged_at IS NULL
    AND retention_until = deleted_at + INTERVAL '30 days')
  OR
  (deleted_at IS NOT NULL AND pii_purged_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND pii_purged_at >= deleted_at
    AND retention_until <= pii_purged_at)
);

CREATE INDEX IF NOT EXISTS users_pii_purge_cursor_idx
  ON users (retention_until, id)
  WHERE deleted_at IS NOT NULL AND pii_purged_at IS NULL;

CREATE INDEX IF NOT EXISTS users_last_network_seen_idx
  ON users (last_network_seen_at DESC, id DESC)
  WHERE deleted_at IS NULL AND last_network_seen_at IS NOT NULL;

ALTER TABLE network_ban_privacy_approvals
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(12) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_account_ban_id BIGINT REFERENCES account_bans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS proposed_duration_hours INTEGER,
  ADD COLUMN IF NOT EXISTS rejected_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE network_ban_privacy_approvals
SET proposed_duration_hours = 24
WHERE proposed_duration_hours IS NULL;

ALTER TABLE network_ban_privacy_approvals
  ALTER COLUMN proposed_duration_hours SET NOT NULL;

ALTER TABLE network_ban_privacy_approvals
  DROP CONSTRAINT IF EXISTS network_ban_privacy_approvals_status_check;
DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'network_ban_privacy_approvals'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%pending%approved%'
  LOOP
    EXECUTE format('ALTER TABLE network_ban_privacy_approvals DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;
ALTER TABLE network_ban_privacy_approvals
  ADD CONSTRAINT network_ban_privacy_approvals_source_check CHECK (
    (source_type = 'account' AND source_user_id IS NOT NULL AND source_account_ban_id IS NOT NULL)
    OR (source_type = 'manual' AND source_user_id IS NULL AND source_account_ban_id IS NULL)
  ),
  ADD CONSTRAINT network_ban_privacy_approvals_duration_check
    CHECK (proposed_duration_hours BETWEEN 1 AND 720),
  ADD CONSTRAINT network_ban_privacy_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT network_ban_privacy_approvals_review_state_check CHECK (
    (status = 'pending'
      AND approved_by IS NULL AND approved_at IS NULL AND approval_reason IS NULL
      AND review_reference IS NULL AND consumed_at IS NULL AND consumed_by IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
    OR
    (status = 'approved'
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_reason IS NOT NULL
      AND review_reference IS NOT NULL
      AND ((consumed_at IS NULL AND consumed_by IS NULL)
        OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL))
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
    OR
    (status = 'rejected'
      AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL AND approval_reason IS NULL
      AND review_reference IS NULL AND consumed_at IS NULL AND consumed_by IS NULL)
  );

ALTER TABLE network_bans
  ADD COLUMN IF NOT EXISTS privacy_approval_id UUID REFERENCES network_ban_privacy_approvals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(12) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_account_ban_id BIGINT REFERENCES account_bans(id) ON DELETE RESTRICT;

ALTER TABLE network_bans DROP CONSTRAINT IF EXISTS network_bans_source_check;
ALTER TABLE network_bans ADD CONSTRAINT network_bans_source_check CHECK (
  (source_type = 'account' AND source_user_id IS NOT NULL AND source_account_ban_id IS NOT NULL)
  OR (source_type = 'manual' AND source_user_id IS NULL AND source_account_ban_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS network_bans_privacy_approval_unique
  ON network_bans (privacy_approval_id)
  WHERE privacy_approval_id IS NOT NULL;

DROP INDEX IF EXISTS network_ban_privacy_approvals_pending_idx;
CREATE INDEX network_ban_privacy_approvals_pending_idx
  ON network_ban_privacy_approvals (created_at DESC, id DESC)
  WHERE status = 'pending';
