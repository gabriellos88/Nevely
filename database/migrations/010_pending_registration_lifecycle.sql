ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registration_pending_at TIMESTAMPTZ;

WITH ranked_verification_tokens AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC, id DESC
         ) AS token_rank
  FROM account_tokens
  WHERE purpose = 'verify_email'
    AND used_at IS NULL
    AND revoked_at IS NULL
)
UPDATE account_tokens token
SET revoked_at = NOW()
FROM ranked_verification_tokens ranked
WHERE token.id = ranked.id
  AND ranked.token_rank > 1;

UPDATE account_tokens
SET expires_at = LEAST(expires_at, created_at + INTERVAL '1 hour')
WHERE purpose = 'verify_email'
  AND used_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > created_at + INTERVAL '1 hour';

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
