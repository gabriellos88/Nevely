CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ALTER COLUMN public_id TYPE VARCHAR(40),
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS display_alias VARCHAR(20),
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS profile_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS admin_2fa_enabled_at TIMESTAMPTZ;

-- The old Nevely#xxxxxx value had only 24 random bits. It remains only as a
-- compact display alias; every externally addressable account receives a new
-- 80-bit opaque identifier.
UPDATE users
SET display_alias = COALESCE(display_alias, public_id),
    public_id = 'nvy_' || encode(gen_random_bytes(10), 'hex');

UPDATE users
SET birth_date = make_date(
      GREATEST(1900, EXTRACT(YEAR FROM CURRENT_DATE)::integer - age),
      1,
      1
    )
WHERE birth_date IS NULL
  AND age BETWEEN 18 AND 120;

UPDATE users
SET country_code = lower(country)
WHERE country_code IS NULL
  AND country ~ '^[A-Za-z]{2}$';

UPDATE users
SET gender = NULL
WHERE gender IS NOT NULL
  AND gender NOT IN ('male', 'female', 'non-binary', 'other', 'prefer-not-to-say');

UPDATE users
SET profile_completed_at = COALESCE(profile_completed_at, updated_at)
WHERE birth_date IS NOT NULL
  AND gender IS NOT NULL
  AND country_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_display_alias_unique
  ON users(display_alias)
  WHERE display_alias IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_email_verified_idx
  ON users(email_verified_at)
  WHERE deleted_at IS NULL;

UPDATE notifications n
SET data = (n.data - 'userId')
  || jsonb_build_object('userPublicId', u.public_id)
FROM users u
WHERE n.data ? 'userId'
  AND (n.data ->> 'userId') ~ '^[0-9]+$'
  AND u.id = (n.data ->> 'userId')::bigint;

CREATE TABLE IF NOT EXISTS account_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider),
  CHECK (provider IN ('google'))
);

CREATE INDEX IF NOT EXISTS account_identities_user_idx
  ON account_identities(user_id);

CREATE TABLE IF NOT EXISTS account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  target_email VARCHAR(255),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_ip_hash CHAR(64),
  requested_user_agent_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (purpose IN ('verify_email', 'password_reset', 'email_change')),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS account_tokens_user_purpose_idx
  ON account_tokens(user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS account_tokens_active_idx
  ON account_tokens(token_hash, purpose)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_token_id UUID REFERENCES account_tokens(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  purpose VARCHAR(40) NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  recipient VARCHAR(255) NOT NULL,
  sender VARCHAR(255) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  last_error_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'sending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS email_outbox_pending_idx
  ON email_outbox(next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS security_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_events_subject_created_idx
  ON security_events(subject_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS google_token_replays (
  token_hash CHAR(64) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS google_token_replays_expiry_idx
  ON google_token_replays(expires_at);
