const { cleanText } = require('./auth');

const GUEST_SKIP_COOLDOWN_MS = 10_000;
const FREE_SKIP_COOLDOWN_MS = 3_000;
const MESSAGE_WINDOW_MS = 10_000;
const MESSAGE_LIMIT = 12;
const MAX_MESSAGE_LENGTH = 1000;

function registerChat(io, db, presence, options = {}) {
  const guestDurationSeconds = options.guestDurationSeconds || 120;
  const waitingUsers = [];
  const activePairs = new Map();
  const guestTimers = new Map();
  const messageWindows = new Map();
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
    const supplied = payload.profile || {};
    const isGuest = !account;
    const plan = account?.plan || 'guest';
    return {
      socketId: socket.id,
      userId: account?.id || null,
      publicId: account?.publicId || null,
      displayName: account?.displayName || cleanText(supplied.username, 24) || 'Guest',
      age: account?.age || Number(supplied.age) || null,
      gender: account?.gender || null,
      country: account?.country || cleanText(supplied.country, 80) || null,
      profileImageUrl: account?.profileImageUrl || null,
      plan,
      isGuest,
      interests: normalizeInterests(payload.interests),
      filters: plan === 'premium' ? normalizeFilters(payload.filters) : null
    };
  }

  function normalizeFilters(value) {
    if (!value || typeof value !== 'object') return null;
    const minAge = Math.min(Math.max(Number(value.minAge) || 18, 18), 99);
    const maxAge = Math.min(Math.max(Number(value.maxAge) || 99, minAge), 99);
    return {
      gender: cleanText(value.gender, 30).toLowerCase() || null,
      country: cleanText(value.country, 80).toLowerCase() || null,
      minAge,
      maxAge
    };
  }

  function filtersAccept(owner, candidate) {
    const filters = owner.filters;
    if (!filters) return true;
    if (filters.gender && String(candidate.gender || '').toLowerCase() !== filters.gender) return false;
    if (filters.country && String(candidate.country || '').toLowerCase() !== filters.country) return false;
    if (candidate.age && (candidate.age < filters.minAge || candidate.age > filters.maxAge)) return false;
    return true;
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

  function removeFromWaiting(socketId) {
    const index = waitingUsers.findIndex((user) => user.socketId === socketId);
    if (index !== -1) waitingUsers.splice(index, 1);
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
        `INSERT INTO conversation_participants (conversation_id, user_id, socket_id, display_name)
         VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)`,
        [conversationId, a.userId, a.socketId, a.displayName, b.userId, b.socketId, b.displayName]
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
    let conversationId = null;
    try {
      conversationId = await createConversation(a, b, type);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
    const startedAt = Date.now();
    activePairs.set(a.socketId, { partnerId: b.socketId, conversationId, user: a, partner: b, skipAllowedAt: startedAt + cooldownFor(a) });
    activePairs.set(b.socketId, { partnerId: a.socketId, conversationId, user: b, partner: a, skipAllowedAt: startedAt + cooldownFor(b) });
    const shared = a.interests.filter((tag) => b.interests.includes(tag));

    io.to(a.socketId).emit('matched', matchPayload(a, b, shared, conversationId));
    io.to(b.socketId).emit('matched', matchPayload(b, a, shared, conversationId));

    if (a.isGuest || b.isGuest) {
      const timer = setTimeout(() => endPair(a.socketId, 'guest-time-expired'), guestDurationSeconds * 1000);
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
        userId: partner.userId,
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
        `UPDATE conversations SET status = 'ended', ended_at = COALESCE(ended_at, NOW()) WHERE id = $1 AND status = 'active'`,
        [conversationId]
      );
      await db.query(
        `UPDATE conversation_participants SET left_at = COALESCE(left_at, NOW()) WHERE conversation_id = $1`,
        [conversationId]
      );
    } catch (error) {
      console.error('Failed to end conversation:', error);
    }
  }

  function endPair(socketId, eventForBoth = null) {
    const active = activePairs.get(socketId);
    if (!active) return;
    const partner = activePairs.get(active.partnerId);
    activePairs.delete(socketId);
    activePairs.delete(active.partnerId);
    clearGuestTimer(socketId);
    clearGuestTimer(active.partnerId);
    markConversationEnded(active.conversationId);
    if (eventForBoth) {
      io.to(socketId).emit(eventForBoth);
      io.to(active.partnerId).emit(eventForBoth);
    } else {
      io.to(active.partnerId).emit('partner-left', { conversationId: active.conversationId });
    }
    return partner;
  }

  function canSendMessage(socketId) {
    const now = Date.now();
    const timestamps = (messageWindows.get(socketId) || []).filter((time) => now - time < MESSAGE_WINDOW_MS);
    if (timestamps.length >= MESSAGE_LIMIT) {
      messageWindows.set(socketId, timestamps);
      return false;
    }
    timestamps.push(now);
    messageWindows.set(socketId, timestamps);
    return true;
  }

  function moderationReason(text) {
    const lowered = text.toLowerCase();
    return bannedWords.find((word) => lowered.includes(word)) ? 'Message blocked by the safety filter.' : null;
  }

  async function persistMessage(active, socketId, text) {
    if (!db.isConfigured || !active.conversationId) return null;
    const result = await db.query(
      `INSERT INTO messages (conversation_id, sender_user_id, sender_socket_id, sender_display_name, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [active.conversationId, active.user.userId, socketId, active.user.displayName, text]
    );
    return result.rows[0];
  }

  io.on('connection', (socket) => {
    const account = socket.request.session?.user || null;
    presence.add(account?.id, socket.id);

    if (db.isConfigured) {
      const forwarded = socket.handshake.headers['x-forwarded-for'];
      const ipAddress = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : socket.handshake.address;
      db.query(
        `SELECT 1 FROM bans
         WHERE ((user_id = $1 AND (type = 'permanent' OR ends_at > NOW())) OR (type = 'ip' AND ip_address = $2))
         LIMIT 1`,
        [account?.id || null, ipAddress]
      ).then((result) => {
        if (result.rowCount) {
          socket.emit('account-banned', { type: 'blocked' });
          socket.disconnect(true);
        }
      }).catch((error) => console.error('Socket ban check failed:', error));
    }

    socket.on('find-partner', async (payload = {}) => {
      try {
        const current = activePairs.get(socket.id);
        if (current && Date.now() < current.skipAllowedAt) {
          socket.emit('skip-cooldown', { remainingMs: current.skipAllowedAt - Date.now() });
          return;
        }
        if (current) endPair(socket.id);
        removeFromWaiting(socket.id);
        const user = profileForSocket(socket, payload);
        const match = await findMatch(user);
        if (match) await pairUsers(user, match);
        else {
          waitingUsers.push(user);
          socket.emit('waiting');
        }
      } catch (error) {
        console.error('Matching failed:', error);
        socket.emit('chat-error', { message: 'Matching is temporarily unavailable.' });
      }
    });

    socket.on('send-message', async (rawText) => {
      const active = activePairs.get(socket.id);
      const text = cleanText(rawText, MAX_MESSAGE_LENGTH);
      if (!active || !text) return;
      if (!canSendMessage(socket.id)) return socket.emit('message-error', { message: 'You are sending messages too quickly.' });
      const blockedReason = moderationReason(text);
      if (blockedReason) return socket.emit('message-error', { message: blockedReason });
      try {
        const stored = await persistMessage(active, socket.id, text);
        io.to(active.partnerId).emit('receive-message', {
          id: stored?.id || null, text, createdAt: stored?.created_at || new Date().toISOString()
        });
        socket.emit('message-sent', { id: stored?.id || null });
      } catch (error) {
        console.error('Message persistence failed:', error);
        socket.emit('message-error', { message: 'Message could not be sent.' });
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
          console.error('Block check failed:', error);
        }
      }
      if (current && !blockedPartner && Date.now() < current.skipAllowedAt) {
        socket.emit('skip-cooldown', { remainingMs: current.skipAllowedAt - Date.now() });
        return;
      }
      endPair(socket.id);
      removeFromWaiting(socket.id);
    });

    socket.on('report', async (payload = {}) => {
      const active = activePairs.get(socket.id);
      if (!active) return socket.emit('report-error', { message: 'No active chat to report.' });
      if (!db.isConfigured) return socket.emit('report-submitted', { stored: false });
      try {
        await db.query(
          `INSERT INTO reports (reporter_user_id, reported_user_id, reporter_socket_id, reported_socket_id, reason, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [active.user.userId, active.partner.userId, socket.id, active.partnerId,
            cleanText(payload.reason, 100) || 'unspecified', cleanText(payload.details, 1000) || null]
        );
        socket.emit('report-submitted', { stored: true });
      } catch (error) {
        console.error('Failed to save report:', error);
        socket.emit('report-error', { message: 'Report could not be saved.' });
      }
    });

    socket.on('direct-chat-request', async (payload = {}) => {
      if (!account || !db.isConfigured) return socket.emit('direct-chat-error', { message: 'An account is required.' });
      const receiverId = Number(payload.userId);
      try {
        const friendship = await db.query('SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2', [account.id, receiverId]);
        if (!friendship.rowCount) return socket.emit('direct-chat-error', { message: 'Only friends can receive direct chat requests.' });
        const result = await db.query(
          `INSERT INTO chat_requests (sender_user_id, receiver_user_id) VALUES ($1, $2) RETURNING id`,
          [account.id, receiverId]
        );
        const request = { id: result.rows[0].id, senderId: account.id, displayName: account.displayName };
        presence.emitToUser(receiverId, 'direct-chat-requested', request);
        socket.emit('direct-chat-request-sent', { requestId: request.id });
      } catch (error) {
        if (error.code === '23505') return socket.emit('direct-chat-error', { message: 'A request is already pending.' });
        console.error('Direct chat request failed:', error);
        socket.emit('direct-chat-error', { message: 'Request could not be sent.' });
      }
    });

    socket.on('direct-chat-response', async (payload = {}) => {
      if (!account || !db.isConfigured) return;
      const action = payload.action === 'accept' ? 'accepted' : 'declined';
      try {
        const result = await db.query(
          `UPDATE chat_requests SET status = $1, responded_at = NOW()
           WHERE id = $2 AND receiver_user_id = $3 AND status = 'pending' RETURNING sender_user_id`,
          [action, Number(payload.requestId), account.id]
        );
        if (!result.rowCount || action !== 'accepted') return;
        const senderId = result.rows[0].sender_user_id;
        const senderSocketId = presence.getSockets(senderId).find((id) => !activePairs.has(id));
        if (!senderSocketId || activePairs.has(socket.id)) return socket.emit('direct-chat-error', { message: 'Your friend is no longer available.' });
        const senderSocket = io.sockets.sockets.get(senderSocketId);
        removeFromWaiting(senderSocketId);
        removeFromWaiting(socket.id);
        await pairUsers(profileForSocket(senderSocket), profileForSocket(socket), 'direct');
      } catch (error) {
        console.error('Direct chat response failed:', error);
        socket.emit('direct-chat-error', { message: 'The direct chat could not start.' });
      }
    });

    socket.on('disconnect', () => {
      endPair(socket.id);
      removeFromWaiting(socket.id);
      messageWindows.delete(socket.id);
      presence.remove(account?.id, socket.id);
    });
  });

  if (db.isConfigured) {
    const cleanup = async () => {
      try {
        await db.query(
          `DELETE FROM conversations c
           WHERE c.expires_at <= NOW()
             AND NOT EXISTS (SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id)`
        );
      } catch (error) {
        console.error('Conversation retention cleanup failed:', error);
      }
    };
    setTimeout(cleanup, 30_000).unref();
    setInterval(cleanup, 24 * 60 * 60 * 1000).unref();
  }
}

module.exports = { registerChat };
