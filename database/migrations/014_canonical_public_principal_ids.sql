-- Canonical public identifiers are intentionally separate from internal keys.
-- users.id and guest_principals.id remain the only relational identifiers.
CREATE OR REPLACE FUNCTION nevely_next_public_id(identifier_prefix TEXT, target_table REGCLASS)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
  candidate VARCHAR;
  available BOOLEAN;
  attempt INTEGER := 0;
BEGIN
  LOOP
    attempt := attempt + 1;
    IF attempt > 100 THEN
      RAISE EXCEPTION 'Could not allocate a unique public identifier for %', target_table;
    END IF;
    candidate := identifier_prefix || encode(gen_random_bytes(6), 'hex');
    EXECUTE format('SELECT NOT EXISTS (SELECT 1 FROM %s WHERE public_id = $1)', target_table)
      INTO available USING candidate;
    IF available THEN RETURN candidate; END IF;
  END LOOP;
END;
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS legacy_public_id VARCHAR(40);

-- Keep the previous opaque nvy_ + 20 hex identifier as a read-only resolver
-- during the compatibility window. It is never emitted by current APIs.
UPDATE users
SET legacy_public_id = public_id
WHERE legacy_public_id IS NULL;

UPDATE users
SET public_id = nevely_next_public_id('nvy_', 'users'::regclass);

ALTER TABLE users
  ALTER COLUMN public_id TYPE VARCHAR(16),
  ALTER COLUMN public_id SET NOT NULL;

DROP INDEX IF EXISTS users_public_id_unique;
CREATE UNIQUE INDEX users_public_id_unique ON users(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_legacy_public_id_unique
  ON users(legacy_public_id) WHERE legacy_public_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_public_id_format_check;
ALTER TABLE users ADD CONSTRAINT users_public_id_format_check
  CHECK (public_id ~ '^nvy_[0-9a-f]{12}$');

ALTER TABLE guest_principals
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(16),
  ADD COLUMN IF NOT EXISTS legacy_public_id VARCHAR(40);

UPDATE guest_principals
SET legacy_public_id = display_alias
WHERE legacy_public_id IS NULL;

UPDATE guest_principals
SET public_id = nevely_next_public_id('gst_', 'guest_principals'::regclass)
WHERE public_id IS NULL;

ALTER TABLE guest_principals
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guest_principals_public_id_unique
  ON guest_principals(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS guest_principals_legacy_public_id_unique
  ON guest_principals(legacy_public_id) WHERE legacy_public_id IS NOT NULL;
ALTER TABLE guest_principals DROP CONSTRAINT IF EXISTS guest_principals_public_id_format_check;
ALTER TABLE guest_principals ADD CONSTRAINT guest_principals_public_id_format_check
  CHECK (public_id ~ '^gst_[0-9a-f]{12}$');

-- Existing notification payloads remain usable without surfacing a legacy ID.
UPDATE notifications n
SET data = jsonb_set(n.data, '{userPublicId}', to_jsonb(u.public_id), true)
FROM users u
WHERE n.data ? 'userPublicId'
  AND n.data ->> 'userPublicId' = u.legacy_public_id;

DROP FUNCTION nevely_next_public_id(TEXT, REGCLASS);
