const crypto = require('crypto');
const { cleanPublicId, isPublicId, insertWithUniquePublicId } = require('./public-identifiers');

const GUEST_RETENTION_DAYS = 30;
const GUEST_RETENTION_INTERVAL = `${GUEST_RETENTION_DAYS} days`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GUEST_COLUMNS = `
  id, public_id, display_alias, name, gender, age, country, country_code, avatar_id,
  name_changes, status, created_at, updated_at, last_seen_at, retention_until,
  deleted_at
`;

function guestAlias(id) {
  if (!UUID_PATTERN.test(id)) throw new Error('Guest principal ID must be a UUID.');
  return `gst_${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

async function guestIdFromPublicId(executor, value, { includeLegacy = true } = {}) {
  const publicId = cleanPublicId(value);
  if (!publicId) return null;
  const canonical = isPublicId(publicId, 'guest');
  if (!canonical && !includeLegacy) return null;
  const result = await executor.query(
    `SELECT id FROM guest_principals
     WHERE ${canonical ? 'public_id = $1' : 'legacy_public_id = $1'}
     LIMIT 1`,
    [publicId]
  );
  return result.rowCount ? result.rows[0].id : null;
}

function publicGuestPrincipal(row) {
  if (!row) return null;
  const principal = {
    publicId: row.public_id,
    name: row.name,
    gender: row.gender,
    age: Number(row.age),
    country: {
      code: row.country_code,
      name: row.country
    },
    avatarId: row.avatar_id,
    nameChanges: Number(row.name_changes),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    retentionUntil: new Date(row.retention_until).toISOString()
  };
  // Services can retain the internal key in their server-side session, but it
  // must not be serialized to a browser or used as an external route ID.
  Object.defineProperty(principal, 'id', { value: row.id, enumerable: false });
  return principal;
}

function guestPassportComplete(guest) {
  return Boolean(
    guest
    && UUID_PATTERN.test(guest.id || '')
    && typeof guest.name === 'string' && guest.name.trim()
    && typeof guest.gender === 'string' && guest.gender
    && Number.isInteger(Number(guest.age)) && Number(guest.age) >= 18
    && typeof guest.country?.code === 'string' && /^[a-z]{2}$/i.test(guest.country.code)
    && typeof guest.country?.name === 'string' && guest.country.name.trim()
    && typeof guest.avatarId === 'string' && guest.avatarId
  );
}

async function createGuestPrincipal(executor, profile, options = {}) {
  const id = UUID_PATTERN.test(options.id || '') ? options.id : crypto.randomUUID();
  const createdAt = options.createdAt && !Number.isNaN(new Date(options.createdAt).getTime())
    ? new Date(options.createdAt).toISOString()
    : new Date().toISOString();
  const result = await insertWithUniquePublicId(executor, 'guest', (generatedPublicId) => executor.query(
    `INSERT INTO guest_principals
       (id, public_id, display_alias, device_principal_fingerprint, name, gender, age, country, country_code, avatar_id,
        name_changes, created_at, updated_at, last_seen_at, retention_until)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(),
       NOW() + $13::interval
     )
     RETURNING ${GUEST_COLUMNS}`,
    [
      id,
      options.publicId || generatedPublicId,
      options.publicId || generatedPublicId,
      options.devicePrincipalFingerprint || null,
      profile.name,
      profile.gender,
      profile.age,
      profile.country.name,
      profile.country.code,
      profile.avatarId,
      Number(profile.nameChanges) >= 1 ? 1 : 0,
      createdAt,
      GUEST_RETENTION_INTERVAL
    ]
  ));
  return publicGuestPrincipal(result.rows[0]);
}

async function findActiveGuestPrincipal(executor, id, { touch = false } = {}) {
  if (!UUID_PATTERN.test(id || '')) return null;
  const result = touch
    ? await executor.query(
      `UPDATE guest_principals
       SET last_seen_at = NOW(),
           updated_at = NOW(),
           retention_until = NOW() + $2::interval
       WHERE id = $1
         AND status = 'active'
         AND retention_until > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM guest_bans b
           WHERE b.guest_id = guest_principals.id
             AND b.revoked_at IS NULL AND b.starts_at <= NOW()
             AND (b.type = 'permanent' OR b.ends_at > NOW())
         )
       RETURNING ${GUEST_COLUMNS}`,
      [id, GUEST_RETENTION_INTERVAL]
    )
    : await executor.query(
      `SELECT ${GUEST_COLUMNS}
       FROM guest_principals
       WHERE id = $1
         AND status = 'active'
         AND retention_until > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM guest_bans b
           WHERE b.guest_id = guest_principals.id
             AND b.revoked_at IS NULL AND b.starts_at <= NOW()
             AND (b.type = 'permanent' OR b.ends_at > NOW())
         )`,
      [id]
    );
  return publicGuestPrincipal(result.rows[0]);
}

async function updateGuestPrincipal(executor, id, { name, avatarId }) {
  if (!UUID_PATTERN.test(id || '')) return null;
  const result = await executor.query(
    `UPDATE guest_principals
     SET name = CASE WHEN $2::boolean THEN $3 ELSE name END,
         name_changes = CASE
           WHEN $2::boolean AND name <> $3 THEN name_changes + 1
           ELSE name_changes
         END,
         avatar_id = CASE WHEN $4::boolean THEN $5 ELSE avatar_id END,
         last_seen_at = NOW(),
         updated_at = NOW(),
         retention_until = NOW() + $6::interval
     WHERE id = $1
       AND status = 'active'
       AND retention_until > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM guest_bans b
         WHERE b.guest_id = guest_principals.id
         AND b.revoked_at IS NULL AND b.starts_at <= NOW()
         AND (b.type = 'permanent' OR b.ends_at > NOW())
       )
       AND (
         NOT $2::boolean
         OR name = $3
         OR name_changes < 1
       )
     RETURNING ${GUEST_COLUMNS}`,
    [
      id,
      name !== undefined,
      name || '',
      avatarId !== undefined,
      avatarId || '',
      GUEST_RETENTION_INTERVAL
    ]
  );
  return publicGuestPrincipal(result.rows[0]);
}

async function tombstoneGuestPrincipal(executor, id) {
  if (!UUID_PATTERN.test(id || '')) return false;
  const result = await executor.query(
    `UPDATE guest_principals
     SET status = 'deleted',
         deleted_at = NOW(),
         updated_at = NOW(),
         retention_until = GREATEST(created_at, NOW())
     WHERE id = $1 AND status = 'active'`,
    [id]
  );
  return result.rowCount > 0;
}

function bindGuestSession(session, guest) {
  session.guestPrincipalId = guest.id;
  session.guestProfile = guest;
}

async function bindGuestDevice(executor, guestId, devicePrincipalFingerprint) {
  if (!UUID_PATTERN.test(guestId || '') || !/^[0-9a-f]{64}$/.test(String(devicePrincipalFingerprint || ''))) return false;
  const result = await executor.query(
    `UPDATE guest_principals
     SET device_principal_fingerprint = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'active'`,
    [guestId, devicePrincipalFingerprint]
  );
  return result.rowCount > 0;
}

function clearGuestSession(session) {
  delete session.guestPrincipalId;
  delete session.guestProfile;
}

module.exports = {
  GUEST_RETENTION_DAYS,
  UUID_PATTERN,
  bindGuestDevice,
  bindGuestSession,
  clearGuestSession,
  createGuestPrincipal,
  findActiveGuestPrincipal,
  guestIdFromPublicId,
  guestPassportComplete,
  guestAlias,
  publicGuestPrincipal,
  tombstoneGuestPrincipal,
  updateGuestPrincipal
};
