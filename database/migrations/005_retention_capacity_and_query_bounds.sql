ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

UPDATE conversations c
SET last_activity_at = GREATEST(
  c.started_at,
  COALESCE(c.ended_at, c.started_at),
  COALESCE(
    (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
    c.started_at
  )
)
WHERE c.last_activity_at IS NULL;

ALTER TABLE conversations
  ALTER COLUMN last_activity_at SET DEFAULT NOW(),
  ALTER COLUMN last_activity_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

UPDATE conversations c
SET expires_at = c.last_activity_at + INTERVAL '7 days'
WHERE NOT EXISTS (
  SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id
);

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS conversation_id BIGINT
    REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

UPDATE reports
SET retention_until = created_at + INTERVAL '24 months'
WHERE retention_until IS NULL;

ALTER TABLE reports
  ALTER COLUMN retention_until SET DEFAULT NOW() + INTERVAL '24 months',
  ALTER COLUMN retention_until SET NOT NULL;

CREATE TABLE IF NOT EXISTS report_evidence_snapshots (
  report_id BIGINT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  conversation_id BIGINT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 months',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  CHECK (jsonb_typeof(messages) = 'array'),
  CHECK (expires_at > captured_at)
);

CREATE OR REPLACE FUNCTION prevent_report_evidence_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'report evidence snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS report_evidence_snapshots_immutable
  ON report_evidence_snapshots;
CREATE TRIGGER report_evidence_snapshots_immutable
BEFORE UPDATE ON report_evidence_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_report_evidence_update();

CREATE TABLE IF NOT EXISTS retention_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  duration_ms INTEGER,
  deleted_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  CHECK (status IN ('running', 'completed', 'failed')),
  CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE TABLE IF NOT EXISTS database_capacity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  database_bytes BIGINT NOT NULL,
  table_bytes BIGINT NOT NULL,
  index_bytes BIGINT NOT NULL,
  budget_bytes BIGINT NOT NULL,
  used_percent NUMERIC(6, 2) NOT NULL,
  threshold_percent INTEGER,
  largest_relations JSONB NOT NULL DEFAULT '[]'::jsonb,
  CHECK (database_bytes >= 0),
  CHECK (table_bytes >= 0),
  CHECK (index_bytes >= 0),
  CHECK (budget_bytes > 0),
  CHECK (used_percent >= 0),
  CHECK (threshold_percent IS NULL OR threshold_percent IN (60, 75, 90))
);

CREATE INDEX IF NOT EXISTS users_username_lower_active_idx
  ON users (LOWER(username), id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_email_lower_active_idx
  ON users (LOWER(email), id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_username_lower_prefix_idx
  ON users (LOWER(username) text_pattern_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_email_lower_prefix_idx
  ON users (LOWER(email) text_pattern_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_created_cursor_idx
  ON users (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS conversations_created_cursor_idx
  ON conversations (created_at DESC, id DESC)
  WHERE deleted_for_everyone_at IS NULL;

CREATE INDEX IF NOT EXISTS conversations_retention_idx
  ON conversations (last_activity_at, id)
  WHERE status <> 'active';

CREATE INDEX IF NOT EXISTS conversation_participants_user_conversation_idx
  ON conversation_participants (user_id, conversation_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_conversation_cursor_idx
  ON messages (conversation_id, id DESC)
  WHERE deleted_for_everyone_at IS NULL;

CREATE INDEX IF NOT EXISTS saved_chats_user_cursor_idx
  ON saved_chats (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS friendships_user_cursor_idx
  ON friendships (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS friend_requests_receiver_cursor_idx
  ON friend_requests (receiver_user_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS chat_requests_receiver_cursor_idx
  ON chat_requests (receiver_user_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS notifications_user_cursor_idx
  ON notifications (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS blocked_users_blocker_cursor_idx
  ON blocked_users (blocker_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS reports_status_cursor_idx
  ON reports (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS reports_retention_idx
  ON reports (retention_until, id)
  WHERE status <> 'pending';

CREATE INDEX IF NOT EXISTS report_evidence_expiry_idx
  ON report_evidence_snapshots (expires_at, report_id);

CREATE INDEX IF NOT EXISTS bans_user_active_lookup_idx
  ON bans (user_id, starts_at DESC, ends_at, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bans_ip_active_lookup_idx
  ON bans (ip_address, starts_at DESC, ends_at, id DESC)
  WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS retention_runs_started_idx
  ON retention_runs (started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS database_capacity_captured_idx
  ON database_capacity_snapshots (captured_at DESC, id DESC);
