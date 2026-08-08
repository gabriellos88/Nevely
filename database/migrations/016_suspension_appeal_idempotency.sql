-- A suspension can have one pending appeal from the affected account. The
-- partial unique index makes retrying a submitted appeal safe across replicas.
CREATE UNIQUE INDEX IF NOT EXISTS moderation_appeals_pending_account_unique
  ON moderation_appeals (account_ban_id, appellant_user_id)
  WHERE status = 'pending' AND account_ban_id IS NOT NULL AND appellant_user_id IS NOT NULL;
