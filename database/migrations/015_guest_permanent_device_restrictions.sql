-- A device principal is an HMAC of a server-issued, signed opaque cookie.
-- It is not an IP address and is never emitted through APIs or audit payloads.
ALTER TABLE guest_bans
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'temporary';

ALTER TABLE guest_bans
  ALTER COLUMN ends_at DROP NOT NULL;

ALTER TABLE guest_bans DROP CONSTRAINT IF EXISTS guest_bans_ends_at_check;
ALTER TABLE guest_bans DROP CONSTRAINT IF EXISTS guest_bans_type_check;
ALTER TABLE guest_bans ADD CONSTRAINT guest_bans_type_check
  CHECK (type IN ('temporary', 'permanent'));
ALTER TABLE guest_bans ADD CONSTRAINT guest_bans_duration_check
  CHECK ((type = 'temporary' AND ends_at > starts_at)
      OR (type = 'permanent' AND ends_at IS NULL));

ALTER TABLE guest_principals
  ADD COLUMN IF NOT EXISTS device_principal_fingerprint CHAR(64);

CREATE INDEX IF NOT EXISTS guest_principals_device_fingerprint_idx
  ON guest_principals(device_principal_fingerprint)
  WHERE device_principal_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS guest_device_restrictions (
  id BIGSERIAL PRIMARY KEY,
  device_principal_fingerprint CHAR(64) NOT NULL,
  guest_ban_id BIGINT NOT NULL UNIQUE REFERENCES guest_bans(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((ends_at IS NULL OR ends_at > starts_at)),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS guest_device_restrictions_active_lookup_idx
  ON guest_device_restrictions(device_principal_fingerprint, starts_at DESC, id DESC)
  WHERE revoked_at IS NULL;
