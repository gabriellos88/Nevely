CREATE TABLE IF NOT EXISTS direct_conversation_pairs (
  user_low_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE INDEX IF NOT EXISTS direct_conversation_pairs_user_high_idx
  ON direct_conversation_pairs(user_high_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT c.id
    FROM conversations c
    LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE c.type = 'direct' AND c.status = 'active'
      AND c.deleted_for_everyone_at IS NULL
    GROUP BY c.id
    HAVING COUNT(DISTINCT cp.user_id) <> 2
  ) THEN
    RAISE EXCEPTION 'Active direct conversation cannot be reserved safely';
  END IF;

  IF EXISTS (
    WITH active_pairs AS (
      SELECT c.id,
             LEAST(MIN(cp.user_id), MAX(cp.user_id)) AS user_low_id,
             GREATEST(MIN(cp.user_id), MAX(cp.user_id)) AS user_high_id
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE c.type = 'direct' AND c.status = 'active'
        AND c.deleted_for_everyone_at IS NULL AND cp.user_id IS NOT NULL
      GROUP BY c.id
      HAVING COUNT(DISTINCT cp.user_id) = 2
    )
    SELECT 1 FROM active_pairs
    GROUP BY user_low_id, user_high_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active direct pair cannot be reserved safely';
  END IF;
END $$;

INSERT INTO direct_conversation_pairs (user_low_id, user_high_id, conversation_id)
SELECT LEAST(MIN(cp.user_id), MAX(cp.user_id)),
       GREATEST(MIN(cp.user_id), MAX(cp.user_id)),
       c.id
FROM conversations c
JOIN conversation_participants cp ON cp.conversation_id = c.id
WHERE c.type = 'direct' AND c.status = 'active'
  AND c.deleted_for_everyone_at IS NULL AND cp.user_id IS NOT NULL
GROUP BY c.id
HAVING COUNT(DISTINCT cp.user_id) = 2
ON CONFLICT DO NOTHING;
