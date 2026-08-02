const { UUID_PATTERN } = require('./guest-principals');

const CLAIM_TOMBSTONE_INTERVAL = '30 days';

function claimRequested(value) {
  return value === '1' || value === 1 || value === true || value === 'true';
}

async function createGuestAccountClaim(executor, { guestId, userId }) {
  if (!UUID_PATTERN.test(guestId || '') || !Number.isSafeInteger(Number(userId))) return null;

  const guest = await executor.query(
    `SELECT id
     FROM guest_principals
     WHERE id = $1
       AND status = 'active'
       AND retention_until > NOW()
     FOR UPDATE`,
    [guestId]
  );
  if (!guest.rowCount) return null;

  const created = await executor.query(
    `INSERT INTO guest_account_claims (guest_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guest_id) DO NOTHING
     RETURNING id, guest_id, user_id, status`,
    [guestId, userId]
  );
  return created.rows[0] || null;
}

async function finalizeGuestAccountClaim(executor, userId) {
  const claim = await executor.query(
    `SELECT claim.id, claim.guest_id, claim.status, guest.avatar_id
     FROM guest_account_claims claim
     JOIN guest_principals guest ON guest.id = claim.guest_id
     WHERE claim.user_id = $1
     FOR UPDATE OF claim, guest`,
    [userId]
  );
  if (!claim.rowCount) return { status: 'none' };

  const current = claim.rows[0];
  if (current.status === 'claimed') return { status: 'claimed', guestId: current.guest_id };

  const activeGuest = await executor.query(
    `SELECT id
     FROM guest_principals
     WHERE id = $1
       AND status = 'active'
       AND retention_until > NOW()`,
    [current.guest_id]
  );
  if (!activeGuest.rowCount) {
    await executor.query(
      `UPDATE guest_account_claims
       SET status = 'unavailable'
       WHERE id = $1 AND status = 'pending'`,
      [current.id]
    );
    return { status: 'unavailable' };
  }

  await executor.query(
    `UPDATE conversation_participants
     SET user_id = $1, guest_id = NULL
     WHERE guest_id = $2`,
    [userId, current.guest_id]
  );
  await executor.query(
    `UPDATE saved_chats
     SET user_id = $1, guest_id = NULL
     WHERE guest_id = $2`,
    [userId, current.guest_id]
  );
  await executor.query(
    `UPDATE message_receipts
     SET user_id = $1, guest_id = NULL
     WHERE guest_id = $2`,
    [userId, current.guest_id]
  );
  await executor.query(
    `UPDATE notifications
     SET user_id = $1, guest_id = NULL
     WHERE guest_id = $2`,
    [userId, current.guest_id]
  );
  await executor.query(
    `UPDATE users
     SET profile_image_url = COALESCE(profile_image_url, $1), updated_at = NOW()
     WHERE id = $2`,
    [`/vendor/dicebear-presets-10.2.0/${current.avatar_id}.svg`, userId]
  );
  await executor.query(
    `UPDATE guest_principals
     SET status = 'claimed',
         claimed_at = NOW(),
         claimed_by_user_id = $1,
         updated_at = NOW(),
         retention_until = GREATEST(retention_until, NOW() + $3::interval)
     WHERE id = $2 AND status = 'active'`,
    [userId, current.guest_id, CLAIM_TOMBSTONE_INTERVAL]
  );
  await executor.query(
    `UPDATE guest_account_claims
     SET status = 'claimed', claimed_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [current.id]
  );
  return { status: 'claimed', guestId: current.guest_id };
}

module.exports = {
  claimRequested,
  createGuestAccountClaim,
  finalizeGuestAccountClaim
};
