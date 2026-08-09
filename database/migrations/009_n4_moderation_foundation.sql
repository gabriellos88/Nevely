-- N4 moderation records are deliberately separate from the legacy bans table.
-- Network identifiers are HMAC fingerprints, never raw IP addresses.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT,
  target_user_id BIGINT,
  target_guest_id UUID,
  target_type VARCHAR(40) NOT NULL,
  action VARCHAR(100) NOT NULL,
  reason TEXT,
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(target_user_id, target_guest_id) <= 1),
  CHECK (jsonb_typeof(before_state) = 'object'),
  CHECK (jsonb_typeof(after_state) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_log_created_cursor_idx
  ON audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_user_idx
  ON audit_log (target_user_id, created_at DESC, id DESC)
  WHERE target_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TABLE IF NOT EXISTS account_bans (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type VARCHAR(20) NOT NULL,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (type IN ('temporary', 'permanent')),
  CHECK ((type = 'permanent' AND ends_at IS NULL) OR (type = 'temporary' AND ends_at > starts_at)),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
         OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS account_bans_active_lookup_idx
  ON account_bans (user_id, starts_at DESC, ends_at, id DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS network_bans (
  id BIGSERIAL PRIMARY KEY,
  network_fingerprint CHAR(64) NOT NULL,
  address_family SMALLINT NOT NULL,
  prefix_length SMALLINT NOT NULL,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  privacy_reviewed_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  privacy_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  privacy_review_reference VARCHAR(160) NOT NULL,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (address_family IN (4, 6)),
  CHECK ((address_family = 4 AND prefix_length BETWEEN 0 AND 32)
         OR (address_family = 6 AND prefix_length BETWEEN 0 AND 128)),
  CHECK ((address_family = 4 AND prefix_length >= 24)
         OR (address_family = 6 AND prefix_length >= 64)),
  CHECK (ends_at > starts_at),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
         OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS network_bans_active_lookup_idx
  ON network_bans (network_fingerprint, starts_at DESC, ends_at, id DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS moderation_appeals (
  id BIGSERIAL PRIMARY KEY,
  account_ban_id BIGINT REFERENCES account_bans(id) ON DELETE CASCADE,
  network_ban_id BIGINT REFERENCES network_bans(id) ON DELETE CASCADE,
  appellant_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  appeal_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(account_ban_id, network_ban_id) = 1),
  CHECK (status IN ('pending', 'accepted', 'rejected')),
  CHECK ((status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
         OR (status IN ('accepted', 'rejected') AND reviewed_by IS NOT NULL
             AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS moderation_rate_windows (
  principal_type VARCHAR(12) NOT NULL,
  principal_id TEXT NOT NULL,
  action VARCHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  escalation_level SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_type, principal_id, action),
  CHECK (principal_type IN ('user', 'guest')),
  CHECK (request_count >= 0),
  CHECK (escalation_level >= 0),
  CHECK (expires_at > window_started_at)
);

CREATE INDEX IF NOT EXISTS moderation_rate_windows_expiry_idx
  ON moderation_rate_windows (expires_at);

CREATE TABLE IF NOT EXISTS report_evidence_access_log (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS report_evidence_access_log_report_idx
  ON report_evidence_access_log (report_id, created_at DESC, id DESC);
