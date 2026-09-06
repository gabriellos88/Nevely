ALTER TABLE chat_requests
  ADD COLUMN IF NOT EXISTS conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chat_requests_conversation_unique
  ON chat_requests(conversation_id)
  WHERE conversation_id IS NOT NULL;
