ALTER TABLE guest_principals
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by_user_id BIGINT
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS guest_id UUID
    REFERENCES guest_principals(id) ON DELETE CASCADE,
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_single_principal;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_single_principal
  CHECK (num_nonnulls(user_id, guest_id) = 1);

CREATE INDEX IF NOT EXISTS notifications_guest_cursor_idx
  ON notifications (guest_id, created_at DESC, id DESC)
  WHERE guest_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_guest_account_claim_unique
  ON notifications (guest_id)
  WHERE guest_id IS NOT NULL AND type = 'guest_account_claim';

CREATE TABLE IF NOT EXISTS guest_account_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL UNIQUE REFERENCES guest_principals(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  CHECK (status IN ('pending', 'claimed', 'unavailable')),
  CHECK (
    (status = 'claimed' AND claimed_at IS NOT NULL)
    OR (status <> 'claimed')
  )
);

CREATE INDEX IF NOT EXISTS guest_account_claims_user_idx
  ON guest_account_claims (user_id, created_at DESC);
