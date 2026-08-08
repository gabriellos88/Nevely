-- Registered accounts without a profile image receive the same local preset
-- baseline used by guests. Existing explicit images are preserved.
UPDATE users
SET profile_image_url = '/vendor/dicebear-presets-10.2.0/'
  || (ARRAY['astra', 'nova', 'lyra', 'vega', 'sol', 'mira', 'orion', 'elara'])[
       1 + (get_byte(decode(md5(COALESCE(public_id, username, id::text)), 'hex'), 0) % 8)
     ]
  || '.svg',
    updated_at = NOW()
WHERE NULLIF(BTRIM(profile_image_url), '') IS NULL;
