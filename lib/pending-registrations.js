const ACTIVE_VERIFICATION_TOKEN_SQL = `
  SELECT 1
  FROM account_tokens token
  WHERE token.user_id = u.id
    AND token.purpose = 'verify_email'
    AND token.used_at IS NULL
    AND token.revoked_at IS NULL
    AND token.expires_at > NOW()
`;

const DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL = `
  WITH candidates AS (
    SELECT u.id
    FROM users u
    WHERE u.deleted_at IS NULL
      AND u.email_verified_at IS NULL
      AND u.registration_pending_at IS NOT NULL
      AND NOT EXISTS (${ACTIVE_VERIFICATION_TOKEN_SQL})
      AND (
        ($2::bigint IS NULL AND $3::text IS NULL AND $4::text IS NULL)
        OR u.id = $2
        OR u.email = $3
        OR u.username = $4
      )
    ORDER BY u.registration_pending_at, u.id
    FOR UPDATE OF u SKIP LOCKED
    LIMIT $1
  ), deleted_sessions AS (
    DELETE FROM session stored
    USING candidates candidate
    WHERE COALESCE(
      stored.sess::jsonb #>> '{user,internalId}',
      stored.sess::jsonb #>> '{user,id}'
    ) = candidate.id::text
    RETURNING stored.sid
  ), deleted_users AS (
    DELETE FROM users u
    USING candidates candidate
    WHERE u.id = candidate.id
    RETURNING u.id
  )
  SELECT id FROM deleted_users ORDER BY id
`;

async function deleteExpiredPendingRegistrations(executor, {
  limit = 500,
  userId = null,
  email = null,
  username = null
} = {}) {
  return executor.query(DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL, [
    limit,
    userId,
    email,
    username
  ]);
}

async function findActivePendingRegistration(executor, { email, username }) {
  return executor.query(
    `SELECT u.id
     FROM users u
     WHERE u.deleted_at IS NULL
       AND u.email_verified_at IS NULL
       AND u.registration_pending_at IS NOT NULL
       AND (u.email = $1 OR u.username = $2)
       AND EXISTS (${ACTIVE_VERIFICATION_TOKEN_SQL})
     ORDER BY u.registration_pending_at, u.id
     LIMIT 1`,
    [email, username]
  );
}

async function deleteExpiredPendingRegistrationsTransaction(db, options) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await deleteExpiredPendingRegistrations(client, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ACTIVE_VERIFICATION_TOKEN_SQL,
  DELETE_EXPIRED_PENDING_REGISTRATIONS_SQL,
  deleteExpiredPendingRegistrations,
  deleteExpiredPendingRegistrationsTransaction,
  findActivePendingRegistration
};
