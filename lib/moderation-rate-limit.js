const DEFAULT_POLICIES = Object.freeze({
  match: { limit: 20, windowSeconds: 60, escalationSeconds: [60, 300, 900] },
  message: { limit: 12, windowSeconds: 10, escalationSeconds: [30, 120, 600] },
  report: { limit: 5, windowSeconds: 3_600, escalationSeconds: [300, 900, 3_600] }
});

function validPrincipal(principalType, principalId) {
  if (!['user', 'guest'].includes(principalType)) return false;
  const id = String(principalId || '');
  return principalType === 'user'
    ? /^\d+$/.test(id) && Number(id) > 0
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function normalizePolicy(policy = {}) {
  const limit = Number(policy.limit);
  const windowSeconds = Number(policy.windowSeconds);
  const escalationSeconds = Array.isArray(policy.escalationSeconds)
    ? policy.escalationSeconds.map(Number).filter((seconds) => Number.isSafeInteger(seconds) && seconds > 0).slice(0, 5)
    : [];
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || !escalationSeconds.length) {
    throw new Error('Invalid moderation rate limit policy');
  }
  return { limit, windowSeconds, escalationSeconds };
}

function createModerationRateLimiter({ db, policies = DEFAULT_POLICIES } = {}) {
  const normalizedPolicies = Object.fromEntries(
    Object.entries(policies).map(([action, policy]) => [action, normalizePolicy(policy)])
  );

  async function consume({ principalType, principalId, action }) {
    if (!validPrincipal(principalType, principalId) || !normalizedPolicies[action]) {
      throw new Error('Invalid moderation rate limit principal or action');
    }
    if (!db?.isConfigured) return { allowed: true, count: 0, retryAfterSeconds: 0, escalationLevel: 0 };
    const policy = normalizedPolicies[action];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO moderation_rate_windows
           (principal_type, principal_id, action, window_started_at, request_count, expires_at, escalation_level)
         VALUES ($1, $2, $3, NOW(), 0, NOW() + ($4::integer * INTERVAL '1 second'), 0)
         ON CONFLICT (principal_type, principal_id, action) DO NOTHING`,
        [principalType, String(principalId), action, policy.windowSeconds]
      );
      const locked = await client.query(
        `SELECT request_count, escalation_level, expires_at, escalation_expires_at,
                expires_at <= NOW() AS window_expired,
                COALESCE(escalation_expires_at > NOW(), FALSE) AS escalation_active,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (escalation_expires_at - NOW()))))::integer AS retry_after_seconds
         FROM moderation_rate_windows
         WHERE principal_type = $1 AND principal_id = $2 AND action = $3
         FOR UPDATE`,
        [principalType, String(principalId), action]
      );
      const row = locked.rows[0];
      if (row.escalation_active) {
        await client.query('COMMIT');
        return {
          allowed: false,
          count: Number(row.request_count),
          retryAfterSeconds: Number(row.retry_after_seconds),
          escalationLevel: Number(row.escalation_level)
        };
      }

      const currentCount = row.window_expired ? 0 : Number(row.request_count);
      const currentLevel = row.window_expired ? 0 : Number(row.escalation_level);
      const count = currentCount + 1;
      if (count <= policy.limit) {
        await client.query(
          `UPDATE moderation_rate_windows
           SET window_started_at = CASE WHEN $4 THEN NOW() ELSE window_started_at END,
               request_count = $5,
               expires_at = CASE WHEN $4 THEN NOW() + ($6::integer * INTERVAL '1 second') ELSE expires_at END,
               escalation_level = CASE WHEN $4 THEN 0 ELSE escalation_level END,
               escalation_expires_at = CASE WHEN $4 THEN NULL ELSE escalation_expires_at END
           WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
          [principalType, String(principalId), action, Boolean(row.window_expired), count, policy.windowSeconds]
        );
        await client.query('COMMIT');
        return { allowed: true, count, retryAfterSeconds: 0, escalationLevel: 0 };
      }

      const escalationLevel = Math.min(currentLevel + 1, policy.escalationSeconds.length);
      const cooldownSeconds = policy.escalationSeconds[escalationLevel - 1];
      await client.query(
        `UPDATE moderation_rate_windows
         SET request_count = $4,
             escalation_level = $5,
             escalation_expires_at = NOW() + ($6::integer * INTERVAL '1 second')
         WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
        [principalType, String(principalId), action, count, escalationLevel, cooldownSeconds]
      );
      await client.query('COMMIT');
      return { allowed: false, count, retryAfterSeconds: cooldownSeconds, escalationLevel };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return { consume };
}

module.exports = { DEFAULT_POLICIES, createModerationRateLimiter, normalizePolicy, validPrincipal };
