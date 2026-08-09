const crypto = require('crypto');
const { appendAudit, normalizedCorrelationId, requiredReason } = require('./moderation');
const { createPublicId } = require('./public-identifiers');
const { revokeUserSessions } = require('./security');

const ACCOUNT_RETENTION_DAYS = 30;

async function deleteAccountLifecycle({
  db,
  targetUserId,
  actorUserId = targetUserId,
  adminAction = false,
  reason = 'Account deletion requested by account owner',
  correlationId = crypto.randomUUID()
}) {
  const normalizedReason = adminAction ? requiredReason(reason) : reason;
  const normalizedCorrelation = normalizedCorrelationId(correlationId);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (adminAction) {
      if (Number(actorUserId) === Number(targetUserId)) {
        const error = new Error('Administrators cannot delete their own account');
        error.code = 'SELF_MODERATION_FORBIDDEN';
        throw error;
      }
      const actor = await client.query(
        `SELECT id FROM users
         WHERE id = $1 AND role = 'admin' AND deleted_at IS NULL
         FOR UPDATE`,
        [actorUserId]
      );
      if (!actor.rowCount) {
        const error = new Error('The administrator authorization is no longer valid');
        error.code = 'ADMIN_AUTH_REQUIRED';
        throw error;
      }
    }

    const target = await client.query(
      `SELECT id, deleted_at, retention_until, pii_purged_at
       FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    if (!target.rowCount) {
      const error = new Error('The target account no longer exists');
      error.code = 'TARGET_NOT_FOUND';
      throw error;
    }
    if (target.rows[0].deleted_at) {
      await client.query('COMMIT');
      return { ...target.rows[0], idempotent: true };
    }

    const deleted = (await client.query(
      `WITH deletion_clock AS (SELECT NOW() AS deleted_at)
       UPDATE users u
       SET deleted_at = deletion_clock.deleted_at,
           retention_until = deletion_clock.deleted_at + INTERVAL '30 days',
           pii_purged_at = NULL,
           updated_at = deletion_clock.deleted_at
       FROM deletion_clock
       WHERE u.id = $1 AND u.deleted_at IS NULL
       RETURNING u.id, u.deleted_at, u.retention_until, u.pii_purged_at`,
      [targetUserId]
    )).rows[0];

    // Product-only state is not needed during the administrative retention
    // period. Referential moderation and conversation records remain linked to
    // the unchanged internal UUID-equivalent key (users.id).
    await client.query('DELETE FROM saved_chats WHERE user_id = $1', [targetUserId]);
    await client.query('DELETE FROM message_receipts WHERE user_id = $1', [targetUserId]);
    await client.query('DELETE FROM notifications WHERE user_id = $1', [targetUserId]);
    await client.query('DELETE FROM friend_requests WHERE sender_user_id = $1 OR receiver_user_id = $1', [targetUserId]);
    await client.query('DELETE FROM chat_requests WHERE sender_user_id = $1 OR receiver_user_id = $1', [targetUserId]);
    await client.query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [targetUserId]);
    await client.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 OR blocked_user_id = $1', [targetUserId]);
    await client.query(
      `UPDATE account_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE user_id = $1 AND used_at IS NULL`,
      [targetUserId]
    );
    await revokeUserSessions(db, targetUserId, { client });
    await appendAudit(client, {
      actorUserId,
      targetUserId,
      targetType: 'account',
      action: 'account_deleted',
      reason: normalizedReason,
      before: { deleted: false },
      after: { deleted: true, retentionDays: ACCOUNT_RETENTION_DAYS },
      correlationId: normalizedCorrelation
    });
    await client.query('COMMIT');
    return { ...deleted, idempotent: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateWithFreshPublicId(client, userId, values) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const publicId = createPublicId('user');
    const savepoint = `purge_public_id_${attempt}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await client.query(
        `UPDATE users
         SET username = 'removed_' || id,
             email = 'removed_' || id || '@deleted.nevely.invalid',
             display_name = $2,
             public_id = $3,
             legacy_public_id = NULL,
             display_alias = NULL,
             avatar_url = NULL,
             profile_image_url = NULL,
             birth_date = NULL,
             age = NULL,
             gender = NULL,
             country = NULL,
             country_code = NULL,
             profile_completed_at = NULL,
             profile_changed_at = NULL,
             email_verified_at = NULL,
             password_hash = NULL,
             admin_totp_secret = NULL,
             admin_2fa_enabled_at = NULL,
             role = 'user',
             plan = 'free',
             last_ip = NULL,
             last_seen_at = NULL,
             last_network_seen_at = NULL,
             pii_purged_at = $4,
             updated_at = $4
         WHERE id = $1 AND pii_purged_at IS NULL
         RETURNING id, public_id, pii_purged_at`,
        [userId, values.removedDisplayName, publicId, values.purgedAt]
      );
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result.rows[0] || null;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      if (error?.code === '23505' && error?.constraint === 'users_public_id_unique') continue;
      throw error;
    }
  }
  const error = new Error('Unable to rotate the public identifier during account purge');
  error.code = 'PUBLIC_ID_COLLISION';
  throw error;
}

async function purgeDueAccountsBatch(client, {
  batchSize = 500,
  removedDisplayName = 'Removed account'
} = {}) {
  await client.query('BEGIN');
  try {
    const candidates = await client.query(
      `SELECT u.id
       FROM users u
       WHERE u.deleted_at IS NOT NULL
         AND u.pii_purged_at IS NULL
         AND u.retention_until <= NOW()
         AND NOT EXISTS (
           SELECT 1 FROM account_bans b
           WHERE b.user_id = u.id AND b.type = 'permanent'
             AND b.revoked_at IS NULL AND b.starts_at <= NOW()
         )
         AND NOT EXISTS (
           SELECT 1 FROM bans legacy
           WHERE legacy.user_id = u.id AND legacy.type = 'permanent'
             AND legacy.starts_at <= NOW()
         )
       ORDER BY u.retention_until, u.id
       FOR UPDATE OF u SKIP LOCKED
       LIMIT $1`,
      [batchSize]
    );
    for (const candidate of candidates.rows) {
      const purgedAt = (await client.query('SELECT NOW() AS value')).rows[0].value;
      await client.query('DELETE FROM account_identities WHERE user_id = $1', [candidate.id]);
      await client.query('DELETE FROM account_tokens WHERE user_id = $1', [candidate.id]);
      await client.query('DELETE FROM email_outbox WHERE user_id = $1', [candidate.id]);
      await client.query(
        'UPDATE messages SET sender_display_name = $2 WHERE sender_user_id = $1',
        [candidate.id, removedDisplayName]
      );
      await client.query(
        'UPDATE conversation_participants SET display_name = $2 WHERE user_id = $1',
        [candidate.id, removedDisplayName]
      );
      const purged = await updateWithFreshPublicId(client, candidate.id, {
        removedDisplayName,
        purgedAt
      });
      if (!purged) continue;
      await appendAudit(client, {
        targetUserId: Number(candidate.id),
        targetType: 'account',
        action: 'account_pii_purged',
        reason: 'Scheduled account retention expired',
        before: { personalDataRetained: true },
        after: { personalDataRetained: false, publicIdRotated: true },
        correlationId: crypto.randomUUID()
      });
    }
    await client.query('COMMIT');
    return candidates.rowCount;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

module.exports = {
  ACCOUNT_RETENTION_DAYS,
  deleteAccountLifecycle,
  purgeDueAccountsBatch
};
