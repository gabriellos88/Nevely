ALTER TABLE moderation_rate_windows
  ADD COLUMN IF NOT EXISTS cooldown_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cooldown_grant_available BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE moderation_rate_windows
  DROP CONSTRAINT IF EXISTS moderation_rate_windows_principal_type_check;

ALTER TABLE moderation_rate_windows
  ADD CONSTRAINT moderation_rate_windows_principal_type_check
  CHECK (principal_type IN ('user', 'guest', 'signal'));

ALTER TABLE moderation_rate_windows
  DROP CONSTRAINT IF EXISTS moderation_rate_windows_cooldown_expiry_check;

ALTER TABLE moderation_rate_windows
  ADD CONSTRAINT moderation_rate_windows_cooldown_expiry_check
  CHECK (cooldown_expires_at IS NULL OR cooldown_expires_at >= window_started_at);

CREATE INDEX IF NOT EXISTS moderation_rate_windows_cooldown_cleanup_idx
  ON moderation_rate_windows (cooldown_expires_at)
  WHERE cooldown_expires_at IS NOT NULL;
