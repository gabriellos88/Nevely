ALTER TABLE chat_requests
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(28),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE chat_requests
SET public_id = 'crq_' || encode(gen_random_bytes(12), 'hex'),
    expires_at = COALESCE(expires_at, created_at + INTERVAL '15 minutes')
WHERE public_id IS NULL OR expires_at IS NULL;

ALTER TABLE chat_requests
  DROP CONSTRAINT IF EXISTS chat_requests_status_check;
ALTER TABLE chat_requests
  ADD CONSTRAINT chat_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired'));

UPDATE chat_requests
SET status = 'expired', responded_at = COALESCE(responded_at, expires_at)
WHERE status = 'pending' AND expires_at <= NOW();

ALTER TABLE chat_requests
  ALTER COLUMN public_id SET DEFAULT ('crq_' || encode(gen_random_bytes(12), 'hex')),
  ALTER COLUMN public_id SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '15 minutes'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chat_requests_public_id_unique
  ON chat_requests(public_id);

ALTER TABLE chat_requests
  DROP CONSTRAINT IF EXISTS chat_requests_public_id_format_check;
ALTER TABLE chat_requests
  ADD CONSTRAINT chat_requests_public_id_format_check
  CHECK (public_id ~ '^crq_[0-9a-f]{24}$');

ALTER TABLE chat_requests
  DROP CONSTRAINT IF EXISTS chat_requests_expiry_check;
ALTER TABLE chat_requests
  ADD CONSTRAINT chat_requests_expiry_check
  CHECK (expires_at > created_at);

CREATE INDEX IF NOT EXISTS chat_requests_pair_status_expiry_idx
  ON chat_requests (
    LEAST(sender_user_id, receiver_user_id),
    GREATEST(sender_user_id, receiver_user_id),
    status,
    expires_at
  );
