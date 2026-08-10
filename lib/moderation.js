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

function networkSafeAuditReason(reason) {
  return reason
    .replace(/\b(?:nvy|gst)_[0-9a-f]{12}\b/gi, '[principal]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g, '[network]')
    .replace(/\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]+(?:\/\d{1,3})?\b/gi, '[network]');
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

async function lockActiveAdmin(client, actorUserId) {
  const actor = await client.query(
    `SELECT id FROM users
     WHERE id = $1 AND role = 'admin' AND deleted_at IS NULL
     FOR UPDATE`,
    [actorUserId]
  );
  if (!actor.rowCount) throw new ModerationError('ADMIN_AUTH_REQUIRED', 'The administrator authorization is no longer valid');
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

function narrowNetworkForAddress(address) {
  let normalized = String(address || '').trim();
  if (normalized.toLowerCase().startsWith('::ffff:')) normalized = normalized.slice(7);
  const family = net.isIP(normalized);
  if (!family) return null;
  return canonicalNetwork(`${normalized}/${family === 4 ? 32 : 128}`);
}

function createModerationService({ db, presence, chat, controlChannel, environment = process.env }) {
  const networkSecret = environment.NETWORK_BAN_HMAC_KEY || environment.SESSION_SECRET || 'development-network-ban-key';

  async function endAndDisconnectUser(userId, payload, event = 'account-banned') {
    if (chat?.terminateUser) await chat.terminateUser(userId, payload, event);
    else if (presence?.disconnectUser) presence.disconnectUser(userId, event, payload);
    else presence?.emitToUser(userId, event, payload);
    await controlChannel?.publishUserTermination(userId, event);
  }

  async function endAndDisconnectGuest(guestId, payload) {
    await chat?.terminateGuest?.(guestId, payload, 'guest-restricted');
    await controlChannel?.publishGuestTermination?.(guestId);
  }

  async function endAndDisconnectNetwork(network) {
    await chat?.terminateNetwork?.(network);
    await controlChannel?.publishNetworkTermination?.(network);
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
        await revokeUserSessions(db, targetUserId, { client });
        await appendAudit(client, {
          actorUserId, targetUserId, targetType: 'account', action: 'account_ban_created',
          reason: normalizedReason, before: { activeBan: false },
          after: { banId: Number(inserted.rows[0].id), type: banType, endsAt: inserted.rows[0].ends_at }, correlationId
        });
        return { ban: inserted.rows[0], idempotent: false, target: target.rows[0] };
      });
      if (!outcome.idempotent) {
        await endAndDisconnectUser(targetUserId, {});
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

    async banGuest({ actorUserId, targetGuestId, type, reason, hours, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      if (!['temporary', 'permanent'].includes(type)) throw new ModerationError('GUEST_BAN_TYPE_INVALID', 'The guest ban type is invalid');
      const durationHours = Number(hours);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(targetGuestId || ''))) {
        throw new ModerationError('GUEST_NOT_FOUND', 'The guest principal no longer exists');
      }
      if (type === 'temporary' && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 24 * 30)) {
        throw new ModerationError('GUEST_BAN_DURATION_INVALID', 'A guest restriction requires a duration between 1 hour and 30 days');
      }
      const outcome = await withTransaction(db, async (client) => {
        await lockActiveAdmin(client, actorUserId);
        const target = await client.query(
          `SELECT id, device_principal_fingerprint FROM guest_principals
           WHERE id = $1 AND status = 'active' AND retention_until > NOW() FOR UPDATE`,
          [targetGuestId]
        );
        if (!target.rowCount) throw new ModerationError('GUEST_NOT_FOUND', 'The guest principal no longer exists');
        const existing = await client.query(
          `SELECT id, type, starts_at, ends_at FROM guest_bans
           WHERE guest_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
             AND (type = 'permanent' OR ends_at > NOW())
           ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [targetGuestId]
        );
        if (existing.rowCount) return { ban: existing.rows[0], idempotent: true };
        const inserted = await client.query(
          `INSERT INTO guest_bans (guest_id, type, reason, ends_at, created_by, correlation_id)
           VALUES ($1, $2::varchar(20), $3,
                   CASE WHEN $2::varchar(20) = 'temporary' THEN NOW() + make_interval(hours => $4::int) ELSE NULL END,
                   $5, $6::uuid)
           RETURNING id, type, starts_at, ends_at`,
          [targetGuestId, type, normalizedReason, type === 'temporary' ? durationHours : 0, actorUserId, correlationId]
        );
        if (type === 'permanent') {
          if (!target.rows[0].device_principal_fingerprint) {
            throw new ModerationError('GUEST_DEVICE_UNAVAILABLE', 'A permanent guest ban requires an established server-side device principal');
          }
          await client.query(
            `INSERT INTO guest_device_restrictions
               (device_principal_fingerprint, guest_ban_id, ends_at)
             VALUES ($1, $2, NULL)`,
            [target.rows[0].device_principal_fingerprint, inserted.rows[0].id]
          );
          await appendAudit(client, {
            actorUserId, targetGuestId, targetType: 'guest_device_restriction', action: 'guest_device_restriction_created',
            reason: normalizedReason, before: { activeRestriction: false },
            after: { guestBanId: Number(inserted.rows[0].id), activeRestriction: true }, correlationId
          });
        }
        await appendAudit(client, {
          actorUserId, targetGuestId, targetType: 'guest', action: 'guest_ban_created', reason: normalizedReason,
          before: { activeBan: false }, after: { banId: Number(inserted.rows[0].id), type, endsAt: inserted.rows[0].ends_at, deviceRestriction: type === 'permanent' }, correlationId
        });
        return { ban: inserted.rows[0], idempotent: false };
      });
      if (!outcome.idempotent) await endAndDisconnectGuest(targetGuestId, {});
      return { ...outcome.ban, idempotent: outcome.idempotent, correlationId };
    },

    async revokeGuestBan({ actorUserId, banId, reason, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const outcome = await withTransaction(db, async (client) => {
        await lockActiveAdmin(client, actorUserId);
        const ban = await client.query(
          'SELECT id, guest_id, type, ends_at, revoked_at FROM guest_bans WHERE id = $1 FOR UPDATE',
          [banId]
        );
        if (!ban.rowCount) throw new ModerationError('BAN_NOT_FOUND', 'The guest restriction does not exist');
        if (ban.rows[0].revoked_at) return { ban: ban.rows[0], idempotent: true };
        const revoked = await client.query(
          `UPDATE guest_bans SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
           WHERE id = $3 AND revoked_at IS NULL
           RETURNING id, guest_id, type, ends_at, revoked_at`,
          [actorUserId, normalizedReason, banId]
        );
        await client.query(
          `UPDATE guest_device_restrictions
           SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
           WHERE guest_ban_id = $3 AND revoked_at IS NULL`,
          [actorUserId, normalizedReason, banId]
        );
        if (ban.rows[0].type === 'permanent') {
          await appendAudit(client, {
            actorUserId, targetGuestId: revoked.rows[0].guest_id, targetType: 'guest_device_restriction',
            action: 'guest_device_restriction_revoked', reason: normalizedReason,
            before: { guestBanId: Number(banId), activeRestriction: true }, after: { activeRestriction: false }, correlationId
          });
        }
        await appendAudit(client, {
          actorUserId, targetGuestId: revoked.rows[0].guest_id, targetType: 'guest', action: 'guest_ban_revoked',
          reason: normalizedReason, before: { banId: Number(banId), activeBan: true }, after: { activeBan: false }, correlationId
        });
        return { ban: revoked.rows[0], idempotent: false };
      });
      return { ...outcome.ban, idempotent: outcome.idempotent, correlationId };
    },

    async requestNetworkBanPrivacyApproval({
      actorUserId,
      sourceType = 'account',
      publicId,
      cidr,
      reason,
      hours,
      correlationId = crypto.randomUUID()
    }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const safeReason = networkSafeAuditReason(normalizedReason);
      if (!['account', 'manual'].includes(sourceType)) {
        throw new ModerationError('NETWORK_SOURCE_INVALID', 'Choose an account or manual network source');
      }
      const durationHours = Number(hours);
      if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 24 * 30) {
        throw new ModerationError('BAN_DURATION_INVALID', 'A network ban requires a duration between 1 hour and 30 days');
      }
      return withTransaction(db, async (client) => {
        await lockActiveAdmin(client, actorUserId);
        let network;
        let sourceUserId = null;
        let sourceAccountBanId = null;
        if (sourceType === 'account') {
          if (!/^nvy_[0-9a-f]{12}$/.test(String(publicId || ''))) {
            throw new ModerationError('TARGET_NOT_FOUND', 'A canonical account Public ID is required');
          }
          const source = await client.query(
            `SELECT u.id, u.last_ip, u.last_network_seen_at, b.id AS account_ban_id
             FROM users u
             JOIN LATERAL (
               SELECT id FROM account_bans
               WHERE user_id = u.id AND revoked_at IS NULL AND starts_at <= NOW()
                 AND (type = 'permanent' OR ends_at > NOW())
               ORDER BY created_at DESC, id DESC LIMIT 1
             ) b ON true
             WHERE u.public_id = $1 AND u.deleted_at IS NULL
             FOR UPDATE OF u`,
            [publicId]
          );
          if (!source.rowCount) {
            throw new ModerationError('ACTIVE_ACCOUNT_BAN_REQUIRED', 'The account must have an active account ban');
          }
          const row = source.rows[0];
          if (!row.last_ip || !row.last_network_seen_at
              || new Date(row.last_network_seen_at).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
            throw new ModerationError('NETWORK_SIGNAL_STALE', 'A reliable network signal from the last 24 hours is required');
          }
          network = narrowNetworkForAddress(row.last_ip);
          if (!network) throw new ModerationError('NETWORK_SIGNAL_STALE', 'The recent server-side network signal is unavailable');
          sourceUserId = Number(row.id);
          sourceAccountBanId = Number(row.account_ban_id);
        } else {
          network = canonicalNetwork(cidr);
          if (!network) throw new ModerationError('NETWORK_INVALID', 'A valid IPv4 or IPv6 CIDR is required');
          if ((network.family === 4 && network.prefix < 24) || (network.family === 6 && network.prefix < 64)) {
            throw new ModerationError('NETWORK_TOO_BROAD', 'Manual network reviews must be no broader than IPv4 /24 or IPv6 /64');
          }
        }
        const networkFingerprint = fingerprint(network, networkSecret);
        const inserted = await client.query(
          `INSERT INTO network_ban_privacy_approvals
             (requested_by, network_fingerprint, address_family, prefix_length, request_reason,
              expires_at, source_type, source_user_id, source_account_ban_id, proposed_duration_hours)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours', $6, $7, $8, $9)
           RETURNING id, expires_at`,
          [actorUserId, networkFingerprint, network.family, network.prefix, safeReason,
            sourceType, sourceUserId, sourceAccountBanId, durationHours]
        );
        await appendAudit(client, {
          actorUserId, targetUserId: sourceUserId, targetType: 'network_privacy_approval', action: 'network_privacy_review_requested',
          reason: safeReason, before: {},
          after: { approvalId: inserted.rows[0].id, sourceType, family: network.family, prefix: network.prefix,
            durationHours, expiresAt: inserted.rows[0].expires_at },
          correlationId
        });
        return { id: inserted.rows[0].id, expires_at: inserted.rows[0].expires_at, correlationId };
      });
    },

    async reviewNetworkBanPrivacyApproval({
      reviewerUserId,
      approvalId,
      decision,
      reason,
      cidr,
      correlationId = crypto.randomUUID()
    }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const safeReviewReason = networkSafeAuditReason(normalizedReason);
      if (!['approve', 'reject'].includes(decision)) {
        throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'Choose approve or reject');
      }
      const outcome = await withTransaction(db, async (client) => {
        const approval = await client.query(
          `SELECT id, requested_by, network_fingerprint, address_family, prefix_length,
                  request_reason, status, expires_at, source_type, source_user_id,
                  source_account_ban_id, proposed_duration_hours, approved_by
           FROM network_ban_privacy_approvals WHERE id = $1 FOR UPDATE`,
          [approvalId]
        );
        if (!approval.rowCount) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'The privacy approval is unavailable');
        }
        const reviewed = approval.rows[0];
        if (reviewed.status === 'approved') {
          const existing = await client.query(
            `SELECT id, address_family, prefix_length, starts_at, ends_at
             FROM network_bans WHERE privacy_approval_id = $1`,
            [approvalId]
          );
          if (existing.rowCount && Number(reviewed.approved_by) === reviewerUserId && decision === 'approve') {
            return { ban: existing.rows[0], idempotent: true };
          }
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'The privacy approval is already resolved');
        }
        if (reviewed.status === 'rejected') {
          if (decision === 'reject') return { rejected: true, idempotent: true };
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'The privacy approval was rejected');
        }
        if (new Date(reviewed.expires_at) <= new Date()) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'The privacy approval has expired');
        }
        if (Number(reviewed.requested_by) === reviewerUserId) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'A second administrator must approve a network ban');
        }
        const administrators = await client.query(
          `SELECT id FROM users
           WHERE id = ANY($1::bigint[]) AND role = 'admin' AND deleted_at IS NULL
           ORDER BY id FOR UPDATE`,
          [[reviewerUserId, Number(reviewed.requested_by)]]
        );
        if (administrators.rowCount !== 2) {
          throw new ModerationError('PRIVACY_REVIEW_REQUIRED', 'Both reviewers must remain active administrators');
        }
        if (decision === 'reject') {
          await client.query(
            `UPDATE network_ban_privacy_approvals
             SET status = 'rejected', rejected_by = $1, rejected_at = NOW(), rejection_reason = $2
             WHERE id = $3 AND status = 'pending'`,
            [reviewerUserId, safeReviewReason, approvalId]
          );
          await appendAudit(client, {
            actorUserId: reviewerUserId, targetUserId: reviewed.source_user_id,
            targetType: 'network_privacy_approval', action: 'network_privacy_review_rejected',
            reason: safeReviewReason, before: { approvalId, status: 'pending' },
            after: { approvalId, status: 'rejected' }, correlationId
          });
          return { rejected: true, idempotent: false };
        }
        if (reviewed.source_type === 'account') {
          const activeSourceBan = await client.query(
            `SELECT id FROM account_bans
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND starts_at <= NOW()
               AND (type = 'permanent' OR ends_at > NOW())
             FOR UPDATE`,
            [reviewed.source_account_ban_id, reviewed.source_user_id]
          );
          if (!activeSourceBan.rowCount) {
            throw new ModerationError('ACTIVE_ACCOUNT_BAN_REQUIRED', 'The source account ban is no longer active');
          }
        }
        if (reviewed.source_type === 'manual') {
          const confirmed = canonicalNetwork(cidr);
          if (!confirmed || fingerprint(confirmed, networkSecret) !== reviewed.network_fingerprint
              || confirmed.family !== Number(reviewed.address_family)
              || confirmed.prefix !== Number(reviewed.prefix_length)) {
            throw new ModerationError('NETWORK_CONFIRMATION_MISMATCH', 'Re-enter the exact reviewed CIDR');
          }
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [reviewed.network_fingerprint]);
        const existing = await client.query(
          `SELECT id, starts_at, ends_at FROM network_bans
           WHERE network_fingerprint = $1 AND revoked_at IS NULL AND starts_at <= NOW() AND ends_at > NOW()
           FOR UPDATE`, [reviewed.network_fingerprint]
        );
        if (existing.rowCount) throw new ModerationError('NETWORK_ALREADY_ACTIVE', 'This network already has an active restriction');
        const reviewReference = `dual-control:${approvalId}`;
        const inserted = await client.query(
          `INSERT INTO network_bans
             (network_fingerprint, address_family, prefix_length, reason, ends_at, created_by,
              privacy_reviewed_by, privacy_review_reference, correlation_id, privacy_approval_id,
              source_type, source_user_id, source_account_ban_id)
           VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5::int), $6, $7, $8, $9::uuid,
                   $10, $11, $12, $13)
          RETURNING id, network_fingerprint, address_family, prefix_length, starts_at, ends_at`,
          [reviewed.network_fingerprint, reviewed.address_family, reviewed.prefix_length,
            reviewed.request_reason, reviewed.proposed_duration_hours, reviewed.requested_by,
            reviewerUserId, reviewReference, correlationId, approvalId, reviewed.source_type,
            reviewed.source_user_id, reviewed.source_account_ban_id]
        );
        await client.query(
          `UPDATE network_ban_privacy_approvals
           SET status = 'approved', approved_by = $1, approved_at = NOW(),
               approval_reason = $2, review_reference = $3,
               consumed_at = NOW(), consumed_by = $1
           WHERE id = $4 AND status = 'pending'`,
          [reviewerUserId, safeReviewReason, reviewReference, approvalId]
        );
        await appendAudit(client, {
          actorUserId: reviewerUserId, targetUserId: reviewed.source_user_id,
          targetType: 'network_privacy_approval', action: 'network_privacy_review_approved',
          reason: safeReviewReason, before: { approvalId, status: 'pending' },
          after: { approvalId, status: 'approved', family: Number(reviewed.address_family), prefix: Number(reviewed.prefix_length) },
          correlationId
        });
        await appendAudit(client, {
          actorUserId: reviewerUserId, targetUserId: reviewed.source_user_id,
          targetType: 'network', action: 'network_ban_created', reason: networkSafeAuditReason(reviewed.request_reason),
          before: { activeBan: false }, after: { banId: Number(inserted.rows[0].id),
            sourceType: reviewed.source_type, family: Number(reviewed.address_family),
            prefix: Number(reviewed.prefix_length), endsAt: inserted.rows[0].ends_at }, correlationId
        });
        return { ban: inserted.rows[0], idempotent: false };
      });
      if (outcome.ban && !outcome.idempotent) {
        await endAndDisconnectNetwork({
          networkFingerprint: outcome.ban.network_fingerprint,
          addressFamily: Number(outcome.ban.address_family),
          prefixLength: Number(outcome.ban.prefix_length)
        });
      }
      return outcome;
    },

    async approveNetworkBanPrivacyApproval(input) {
      return this.reviewNetworkBanPrivacyApproval({ ...input, decision: 'approve' });
    },

    async listPendingNetworkBanPrivacyApprovals({ limit = 50 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const result = await db.query(
        `SELECT a.id, a.source_type, source.public_id AS source_public_id,
                CASE WHEN source_ban.id IS NULL THEN false ELSE true END AS source_ban_active,
                a.request_reason, a.proposed_duration_hours, a.address_family,
                a.prefix_length, a.network_fingerprint, requester.public_id AS requester_public_id,
                a.expires_at, a.created_at
         FROM network_ban_privacy_approvals a
         JOIN users requester ON requester.id = a.requested_by
         LEFT JOIN users source ON source.id = a.source_user_id
         LEFT JOIN account_bans source_ban ON source_ban.id = a.source_account_ban_id
           AND source_ban.revoked_at IS NULL AND source_ban.starts_at <= NOW()
           AND (source_ban.type = 'permanent' OR source_ban.ends_at > NOW())
         WHERE a.status = 'pending' AND a.expires_at > NOW()
         ORDER BY a.created_at DESC, a.id DESC LIMIT $1`,
        [safeLimit]
      );
      return result.rows.map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        sourcePublicId: row.source_public_id || null,
        sourceAccountBanActive: row.source_ban_active,
        reason: row.request_reason,
        durationHours: Number(row.proposed_duration_hours),
        addressFamily: Number(row.address_family),
        prefixLength: Number(row.prefix_length),
        networkReference: `net_${String(row.network_fingerprint).slice(0, 12)}`,
        requesterPublicId: row.requester_public_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at
      }));
    },

    async revokeNetworkBan({ actorUserId, banId, reason, correlationId = crypto.randomUUID() }) {
      correlationId = normalizedCorrelationId(correlationId);
      const normalizedReason = requiredReason(reason);
      const safeReason = networkSafeAuditReason(normalizedReason);
      return withTransaction(db, async (client) => {
        await lockActiveAdmin(client, actorUserId);
        const ban = await client.query('SELECT id, address_family, prefix_length, revoked_at FROM network_bans WHERE id = $1 FOR UPDATE', [banId]);
        if (!ban.rowCount) throw new ModerationError('BAN_NOT_FOUND', 'The network ban does not exist');
        if (ban.rows[0].revoked_at) return { ...ban.rows[0], idempotent: true, correlationId };
        const revoked = await client.query(
          `UPDATE network_bans SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
           WHERE id = $3 AND revoked_at IS NULL
           RETURNING id, address_family, prefix_length, ends_at, revoked_at`,
          [actorUserId, safeReason, banId]
        );
        await appendAudit(client, {
          actorUserId, targetType: 'network', action: 'network_ban_revoked', reason: safeReason,
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

    matchesNetworkControl(address, control) {
      if (!control || !/^[0-9a-f]{64}$/.test(String(control.networkFingerprint || ''))) return false;
      const family = Number(control.addressFamily);
      const prefix = Number(control.prefixLength);
      let normalized = String(address || '').trim();
      if (normalized.toLowerCase().startsWith('::ffff:')) normalized = normalized.slice(7);
      if (net.isIP(normalized) !== family) return false;
      const network = canonicalNetwork(`${normalized}/${prefix}`);
      return Boolean(network && fingerprint(network, networkSecret) === control.networkFingerprint);
    },

    async disconnectNetwork(network) {
      await endAndDisconnectNetwork(network);
    },

    async isGuestBlocked(guestId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(guestId || ''))) return false;
      const result = await db.query(
        `SELECT 1 FROM guest_bans
         WHERE guest_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
           AND (type = 'permanent' OR ends_at > NOW())
         LIMIT 1`,
        [guestId]
      );
      return Boolean(result.rowCount);
    },

    async isGuestDeviceRestricted(devicePrincipalFingerprint) {
      if (!/^[0-9a-f]{64}$/.test(String(devicePrincipalFingerprint || ''))) return false;
      const result = await db.query(
        `SELECT 1
         FROM guest_device_restrictions d
         JOIN guest_bans b ON b.id = d.guest_ban_id
         WHERE d.device_principal_fingerprint = $1
           AND d.revoked_at IS NULL AND d.starts_at <= NOW()
           AND (d.ends_at IS NULL OR d.ends_at > NOW())
           AND b.revoked_at IS NULL AND b.starts_at <= NOW()
           AND (b.type = 'permanent' OR b.ends_at > NOW())
         LIMIT 1`,
        [devicePrincipalFingerprint]
      );
      return Boolean(result.rowCount);
    },

    async isGuestDeviceRestrictedForGuest(guestId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(guestId || ''))) return false;
      const result = await db.query(
        `SELECT 1
         FROM guest_principals g
         JOIN guest_device_restrictions d ON d.device_principal_fingerprint = g.device_principal_fingerprint
         JOIN guest_bans b ON b.id = d.guest_ban_id
         WHERE g.id = $1 AND d.revoked_at IS NULL AND d.starts_at <= NOW()
           AND (d.ends_at IS NULL OR d.ends_at > NOW())
           AND b.revoked_at IS NULL AND b.starts_at <= NOW()
           AND (b.type = 'permanent' OR b.ends_at > NOW())
         LIMIT 1`,
        [guestId]
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
