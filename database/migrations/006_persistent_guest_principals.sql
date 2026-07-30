CREATE TABLE IF NOT EXISTS guest_principals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_alias VARCHAR(20) NOT NULL,
  name VARCHAR(24) NOT NULL,
  gender VARCHAR(30) NOT NULL,
  age SMALLINT NOT NULL,
  country VARCHAR(80) NOT NULL,
  country_code CHAR(2) NOT NULL,
  avatar_id VARCHAR(20) NOT NULL,
  name_changes SMALLINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_until TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  deleted_at TIMESTAMPTZ,
  CHECK (char_length(trim(name)) BETWEEN 1 AND 24),
  CHECK (gender IN ('any', 'male', 'female', 'non-binary', 'other')),
  CHECK (age BETWEEN 18 AND 99),
  CHECK (country_code ~ '^[a-z]{2}$'),
  CHECK (avatar_id IN ('astra', 'nova', 'lyra', 'vega', 'sol', 'mira', 'orion', 'elara')),
  CHECK (name_changes IN (0, 1)),
  CHECK (status IN ('active', 'claimed', 'deleted', 'expired')),
  CHECK (retention_until >= created_at),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status <> 'deleted')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_principals_display_alias_unique
  ON guest_principals (display_alias);

CREATE INDEX IF NOT EXISTS guest_principals_created_cursor_idx
  ON guest_principals (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS guest_principals_status_cursor_idx
  ON guest_principals (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS guest_principals_retention_idx
  ON guest_principals (retention_until, id);
