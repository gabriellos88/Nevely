const crypto = require('crypto');
const net = require('net');
const { revokeUserSessions } = require('./security');

class ModerationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModerationError';
    this.code = code;
  }
}

function normalizedCorrelationId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
    ? String(value).toLowerCase()
    : crypto.randomUUID();
}

function requiredReason(value) {
  const reason = String(value || '').trim().replace(/\s+/g, ' ');
  if (reason.length < 3 || reason.length > 500) {
    throw new ModerationError('MODERATION_REASON_REQUIRED', 'A reason between 3 and 500 characters is required');
  }
  return reason;
}

async function withTransaction(db, handler) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function appendAudit(client, entry) {
  const correlationId = normalizedCorrelationId(entry.correlationId);
  const result = await client.query(
    `INSERT INTO audit_log
       (actor_user_id, target_user_id, target_guest_id, target_type, action, reason,
        before_state, after_state, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::uuid)
     RETURNING id, created_at`,
    [
      entry.actorUserId || null,
      entry.targetUserId || null,
      entry.targetGuestId || null,
      entry.targetType,
      entry.action,
      entry.reason || null,
      JSON.stringify(entry.before || {}),
      JSON.stringify(entry.after || {}),
      correlationId
    ]
  );
  return result.rows[0];
}

function parseIpv6(address) {
  const parts = address.toLowerCase().split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (left.concat(right).some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if ((parts.length === 1 && left.length !== 8) || left.length + right.length > 8) return null;
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups.reduce((value, group) => (value << 16n) + BigInt(`0x${group}`), 0n);
}

function ipv4ToBigInt(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => (value << 8n) + BigInt(part), 0n);
}

function canonicalNetwork(cidr) {
  let [address, rawPrefix] = String(cidr || '').trim().split('/');
  if (address?.toLowerCase().startsWith('::ffff:')) address = address.slice(7);
  const family = net.isIP(address);
  if (!family || rawPrefix === undefined || !/^\d{1,3}$/.test(rawPrefix)) return null;
  const bits = family === 4 ? 32 : 128;
  const prefix = Number(rawPrefix);
  if (prefix < 0 || prefix > bits) return null;
  const value = family === 4 ? ipv4ToBigInt(address) : parseIpv6(address);
  if (value === null) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  return { family, prefix, value: value & mask };
}

function fingerprint(network, secret) {
  return crypto.createHmac('sha256', secret)
    .update(`${network.family}:${network.prefix}:${network.value.toString(16)}`)
    .digest('hex');
}

function fingerprintsForAddress(address, secret) {
  if (String(address || '').toLowerCase().startsWith('::ffff:')) address = String(address).slice(7);
  const family = net.isIP(address);
  if (!family) return [];
  const bits = family === 4 ? 32 : 128;
  const value = family === 4 ? ipv4ToBigInt(address) : parseIpv6(address);
  if (value === null) return [];
  const result = [];
  for (let prefix = 0; prefix <= bits; prefix += 1) {
    const mask = prefix === 0 ? 0n : ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
    result.push(fingerprint({ family, prefix, value: value & mask }, secret));
  }
  return result;
}

function createModerationService({ db, presence, chat, environment = process.env }) {
  const networkSecret = environment.NETWORK_BAN_HMAC_KEY || environment.SESSION_SECRET || 'development-network-ban-key';

  async function endAndDisconnectUser(userId, payload, event = 'account-banned') {
    if (chat?.terminateUser) await chat.terminateUser(userId, payload, event);
    else if (presence?.disconnectUser) presence.disconnectUser(userId, event, payload);
    else presence?.emitToUser(userId, event, payload);
  }

  return {
    async banAccount({ actorUserId, targetUserId, type, reason, hours, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      if (actorUserId === targetUserId) throw new ModerationError('SELF_MODERATION_FORBIDDEN', 'Administrators cannot ban themselves');
      const normalizedReason = requiredReason(reason);
      if (!['temporary', 'permanent'].includes(type)) throw new ModerationError('BAN_TYPE_INVALID', 'The ban type is invalid');
      const banType = type;
      const requestedHours = Number(hours);
      if (banType === 'temporary' && (!Number.isInteger(requestedHours) || requestedHours < 1 || requestedHours > 24 * 365)) {
        throw new ModerationError('BAN_DURATION_INVALID', 'A temporary ban requires a valid duration');
      }
      const durationHours = banType === 'temporary' ? requestedHours : 0;
      const outcome = await withTransaction(db, async (client) => {
        const target = await client.query(
          `SELECT id, public_id, role FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [targetUserId]
        );
        if (!target.rowCount) throw new ModerationError('TARGET_NOT_FOUND', 'The target account no longer exists');
        if (Number(target.rows[0].id) === actorUserId) throw new ModerationError('SELF_MODERATION_FORBIDDEN', 'Administrators cannot ban themselves');
        const existing = await client.query(
          `SELECT id, type, starts_at, ends_at FROM account_bans
           WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
             AND (type = 'permanent' OR ends_at > NOW())
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [targetUserId]
        );
        if (existing.rowCount) {
          return { ban: existing.rows[0], idempotent: true, target: target.rows[0] };
        }
        const inserted = await client.query(
          `INSERT INTO account_bans (user_id, type, reason, ends_at, created_by, correlation_id)
           VALUES ($1, $2::varchar(20), $3,
                   CASE WHEN $2::varchar(20) = 'temporary' THEN NOW() + make_interval(hours => $4::int) ELSE NULL END,
                   $5, $6::uuid)
           RETURNING id, type, starts_at, ends_at`,
          [targetUserId, banType, normalizedReason, durationHours, actorUserId, correlationId]
        );
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'account_ban', 'Account suspended', $2,
                   jsonb_build_object('type', $3::text, 'endsAt', $4::timestamptz))`,
          [targetUserId, normalizedReason, banType, inserted.rows[0].ends_at]
        );
        await revokeUserSessions(db, targetUserId, { client });
        await appendAudit(client, {
          actorUserId, targetUserId, targetType: 'account', action: 'account_ban_created',
          reason: normalizedReason, before: { activeBan: false },
          after: { banId: Number(inserted.rows[0].id), type: banType, endsAt: inserted.rows[0].ends_at }, correlationId
        });
        return { ban: inserted.rows[0], idempotent: false, target: target.rows[0] };
      });
      if (!outcome.idempotent) {
        await endAndDisconnectUser(targetUserId, {
          type: outcome.ban.type, endsAt: outcome.ban.ends_at, reason: normalizedReason
        });
      }
      return { ...outcome.ban, idempotent: outcome.idempotent, correlationId };
    },

    async revokeAccountBan({ actorUserId, banId, reason, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const outcome = await withTransaction(db, async (client) => {
        const ban = await client.query(
          `SELECT id, user_id, type, ends_at, revoked_at FROM account_bans WHERE id = $1 FOR UPDATE`,
          [banId]
        );
        if (!ban.rowCount) throw new ModerationError('BAN_NOT_FOUND', 'The ban does not exist');
        if (ban.rows[0].revoked_at) return { ban: ban.rows[0], idempotent: true };
        const revoked = await client.query(
          `UPDATE account_bans SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
           WHERE id = $3 AND revoked_at IS NULL RETURNING id, user_id, type, ends_at, revoked_at`,
          [actorUserId, normalizedReason, banId]
        );
        await appendAudit(client, {
          actorUserId, targetUserId: Number(revoked.rows[0].user_id), targetType: 'account',
          action: 'account_ban_revoked', reason: normalizedReason,
          before: { banId: Number(banId), activeBan: true }, after: { activeBan: false }, correlationId
        });
        return { ban: revoked.rows[0], idempotent: false };
      });
      return { ...outcome.ban, idempotent: outcome.idempotent, correlationId };
    },

    async requestNetworkBanPrivacyApproval({ actorUserId, cidr, reason, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const network = canonicalNetwork(cidr);
      if (!network) throw new ModerationError('NETWORK_INVALID', 'A valid IPv4 or IPv6 CIDR is required');
      if ((network.family === 4 && network.prefix < 24) || (network.family === 6 && network.prefix < 64)) {
        throw new ModerationError('NETWORK_TOO_BROAD', 'Network bans must be narrowly scoped');
      }
      const networkFingerprint = fingerprint(network, networkSecret);
      return withTransaction(db, async (client) => {
        const inserted = await client.query(
          `INSERT INTO network_ban_privacy_approvals
             (requested_by, network_fingerprint, address_family, prefix_length, request_reason, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours')
           RETURNING id, expires_at`,
          [actorUserId, networkFingerprint, network.family, network.prefix, normalizedReason]
        );
        await appendAudit(client, {
          actorUserId, targetType: 'network_privacy_approval', action: 'network_privacy_review_requested',
          reason: normalizedReason, before: {},
          after: { approvalId: inserted.rows[0].id, family: network.family, prefix: network.prefix, expiresAt: inserted.rows[0].expires_at },
          correlationId
        });
        return { id: inserted.rows[0].id, expires_at: inserted.rows[0].expires_at, correlationId };
      });
    },

    async approveNetworkBanPrivacyApproval({ reviewerUserId, approvalId, reason, reviewReference, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const reference = String(reviewReference || '').trim();
      if (reference.length < 3 || reference.length > 160) {
        throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'A privacy review reference is required');
      }
      return withTransaction(db, async (client) => {
        const approval = await client.query(
          `SELECT id, requested_by, address_family, prefix_length, status, expires_at
           FROM network_ban_privacy_approvals WHERE id = $1 FOR UPDATE`,
          [approvalId]
        );
        if (!approval.rowCount || approval.rows[0].status !== 'pending' || new Date(approval.rows[0].expires_at) <= new Date()) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'The privacy approval is unavailable');
        }
        if (Number(approval.rows[0].requested_by) === reviewerUserId) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'A second administrator must approve a network ban');
        }
        const reviewer = await client.query(
          `SELECT id FROM users WHERE id = $1 AND role = 'admin' AND deleted_at IS NULL FOR UPDATE`,
          [reviewerUserId]
        );
        if (!reviewer.rowCount) throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'The privacy reviewer must be an active administrator');
        await client.query(
          `UPDATE network_ban_privacy_approvals
           SET status = 'approved', approved_by = $1, approved_at = NOW(),
               approval_reason = $2, review_reference = $3
           WHERE id = $4`,
          [reviewerUserId, normalizedReason, reference, approvalId]
        );
        await appendAudit(client, {
          actorUserId: reviewerUserId, targetType: 'network_privacy_approval', action: 'network_privacy_review_approved',
          reason: normalizedReason, before: { approvalId, status: 'pending' },
          after: { approvalId, status: 'approved', family: Number(approval.rows[0].address_family), prefix: Number(approval.rows[0].prefix_length) },
          correlationId
        });
        return { id: approvalId, expires_at: approval.rows[0].expires_at, correlationId };
      });
    },

    async createNetworkBan({ actorUserId, cidr, reason, hours, privacyApprovalId, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const network = canonicalNetwork(cidr);
      if (!network) throw new ModerationError('NETWORK_INVALID', 'A valid IPv4 or IPv6 CIDR is required');
      if ((network.family === 4 && network.prefix < 24) || (network.family === 6 && network.prefix < 64)) {
        throw new ModerationError('NETWORK_TOO_BROAD', 'Network bans must be narrowly scoped');
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(privacyApprovalId || ''))) {
        throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'An approved privacy review is required');
      }
      const durationHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 30);
      const networkFingerprint = fingerprint(network, networkSecret);
      return withTransaction(db, async (client) => {
        const approval = await client.query(
          `SELECT id, requested_by, network_fingerprint, address_family, prefix_length,
                  approved_by, review_reference, status, expires_at, consumed_at
           FROM network_ban_privacy_approvals WHERE id = $1 FOR UPDATE`,
          [privacyApprovalId]
        );
        const reviewed = approval.rows[0];
        if (!reviewed || reviewed.status !== 'approved' || reviewed.consumed_at
          || Number(reviewed.requested_by) !== actorUserId
          || reviewed.network_fingerprint !== networkFingerprint
          || Number(reviewed.address_family) !== network.family || Number(reviewed.prefix_length) !== network.prefix
          || new Date(reviewed.expires_at) <= new Date()) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'An approved privacy review for this exact network is required');
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [networkFingerprint]);
        const existing = await client.query(
          `SELECT id, starts_at, ends_at FROM network_bans
           WHERE network_fingerprint = $1 AND revoked_at IS NULL AND starts_at <= NOW() AND ends_at > NOW()
           FOR UPDATE`, [networkFingerprint]
        );
        if (existing.rowCount) return { ...existing.rows[0], idempotent: true, correlationId };
        const inserted = await client.query(
          `INSERT INTO network_bans
             (network_fingerprint, address_family, prefix_length, reason, ends_at, created_by,
              privacy_reviewed_by, privacy_review_reference, correlation_id)
           VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5::int), $6, $7, $8, $9::uuid)
          RETURNING id, address_family, prefix_length, starts_at, ends_at`,
          [networkFingerprint, network.family, network.prefix, normalizedReason, durationHours, actorUserId,
            reviewed.approved_by, reviewed.review_reference, correlationId]
        );
        await client.query(
          `UPDATE network_ban_privacy_approvals SET consumed_at = NOW(), consumed_by = $1 WHERE id = $2`,
          [actorUserId, privacyApprovalId]
        );
        await appendAudit(client, {
          actorUserId, targetType: 'network', action: 'network_ban_created', reason: normalizedReason,
          before: { activeBan: false }, after: { banId: Number(inserted.rows[0].id), family: network.family, prefix: network.prefix, endsAt: inserted.rows[0].ends_at }, correlationId
        });
        return { ...inserted.rows[0], idempotent: false, correlationId };
      });
    },

    async revokeNetworkBan({ actorUserId, banId, reason, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      return withTransaction(db, async (client) => {
        const ban = await client.query('SELECT id, address_family, prefix_length, revoked_at FROM network_bans WHERE id = $1 FOR UPDATE', [banId]);
        if (!ban.rowCount) throw new ModerationError('BAN_NOT_FOUND', 'The network ban does not exist');
        if (ban.rows[0].revoked_at) return { ...ban.rows[0], idempotent: true, correlationId };
        const revoked = await client.query(
          `UPDATE network_bans SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
           WHERE id = $3 AND revoked_at IS NULL
           RETURNING id, address_family, prefix_length, ends_at, revoked_at`,
          [actorUserId, normalizedReason, banId]
        );
        await appendAudit(client, {
          actorUserId, targetType: 'network', action: 'network_ban_revoked', reason: normalizedReason,
          before: { banId: Number(banId), activeBan: true }, after: { activeBan: false }, correlationId
        });
        return { ...revoked.rows[0], idempotent: false, correlationId };
      });
    },

    async isNetworkBlocked(address) {
      const fingerprints = fingerprintsForAddress(address, networkSecret);
      if (!fingerprints.length) return false;
      const result = await db.query(
        `SELECT 1 FROM network_bans
         WHERE network_fingerprint = ANY($1::text[])
           AND revoked_at IS NULL AND starts_at <= NOW() AND ends_at > NOW()
         UNION ALL
         SELECT 1 FROM bans
         WHERE type = 'ip' AND ip_address = $2 AND starts_at <= NOW()
           AND (ends_at IS NULL OR ends_at > NOW()) LIMIT 1`,
        [fingerprints, address]
      );
      return Boolean(result.rowCount);
    },

    async disconnectUser(userId, payload, event = 'account-banned') {
      await endAndDisconnectUser(userId, payload, event);
    },

    appendAudit,
    withTransaction
  };
}

module.exports = {
  ModerationError,
  appendAudit,
  canonicalNetwork,
  createModerationService,
  fingerprintsForAddress,
  normalizedCorrelationId,
  requiredReason,
  withTransaction
};
