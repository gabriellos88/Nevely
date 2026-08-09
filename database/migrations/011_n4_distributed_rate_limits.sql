ALTER TABLE moderation_rate_windows
  ADD COLUMN IF NOT EXISTS escalation_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'moderation_rate_windows_escalation_expiry_check'
  ) THEN
    ALTER TABLE moderation_rate_windows
      ADD CONSTRAINT moderation_rate_windows_escalation_expiry_check
      CHECK (escalation_expires_at IS NULL OR escalation_expires_at >= window_started_at);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS moderation_rate_windows_expiry_cleanup_idx
  ON moderation_rate_windows (expires_at, escalation_expires_at);
