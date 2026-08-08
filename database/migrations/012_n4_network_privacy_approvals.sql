CREATE TABLE IF NOT EXISTS network_ban_privacy_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  network_fingerprint TEXT NOT NULL,
  address_family SMALLINT NOT NULL,
  prefix_length SMALLINT NOT NULL,
  request_reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approved_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  approval_reason TEXT,
  review_reference VARCHAR(160),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  consumed_at TIMESTAMPTZ,
  consumed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (address_family IN (4, 6)),
  CHECK ((address_family = 4 AND prefix_length BETWEEN 24 AND 32)
         OR (address_family = 6 AND prefix_length BETWEEN 64 AND 128)),
  CHECK (status IN ('pending', 'approved')),
  CHECK (expires_at > created_at),
  CHECK ((status = 'pending' AND approved_by IS NULL AND approved_at IS NULL
          AND approval_reason IS NULL AND review_reference IS NULL
          AND consumed_at IS NULL AND consumed_by IS NULL)
         OR (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL
             AND approval_reason IS NOT NULL AND review_reference IS NOT NULL
             AND ((consumed_at IS NULL AND consumed_by IS NULL)
                  OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL))))
);

CREATE INDEX IF NOT EXISTS network_ban_privacy_approvals_pending_idx
  ON network_ban_privacy_approvals (created_at DESC, id DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS network_ban_privacy_approvals_expiry_idx
  ON network_ban_privacy_approvals (expires_at, id);
