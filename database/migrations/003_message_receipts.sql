CREATE TABLE IF NOT EXISTS message_receipts (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id),
  CHECK (read_at IS NULL OR delivered_at IS NULL OR read_at >= delivered_at)
);

CREATE INDEX IF NOT EXISTS message_receipts_user_unread_idx
  ON message_receipts(user_id, message_id DESC)
  WHERE read_at IS NULL;

-- Existing history predates receipts. Mark it as read to avoid false unread badges.
INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
SELECT DISTINCT m.id, cp.user_id, m.created_at, m.created_at
FROM messages m
JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
WHERE cp.user_id IS NOT NULL
  AND cp.user_id IS DISTINCT FROM m.sender_user_id
  AND m.deleted_for_everyone_at IS NULL
ON CONFLICT (message_id, user_id) DO NOTHING;
