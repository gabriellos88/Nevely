-- Final N4 moderation cleanup and reliable registered-account activity.
-- Historical append-only audit records and the retired appeal storage remain
-- available only for policy retention; no public or admin workflow uses them.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE users u
SET last_seen_at = activity.last_seen_at
FROM (
  SELECT cp.user_id, MAX(c.last_activity_at) AS last_seen_at
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  WHERE cp.user_id IS NOT NULL
  GROUP BY cp.user_id
) activity
WHERE u.id = activity.user_id
  AND (u.last_seen_at IS NULL OR u.last_seen_at < activity.last_seen_at);

CREATE INDEX IF NOT EXISTS users_last_seen_at_idx
  ON users (last_seen_at DESC, id DESC)
  WHERE deleted_at IS NULL;

DELETE FROM notifications
WHERE type = 'account_ban';
