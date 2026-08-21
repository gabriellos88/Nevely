const { cleanText } = require('./auth');
const { cleanPublicId, insertWithUniquePublicId, isPublicId } = require('./public-identifiers');
const { DEFAULT_POLICIES: DEFAULT_RATE_LIMIT_POLICIES, createModerationRateLimiter } = require('./moderation-rate-limit');
const { createMessageAbuseProtector } = require('./message-abuse');
const { persistConversationMessage } = require('./conversation-messages');
const {
  initialMatchingPhase,
  interestsAllowMatch,
  normalizeStrictPhaseSeconds,
  samePrincipal
} = require('./chat-matching');
const copy = require('../public/i18n/en.json');
const safeLog = require('./safe-log');

function formatCopy(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

const MAX_MESSAGE_LENGTH = 1000;
const AGE_FILTER_RANGES = Object.freeze({
  '18-24': { min: 18, max: 24 },
  '25-34': { min: 25, max: 34 },
  '35-44': { min: 35, max: 44 },
  '45-54': { min: 45, max: 54 },
  '55-59': { min: 55, max: 59 },
  '60+': { min: 60, max: 99 }
});
const STANDARD_GENDERS = new Set(['male', 'female', 'non-binary']);

async function lockDirectChatAccountPair(executor, firstUserId, secondUserId) {
  return executor.query(
    `SELECT u.id, u.public_id, u.display_name, u.profile_image_url, u.age, u.gender, u.country,
            u.plan, u.deleted_at, u.email_verified_at,
            EXISTS (
              SELECT 1 FROM account_bans b
              WHERE b.user_id = u.id AND b.revoked_at IS NULL AND b.starts_at <= NOW()
                AND (b.type = 'permanent' OR b.ends_at > NOW())
            ) AS banned
     FROM users u
     WHERE u.id = ANY($1::bigint[])
     ORDER BY u.id
     FOR UPDATE`,
    [[firstUserId, secondUserId].sort((a, b) => a - b)]
  );
}

function directChatAccountPairIsActive(rows) {
  return rows.length === 2 && rows.every((row) => (
    !row.deleted_at && row.email_verified_at && !row.banned
  ));
}

function registerChat(io, db, presence, options = {}) {
  const log = options.log || safeLog;
  const isNetworkBlocked = options.isNetworkBlocked || (async () => false);
  const isGuestBlocked = options.isGuestBlocked || (async () => false);
  const isGuestDeviceRestricted = options.isGuestDeviceRestricted || (async () => false);
  const matchesNetworkControl = options.matchesNetworkControl || (() => false);
  const clientAddressForSocket = options.clientAddressForSocket || ((socket) => socket.handshake.address);
  const waitingUsers = [];
  const activePairs = new Map();
  const waitingTimers = new Map();
  const socketTransitions = new Map();
  const postChatReports = new Map();
  const idleWaiters = new Set();
  const pendingPersistence = new Set();
  const strictPhaseDelayMs = typeof options.strictPhaseDelayMs === 'function'
    ? options.strictPhaseDelayMs
    : (seconds) => seconds * 1000;
  let matchmakingTransition = Promise.resolve();
  const enforcePersistentGuestOwnership = options.enforcePersistentGuestOwnership !== false;
  const rateLimiter = options.rateLimiter || createModerationRateLimiter({
    db,
    policies: options.rateLimitPolicies ? { ...DEFAULT_RATE_LIMIT_POLICIES, ...options.rateLimitPolicies } : undefined
  });
  const rateLimitPrincipalResolver = options.rateLimitPrincipalResolver;
  const messageAbuseProtector = options.messageAbuseProtector || createMessageAbuseProtector({
    rateLimiter,
    hmacSecret: options.messageAbuseHmacSecret || process.env.MODERATION_MESSAGE_HMAC_KEY || process.env.SESSION_SECRET
  });
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
      emailVerified: Boolean(account?.emailVerified),
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
             AND revoked_at IS NULL AND starts_at <= NOW()
             AND (type = 'permanent' OR ends_at > NOW())
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
      if (samePrincipal(user, candidate)) continue;
      if (!filtersAccept(user, candidate) || !filtersAccept(candidate, user)) continue;
      if (await isBlockedPair(user, candidate)) continue;
      const interestMatch = interestsAllowMatch(user, candidate);
      if (!interestMatch.allowed) continue;
      const score = interestMatch.sharedCount;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) return null;
    return waitingUsers.splice(bestIndex, 1)[0];
  }

  function clearWaitingTimer(socketId) {
    const timer = waitingTimers.get(socketId);
    if (timer) clearTimeout(timer);
    waitingTimers.delete(socketId);
  }

  function removeFromWaiting(socketId) {
    let removed = null;
    for (let index = waitingUsers.length - 1; index >= 0; index -= 1) {
      if (waitingUsers[index].socketId !== socketId) continue;
      removed = waitingUsers.splice(index, 1)[0];
    }
    clearWaitingTimer(socketId);
    return removed;
  }

  function profileForDirectAccount(row) {
    return {
      socketId: `direct-user-${Number(row.id)}`,
      userId: Number(row.id),
      publicId: row.public_id,
      guestId: null,
      displayName: row.display_name || copy.common.unknownUser,
      age: Number(row.age) || null,
      gender: row.gender || null,
      country: row.country || null,
      profileImageUrl: row.profile_image_url || null,
      plan: row.plan || 'free',
      emailVerified: Boolean(row.email_verified_at),
      isGuest: false,
      interests: [],
      filters: null
    };
  }

  function cancelOtherPrincipalSearches(user) {
    for (let index = waitingUsers.length - 1; index >= 0; index -= 1) {
      const waiting = waitingUsers[index];
      if (waiting.socketId === user.socketId || !samePrincipal(waiting, user)) continue;
      waitingUsers.splice(index, 1);
      clearWaitingTimer(waiting.socketId);
      io.to(waiting.socketId).emit('search-cancelled');
    }
  }

  function queueMatchmakingTransition(operation) {
    const current = matchmakingTransition.catch(() => {}).then(operation);
    matchmakingTransition = current;
    return current;
  }

  function emitSearchState(socket, user) {
    socket.emit('search-state', {
      phase: user.matchingPhase === 'strict' ? 'topic-preference' : 'general'
    });
  }

  function startStrictPhaseTimer(socket, user, seconds) {
    clearWaitingTimer(socket.id);
    if (user.matchingPhase !== 'strict') return;
    if (seconds === null) return;
    const timer = setTimeout(() => {
      queueSocketTransition(socket, async () => {
        await queueMatchmakingTransition(async () => {
          const waiting = waitingUsers.find((entry) => entry.socketId === socket.id);
          if (!waiting || waiting !== user || waiting.matchingPhase !== 'strict') return;
          clearWaitingTimer(socket.id);
          waiting.matchingPhase = 'relaxed';
          emitSearchState(socket, waiting);
          const match = await findMatch(waiting);
          if (!match) return;
          removeFromWaiting(waiting.socketId);
          await pairUsers(waiting, match);
        });
      });
    }, strictPhaseDelayMs(seconds));
    timer.unref?.();
    waitingTimers.set(socket.id, timer);
  }

  async function insertConversation(executor, a, b, type) {
    const conversation = await executor.query(
      `INSERT INTO conversations (type) VALUES ($1) RETURNING id`,
      [type]
    );
    const conversationId = Number(conversation.rows[0].id);
    await executor.query(
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
    return conversationId;
  }

  async function createConversation(a, b, type, executor = null) {
    if (!db.isConfigured) return null;
    if (executor) return insertConversation(executor, a, b, type);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const conversationId = await insertConversation(client, a, b, type);
      await client.query('COMMIT');
      return conversationId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function pairUsers(a, b, type = 'random', reservedConversationId = null, restored = false) {
    clearWaitingTimer(a.socketId);
    clearWaitingTimer(b.socketId);
    let conversationId = reservedConversationId;
    if (!conversationId) {
      try {
        conversationId = await createConversation(a, b, type);
      } catch (error) {
        log.error('chat.conversation_create_failed', error);
      }
    }
    let conversationPublicId = null;
    if (db.isConfigured && conversationId) {
      conversationPublicId = (await db.query(
        'SELECT public_id FROM conversations WHERE id = $1',
        [conversationId]
      )).rows[0]?.public_id || null;
    }
    activePairs.set(a.socketId, {
      partnerId: b.socketId, conversationId, conversationPublicId, type, user: a, partner: b
    });
    activePairs.set(b.socketId, {
      partnerId: a.socketId, conversationId, conversationPublicId, type, user: b, partner: a
    });
    const shared = a.interests.filter((tag) => b.interests.includes(tag));
    const [aCanAddFriend, bCanAddFriend, aCanBlock, bCanBlock] = await Promise.all([
      canAddFriend(a, b),
      canAddFriend(b, a),
      canBlockPartner(a, b),
      canBlockPartner(b, a)
    ]);

    io.to(a.socketId).emit('matched', matchPayload(
      a, b, shared, conversationId, conversationPublicId, type, aCanAddFriend, aCanBlock, restored
    ));
    io.to(b.socketId).emit('matched', matchPayload(
      b, a, shared, conversationId, conversationPublicId, type, bCanAddFriend, bCanBlock, restored
    ));
    return conversationId;
  }

  async function canAddFriend(user, partner) {
    if (!db.isConfigured || !user.userId || !partner.userId || !user.emailVerified) return false;
    try {
      const result = await db.query(
        `SELECT NOT EXISTS (
           SELECT 1 FROM friendships
           WHERE (user_id = $1 AND friend_id = $2)
              OR (user_id = $2 AND friend_id = $1)
         ) AND NOT EXISTS (
           SELECT 1 FROM blocked_users
           WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
              OR (blocker_user_id = $2 AND blocked_user_id = $1)
         ) AND NOT EXISTS (
           SELECT 1 FROM friend_requests
           WHERE status = 'pending'
             AND ((sender_user_id = $1 AND receiver_user_id = $2)
               OR (sender_user_id = $2 AND receiver_user_id = $1))
         ) AS allowed`,
        [user.userId, partner.userId]
      );
      return Boolean(result.rows[0]?.allowed);
    } catch (error) {
      log.error('chat.friend_eligibility_failed', error);
      return false;
    }
  }

  async function canBlockPartner(user, partner) {
    if (!db.isConfigured || !user.userId || !partner.userId || !user.emailVerified) return false;
    try {
      const result = await db.query(
        `SELECT NOT EXISTS (
           SELECT 1 FROM blocked_users
           WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
              OR (blocker_user_id = $2 AND blocked_user_id = $1)
         ) AS allowed`,
        [user.userId, partner.userId]
      );
      return Boolean(result.rows[0]?.allowed);
    } catch (error) {
      log.error('chat.block_eligibility_failed', error);
      return false;
    }
  }

  function matchPayload(
    user,
    partner,
    shared,
    conversationId,
    conversationPublicId,
    type,
    canAddFriendValue,
    canBlockValue,
    restored = false
  ) {
    return {
      sharedInterests: shared,
      isGuest: user.isGuest || partner.isGuest,
      conversationId: conversationPublicId,
      conversationPublicId,
      conversationType: type,
      restored: Boolean(restored),
      capabilities: {
        canNext: type === 'random',
        canEnd: type === 'direct',
        canReport: true,
        canAddFriend: Boolean(canAddFriendValue),
        canBlock: Boolean(canBlockValue)
      },
      canAddFriend: Boolean(canAddFriendValue),
      partner: {
        publicId: partner.publicId,
        displayName: partner.displayName,
        profileImageUrl: partner.profileImageUrl,
        country: partner.country
      },
      skipCooldownSeconds: 0
    };
  }

  async function markConversationEnded(conversationId) {
    if (!db.isConfigured || !conversationId) return true;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE conversations SET status = 'ended',
             ended_at = COALESCE(ended_at, NOW()),
             last_activity_at = GREATEST(last_activity_at, NOW()),
             expires_at = GREATEST(last_activity_at, NOW()) + INTERVAL '7 days'
         WHERE id = $1 AND status = 'active'`,
        [conversationId]
      );
      await client.query(
        `UPDATE conversation_participants SET left_at = COALESCE(left_at, NOW()) WHERE conversation_id = $1`,
        [conversationId]
      );
      await client.query('DELETE FROM direct_conversation_pairs WHERE conversation_id = $1', [conversationId]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      log.error('chat.conversation_end_failed', error);
      return false;
    } finally {
      client.release();
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
    const persisted = markConversationEnded(active.conversationId);
    pendingPersistence.add(persisted);
    let persistedResult = false;
    try {
      persistedResult = await persisted;
    } finally {
      pendingPersistence.delete(persisted);
    }
    if (persistedResult) {
      if (!eventForBoth && active.type === 'random' && partner?.user) {
        postChatReports.set(active.partnerId, partner);
      }
      if (eventForBoth) {
        io.to(socketId).emit(eventForBoth);
        io.to(active.partnerId).emit(eventForBoth);
      } else {
        io.to(active.partnerId).emit('partner-left', {
          conversationId: active.conversationPublicId,
          canReport: active.type === 'random'
        });
      }
    }
    notifyIdle();
    return persistedResult ? partner : null;
  }

  function detachDirectPair(socketId) {
    const active = activePairs.get(socketId);
    if (!active || active.type !== 'direct') return false;
    activePairs.delete(socketId);
    activePairs.delete(active.partnerId);
    io.to(active.partnerId).emit('direct-chat-paused', {});
    notifyIdle();
    return true;
  }

  async function resumeDirectConversation(
    socket,
    requestedPartnerPublicId = null,
    { cancelOwnSearch = false } = {}
  ) {
    const accountId = Number(socket.request.session?.user?.internalId);
    if (!db.isConfigured || !accountId || !socket.connected) return { ok: false, resumed: false };
    try {
      const result = await db.query(
        `SELECT pair.conversation_id, c.public_id AS conversation_public_id,
                CASE WHEN pair.user_low_id = $1 THEN pair.user_high_id ELSE pair.user_low_id END AS partner_user_id,
                partner.public_id AS partner_public_id, partner.display_name AS partner_display_name,
                partner.profile_image_url AS partner_profile_image_url, partner.country AS partner_country
         FROM direct_conversation_pairs pair
         JOIN conversations c ON c.id = pair.conversation_id
         JOIN users partner ON partner.id = CASE
           WHEN pair.user_low_id = $1 THEN pair.user_high_id ELSE pair.user_low_id END
         WHERE (pair.user_low_id = $1 OR pair.user_high_id = $1)
           AND ($2::text IS NULL OR partner.public_id = $2)
           AND c.type = 'direct' AND c.status = 'active'
           AND c.deleted_for_everyone_at IS NULL
           AND EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.user_id = pair.user_low_id AND f.friend_id = pair.user_high_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocked_users b
             WHERE (b.blocker_user_id = pair.user_low_id AND b.blocked_user_id = pair.user_high_id)
                OR (b.blocker_user_id = pair.user_high_id AND b.blocked_user_id = pair.user_low_id)
           )
         LIMIT 1`,
         [accountId, requestedPartnerPublicId]
      );
      const reservation = result.rows[0];
      if (!reservation) return { ok: false, resumed: false };
      return queueMatchmakingTransition(async () => {
        if (!socket.connected) return { ok: false, resumed: false };
        const existing = activePairs.get(socket.id);
        if (existing) {
          const sameDirectConversation = existing.type === 'direct'
            && Number(existing.conversationId) === Number(reservation.conversation_id);
          return { ok: sameDirectConversation, resumed: sameDirectConversation };
        }
        const ownSearchActive = waitingUsers.some((waiting) => waiting.socketId === socket.id);
        if (ownSearchActive && !cancelOwnSearch) return { ok: false, resumed: false };
        if (ownSearchActive) removeFromWaiting(socket.id);
        const partnerSocketId = presence.getSockets(Number(reservation.partner_user_id))
          .find((id) => id !== socket.id
            && !activePairs.has(id)
            && !waitingUsers.some((waiting) => waiting.socketId === id));
        const partnerSocket = partnerSocketId ? io.sockets.sockets.get(partnerSocketId) : null;
        if (!partnerSocket?.connected) {
          socket.emit('direct-chat-resumable', {
            conversationId: reservation.conversation_public_id,
            conversationPublicId: reservation.conversation_public_id,
            conversationType: 'direct',
            partner: {
              publicId: reservation.partner_public_id,
              displayName: reservation.partner_display_name,
              profileImageUrl: reservation.partner_profile_image_url,
              country: reservation.partner_country
            }
          });
          return { ok: true, resumed: false };
        }
        await pairUsers(
          profileForSocket(socket),
          profileForSocket(partnerSocket),
          'direct',
          Number(reservation.conversation_id),
          true
        );
        return { ok: true, resumed: true };
      });
    } catch (error) {
      log.error('chat.direct_restore_failed', error);
      return { ok: false, resumed: false };
    }
  }

  function rateLimitPrincipal(user, action) {
    const fallbackPrincipal = user?.userId
      ? { principalType: 'user', principalId: user.userId }
      : { principalType: 'guest', principalId: user?.guestId };
    return fallbackPrincipal.principalId
      ? fallbackPrincipal
      : rateLimitPrincipalResolver?.(user, action);
  }

  function queueSocketTransition(socket, operation) {
    const previous = socketTransitions.get(socket.id) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      if (socket.connected) await operation();
    });
    socketTransitions.set(socket.id, current);
    void current.finally(() => {
      if (socketTransitions.get(socket.id) === current) socketTransitions.delete(socket.id);
    }).catch(() => {});
  }

  async function consumeRateLimit(user, action) {
    if (!db.isConfigured) return { allowed: true, retryAfterSeconds: 0 };
    const resolvedPrincipal = rateLimitPrincipal(user, action);
    const principalType = resolvedPrincipal?.principalType;
    const principalId = resolvedPrincipal?.principalId;
    if (!principalId) return { allowed: false, retryAfterSeconds: 0 };
    return rateLimiter.consume({ principalType, principalId, action });
  }

  async function consumeSkipCooldown(user) {
    if (user.plan === 'premium') return { allowed: true, retryAfterSeconds: 0 };
    return consumeRateLimit(user, 'skip');
  }

  function moderationReason(text) {
    const lowered = text.toLowerCase();
    return bannedWords.find((word) => lowered.includes(word)) ? copy.errors.safetyBlocked : null;
  }

  async function persistMessage(active, socketId, text) {
    if (!db.isConfigured || !active.conversationId) return null;
    return persistConversationMessage(db, active, socketId, text);
  }

  io.use(async (socket, next) => {
    if (!db.isConfigured) return next();
    try {
      const account = socket.request.session?.user || null;
      const guestId = !account
        ? socket.request.session?.guestPrincipalId || socket.request.session?.guestProfile?.id || null
        : null;
      const [accountBan, networkBan, guestBan, deviceBan] = await Promise.all([
        account ? db.query(
          `SELECT 1 FROM account_bans
           WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
             AND (type = 'permanent' OR ends_at > NOW())
           UNION ALL
           SELECT 1 FROM bans WHERE user_id = $1 AND starts_at <= NOW()
             AND (type = 'permanent' OR ends_at > NOW()) LIMIT 1`,
          [account.internalId]
        ) : Promise.resolve({ rowCount: 0 }),
        isNetworkBlocked(clientAddressForSocket(socket)),
        guestId ? isGuestBlocked(guestId) : false,
        guestId ? isGuestDeviceRestricted(guestId) : false
      ]);
      if (accountBan.rowCount || networkBan || guestBan || deviceBan) {
        const error = new Error('connection restricted');
        if (guestBan || deviceBan) {
          error.data = { code: 'GUEST_ACCESS_RESTRICTED', redirect: '/guest-restricted' };
        }
        return next(error);
      }
      if (!account) return next();
      const current = (await db.query(
        'SELECT session_version, deleted_at FROM users WHERE id = $1',
        [account.internalId]
      )).rows[0];
      if (!current || current.deleted_at || Number(current.session_version) !== Number(account.sessionVersion)) {
        return next(new Error('authentication required'));
      }
      return next();
    } catch (error) {
      log.error('chat.socket_admission_failed', error);
      return next(new Error(copy.errors.serviceUnavailable));
    }
  });

  io.on('connection', (socket) => {
    const account = socket.request.session?.user || null;
    presence.add(account?.internalId, socket.id);
    if (db.isConfigured && account?.internalId) {
      void db.query(
        'UPDATE users SET last_seen_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [account.internalId]
      ).catch((error) => log.error('chat.account_activity_update_failed', error));
    }
    const ipAddress = clientAddressForSocket(socket);
    if (db.isConfigured) {
      socket.use(async (_packet, next) => {
        try {
          const guestId = !account
            ? socket.request.session?.guestPrincipalId || socket.request.session?.guestProfile?.id || null
            : null;
          const [accountBan, networkBan, guestBan, deviceBan] = await Promise.all([
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
            guestId ? isGuestBlocked(guestId) : false,
            guestId ? isGuestDeviceRestricted(guestId) : false
          ]);
          if (accountBan.rowCount || networkBan || guestBan || deviceBan) {
            socket.emit(
              (guestBan || deviceBan) ? 'guest-restricted' : 'account-banned',
              (guestBan || deviceBan) ? { redirect: '/guest-restricted', supportUrl: '/support' } : {}
            );
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

    if (account?.internalId && account.emailVerified) {
      setImmediate(() => void resumeDirectConversation(socket));
    }

    socket.on('find-partner', (payload = {}) => {
      queueSocketTransition(socket, async () => {
        if (draining) {
          socket.emit('release-draining', { retryAfterSeconds: drainRetryAfterSeconds });
          return;
        }
        if (account && !account.emailVerified) {
          socket.emit('chat-error', { message: copy.errors.emailVerificationRequired });
          return;
        }
        try {
          postChatReports.delete(socket.id);
          const startingPair = activePairs.get(socket.id);
          if (startingPair?.type === 'random') {
            const skip = await consumeSkipCooldown(startingPair.user);
            if (!skip.allowed) {
              socket.emit('skip-cooldown', { retryAfterSeconds: skip.retryAfterSeconds });
              return;
            }
          }
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
          const strictPhaseSeconds = normalizeStrictPhaseSeconds(payload.waitingTimeSeconds);
          user.matchingPhase = initialMatchingPhase(user.interests);
          await queueMatchmakingTransition(async () => {
            removeFromWaiting(socket.id);
            const currentPair = activePairs.get(socket.id);
            if (currentPair && currentPair !== startingPair) return;
            if (currentPair?.type === 'direct') detachDirectPair(socket.id);
            else if (currentPair) await endPair(socket.id);
            cancelOtherPrincipalSearches(user);
            const match = await findMatch(user);
            if (match) await pairUsers(user, match);
            else {
              waitingUsers.push(user);
              startStrictPhaseTimer(socket, user, strictPhaseSeconds);
              socket.emit('waiting', { status: 'searching' });
              emitSearchState(socket, user);
            }
          });
        } catch (error) {
          log.error('chat.matching_failed', error);
          socket.emit('chat-error', { message: copy.errors.matchingUnavailable });
        }
      });
    });

    socket.on('cancel-search', (acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      queueSocketTransition(socket, async () => {
        try {
          const removed = await queueMatchmakingTransition(() => removeFromWaiting(socket.id));
          if (removed) socket.emit('search-cancelled');
          done({ ok: true, cancelled: Boolean(removed) });
        } catch (error) {
          log.error('chat.search_cancel_failed', error);
          done({ ok: false, error: copy.errors.matchingUnavailable });
        }
      });
    });

    socket.on('resume-direct-chat', (payload = {}, acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      queueSocketTransition(socket, async () => {
        if (!account?.internalId || !account.emailVerified || !db.isConfigured) {
          return done({ ok: false, resumed: false, error: copy.errors.chatRequestUnavailable });
        }
        const partnerPublicId = cleanPublicId(payload.partnerPublicId);
        if (!isPublicId(partnerPublicId, 'user')) {
          return done({ ok: false, resumed: false, error: copy.errors.chatRequestUnavailable });
        }
        const rate = await consumeRateLimit(profileForSocket(socket), 'direct-chat-resume');
        if (!rate.allowed) {
          return done({
            ok: false,
            resumed: false,
            error: copy.errors.requestCooldown,
            retryAfterSeconds: rate.retryAfterSeconds
          });
        }
        const result = await resumeDirectConversation(socket, partnerPublicId, { cancelOwnSearch: true });
        if (!result.ok) {
          return done({ ok: false, resumed: false, error: copy.errors.chatRequestUnavailable });
        }
        return done(result);
      });
    });

    socket.on('refresh-guest-session', (acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (socket.request.session?.user) return done({ ok: false, error: copy.errors.alreadySignedIn });
      socket.request.session.reload((error) => {
        if (error) return done({ ok: false, error: copy.errors.guestSessionRefresh });
        return done({ ok: true });
      });
    });

    socket.on('send-message', async (rawText, acknowledge) => {
      const reply = (event, payload) => {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: event === 'message-sent', ...payload });
          return;
        }
        socket.emit(event, payload);
      };
      if (account && !account.emailVerified) {
        reply('message-error', { message: copy.errors.emailVerificationRequired });
        return;
      }
      const active = activePairs.get(socket.id);
      const text = cleanText(rawText, MAX_MESSAGE_LENGTH);
      if (!active || !text) return reply('message-error', { message: copy.errors.messageSend });
      try {
        if (active.type === 'direct' && db.isConfigured) {
          const reservation = await db.query(
            `SELECT 1 FROM direct_conversation_pairs pair
             JOIN conversations c ON c.id = pair.conversation_id
             WHERE pair.conversation_id = $1 AND c.status = 'active'
             LIMIT 1`,
            [active.conversationId]
          );
          if (!reservation.rowCount) {
            await queueMatchmakingTransition(() => {
              activePairs.delete(socket.id);
              activePairs.delete(active.partnerId);
              io.to(socket.id).emit('partner-left', { conversationId: active.conversationPublicId });
              io.to(active.partnerId).emit('partner-left', { conversationId: active.conversationPublicId });
              notifyIdle();
            });
            return reply('message-error', { message: copy.errors.messageSend });
          }
        }
        const rate = await consumeRateLimit(active.user, 'message');
        if (!rate.allowed) return reply('message-error', { message: copy.errors.messagesTooFast, retryAfterSeconds: rate.retryAfterSeconds });
        const principal = rateLimitPrincipal(active.user, 'message');
        const abuse = !db.isConfigured
          ? { allowed: true, retryAfterSeconds: 0 }
          : principal?.principalId
            ? await messageAbuseProtector.consume({ ...principal, text })
            : { allowed: false, retryAfterSeconds: 0 };
        if (!abuse.allowed) return reply('message-error', { message: copy.errors.messagesTooFast, retryAfterSeconds: abuse.retryAfterSeconds });
        const blockedReason = moderationReason(text);
        if (blockedReason) return reply('message-error', { message: blockedReason });
        const stored = await persistMessage(active, socket.id, text);
        io.to(active.partnerId).emit('receive-message', {
          id: stored?.id || null, text, createdAt: stored?.created_at || new Date().toISOString()
        });
        reply('message-sent', { id: stored?.id || null });
      } catch (error) {
        log.error('chat.message_persistence_failed', error);
        reply('message-error', { message: copy.errors.messageSend });
      }
    });

    socket.on('messages-read', async (payload = {}, acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      const conversationPublicId = cleanPublicId(payload.conversationId);
      const upToMessageId = cleanPublicId(payload.upToMessageId);
      const active = activePairs.get(socket.id);
      const conversationId = active?.conversationId || null;
      const sessionAccount = socket.request.session?.user || null;
      const sessionGuestId = sessionAccount
        ? null
        : socket.request.session?.guestPrincipalId || socket.request.session?.guestProfile?.id || null;
      if ((!sessionAccount && !sessionGuestId) || !db.isConfigured) {
        return done({ ok: false, error: copy.errors.accountRequired });
      }
      if (!conversationId || active.conversationPublicId !== conversationPublicId
          || !isPublicId(conversationPublicId, 'conversation')
          || !isPublicId(upToMessageId, 'message')) {
        return done({ ok: false, error: copy.errors.readReceiptInvalid });
      }

      try {
        const result = await db.query(
          `UPDATE message_receipts mr
           SET delivered_at = COALESCE(mr.delivered_at, NOW()),
               read_at = COALESCE(mr.read_at, NOW())
           FROM messages m
           JOIN messages boundary
             ON boundary.public_id = $4 AND boundary.conversation_id = $3
            WHERE mr.message_id = m.id
              AND (mr.user_id = $1 OR mr.guest_id = $2)
              AND mr.read_at IS NULL
              AND m.conversation_id = $3
              AND m.id <= boundary.id
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
            presence.emitToUser(senderId, 'message-read', {
              conversationId: conversationPublicId, upToMessageId, readAt
            });
          }
        }
        done({ ok: true, updated: result.rowCount, readAt });
      } catch (error) {
        log.error('chat.read_receipt_failed', error);
        done({ ok: false, error: copy.errors.readReceiptSave });
      }
    });

    socket.on('leave-chat', (acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      queueSocketTransition(socket, async () => {
        try {
          postChatReports.delete(socket.id);
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
          if (current && current.type !== 'direct' && !blockedPartner) {
            const skip = await consumeSkipCooldown(current.user);
            if (!skip.allowed) {
              const retryAfterSeconds = skip.retryAfterSeconds;
              socket.emit('skip-cooldown', { retryAfterSeconds });
              done({ ok: false, retryAfterSeconds });
              return;
            }
          }
          if (current?.type === 'direct' && !blockedPartner) {
            done({ ok: false, error: copy.errors.directChatEnd });
            return;
          }
          let ended = false;
          await queueMatchmakingTransition(async () => {
            removeFromWaiting(socket.id);
            const livePair = activePairs.get(socket.id);
            if (livePair !== current) return;
            ended = Boolean(await endPair(socket.id));
          });
          done({ ok: true, ended });
        } catch (error) {
          log.error('chat.leave_failed', error);
          done({ ok: false, error: copy.errors.serviceUnavailable });
        }
      });
    });

    socket.on('end-direct-chat', (payload = {}, acknowledge) => {
      if (typeof payload === 'function') {
        acknowledge = payload;
        payload = {};
      }
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (payload.confirmation !== 'END DIRECT CONVERSATION') {
        return done({ ok: false, error: copy.errors.confirmationRequired });
      }
      queueSocketTransition(socket, async () => {
        try {
          const current = activePairs.get(socket.id);
          if (!current) {
            if (!account?.internalId || !db.isConfigured) return done({ ok: true, ended: false });
            const reservation = await db.query(
              `SELECT pair.conversation_id, c.public_id AS conversation_public_id,
                      CASE WHEN pair.user_low_id = $1 THEN pair.user_high_id ELSE pair.user_low_id END AS partner_user_id
               FROM direct_conversation_pairs pair
               JOIN conversations c ON c.id = pair.conversation_id
               WHERE (pair.user_low_id = $1 OR pair.user_high_id = $1)
                 AND c.type = 'direct' AND c.status = 'active'
               LIMIT 1`,
              [account.internalId]
            );
            if (!reservation.rowCount) return done({ ok: true, ended: false });
            const persisted = await markConversationEnded(Number(reservation.rows[0].conversation_id));
            if (!persisted) return done({ ok: false, error: copy.errors.directChatEnd });
            presence.emitToUser(Number(reservation.rows[0].partner_user_id), 'partner-left', {
              conversationId: reservation.rows[0].conversation_public_id
            });
            return done({ ok: true, ended: true });
          }
          if (current.type !== 'direct') {
            return done({ ok: false, error: copy.errors.directChatEnd });
          }
          let ended = false;
          await queueMatchmakingTransition(async () => {
            const livePair = activePairs.get(socket.id);
            if (livePair !== current || livePair.type !== 'direct') return;
            ended = Boolean(await endPair(socket.id));
          });
          return done({ ok: true, ended });
        } catch (error) {
          log.error('chat.direct_end_failed', error);
          return done({ ok: false, error: copy.errors.directChatEnd });
        }
      });
    });

    socket.on('report', async (payload = {}) => {
      const active = activePairs.get(socket.id) || postChatReports.get(socket.id);
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

    socket.on('direct-chat-request', async (payload = {}, acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      const fail = (message, retryAfterSeconds = 0) => {
        const response = { ok: false, error: message };
        const event = { message };
        if (Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
          response.retryAfterSeconds = retryAfterSeconds;
          event.retryAfterSeconds = retryAfterSeconds;
        }
        socket.emit('direct-chat-error', event);
        done(response);
      };
      if (draining) {
        socket.emit('release-draining', { retryAfterSeconds: drainRetryAfterSeconds });
        return done({ ok: false, error: copy.errors.serviceUnavailable });
      }
      if (!account || !db.isConfigured) return fail(copy.errors.accountRequired);
      if (!account.emailVerified) {
        return fail(copy.errors.emailVerificationRequired);
      }
      let client;
      try {
        const rate = await consumeRateLimit(profileForSocket(socket), 'chat-request');
        if (!rate.allowed) return fail(copy.errors.requestCooldown, rate.retryAfterSeconds);
        const receiverPublicId = cleanPublicId(payload.publicId || payload.userId);
        const receiver = await db.query(
          `SELECT id FROM users
           WHERE ${isPublicId(receiverPublicId, 'user') ? 'public_id' : 'legacy_public_id'} = $1
             AND deleted_at IS NULL`,
          [receiverPublicId]
        );
        const receiverId = Number(receiver.rows[0]?.id);
        if (!receiverId || receiverId === Number(account.internalId)) return fail(copy.errors.requestSend);
        client = await db.getClient();
        await client.query('BEGIN');
        const accounts = await lockDirectChatAccountPair(client, account.internalId, receiverId);
        await client.query(
          `DELETE FROM direct_conversation_pairs pair
           USING conversations c
           WHERE pair.conversation_id = c.id
             AND pair.user_low_id = LEAST($1::bigint, $2::bigint)
             AND pair.user_high_id = GREATEST($1::bigint, $2::bigint)
             AND (c.status <> 'active' OR c.deleted_for_everyone_at IS NOT NULL)`,
          [account.internalId, receiverId]
        );
        await client.query(
          `UPDATE chat_requests SET status = 'expired', responded_at = COALESCE(responded_at, expires_at)
           WHERE status = 'pending' AND expires_at <= NOW()
             AND LEAST(sender_user_id, receiver_user_id) = LEAST($1::bigint, $2::bigint)
             AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($1::bigint, $2::bigint)`,
          [account.internalId, receiverId]
        );
        if (!directChatAccountPairIsActive(accounts.rows)) {
          await client.query('ROLLBACK');
          client.release();
          client = null;
          return fail(copy.errors.requestSend);
        }
        const eligibility = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2
           ) AND NOT EXISTS (
             SELECT 1 FROM blocked_users
             WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
                OR (blocker_user_id = $2 AND blocked_user_id = $1)
           ) AS eligible,
           (
             SELECT c.public_id
             FROM direct_conversation_pairs pair
             JOIN conversations c ON c.id = pair.conversation_id
             WHERE pair.user_low_id = LEAST($1::bigint, $2::bigint)
               AND pair.user_high_id = GREATEST($1::bigint, $2::bigint)
               AND c.type = 'direct' AND c.status = 'active'
               AND c.deleted_for_everyone_at IS NULL
             LIMIT 1
           ) AS active_conversation_id,
           NOT EXISTS (
             SELECT 1 FROM direct_conversation_pairs pair
             JOIN conversations c ON c.id = pair.conversation_id
             WHERE pair.user_low_id = LEAST($1::bigint, $2::bigint)
               AND pair.user_high_id = GREATEST($1::bigint, $2::bigint)
               AND c.status = 'active' AND c.deleted_for_everyone_at IS NULL
           ) AS available`,
          [account.internalId, receiverId]
        );
        if (!eligibility.rows[0]?.eligible) {
          await client.query('ROLLBACK');
          client.release();
          client = null;
          return fail(copy.errors.requestSend);
        }
        if (eligibility.rows[0]?.active_conversation_id) {
          await client.query('COMMIT');
          client.release();
          client = null;
          return done({
            ok: true,
            status: 'active',
            conversationId: eligibility.rows[0].active_conversation_id
          });
        }
        if (!eligibility.rows[0]?.available) {
          await client.query('ROLLBACK');
          client.release();
          client = null;
          return fail(copy.errors.requestSend);
        }
        const existing = await client.query(
          `SELECT public_id, sender_user_id
           FROM chat_requests
           WHERE status = 'pending' AND expires_at > NOW()
             AND LEAST(sender_user_id, receiver_user_id) = LEAST($1::bigint, $2::bigint)
             AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($1::bigint, $2::bigint)
           LIMIT 1`,
          [account.internalId, receiverId]
        );
        if (existing.rowCount) {
          await client.query('COMMIT');
          client.release();
          client = null;
          if (Number(existing.rows[0].sender_user_id) !== Number(account.internalId)) {
            return fail(copy.errors.requestPending);
          }
          const response = { ok: true, requestId: existing.rows[0].public_id, status: 'pending' };
          socket.emit('direct-chat-request-sent', response);
          return done(response);
        }
        const result = await insertWithUniquePublicId(
          client,
          'chatRequest',
          (publicId) => client.query(
            `INSERT INTO chat_requests (public_id, sender_user_id, receiver_user_id)
             VALUES ($1, $2, $3)
             RETURNING public_id`,
            [publicId, account.internalId, receiverId]
          )
        );
        const requestPublicId = result.rows[0].public_id;
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'chat_request', $2, $3,
                   jsonb_build_object('requestPublicId', $4::text, 'userPublicId', $5::text))`,
          [
            receiverId,
            copy.notifications.chatRequestTitle,
            formatCopy(copy.notifications.chatRequestBody, { name: account.displayName }),
            requestPublicId,
            account.publicId
          ]
        );
        await client.query('COMMIT');
        client.release();
        client = null;
        const response = { ok: true, requestId: requestPublicId, status: 'pending' };
        presence.emitToUser(receiverId, 'direct-chat-requested', { requestId: requestPublicId });
        presence.emitToUser(receiverId, 'notification-created', { type: 'chat_request' });
        socket.emit('direct-chat-request-sent', response);
        return done(response);
      } catch (error) {
        await client?.query('ROLLBACK').catch(() => {});
        log.error('chat.direct_request_failed', error);
        return fail(copy.errors.requestSend);
      } finally {
        client?.release();
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
      const action = payload.action === 'accept'
        ? 'accepted'
        : payload.action === 'decline' ? 'declined' : null;
      const requestPublicId = cleanPublicId(payload.requestId);
      if (!action || !isPublicId(requestPublicId, 'chatRequest')) {
        return done({ ok: false, error: copy.errors.chatRequestUnavailable });
      }
      let client;
      let senderId = null;
      try {
        const rate = await consumeRateLimit(profileForSocket(socket), 'chat-request-response');
        if (!rate.allowed) {
          return done({
            ok: false,
            error: copy.errors.requestCooldown,
            retryAfterSeconds: rate.retryAfterSeconds
          });
        }
        const located = await db.query(
          `SELECT sender_user_id FROM chat_requests
           WHERE public_id = $1 AND receiver_user_id = $2`,
          [requestPublicId, account.internalId]
        );
        if (!located.rowCount) return done({ ok: false, error: copy.errors.chatRequestUnavailable });
        senderId = Number(located.rows[0].sender_user_id);
        await queueMatchmakingTransition(async () => {
          const senderSocketIds = action === 'accepted' ? presence.getSockets(senderId) : [];
          const senderSocketId = senderSocketIds.find((id) => !activePairs.has(id)) || null;
          const senderSocket = senderSocketId ? io.sockets.sockets.get(senderSocketId) : null;
          client = await db.getClient();
          await client.query('BEGIN');
          const accounts = await lockDirectChatAccountPair(client, senderId, account.internalId);
          const request = await client.query(
            `SELECT status, expires_at <= NOW() AS expired
             FROM chat_requests
             WHERE public_id = $1 AND receiver_user_id = $2
             FOR UPDATE`,
            [requestPublicId, account.internalId]
          );
          const current = request.rows[0];
          if (current?.status === action) {
            await client.query('COMMIT');
            client.release();
            client = null;
            done({ ok: true, status: action, started: false });
            return;
          }
          if (current?.status !== 'pending' || current.expired
              || !directChatAccountPairIsActive(accounts.rows)) {
            if (current?.status === 'pending' && current.expired) {
              await client.query(
                `UPDATE chat_requests SET status = 'expired', responded_at = COALESCE(responded_at, expires_at)
                 WHERE public_id = $1 AND status = 'pending'`,
                [requestPublicId]
              );
              await client.query('COMMIT');
              client.release();
              client = null;
              const update = { requestId: requestPublicId, status: 'expired' };
              presence.emitToUser(senderId, 'direct-chat-request-updated', update);
              presence.emitToUser(account.internalId, 'direct-chat-request-updated', update);
            } else {
              await client.query('ROLLBACK');
              client.release();
              client = null;
            }
            done({ ok: false, error: copy.errors.chatRequestUnavailable });
            return;
          }

          let conversationId = null;
          let senderProfile = null;
          let receiverProfile = null;
          if (action === 'accepted') {
            const eligibility = await client.query(
              `SELECT EXISTS (
                 SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2
               ) AND NOT EXISTS (
                 SELECT 1 FROM blocked_users
                 WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
                    OR (blocker_user_id = $2 AND blocked_user_id = $1)
               ) AS allowed`,
              [account.internalId, senderId]
            );
            const senderIsOnline = senderSocketIds.some((id) => io.sockets.sockets.get(id)?.connected);
            if (!eligibility.rows[0]?.allowed
                || !socket.connected
                || (senderIsOnline && !senderSocket?.connected)
                || (senderSocketId && activePairs.has(senderSocketId))
                || activePairs.has(socket.id)) {
              await client.query('ROLLBACK');
              client.release();
              client = null;
              done({ ok: false, error: copy.errors.chatRequestUnavailable });
              return;
            }
            senderProfile = senderSocket?.connected
              ? profileForSocket(senderSocket)
              : profileForDirectAccount(accounts.rows.find((row) => Number(row.id) === senderId));
            receiverProfile = profileForSocket(socket);
            conversationId = await createConversation(senderProfile, receiverProfile, 'direct', client);
            await client.query(
              `INSERT INTO direct_conversation_pairs (user_low_id, user_high_id, conversation_id)
               VALUES (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint), $3)`,
              [senderId, account.internalId, conversationId]
            );
          }
          await client.query(
            `UPDATE chat_requests SET status = $1, responded_at = NOW(), conversation_id = $4
             WHERE public_id = $2 AND receiver_user_id = $3 AND status = 'pending'`,
            [action, requestPublicId, account.internalId, conversationId]
          );
          await client.query('COMMIT');
          client.release();
          client = null;
          const update = { requestId: requestPublicId, status: action };
          presence.emitToUser(senderId, 'direct-chat-request-updated', update);
          presence.emitToUser(account.internalId, 'direct-chat-request-updated', update);
          if (action !== 'accepted') {
            done({ ok: true, status: action });
            return;
          }
          if (!senderSocket?.connected) {
            const publicConversationId = (await db.query(
              'SELECT public_id FROM conversations WHERE id = $1',
              [conversationId]
            )).rows[0]?.public_id;
            if (publicConversationId) {
              socket.emit('direct-chat-resumable', {
                conversationId: publicConversationId,
                conversationPublicId: publicConversationId,
                conversationType: 'direct',
                partner: {
                  publicId: senderProfile.publicId,
                  displayName: senderProfile.displayName,
                  profileImageUrl: senderProfile.profileImageUrl,
                  country: senderProfile.country
                }
              });
            }
            done({ ok: true, status: action, started: true, resumed: false });
            return;
          }
          removeFromWaiting(senderSocketId);
          removeFromWaiting(socket.id);
          await pairUsers(senderProfile, receiverProfile, 'direct', conversationId);
          done({ ok: true, status: action, started: true });
        });
      } catch (error) {
        await client?.query('ROLLBACK').catch(() => {});
        log.error('chat.direct_response_failed', error);
        socket.emit('direct-chat-error', { message: copy.errors.directChatStart });
        done({ ok: false, error: copy.errors.directChatStart });
      } finally {
        client?.release();
      }
    });

    socket.on('direct-chat-cancel', async (payload = {}, acknowledge) => {
      const done = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!account || !db.isConfigured || !account.emailVerified) {
        return done({ ok: false, error: copy.errors.accountRequired });
      }
      const requestPublicId = cleanPublicId(payload.requestId);
      if (!isPublicId(requestPublicId, 'chatRequest')) {
        return done({ ok: false, error: copy.errors.chatRequestUnavailable });
      }
      let client;
      let receiverId = null;
      try {
        const rate = await consumeRateLimit(profileForSocket(socket), 'chat-request-cancel');
        if (!rate.allowed) {
          return done({
            ok: false,
            error: copy.errors.requestCooldown,
            retryAfterSeconds: rate.retryAfterSeconds
          });
        }
        const located = await db.query(
          `SELECT receiver_user_id FROM chat_requests
           WHERE public_id = $1 AND sender_user_id = $2`,
          [requestPublicId, account.internalId]
        );
        if (!located.rowCount) return done({ ok: false, error: copy.errors.chatRequestUnavailable });
        receiverId = Number(located.rows[0].receiver_user_id);
        client = await db.getClient();
        await client.query('BEGIN');
        await lockDirectChatAccountPair(client, account.internalId, receiverId);
        const request = await client.query(
          `SELECT status FROM chat_requests
           WHERE public_id = $1 AND sender_user_id = $2
           FOR UPDATE`,
          [requestPublicId, account.internalId]
        );
        if (request.rows[0]?.status === 'cancelled') {
          await client.query('COMMIT');
          client.release();
          client = null;
          return done({ ok: true, status: 'cancelled' });
        }
        if (request.rows[0]?.status !== 'pending') {
          await client.query('ROLLBACK');
          client.release();
          client = null;
          return done({ ok: false, error: copy.errors.chatRequestUnavailable });
        }
        await client.query(
          `UPDATE chat_requests SET status = 'cancelled', responded_at = NOW()
           WHERE public_id = $1 AND sender_user_id = $2 AND status = 'pending'`,
          [requestPublicId, account.internalId]
        );
        await client.query('COMMIT');
        client.release();
        client = null;
        const update = { requestId: requestPublicId, status: 'cancelled' };
        presence.emitToUser(receiverId, 'direct-chat-request-updated', update);
        presence.emitToUser(account.internalId, 'direct-chat-request-updated', update);
        return done({ ok: true, status: 'cancelled' });
      } catch (error) {
        await client?.query('ROLLBACK').catch(() => {});
        log.error('chat.direct_cancel_failed', error);
        return done({ ok: false, error: copy.errors.chatRequestUnavailable });
      } finally {
        client?.release();
      }
    });

    socket.on('disconnect', () => {
      postChatReports.delete(socket.id);
      void queueMatchmakingTransition(async () => {
        removeFromWaiting(socket.id);
        const active = activePairs.get(socket.id);
        if (active?.type === 'direct') detachDirectPair(socket.id);
        else await endPair(socket.id);
      });
      presence.remove(account?.internalId, socket.id);
    });
  });

  return {
    async terminateDirectPair(firstUserId, secondUserId) {
      await queueMatchmakingTransition(async () => {
        const target = [Number(firstUserId), Number(secondUserId)].sort((a, b) => a - b).join(':');
        const seen = new Set();
        for (const [socketId, active] of activePairs) {
          if (seen.has(socketId) || active.type !== 'direct') continue;
          const pair = [Number(active.user.userId), Number(active.partner.userId)].sort((a, b) => a - b).join(':');
          if (pair !== target) continue;
          seen.add(socketId);
          seen.add(active.partnerId);
          activePairs.delete(socketId);
          activePairs.delete(active.partnerId);
          io.to(socketId).emit('partner-left', { conversationId: active.conversationPublicId });
          io.to(active.partnerId).emit('partner-left', { conversationId: active.conversationPublicId });
        }
        notifyIdle();
      });
    },
    async terminateConversation(conversationId) {
      await queueMatchmakingTransition(async () => {
        for (const [socketId, active] of activePairs) {
          if (Number(active.conversationId) !== Number(conversationId)) continue;
          activePairs.delete(socketId);
          activePairs.delete(active.partnerId);
          io.to(socketId).emit('partner-left', { conversationId: active.conversationPublicId });
          io.to(active.partnerId).emit('partner-left', { conversationId: active.conversationPublicId });
          break;
        }
        notifyIdle();
      });
    },
    async terminateUser(userId, payload = {}, event = 'account-banned') {
      await queueMatchmakingTransition(async () => {
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
      });
    },
    async terminateGuest(guestId, payload = {}, event = 'guest-restricted') {
      await queueMatchmakingTransition(async () => {
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
      });
    },
    async terminateNetwork(control) {
      const matching = [];
      for (const socket of io.sockets.sockets.values()) {
        if (await matchesNetworkControl(clientAddressForSocket(socket), control)) matching.push(socket);
      }
      await queueMatchmakingTransition(async () => {
        const paired = new Set();
        for (const socket of matching) {
          const active = activePairs.get(socket.id);
          if (active && !paired.has(socket.id) && !paired.has(active.partnerId)) {
            paired.add(socket.id);
            paired.add(active.partnerId);
            await endPair(socket.id);
          }
          removeFromWaiting(socket.id);
          socket.emit('network-restricted', {});
          socket.disconnect(true);
        }
      });
    },
    beginDrain({ retryAfterSeconds = 0 } = {}) {
      if (draining) return;
      draining = true;
      drainRetryAfterSeconds = Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0));
      const payload = { retryAfterSeconds: drainRetryAfterSeconds };
      io.emit('release-draining', payload);
      void queueMatchmakingTransition(() => {
        for (const waiting of [...waitingUsers]) removeFromWaiting(waiting.socketId);
      });
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
      await queueMatchmakingTransition(async () => {
        for (const waiting of [...waitingUsers]) removeFromWaiting(waiting.socketId);
        const pairSocketIds = [];
        const seen = new Set();
        for (const [socketId, active] of activePairs) {
          if (seen.has(socketId) || seen.has(active.partnerId)) continue;
          seen.add(socketId);
          seen.add(active.partnerId);
          pairSocketIds.push(socketId);
        }
        for (const socketId of pairSocketIds) {
          const active = activePairs.get(socketId);
          if (active?.type === 'direct') detachDirectPair(socketId);
          else await endPair(socketId, 'server-shutdown');
        }
      });
      io.emit('server-shutdown');
      notifyIdle();
    }
  };
}

module.exports = { registerChat };
