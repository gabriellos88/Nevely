const DEFAULT_POLICIES = Object.freeze({
  match: { limit: 20, windowSeconds: 60, escalationSeconds: [60, 300, 900] },
  skip: {
    freeRequests: 3,
    windowSeconds: 60,
    delayTiers: [
      { through: 6, seconds: 1 },
      { through: 10, seconds: 2 },
      { through: Infinity, seconds: 5 }
    ]
  },
  message: { limit: 12, windowSeconds: 10, escalationSeconds: [30, 120, 600] },
  'message-duplicate': { limit: 2, windowSeconds: 60, escalationSeconds: [15, 60, 300] },
  'message-link-flood': { limit: 4, windowSeconds: 60, escalationSeconds: [15, 60, 300] },
  'message-repeated-character-flood': { limit: 2, windowSeconds: 60, escalationSeconds: [15, 60, 300] },
  report: { limit: 5, windowSeconds: 3_600, escalationSeconds: [300, 900, 3_600] }
});

function validPrincipal(principalType, principalId) {
  if (!['user', 'guest', 'signal'].includes(principalType)) return false;
  const id = String(principalId || '');
  if (principalType === 'signal') return /^[0-9a-f]{64}$/i.test(id);
  return principalType === 'user'
    ? /^\d+$/.test(id) && Number(id) > 0
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function normalizePolicy(policy = {}) {
  if (Number.isSafeInteger(Number(policy.freeRequests)) && Array.isArray(policy.delayTiers)) {
    const freeRequests = Number(policy.freeRequests);
    const windowSeconds = Number(policy.windowSeconds);
    const delayTiers = policy.delayTiers.map((tier) => ({
      through: tier.through === Infinity ? Infinity : Number(tier.through),
      seconds: Number(tier.seconds)
    }));
    const tiersAreValid = delayTiers.length > 0
      && delayTiers.every((tier, index) => Number.isSafeInteger(tier.seconds) && tier.seconds > 0
        && (tier.through === Infinity || (Number.isSafeInteger(tier.through) && tier.through > freeRequests))
        && (index === 0 || tier.through > delayTiers[index - 1].through));
    if (!Number.isSafeInteger(freeRequests) || freeRequests < 0
      || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || !tiersAreValid
      || delayTiers[delayTiers.length - 1].through !== Infinity) {
      throw new Error('Invalid progressive cooldown policy');
    }
    return { type: 'progressive-cooldown', freeRequests, windowSeconds, delayTiers };
  }
  const limit = Number(policy.limit);
  const windowSeconds = Number(policy.windowSeconds);
  const escalationSeconds = Array.isArray(policy.escalationSeconds)
    ? policy.escalationSeconds.map(Number).filter((seconds) => Number.isSafeInteger(seconds) && seconds > 0).slice(0, 5)
    : [];
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || !escalationSeconds.length) {
    throw new Error('Invalid moderation rate limit policy');
  }
  return { type: 'escalating-rate-limit', limit, windowSeconds, escalationSeconds };
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
                cooldown_expires_at, cooldown_grant_available,
                expires_at <= NOW() AS window_expired,
                COALESCE(cooldown_expires_at > NOW(), FALSE) AS cooldown_active,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (cooldown_expires_at - NOW()))))::integer AS cooldown_retry_after_seconds,
                COALESCE(escalation_expires_at > NOW(), FALSE) AS escalation_active,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (escalation_expires_at - NOW()))))::integer AS retry_after_seconds
         FROM moderation_rate_windows
         WHERE principal_type = $1 AND principal_id = $2 AND action = $3
         FOR UPDATE`,
        [principalType, String(principalId), action]
      );
      const row = locked.rows[0];
      const windowExpired = Boolean(row.window_expired);
      if (policy.type === 'progressive-cooldown') {
        const cooldownActive = !windowExpired && Boolean(row.cooldown_active);
        if (cooldownActive) {
          await client.query('COMMIT');
          return { allowed: false, count: Number(row.request_count), retryAfterSeconds: Number(row.cooldown_retry_after_seconds), escalationLevel: 0 };
        }

        if (!windowExpired && row.cooldown_grant_available) {
          await client.query(
            `UPDATE moderation_rate_windows
             SET cooldown_expires_at = NULL, cooldown_grant_available = FALSE
             WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
            [principalType, String(principalId), action]
          );
          await client.query('COMMIT');
          return { allowed: true, count: Number(row.request_count), retryAfterSeconds: 0, escalationLevel: 0 };
        }

        const count = (windowExpired ? 0 : Number(row.request_count)) + 1;
        const delayTier = policy.delayTiers.find((tier) => count <= tier.through);
        const cooldownSeconds = count <= policy.freeRequests ? 0 : delayTier.seconds;
        await client.query(
          `UPDATE moderation_rate_windows
           SET window_started_at = CASE WHEN $4 THEN NOW() ELSE window_started_at END,
               request_count = $5,
               expires_at = CASE WHEN $4 THEN NOW() + ($6::integer * INTERVAL '1 second') ELSE expires_at END,
               escalation_level = 0,
               escalation_expires_at = NULL,
               cooldown_expires_at = CASE WHEN $7 > 0 THEN NOW() + ($7::integer * INTERVAL '1 second') ELSE NULL END,
               cooldown_grant_available = $7 > 0
           WHERE principal_type = $1 AND principal_id = $2 AND action = $3`,
          [principalType, String(principalId), action, windowExpired, count, policy.windowSeconds, cooldownSeconds]
        );
        await client.query('COMMIT');
        return { allowed: cooldownSeconds === 0, count, retryAfterSeconds: cooldownSeconds, escalationLevel: 0 };
      }
      if (row.escalation_active) {
        await client.query('COMMIT');
        return {
          allowed: false,
          count: Number(row.request_count),
          retryAfterSeconds: Number(row.retry_after_seconds),
          escalationLevel: Number(row.escalation_level)
        };
      }

      const currentCount = windowExpired ? 0 : Number(row.request_count);
      const currentLevel = windowExpired ? 0 : Number(row.escalation_level);
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
          [principalType, String(principalId), action, windowExpired, count, policy.windowSeconds]
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
