const { cleanText } = require('./auth');
const { cleanPublicId, isPublicId } = require('./public-identifiers');
const { createModerationRateLimiter } = require('./moderation-rate-limit');
const copy = require('../public/i18n/en.json');
const safeLog = require('./safe-log');

const GUEST_SKIP_COOLDOWN_MS = 10_000;
const FREE_SKIP_COOLDOWN_MS = 3_000;
const MAX_MESSAGE_LENGTH = 1000;
const DEFAULT_WAITING_TIME_SECONDS = 10;
const AGE_FILTER_RANGES = Object.freeze({
  '18-24': { min: 18, max: 24 },
  '25-34': { min: 25, max: 34 },
  '35-44': { min: 35, max: 44 },
  '45-54': { min: 45, max: 54 },
  '55-59': { min: 55, max: 59 },
  '60+': { min: 60, max: 99 }
});
const STANDARD_GENDERS = new Set(['male', 'female', 'non-binary']);

function registerChat(io, db, presence, options = {}) {
  const guestDurationSeconds = options.guestDurationSeconds || 120;
  const log = options.log || safeLog;
  const isNetworkBlocked = options.isNetworkBlocked || (async () => false);
  const isGuestBlocked = options.isGuestBlocked || (async () => false);
  const waitingUsers = [];
  const activePairs = new Map();
  const guestTimers = new Map();
  const waitingTimers = new Map();
  const idleWaiters = new Set();
  const pendingPersistence = new Set();
  const enforcePersistentGuestOwnership = options.enforcePersistentGuestOwnership !== false;
  const rateLimiter = options.rateLimiter || createModerationRateLimiter({
    db,
    policies: options.rateLimitPolicies
  });
  const rateLimitPrincipalResolver = options.rateLimitPrincipalResolver;
  let draining = false;
  let drainRetryAfterSeconds = 0;
  const bannedWords = (process.env.BANNED_WORDS || '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

  function normalizeInterests(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length >= 2 && item.length <= 30))].slice(0, 5);
  }

  function profileForSocket(socket, payload = {}) {
    const account = socket.request.session?.user || null;
    const guestProfile = !account ? socket.request.session?.guestProfile || null : null;
    const supplied = payload.profile || {};
    const isGuest = !account;
    const plan = account?.plan || 'guest';
    return {
      socketId: socket.id,
      userId: account?.internalId || null,
      publicId: account?.publicId || null,
      guestId: socket.request.session?.guestPrincipalId || guestProfile?.id || null,
      displayName: account?.displayName || guestProfile?.name || cleanText(supplied.username, 24) || copy.common.guest,
      age: account?.age || Number(guestProfile?.age) || Number(supplied.age) || null,
      gender: account?.gender || guestProfile?.gender || cleanText(supplied.gender, 30) || null,
      country: account?.country || guestProfile?.country?.name || cleanText(supplied.country, 80) || null,
      profileImageUrl: account?.profileImageUrl || null,
      plan,
      isGuest,
      interests: normalizeInterests(payload.interests),
      filters: plan === 'premium' ? normalizeFilters(payload.filters) : null
    };
  }

  function normalizeFilters(value) {
    if (!value || typeof value !== 'object') return null;
    const genderValues = Array.isArray(value.genders) ? value.genders : [value.gender];
    const countryValues = Array.isArray(value.countries) ? value.countries : [value.country];
    const genders = [...new Set(genderValues.map(normalizeGender).filter(Boolean))].slice(0, 4);
    const countries = [...new Set(countryValues.map(normalizeCountry).filter(Boolean))].slice(0, 280);
    const ageRanges = [];

    if (Array.isArray(value.ageRanges)) {
      [...new Set(value.ageRanges)].forEach((key) => {
        if (typeof key === 'string' && AGE_FILTER_RANGES[key]) {
          ageRanges.push({ key, ...AGE_FILTER_RANGES[key] });
        }
      });
    }

    const hasLegacyAgeFilter = value.minAge !== undefined || value.maxAge !== undefined;
    if (!ageRanges.length && hasLegacyAgeFilter) {
      const min = Math.min(Math.max(Number(value.minAge) || 18, 18), 99);
      const max = Math.min(Math.max(Number(value.maxAge) || 99, min), 99);
      ageRanges.push({ key: 'legacy', min, max });
    }

    if (!genders.length && !countries.length && !ageRanges.length) return null;
    return { genders, countries, ageRanges };
  }

  function filtersAccept(owner, candidate) {
    const filters = owner.filters;
    if (!filters) return true;

    if (filters.genders.length) {
      const candidateGender = normalizeGender(candidate.gender);
      const matchesSelectedGender = filters.genders.includes(candidateGender);
      const matchesOther = filters.genders.includes('other')
        && candidateGender
        && !STANDARD_GENDERS.has(candidateGender);
      if (!matchesSelectedGender && !matchesOther) return false;
    }

    if (filters.countries.length && !filters.countries.includes(normalizeCountry(candidate.country))) {
      return false;
    }

    if (filters.ageRanges.length) {
      const candidateAge = Number(candidate.age);
      const matchesSelectedAge = Number.isFinite(candidateAge)
        && filters.ageRanges.some(({ min, max }) => candidateAge >= min && candidateAge <= max);
      if (!matchesSelectedAge) return false;
    }

    return true;
  }

  function normalizeGender(value) {
    const gender = cleanText(value, 30).toLowerCase();
    if (gender === 'man') return 'male';
    if (gender === 'woman') return 'female';
    if (gender === 'nonbinary' || gender === 'non binary') return 'non-binary';
    return gender;
  }

  function normalizeCountry(value) {
    return cleanText(value, 80).toLowerCase();
  }

  async function authorizePersistentGuest(user) {
    if (!db.isConfigured || !user.isGuest || !enforcePersistentGuestOwnership) return user;
    if (!user.guestId) return null;
    const result = await db.query(
      `SELECT name, age, gender, country
       FROM guest_principals
       WHERE id = $1
         AND status = 'active'
         AND retention_until > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM guest_bans
           WHERE guest_id = guest_principals.id
             AND revoked_at IS NULL AND starts_at <= NOW() AND ends_at > NOW()
         )`,
      [user.guestId]
    );
    if (!result.rowCount) return null;
    return {
      ...user,
      displayName: result.rows[0].name,
      age: Number(result.rows[0].age),
      gender: result.rows[0].gender,
      country: result.rows[0].country
    };
  }

  async function isBlockedPair(a, b) {
    if (!db.isConfigured || !a.userId || !b.userId) return false;
    const result = await db.query(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [a.userId, b.userId]
    );
    return result.rowCount > 0;
  }

  async function findMatch(user) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < waitingUsers.length; index += 1) {
      const candidate = waitingUsers[index];
      if (candidate.socketId === user.socketId) continue;
      if (!filtersAccept(user, candidate) || !filtersAccept(candidate, user)) continue;
      if (await isBlockedPair(user, candidate)) continue;
      const score = candidate.interests.filter((tag) => user.interests.includes(tag)).length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) return null;
    return waitingUsers.splice(bestIndex, 1)[0];
  }

  function clearGuestTimer(socketId) {
    const timer = guestTimers.get(socketId);
    if (timer) clearTimeout(timer);
    guestTimers.delete(socketId);
  }

  function clearWaitingTimer(socketId) {
    const timer = waitingTimers.get(socketId);
    if (timer) clearTimeout(timer);
    waitingTimers.delete(socketId);
  }

  function removeFromWaiting(socketId) {
    const index = waitingUsers.findIndex((user) => user.socketId === socketId);
    if (index !== -1) waitingUsers.splice(index, 1);
    clearWaitingTimer(socketId);
  }

  function normalizeWaitingTime(value) {
    if (value === null || value === 'unlimited') return null;
    const seconds = Number(value);
    return Number.isInteger(seconds) && seconds >= 5 && seconds <= 30
      ? seconds
      : DEFAULT_WAITING_TIME_SECONDS;
  }

  function startWaitingTimer(socket, seconds) {
    clearWaitingTimer(socket.id);
    if (seconds === null) return;
    const timer = setTimeout(() => {
      removeFromWaiting(socket.id);
      socket.emit('waiting-timeout', { seconds });
    }, seconds * 1000);
    timer.unref?.();
    waitingTimers.set(socket.id, timer);
  }

  function cooldownFor(user) {
    if (user.plan === 'premium') return 0;
    return user.isGuest ? GUEST_SKIP_COOLDOWN_MS : FREE_SKIP_COOLDOWN_MS;
  }

  async function createConversation(a, b, type) {
    if (!db.isConfigured) return null;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const conversation = await client.query(
        `INSERT INTO conversations (type) VALUES ($1) RETURNING id`,
        [type]
      );
      const conversationId = Number(conversation.rows[0].id);
      await client.query(
        `INSERT INTO conversation_participants
           (conversation_id, user_id, guest_id, socket_id, display_name)
         VALUES ($1, $2, $3, $4, $5), ($1, $6, $7, $8, $9)`,
        [
          conversationId,
          a.userId,
          a.guestId,
          a.socketId,
          a.displayName,
          b.userId,
          b.guestId,
          b.socketId,
          b.displayName
        ]
      );
      await client.query('COMMIT');
      return conversationId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function pairUsers(a, b, type = 'random') {
    clearWaitingTimer(a.socketId);
    clearWaitingTimer(b.socketId);
    let conversationId = null;
    try {
      conversationId = await createConversation(a, b, type);
    } catch (error) {
      log.error('chat.conversation_create_failed', error);
    }
    const startedAt = Date.now();
    activePairs.set(a.socketId, { partnerId: b.socketId, conversationId, user: a, partner: b, skipAllowedAt: startedAt + cooldownFor(a) });
    activePairs.set(b.socketId, { partnerId: a.socketId, conversationId, user: b, partner: a, skipAllowedAt: startedAt + cooldownFor(b) });
    const shared = a.interests.filter((tag) => b.interests.includes(tag));

    io.to(a.socketId).emit('matched', matchPayload(a, b, shared, conversationId));
    io.to(b.socketId).emit('matched', matchPayload(b, a, shared, conversationId));

    if (a.isGuest || b.isGuest) {
      const timer = setTimeout(() => {
        void endPair(a.socketId, 'guest-time-expired');
      }, guestDurationSeconds * 1000);
      guestTimers.set(a.socketId, timer);
      guestTimers.set(b.socketId, timer);
    }
  }

  function matchPayload(user, partner, shared, conversationId) {
    return {
      sharedInterests: shared,
      isGuest: user.isGuest || partner.isGuest,
      durationSeconds: user.isGuest || partner.isGuest ? guestDurationSeconds : null,
      conversationId,
      partner: {
        publicId: partner.publicId,
        displayName: partner.displayName,
        profileImageUrl: partner.profileImageUrl,
        country: partner.country
      },
      skipCooldownSeconds: Math.ceil(cooldownFor(user) / 1000)
    };
  }

  async function markConversationEnded(conversationId) {
    if (!db.isConfigured || !conversationId) return;
    try {
      await db.query(
        `UPDATE conversations SET status = 'ended',
             ended_at = COALESCE(ended_at, NOW()),
             last_activity_at = GREATEST(last_activity_at, NOW()),
             expires_at = GREATEST(last_activity_at, NOW()) + INTERVAL '7 days'
         WHERE id = $1 AND status = 'active'`,
        [conversationId]
      );
      await db.query(
        `UPDATE conversation_participants SET left_at = COALESCE(left_at, NOW()) WHERE conversation_id = $1`,
        [conversationId]
      );
    } catch (error) {
      log.error('chat.conversation_end_failed', error);
    }
  }

  function notifyIdle() {
    if (activePairs.size || pendingPersistence.size) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  async function endPair(socketId, eventForBoth = null) {
    const active = activePairs.get(socketId);
    if (!active) return;
    const partner = activePairs.get(active.partnerId);
    activePairs.delete(socketId);
    activePairs.delete(active.partnerId);
    clearGuestTimer(socketId);
    clearGuestTimer(active.partnerId);
    const persisted = markConversationEnded(active.conversationId);
    pendingPersistence.add(persisted);
    if (eventForBoth) {
      io.to(socketId).emit(eventForBoth);
      io.to(active.partnerId).emit(eventForBoth);
    } else {
      io.to(active.partnerId).emit('partner-left', { conversationId: active.conversationId });
    }
    try {
      await persisted;
    } finally {
      pendingPersistence.delete(persisted);
    }
    notifyIdle();
    return partner;
  }

  async function consumeRateLimit(user, action) {
    if (!db.isConfigured) return { allowed: true, retryAfterSeconds: 0 };
    const fallbackPrincipal = user?.userId
      ? { principalType: 'user', principalId: user.userId }
      : { principalType: 'guest', principalId: user?.guestId };
    const resolvedPrincipal = fallbackPrincipal.principalId
      ? fallbackPrincipal
      : rateLimitPrincipalResolver?.(user, action);
    const principalType = resolvedPrincipal?.principalType;
    const principalId = resolvedPrincipal?.principalId;
    if (!principalId) return { allowed: false, retryAfterSeconds: 0 };
    return rateLimiter.consume({ principalType, principalId, action });
  }

  function moderationReason(text) {
    const lowered = text.toLowerCase();
    return bannedWords.find((word) => lowered.includes(word)) ? copy.errors.safetyBlocked : null;
  }

  async function persistMessage(active, socketId, text) {
    if (!db.isConfigured || !active.conversationId) return null;
    const result = await db.query(
      `WITH new_message AS (
         INSERT INTO messages
           (conversation_id, sender_user_id, sender_guest_id, sender_socket_id,
            sender_display_name, body)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, conversation_id, sender_user_id, sender_guest_id, created_at
       ), new_receipts AS (
         INSERT INTO message_receipts (message_id, user_id, guest_id, delivered_at)
         SELECT DISTINCT new_message.id, cp.user_id, cp.guest_id, NOW()
         FROM new_message
         JOIN conversation_participants cp ON cp.conversation_id = new_message.conversation_id
         WHERE (cp.user_id IS NOT NULL OR cp.guest_id IS NOT NULL)
           AND NOT (
             cp.user_id IS NOT DISTINCT FROM new_message.sender_user_id
             AND cp.guest_id IS NOT DISTINCT FROM new_message.sender_guest_id
           )
           ON CONFLICT DO NOTHING
           RETURNING message_id
       ), touched_conversation AS (
         UPDATE conversations c
         SET last_activity_at = new_message.created_at,
             expires_at = new_message.created_at + INTERVAL '7 days'
         FROM new_message
         WHERE c.id = new_message.conversation_id
         RETURNING c.id
       )
       SELECT id, created_at, (SELECT COUNT(*)::int FROM new_receipts) AS receipt_count
       FROM new_message
       WHERE EXISTS (SELECT 1 FROM touched_conversation)`,
      [
        active.conversationId,
        active.user.userId,
        active.user.guestId,
        socketId,
        active.user.displayName,
        text
      ]
    );
    return result.rows[0];
  }

  io.on('connection', (socket) => {
    const account = socket.request.session?.user || null;
    presence.add(account?.internalId, socket.id);
    const ipAddress = socket.handshake.address;
    if (db.isConfigured) {
      socket.use(async (_packet, next) => {
        try {
          const guestId = !account
            ? socket.request.session?.guestPrincipalId || socket.request.session?.guestProfile?.id || null
            : null;
          const [accountBan, networkBan, guestBan] = await Promise.all([
            db.query(
              `SELECT 1 FROM account_bans
               WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
                 AND (type = 'permanent' OR ends_at > NOW())
               UNION ALL
               SELECT 1 FROM bans WHERE user_id = $1 AND starts_at <= NOW()
                 AND (type = 'permanent' OR ends_at > NOW()) LIMIT 1`,
              [account?.internalId || null]
            ),
            isNetworkBlocked(ipAddress),
            guestId ? isGuestBlocked(guestId) : false
          ]);
          if (accountBan.rowCount || networkBan || guestBan) {
            socket.emit(guestBan ? 'guest-restricted' : 'account-banned', guestBan ? {} : { type: 'blocked' });
            socket.disconnect(true);
            return;
          }
          if (!account) return next();
          const current = (await db.query(
            `SELECT session_version, deleted_at
             FROM users WHERE id = $1`,
            [account.internalId]
          )).rows[0];
          if (!current
            || current.deleted_at
            || Number(current.session_version) !== Number(account.sessionVersion)) {
            socket.emit('auth-required');
            socket.disconnect(true);
            return;
          }
          next();
        } catch (error) {
          log.error('chat.socket_session_check_failed', error);
          next(new Error(copy.errors.serviceUnavailable));
        }
      });
    }

    if (draining) {
      socket.emit('release-draining', { retryAfterSeconds: drainRetryAfterSeconds });
      socket.disconnect(true);
      presence.remove(account?.internalId, socket.id);
      return;
    }

    socket.on('find-partner', async (payload = {}) => {
      if (draining) {
        socket.emit('release-draining', { retryAfterSeconds: drainRetryAfterSeconds });
        return;
      }
      if (account && !account.emailVerified) {
        socket.emit('chat-error', { message: copy.errors.emailVerificationRequired });
        return;
      }
      try {
        const current = activePairs.get(socket.id);
        if (current && Date.now() < current.skipAllowedAt) {
          socket.emit('skip-cooldown', { remainingMs: current.skipAllowedAt - Date.now() });
          return;
        }
        if (current) await endPair(socket.id);
        removeFromWaiting(socket.id);
        const user = await authorizePersistentGuest(profileForSocket(socket, payload));
        if (!user) {
          socket.emit('chat-error', { message: copy.errors.guestProfileMissing });
          return;
        }
        const rate = await consumeRateLimit(user, 'match');
        if (!rate.allowed) {
          socket.emit('chat-error', { message: copy.errors.messagesTooFast, retryAfterSeconds: rate.retryAfterSeconds });
          return;
        }
        const waitingTimeSeconds = normalizeWaitingTime(payload.waitingTimeSeconds);
        const match = await findMatch(user);
        if (match) await pairUsers(user, match);
        else {
          waitingUsers.push(user);
          startWaitingTimer(socket, waitingTimeSeconds);
          socket.emit('waiting', { waitingTimeSeconds });
        }
      } catch (error) {
        log.error('chat.matching_failed', error);
        socket.emit('chat-error', { message: copy.errors.matchingUnavailable });
      }
    });

    socket.on('refresh-guest-session', (acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (socket.request.session?.user) return done({ ok: false, error: copy.errors.alreadySignedIn });
      socket.request.session.reload((error) => {
        if (error) return done({ ok: false, error: copy.errors.guestSessionRefresh });
        return done({ ok: true });
      });
    });

    socket.on('send-message', async (rawText) => {
      if (account && !account.emailVerified) {
        socket.emit('message-error', { message: copy.errors.emailVerificationRequired });
        return;
      }
      const active = activePairs.get(socket.id);
      const text = cleanText(rawText, MAX_MESSAGE_LENGTH);
      if (!active || !text) return;
      try {
        const rate = await consumeRateLimit(active.user, 'message');
        if (!rate.allowed) return socket.emit('message-error', { message: copy.errors.messagesTooFast, retryAfterSeconds: rate.retryAfterSeconds });
        const blockedReason = moderationReason(text);
        if (blockedReason) return socket.emit('message-error', { message: blockedReason });
        const stored = await persistMessage(active, socket.id, text);
        io.to(active.partnerId).emit('receive-message', {
          id: stored?.id || null, text, createdAt: stored?.created_at || new Date().toISOString()
        });
        socket.emit('message-sent', { id: stored?.id || null });
      } catch (error) {
        log.error('chat.message_persistence_failed', error);
        socket.emit('message-error', { message: copy.errors.messageSend });
      }
    });

    socket.on('messages-read', async (payload = {}, acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      const conversationId = Number(payload.conversationId);
      const upToMessageId = Number(payload.upToMessageId);
      const sessionAccount = socket.request.session?.user || null;
      const sessionGuestId = sessionAccount
        ? null
        : socket.request.session?.guestPrincipalId || socket.request.session?.guestProfile?.id || null;
      if ((!sessionAccount && !sessionGuestId) || !db.isConfigured) {
        return done({ ok: false, error: copy.errors.accountRequired });
      }
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0
          || !Number.isSafeInteger(upToMessageId) || upToMessageId <= 0) {
        return done({ ok: false, error: copy.errors.readReceiptInvalid });
      }

      try {
        const result = await db.query(
          `UPDATE message_receipts mr
           SET delivered_at = COALESCE(mr.delivered_at, NOW()),
               read_at = COALESCE(mr.read_at, NOW())
           FROM messages m
            WHERE mr.message_id = m.id
              AND (mr.user_id = $1 OR mr.guest_id = $2)
              AND mr.read_at IS NULL
              AND m.conversation_id = $3
              AND m.id <= $4
              AND m.deleted_for_everyone_at IS NULL
              AND EXISTS (
                SELECT 1 FROM conversation_participants cp
                WHERE cp.conversation_id = m.conversation_id
                  AND (cp.user_id = $1 OR cp.guest_id = $2)
              )
            RETURNING mr.message_id, mr.read_at, m.sender_user_id, m.sender_guest_id`,
           [sessionAccount?.internalId || null, sessionGuestId, conversationId, upToMessageId]
         );
        const readAt = result.rows[0]?.read_at || null;
        if (readAt) {
          const senderIds = new Set(result.rows.map((row) => Number(row.sender_user_id)).filter(Boolean));
          for (const senderId of senderIds) {
            presence.emitToUser(senderId, 'message-read', { conversationId, upToMessageId, readAt });
          }
        }
        done({ ok: true, updated: result.rowCount, readAt });
      } catch (error) {
        log.error('chat.read_receipt_failed', error);
        done({ ok: false, error: copy.errors.readReceiptSave });
      }
    });

    socket.on('leave-chat', async () => {
      const current = activePairs.get(socket.id);
      let blockedPartner = false;
      if (current?.user.userId && current.partner.userId && db.isConfigured) {
        try {
          const block = await db.query(
            `SELECT 1 FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2 LIMIT 1`,
            [current.user.userId, current.partner.userId]
          );
          blockedPartner = block.rowCount > 0;
        } catch (error) {
          log.error('chat.block_check_failed', error);
        }
      }
      if (current && !blockedPartner && Date.now() < current.skipAllowedAt) {
        socket.emit('skip-cooldown', { remainingMs: current.skipAllowedAt - Date.now() });
        return;
      }
      await endPair(socket.id);
      removeFromWaiting(socket.id);
    });

    socket.on('report', async (payload = {}) => {
      const active = activePairs.get(socket.id);
      if (!active) return socket.emit('report-error', { message: copy.errors.reportNoChat });
      if (!db.isConfigured) return socket.emit('report-submitted', { stored: false });
      let client;
      try {
        const rate = await consumeRateLimit(active.user, 'report');
        if (!rate.allowed) {
          socket.emit('report-error', { message: copy.errors.messagesTooFast, retryAfterSeconds: rate.retryAfterSeconds });
          return;
        }
        client = await db.getClient();
        await client.query('BEGIN');
        const report = await client.query(
          `INSERT INTO reports
             (reporter_user_id, reporter_guest_id, reported_user_id, reported_guest_id,
              reporter_socket_id, reported_socket_id, conversation_id, reason, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, retention_until`,
          [
            active.user.userId,
            active.user.guestId,
            active.partner.userId,
            active.partner.guestId,
            socket.id,
            active.partnerId,
            active.conversationId,
            cleanText(payload.reason, 100) || 'unspecified',
            cleanText(payload.details, 1000) || null
          ]
        );
        await client.query(
          `INSERT INTO report_evidence_snapshots
             (report_id, conversation_id, expires_at, messages)
           SELECT $1, $2, $3,
                  COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'messageId', evidence.id,
                        'senderRole', evidence.sender_role,
                        'body', evidence.body,
                        'createdAt', evidence.created_at
                      )
                      ORDER BY evidence.id
                    ),
                    '[]'::jsonb
                  )
           FROM (
             SELECT m.id,
                    CASE
                      WHEN m.sender_socket_id = $4 THEN 'reporter'
                      WHEN m.sender_socket_id = $5 THEN 'reported'
                      ELSE 'participant'
                    END AS sender_role,
                    m.body,
                    m.created_at
             FROM messages m
             WHERE m.conversation_id = $2
               AND m.deleted_for_everyone_at IS NULL
             ORDER BY m.id DESC
             LIMIT 50
           ) evidence`,
          [
            report.rows[0].id,
            active.conversationId,
            report.rows[0].retention_until,
            socket.id,
            active.partnerId
          ]
        );
        await client.query('COMMIT');
        socket.emit('report-submitted', { stored: true });
      } catch (error) {
        await client?.query('ROLLBACK').catch(() => {});
        log.error('chat.report_save_failed', error);
        socket.emit('report-error', { message: copy.errors.reportSave });
      } finally {
        client?.release();
      }
    });

    socket.on('direct-chat-request', async (payload = {}) => {
      if (draining) {
        socket.emit('release-draining', { retryAfterSeconds: drainRetryAfterSeconds });
        return;
      }
      if (!account || !db.isConfigured) return socket.emit('direct-chat-error', { message: copy.errors.accountRequired });
      if (!account.emailVerified) {
        return socket.emit('direct-chat-error', { message: copy.errors.emailVerificationRequired });
      }
      try {
        const receiverPublicId = cleanPublicId(payload.publicId || payload.userId);
        const receiver = await db.query(
          `SELECT id FROM users
           WHERE ${isPublicId(receiverPublicId, 'user') ? 'public_id' : 'legacy_public_id'} = $1
             AND deleted_at IS NULL`,
          [receiverPublicId]
        );
        const receiverId = Number(receiver.rows[0]?.id);
        if (!receiverId) return socket.emit('direct-chat-error', { message: copy.errors.userInvalid });
        const friendship = await db.query('SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2', [account.internalId, receiverId]);
        if (!friendship.rowCount) return socket.emit('direct-chat-error', { message: copy.errors.friendsOnly });
        const result = await db.query(
          `INSERT INTO chat_requests (sender_user_id, receiver_user_id) VALUES ($1, $2) RETURNING id`,
          [account.internalId, receiverId]
        );
        const request = {
          id: result.rows[0].id,
          senderPublicId: account.publicId,
          displayName: account.displayName
        };
        presence.emitToUser(receiverId, 'direct-chat-requested', request);
        socket.emit('direct-chat-request-sent', { requestId: request.id });
      } catch (error) {
        if (error.code === '23505') return socket.emit('direct-chat-error', { message: copy.errors.requestPending });
        log.error('chat.direct_request_failed', error);
        socket.emit('direct-chat-error', { message: copy.errors.requestSend });
      }
    });

    socket.on('direct-chat-response', async (payload = {}, acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (draining) {
        socket.emit('release-draining', { retryAfterSeconds: drainRetryAfterSeconds });
        return done({ ok: false, error: copy.errors.serviceUnavailable });
      }
      if (!account || !db.isConfigured) return done({ ok: false, error: copy.errors.accountRequired });
      if (!account.emailVerified) {
        return done({ ok: false, error: copy.errors.emailVerificationRequired });
      }
      const action = payload.action === 'accept' ? 'accepted' : 'declined';
      try {
        const result = await db.query(
          `UPDATE chat_requests SET status = $1, responded_at = NOW()
           WHERE id = $2 AND receiver_user_id = $3 AND status = 'pending' RETURNING sender_user_id`,
          [action, Number(payload.requestId), account.internalId]
        );
        if (!result.rowCount) return done({ ok: false, error: copy.errors.chatRequestUnavailable });
        if (action !== 'accepted') return done({ ok: true, status: action });
        const senderId = result.rows[0].sender_user_id;
        const senderSocketId = presence.getSockets(senderId).find((id) => !activePairs.has(id));
        if (!senderSocketId || activePairs.has(socket.id)) {
          await db.query(
            `UPDATE chat_requests SET status = 'pending', responded_at = NULL
             WHERE id = $1 AND receiver_user_id = $2 AND status = 'accepted'`,
            [Number(payload.requestId), account.internalId]
          );
          socket.emit('direct-chat-error', { message: copy.errors.friendUnavailable });
          return done({ ok: false, error: copy.errors.friendUnavailable });
        }
        const senderSocket = io.sockets.sockets.get(senderSocketId);
        removeFromWaiting(senderSocketId);
        removeFromWaiting(socket.id);
        await pairUsers(profileForSocket(senderSocket), profileForSocket(socket), 'direct');
        done({ ok: true, status: action });
      } catch (error) {
        log.error('chat.direct_response_failed', error);
        socket.emit('direct-chat-error', { message: copy.errors.directChatStart });
        done({ ok: false, error: copy.errors.directChatStart });
      }
    });

    socket.on('disconnect', () => {
      void endPair(socket.id);
      removeFromWaiting(socket.id);
      presence.remove(account?.internalId, socket.id);
    });
  });

  return {
    async terminateUser(userId, payload = {}, event = 'account-banned') {
      const socketIds = presence.getSockets(userId);
      const paired = new Set();
      for (const socketId of socketIds) {
        const active = activePairs.get(socketId);
        if (active && !paired.has(socketId) && !paired.has(active.partnerId)) {
          paired.add(socketId);
          paired.add(active.partnerId);
          await endPair(socketId);
        }
        removeFromWaiting(socketId);
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(event, payload);
          socket.disconnect(true);
        }
      }
    },
    async terminateGuest(guestId, payload = {}, event = 'guest-restricted') {
      const paired = new Set();
      for (const socket of io.sockets.sockets.values()) {
        const socketGuestId = socket.request.session?.user
          ? null
          : socket.request.session?.guestPrincipalId || socket.request.session?.guestProfile?.id || null;
        if (socketGuestId !== guestId) continue;
        const active = activePairs.get(socket.id);
        if (active && !paired.has(socket.id) && !paired.has(active.partnerId)) {
          paired.add(socket.id);
          paired.add(active.partnerId);
          await endPair(socket.id);
        }
        removeFromWaiting(socket.id);
        socket.emit(event, payload);
        socket.disconnect(true);
      }
    },
    beginDrain({ retryAfterSeconds = 0 } = {}) {
      if (draining) return;
      draining = true;
      drainRetryAfterSeconds = Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0));
      const payload = { retryAfterSeconds: drainRetryAfterSeconds };
      io.emit('release-draining', payload);
      for (const waiting of [...waitingUsers]) {
        removeFromWaiting(waiting.socketId);
      }
      notifyIdle();
    },

    getActiveConversationCount() {
      return activePairs.size / 2;
    },

    whenIdle() {
      if (!activePairs.size && !pendingPersistence.size) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.add(resolve));
    },

    async stop() {
      draining = true;
      for (const waiting of [...waitingUsers]) removeFromWaiting(waiting.socketId);
      const pairSocketIds = [];
      const seen = new Set();
      for (const [socketId, active] of activePairs) {
        if (seen.has(socketId) || seen.has(active.partnerId)) continue;
        seen.add(socketId);
        seen.add(active.partnerId);
        pairSocketIds.push(socketId);
      }
      await Promise.all(pairSocketIds.map((socketId) => endPair(socketId, 'server-shutdown')));
      io.emit('server-shutdown');
      notifyIdle();
    }
  };
}

module.exports = { registerChat };
