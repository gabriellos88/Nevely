-- Guest principals are short-lived, so their moderation restriction is always
-- temporary and is removed with the principal. The immutable audit_log retains
-- the moderation decision without retaining guest profile data.
CREATE TABLE IF NOT EXISTS guest_bans (
  id BIGSERIAL PRIMARY KEY,
  guest_id UUID NOT NULL REFERENCES guest_principals(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
         OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS guest_bans_active_lookup_idx
  ON guest_bans (guest_id, starts_at DESC, ends_at, id DESC)
  WHERE revoked_at IS NULL;
