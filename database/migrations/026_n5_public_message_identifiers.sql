ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(28);

UPDATE messages
SET public_id = 'msg_' || encode(gen_random_bytes(12), 'hex')
WHERE public_id IS NULL;

ALTER TABLE messages
  ALTER COLUMN public_id SET DEFAULT ('msg_' || encode(gen_random_bytes(12), 'hex')),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_public_id_unique
  ON messages(public_id);

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_public_id_format_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_public_id_format_check
  CHECK (public_id ~ '^msg_[0-9a-f]{24}$');
