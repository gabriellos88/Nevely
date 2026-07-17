CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(32),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(40),
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(30),
  ADD COLUMN IF NOT EXISTS country VARCHAR(80),
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
  ADD COLUMN IF NOT EXISTS last_ip TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE users
SET public_id = 'Nevely#' || substr(md5(id::text || created_at::text), 1, 6)
WHERE public_id IS NULL;

UPDATE users
SET display_name = username
WHERE display_name IS NULL;

ALTER TABLE users
  ALTER COLUMN public_id SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_unique
  ON users(public_id);

CREATE INDEX IF NOT EXISTS users_plan_idx
  ON users(plan);

CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_session_expire
  ON session(expire);

CREATE TABLE IF NOT EXISTS friendships (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id BIGSERIAL PRIMARY KEY,
  sender_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (sender_user_id, receiver_user_id),
  CHECK (sender_user_id <> receiver_user_id),
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS chat_requests (
  id BIGSERIAL PRIMARY KEY,
  sender_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (sender_user_id <> receiver_user_id),
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_requests_pending_unique
  ON chat_requests(sender_user_id, receiver_user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'random',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  title TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  deleted_for_everyone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (type IN ('random', 'direct')),
  CHECK (status IN ('active', 'ended', 'deleted'))
);

CREATE INDEX IF NOT EXISTS conversations_started_at_idx
  ON conversations(started_at DESC);

CREATE INDEX IF NOT EXISTS conversations_expires_at_idx
  ON conversations(expires_at)
  WHERE deleted_for_everyone_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  socket_id TEXT,
  display_name VARCHAR(80),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, socket_id)
);

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx
  ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sender_socket_id TEXT,
  sender_display_name VARCHAR(80) NOT NULL DEFAULT 'Guest',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_for_everyone_at TIMESTAMPTZ,
  CHECK (char_length(body) <= 2000)
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS saved_chats (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS saved_chats_user_idx
  ON saved_chats(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blocked_users (
  id BIGSERIAL PRIMARY KEY,
  blocker_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE TABLE IF NOT EXISTS bans (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT,
  type VARCHAR(20) NOT NULL,
  reason TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (type IN ('temporary', 'permanent', 'ip'))
);

CREATE INDEX IF NOT EXISTS bans_user_idx
  ON bans(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plan_price_history (
  id BIGSERIAL PRIMARY KEY,
  plan VARCHAR(20) NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution TEXT;

CREATE INDEX IF NOT EXISTS reports_status_created_idx
  ON reports(status, created_at DESC);

INSERT INTO plan_price_history (plan, price_cents, currency)
SELECT 'premium', 0, 'USD'
WHERE NOT EXISTS (
  SELECT 1 FROM plan_price_history WHERE plan = 'premium'
);
