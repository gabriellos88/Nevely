ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registration_pending_at TIMESTAMPTZ;

UPDATE users u
SET registration_pending_at = COALESCE(u.registration_pending_at, u.created_at, u.updated_at, NOW())
WHERE u.deleted_at IS NULL
  AND u.email_verified_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM account_tokens token
    WHERE token.user_id = u.id
      AND token.purpose = 'verify_email'
  );

CREATE INDEX IF NOT EXISTS users_pending_registration_cleanup_idx
  ON users(registration_pending_at, id)
  WHERE deleted_at IS NULL
    AND email_verified_at IS NULL
    AND registration_pending_at IS NOT NULL;

ALTER TABLE account_tokens
  DROP CONSTRAINT IF EXISTS account_tokens_purpose_check;

ALTER TABLE account_tokens
  ADD CONSTRAINT account_tokens_purpose_check
  CHECK (purpose IN ('verify_email', 'password_reset', 'password_setup', 'email_change'));
