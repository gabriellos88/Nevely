ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(28),
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

UPDATE notifications
SET public_id = 'ntf_' || encode(gen_random_bytes(12), 'hex')
WHERE public_id IS NULL;

ALTER TABLE notifications
  ALTER COLUMN public_id SET DEFAULT ('ntf_' || encode(gen_random_bytes(12), 'hex')),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_public_id_unique
  ON notifications(public_id);

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_public_id_format_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_public_id_format_check
  CHECK (public_id ~ '^ntf_[0-9a-f]{24}$');

CREATE INDEX IF NOT EXISTS notifications_user_product_cursor_idx
  ON notifications(user_id, created_at DESC, public_id DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_guest_product_cursor_idx
  ON notifications(guest_id, created_at DESC, public_id DESC)
  WHERE guest_id IS NOT NULL AND dismissed_at IS NULL;
