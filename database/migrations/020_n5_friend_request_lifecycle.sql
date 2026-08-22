ALTER TABLE friend_requests
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(28);

UPDATE friend_requests
SET public_id = 'frq_' || encode(gen_random_bytes(12), 'hex')
WHERE public_id IS NULL;

ALTER TABLE friend_requests
  ALTER COLUMN public_id SET DEFAULT ('frq_' || encode(gen_random_bytes(12), 'hex')),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_public_id_unique
  ON friend_requests(public_id);

ALTER TABLE friend_requests
  DROP CONSTRAINT IF EXISTS friend_requests_public_id_format_check;
ALTER TABLE friend_requests
  ADD CONSTRAINT friend_requests_public_id_format_check
  CHECK (public_id ~ '^frq_[0-9a-f]{24}$');

CREATE INDEX IF NOT EXISTS friend_requests_pair_status_idx
  ON friend_requests (
    LEAST(sender_user_id, receiver_user_id),
    GREATEST(sender_user_id, receiver_user_id),
    status,
    created_at DESC
  );
