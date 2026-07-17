CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(30) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reported_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reporter_socket_id TEXT,
  reported_socket_id TEXT,
  reason VARCHAR(100) NOT NULL DEFAULT 'unspecified',
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_reported_user_idx
  ON reports(reported_user_id);

CREATE INDEX IF NOT EXISTS reports_reported_socket_idx
  ON reports(reported_socket_id);

CREATE INDEX IF NOT EXISTS reports_created_at_idx
  ON reports(created_at);
