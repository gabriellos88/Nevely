ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(28);

UPDATE conversations
SET public_id = 'cnv_' || encode(gen_random_bytes(12), 'hex')
WHERE public_id IS NULL;

ALTER TABLE conversations
  ALTER COLUMN public_id SET DEFAULT ('cnv_' || encode(gen_random_bytes(12), 'hex')),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_public_id_unique
  ON conversations(public_id);

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_public_id_format_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_public_id_format_check
  CHECK (public_id ~ '^cnv_[0-9a-f]{24}$');

CREATE TABLE IF NOT EXISTS conversation_history_visibility (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES guest_principals(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(user_id, guest_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_history_visibility_user_unique
  ON conversation_history_visibility(conversation_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_history_visibility_guest_unique
  ON conversation_history_visibility(conversation_id, guest_id)
  WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_history_visibility_user_lookup_idx
  ON conversation_history_visibility(user_id, hidden_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_history_visibility_guest_lookup_idx
  ON conversation_history_visibility(guest_id, hidden_at DESC)
  WHERE guest_id IS NOT NULL;
