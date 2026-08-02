ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS guest_id UUID
    REFERENCES guest_principals(id) ON DELETE SET NULL;

ALTER TABLE conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_single_principal;
ALTER TABLE conversation_participants
  ADD CONSTRAINT conversation_participants_single_principal
  CHECK (num_nonnulls(user_id, guest_id) <= 1);

CREATE INDEX IF NOT EXISTS conversation_participants_guest_conversation_idx
  ON conversation_participants (guest_id, conversation_id)
  WHERE guest_id IS NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_guest_id UUID
    REFERENCES guest_principals(id) ON DELETE SET NULL;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_single_sender_principal;
ALTER TABLE messages
  ADD CONSTRAINT messages_single_sender_principal
  CHECK (num_nonnulls(sender_user_id, sender_guest_id) <= 1);

CREATE INDEX IF NOT EXISTS messages_sender_guest_idx
  ON messages (sender_guest_id, conversation_id, id DESC)
  WHERE sender_guest_id IS NOT NULL;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS reporter_guest_id UUID
    REFERENCES guest_principals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reported_guest_id UUID
    REFERENCES guest_principals(id) ON DELETE SET NULL;

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_single_reporter_principal;
ALTER TABLE reports
  ADD CONSTRAINT reports_single_reporter_principal
  CHECK (num_nonnulls(reporter_user_id, reporter_guest_id) <= 1);

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_single_reported_principal;
ALTER TABLE reports
  ADD CONSTRAINT reports_single_reported_principal
  CHECK (num_nonnulls(reported_user_id, reported_guest_id) <= 1);

CREATE INDEX IF NOT EXISTS reports_reporter_guest_idx
  ON reports (reporter_guest_id, created_at DESC, id DESC)
  WHERE reporter_guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reports_reported_guest_idx
  ON reports (reported_guest_id, created_at DESC, id DESC)
  WHERE reported_guest_id IS NOT NULL;

ALTER TABLE saved_chats
  ADD COLUMN IF NOT EXISTS guest_id UUID
    REFERENCES guest_principals(id) ON DELETE CASCADE,
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE saved_chats
  DROP CONSTRAINT IF EXISTS saved_chats_single_owner;
ALTER TABLE saved_chats
  ADD CONSTRAINT saved_chats_single_owner
  CHECK (num_nonnulls(user_id, guest_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS saved_chats_guest_conversation_unique
  ON saved_chats (guest_id, conversation_id)
  WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS saved_chats_guest_cursor_idx
  ON saved_chats (guest_id, created_at DESC, id DESC)
  WHERE guest_id IS NOT NULL;

ALTER TABLE message_receipts
  DROP CONSTRAINT IF EXISTS message_receipts_pkey,
  ADD COLUMN IF NOT EXISTS guest_id UUID
    REFERENCES guest_principals(id) ON DELETE CASCADE,
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE message_receipts
  DROP CONSTRAINT IF EXISTS message_receipts_single_owner;
ALTER TABLE message_receipts
  ADD CONSTRAINT message_receipts_single_owner
  CHECK (num_nonnulls(user_id, guest_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS message_receipts_user_message_unique
  ON message_receipts (message_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_receipts_guest_message_unique
  ON message_receipts (message_id, guest_id)
  WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_receipts_guest_unread_idx
  ON message_receipts (guest_id, message_id DESC)
  WHERE guest_id IS NOT NULL AND read_at IS NULL;
