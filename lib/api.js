const crypto = require('crypto');
const {
  REGISTERED_COUNTRIES,
  REGISTERED_GENDERS,
  cleanText,
  createRequireAdmin,
  publicSessionUser,
  requireAuth,
  requireVerifiedEmail,
  sessionUser
} = require('./auth');
const { requireRecentAdminAuth, revokeUserSessions, sessionUserId } = require('./security');
const flagCountries = require('../public/vendor/flag-icons-7.5.0/country.json');
const copy = require('../public/i18n/en.json');

function formatCopy(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function asId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function userIdFromPublicId(executor, value) {
  const publicId = cleanText(value, 40);
  if (!/^nvy_[a-f0-9]{20}$/.test(publicId)) return null;
  const result = await executor.query(
    'SELECT id FROM users WHERE public_id = $1 AND deleted_at IS NULL',
    [publicId]
  );
  return result.rowCount ? Number(result.rows[0].id) : null;
}

const GUEST_GENDERS = new Set(['any', 'male', 'female', 'non-binary', 'other']);
const GUEST_AVATARS = new Set(['astra', 'nova', 'lyra', 'vega', 'sol', 'mira', 'orion', 'elara']);
const GUEST_COUNTRIES = new Map(flagCountries
  .filter((country) => country.iso === true || country.code === 'xk')
  .filter((country) => country.code && country.name && country.flag_4x3)
  .map((country) => [country.code.toLowerCase(), country.name]));

function normalizeGuestInput(value = {}) {
  const name = cleanText(value.name, 24).replace(/\s+/g, ' ');
  const gender = cleanText(value.gender, 30).toLowerCase();
  const age = Number(value.age);
  const countryCode = cleanText(value.country?.code, 2).toLowerCase();
  const countryName = GUEST_COUNTRIES.get(countryCode) || '';
  const avatarId = cleanText(value.avatarId, 20).toLowerCase();

  if (!name) return { error: copy.errors.enterName };
  if (!GUEST_GENDERS.has(gender)) return { error: copy.errors.genderInvalid };
  if (!Number.isInteger(age) || age < 18 || age > 99) return { error: copy.errors.guestAgeInvalid };
  if (!/^[a-z]{2}$/.test(countryCode) || !countryName) return { error: copy.errors.countryInvalid };
  if (!GUEST_AVATARS.has(avatarId)) return { error: copy.errors.avatarInvalid };

  return {
    profile: {
      id: crypto.randomUUID(),
      name,
      gender,
      age,
      country: { code: countryCode, name: countryName },
      avatarId,
      nameChanges: Number(value.nameChanges) >= 1 ? 1 : 0,
      createdAt: new Date().toISOString()
    }
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function registerApiRoutes(app, db, presence, options = {}) {
  const auth = [requireAuth];
  const requireAdmin = createRequireAdmin(db);
  const highRiskAdmin = [requireAuth, requireAdmin, requireRecentAdminAuth];
  const userId = (req) => sessionUserId(req);

  app.get('/api/guest-profile', (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    return res.json({ guest: req.session.guestProfile || null });
  });

  app.post('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const normalized = normalizeGuestInput(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    req.session.guestProfile = normalized.profile;
    await saveSession(req);
    return res.status(201).json({ guest: normalized.profile });
  }));

  app.patch('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const guest = req.session.guestProfile;
    if (!guest) return res.status(404).json({ error: copy.errors.guestProfileMissing });

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const name = cleanText(req.body.name, 24).replace(/\s+/g, ' ');
      if (!name) return res.status(400).json({ error: copy.errors.enterName });
      if (name !== guest.name) {
        if (Number(guest.nameChanges) >= 1) {
          return res.status(409).json({ error: copy.errors.guestNameUsed });
        }
        guest.name = name;
        guest.nameChanges = 1;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'avatarId')) {
      const avatarId = cleanText(req.body.avatarId, 20).toLowerCase();
      if (!GUEST_AVATARS.has(avatarId)) return res.status(400).json({ error: copy.errors.avatarInvalid });
      guest.avatarId = avatarId;
    }

    req.session.guestProfile = guest;
    await saveSession(req);
    return res.json({ guest });
  }));

  app.delete('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.registeredLogout });
    delete req.session.guestProfile;
    await saveSession(req);
    return res.status(204).end();
  }));

  app.get('/api/account', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT id, public_id, display_alias, username, display_name, email, role, plan,
              birth_date, gender, country, country_code, profile_image_url,
              profile_completed_at, email_verified_at, session_version,
              admin_2fa_enabled_at, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId(req)]
    );
    if (!result.rowCount) return res.status(404).json({ error: copy.errors.userNotFound });
    const account = sessionUser(result.rows[0]);
    res.json({
      user: {
        ...publicSessionUser(account),
        public_id: account.publicId,
        display_alias: account.displayAlias,
        display_name: account.displayName,
        email_verified: account.emailVerified,
        birth_date: account.birthDate,
        country_code: account.countryCode,
        profile_image_url: account.profileImageUrl,
        created_at: result.rows[0].created_at
      }
    });
  }));

  app.patch('/api/account', ...auth, asyncRoute(async (req, res) => {
    const displayName = cleanText(req.body.displayName, 40);
    const gender = cleanText(req.body.gender, 30).toLowerCase();
    const countryCode = cleanText(req.body.countryCode || req.body.country, 2).toLowerCase();
    const profileImageUrl = cleanText(req.body.profileImageUrl, 500) || null;

    if (displayName.length < 2) return res.status(400).json({ error: copy.errors.displayNameShort });
    if (!REGISTERED_GENDERS.has(gender)) {
      return res.status(400).json({ error: copy.errors.genderInvalid });
    }
    if (!REGISTERED_COUNTRIES.has(countryCode)) {
      return res.status(400).json({ error: copy.errors.countryInvalid });
    }

    try {
      const current = await db.query(
        `SELECT gender, country_code, profile_changed_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId(req)]
      );
      if (!current.rowCount) return res.status(404).json({ error: copy.errors.userNotFound });
      const protectedFieldsChanged = current.rows[0].gender !== gender
        || current.rows[0].country_code !== countryCode;
      if (protectedFieldsChanged && current.rows[0].profile_changed_at
        && Date.now() - new Date(current.rows[0].profile_changed_at).getTime() < 30 * 24 * 60 * 60 * 1000) {
        return res.status(429).json({ error: copy.errors.profileChangeCooldown });
      }
      const result = await db.query(
        `UPDATE users
         SET display_name = $1, gender = $2, country = $3, country_code = $4,
             profile_image_url = $5,
             profile_changed_at = CASE WHEN $6 THEN NOW() ELSE profile_changed_at END,
             updated_at = NOW()
         WHERE id = $7 AND deleted_at IS NULL
         RETURNING *`,
        [
          displayName,
          gender,
          REGISTERED_COUNTRIES.get(countryCode),
          countryCode,
          profileImageUrl,
          protectedFieldsChanged,
          userId(req)
        ]
      );
      if (protectedFieldsChanged) {
        await db.query(
          `INSERT INTO security_events
             (actor_user_id, subject_user_id, event_type, metadata)
           VALUES ($1, $1, 'profile_matching_fields_changed',
                   jsonb_build_object('genderChanged', $2, 'countryChanged', $3))`,
          [
            userId(req),
            current.rows[0].gender !== gender,
            current.rows[0].country_code !== countryCode
          ]
        );
      }
      req.session.user = sessionUser(result.rows[0]);
      res.json({ user: publicSessionUser(req.session.user) });
    } catch (error) {
      throw error;
    }
  }));

  app.delete('/api/account', ...auth, asyncRoute(async (req, res) => {
    if (req.body.confirmation !== 'DELETE') {
      return res.status(400).json({ error: copy.errors.deleteConfirmation });
    }
    const accountUserId = userId(req);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE messages SET sender_user_id = NULL, sender_display_name = $2
         WHERE sender_user_id = $1`,
        [accountUserId, copy.common.deletedUser]
      );
      await client.query('DELETE FROM saved_chats WHERE user_id = $1', [accountUserId]);
      await client.query('DELETE FROM message_receipts WHERE user_id = $1', [accountUserId]);
      await client.query('DELETE FROM notifications WHERE user_id = $1', [accountUserId]);
      await client.query('DELETE FROM friend_requests WHERE sender_user_id = $1 OR receiver_user_id = $1', [accountUserId]);
      await client.query('DELETE FROM chat_requests WHERE sender_user_id = $1 OR receiver_user_id = $1', [accountUserId]);
      await client.query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [accountUserId]);
      await client.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 OR blocked_user_id = $1', [accountUserId]);
      await client.query(
        `UPDATE users
         SET username = 'deleted_' || id,
             display_name = $2,
             email = 'deleted_' || id || '@deleted.nevely.invalid',
             password_hash = $3,
             public_id = 'deleted_' || encode(gen_random_bytes(10), 'hex'),
             display_alias = NULL,
             profile_image_url = NULL,
             deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [accountUserId, copy.common.deletedUser, crypto.randomBytes(32).toString('hex')]
      );
      await revokeUserSessions(db, accountUserId, { client });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    req.session.destroy(() => res.status(204).end());
  }));

  app.post('/api/account/avatar', ...auth, (req, res) => {
    res.status(501).json({ error: copy.errors.photoUploadUnavailable });
  });

  app.get('/api/users/:id/profile', ...auth, asyncRoute(async (req, res) => {
    const targetId = await userIdFromPublicId(db, req.params.id);
    if (!targetId) return res.status(404).json({ error: copy.errors.userNotFound });
    const result = await db.query(
      `SELECT u.public_id, u.display_alias, u.display_name, u.country,
              u.profile_image_url, u.plan,
              EXISTS(SELECT 1 FROM friendships f WHERE f.user_id = $1 AND f.friend_id = u.id) AS is_friend,
              EXISTS(SELECT 1 FROM blocked_users b WHERE b.blocker_user_id = $1 AND b.blocked_user_id = u.id) AS is_blocked
       FROM users u WHERE u.id = $2 AND u.deleted_at IS NULL`,
      [userId(req), targetId]
    );
    if (!result.rowCount) return res.status(404).json({ error: copy.errors.userNotFound });
    res.json({ user: result.rows[0], online: presence.isOnline(targetId) });
  }));

  app.get('/api/conversations', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT c.id, c.type, c.status, c.started_at, c.ended_at, c.expires_at,
              COALESCE(partner.display_name, $2) AS partner_name,
              partner.public_id AS partner_public_id, partner.profile_image_url,
              EXISTS(SELECT 1 FROM saved_chats s WHERE s.user_id = $1 AND s.conversation_id = c.id) AS saved,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_for_everyone_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_for_everyone_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*)::int
               FROM message_receipts mr
               JOIN messages unread_message ON unread_message.id = mr.message_id
               WHERE mr.user_id = $1
                 AND mr.read_at IS NULL
                 AND unread_message.conversation_id = c.id
                 AND unread_message.deleted_for_everyone_at IS NULL) AS unread_count
       FROM conversation_participants mine
       JOIN conversations c ON c.id = mine.conversation_id
       LEFT JOIN LATERAL (
         SELECT cp.user_id, u.public_id, COALESCE(u.display_name, cp.display_name) AS display_name,
                u.profile_image_url
         FROM conversation_participants cp
         LEFT JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = c.id AND cp.socket_id <> mine.socket_id
         ORDER BY cp.joined_at LIMIT 1
       ) partner ON TRUE
       WHERE mine.user_id = $1 AND c.deleted_for_everyone_at IS NULL
         AND (c.expires_at > NOW() OR EXISTS (SELECT 1 FROM saved_chats s2 WHERE s2.conversation_id = c.id))
       ORDER BY c.started_at DESC LIMIT 100`,
      [userId(req), copy.common.guest]
    );
    res.json({ conversations: result.rows });
  }));

  app.get('/api/conversations/:id/messages', ...auth, asyncRoute(async (req, res) => {
    const conversationId = asId(req.params.id);
    const allowed = await db.query(
      `SELECT c.id, c.status, c.started_at, c.ended_at,
              EXISTS(SELECT 1 FROM saved_chats s WHERE s.user_id = $1 AND s.conversation_id = c.id) AS saved
       FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
       WHERE c.id = $2 AND cp.user_id = $1 AND c.deleted_for_everyone_at IS NULL
         AND (c.expires_at > NOW() OR EXISTS (SELECT 1 FROM saved_chats s2 WHERE s2.conversation_id = c.id))`,
      [userId(req), conversationId]
    );
    if (!allowed.rowCount) return res.status(404).json({ error: copy.errors.conversationUnavailable });
    const messages = await db.query(
      `SELECT m.id, sender.public_id AS sender_public_id, m.sender_display_name, m.body,
              m.created_at,
              (SELECT MAX(mr.delivered_at) FROM message_receipts mr WHERE mr.message_id = m.id) AS delivered_at,
              (SELECT MAX(mr.read_at) FROM message_receipts mr WHERE mr.message_id = m.id) AS read_at
       FROM messages m
       LEFT JOIN users sender ON sender.id = m.sender_user_id
       WHERE m.conversation_id = $1 AND m.deleted_for_everyone_at IS NULL
       ORDER BY m.created_at`,
      [conversationId]
    );
    res.json({ conversation: allowed.rows[0], messages: messages.rows });
  }));

  app.patch('/api/conversations/:id/read', ...auth, asyncRoute(async (req, res) => {
    const conversationId = asId(req.params.id);
    const upToMessageId = asId(req.body.upToMessageId);
    if (!conversationId || !upToMessageId) {
      return res.status(400).json({ error: copy.errors.conversationMessageInvalid });
    }

    const result = await db.query(
      `UPDATE message_receipts mr
       SET delivered_at = COALESCE(mr.delivered_at, NOW()),
           read_at = COALESCE(mr.read_at, NOW())
       FROM messages m
       WHERE mr.message_id = m.id
         AND mr.user_id = $1
         AND mr.read_at IS NULL
         AND m.conversation_id = $2
         AND m.id <= $3
         AND m.deleted_for_everyone_at IS NULL
         AND EXISTS (
           SELECT 1 FROM conversation_participants cp
           WHERE cp.conversation_id = m.conversation_id AND cp.user_id = $1
         )
       RETURNING mr.message_id, mr.read_at, m.sender_user_id`,
      [userId(req), conversationId, upToMessageId]
    );

    const senderIds = new Set(result.rows.map((row) => Number(row.sender_user_id)).filter(Boolean));
    const readAt = result.rows[0]?.read_at || null;
    if (readAt) {
      for (const senderId of senderIds) {
        presence.emitToUser(senderId, 'message-read', { conversationId, upToMessageId, readAt });
      }
    }

    res.json({ updated: result.rowCount, conversationId, upToMessageId, readAt });
  }));

  app.delete('/api/conversations/:id', ...auth, asyncRoute(async (req, res) => {
    if (req.body.confirmation !== 'DELETE FOR EVERYONE') {
      return res.status(400).json({ error: copy.errors.confirmationRequired });
    }
    const conversationId = asId(req.params.id);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE conversations c SET status = 'deleted', deleted_for_everyone_at = NOW()
         WHERE c.id = $1 AND EXISTS (
           SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $2
         ) RETURNING c.id`,
        [conversationId, userId(req)]
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: copy.errors.conversationNotFound });
      }
      await client.query('UPDATE messages SET deleted_for_everyone_at = NOW() WHERE conversation_id = $1', [conversationId]);
      await client.query('DELETE FROM saved_chats WHERE conversation_id = $1', [conversationId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  }));

  app.get('/api/saved-chats', ...auth, asyncRoute(async (req, res) => {
    const limit = req.session.user.plan === 'premium' ? 10 : 2;
    const result = await db.query(
      `SELECT s.conversation_id, s.created_at, c.started_at,
              COALESCE(partner.display_name, $2) AS partner_name
       FROM saved_chats s JOIN conversations c ON c.id = s.conversation_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(u.display_name, cp.display_name) AS display_name
         FROM conversation_participants cp LEFT JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = c.id AND cp.user_id IS DISTINCT FROM $1
         ORDER BY cp.joined_at LIMIT 1
       ) partner ON TRUE
       WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [userId(req), copy.common.guest]
    );
    res.json({ chats: result.rows, limit, used: result.rowCount });
  }));

  app.put('/api/conversations/:id/saved', ...auth, requireVerifiedEmail, asyncRoute(async (req, res) => {
    const limit = req.session.user.plan === 'premium' ? 10 : 2;
    const conversationId = asId(req.params.id);
    const owns = await db.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId(req)]
    );
    if (!owns.rowCount) return res.status(404).json({ error: copy.errors.conversationNotFound });
    const count = await db.query('SELECT COUNT(*)::int AS count FROM saved_chats WHERE user_id = $1', [userId(req)]);
    if (count.rows[0].count >= limit) return res.status(409).json({ error: formatCopy(copy.errors.savedLimit, { limit }), limit });
    await db.query(
      `INSERT INTO saved_chats (user_id, conversation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId(req), conversationId]
    );
    res.status(201).json({ saved: true, limit });
  }));

  app.delete('/api/conversations/:id/saved', ...auth, asyncRoute(async (req, res) => {
    await db.query('DELETE FROM saved_chats WHERE user_id = $1 AND conversation_id = $2', [userId(req), asId(req.params.id)]);
    res.status(204).end();
  }));

  app.get('/api/friends', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT u.id AS internal_id, u.public_id, u.display_alias, u.display_name,
              u.profile_image_url, u.country
       FROM friendships f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND u.deleted_at IS NULL ORDER BY u.display_name`,
      [userId(req)]
    );
    res.json({
      friends: result.rows.map(({ internal_id: internalId, ...friend }) => ({
        ...friend,
        online: presence.isOnline(internalId)
      }))
    });
  }));

  app.delete('/api/friends/:id', ...auth, asyncRoute(async (req, res) => {
    const friendId = await userIdFromPublicId(db, req.params.id);
    if (!friendId) return res.status(404).json({ error: copy.errors.userNotFound });
    await db.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [userId(req), friendId]);
    res.status(204).end();
  }));

  app.get('/api/friend-requests', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT fr.id, fr.created_at, u.public_id AS sender_public_id,
              u.display_name, u.profile_image_url
       FROM friend_requests fr JOIN users u ON u.id = fr.sender_user_id
       WHERE fr.receiver_user_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [userId(req)]
    );
    res.json({ requests: result.rows });
  }));

  app.post('/api/friend-requests', ...auth, requireVerifiedEmail, asyncRoute(async (req, res) => {
    const receiverId = await userIdFromPublicId(db, req.body.publicId || req.body.userId);
    if (!receiverId || receiverId === userId(req)) return res.status(400).json({ error: copy.errors.userInvalid });
    const result = await db.query(
      `INSERT INTO friend_requests (sender_user_id, receiver_user_id)
       VALUES ($1, $2)
       ON CONFLICT (sender_user_id, receiver_user_id) DO UPDATE SET status = 'pending', created_at = NOW(), responded_at = NULL
       RETURNING id`,
      [userId(req), receiverId]
    );
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
        VALUES ($1, 'friend_request', $2, $3,
                jsonb_build_object('requestId', $4, 'userPublicId', $5))`,
      [receiverId, copy.notifications.friendRequestTitle,
        formatCopy(copy.notifications.friendRequestBody, { name: req.session.user.displayName }),
        result.rows[0].id, req.session.user.publicId]
    );
    presence.emitToUser(receiverId, 'notification-created', { type: 'friend_request' });
    res.status(201).json({ requestId: result.rows[0].id });
  }));

  app.patch('/api/friend-requests/:id', ...auth, asyncRoute(async (req, res) => {
    const status = req.body.action === 'accept' ? 'accepted' : 'declined';
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE friend_requests SET status = $1, responded_at = NOW()
         WHERE id = $2 AND receiver_user_id = $3 AND status = 'pending'
         RETURNING sender_user_id`,
        [status, asId(req.params.id), userId(req)]
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: copy.errors.requestUnavailable });
      }
      if (status === 'accepted') {
        const senderId = result.rows[0].sender_user_id;
        await client.query(
          `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
          [userId(req), senderId]
        );
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body)
           VALUES ($1, 'friend_accepted', $2, $3)`,
          [senderId, copy.notifications.friendAcceptedTitle,
            formatCopy(copy.notifications.friendAcceptedBody, { name: req.session.user.displayName })]
        );
        presence.emitToUser(senderId, 'notification-created', { type: 'friend_accepted' });
      }
      await client.query('COMMIT');
      res.json({ status });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.get('/api/chat-requests', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT cr.id, cr.created_at, u.public_id AS sender_public_id,
              u.display_name, u.profile_image_url
       FROM chat_requests cr JOIN users u ON u.id = cr.sender_user_id
       WHERE cr.receiver_user_id = $1 AND cr.status = 'pending' ORDER BY cr.created_at DESC`,
      [userId(req)]
    );
    res.json({ requests: result.rows });
  }));

  app.get('/api/notifications', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId(req)]
    );
    res.json({ notifications: result.rows });
  }));

  app.patch('/api/notifications/:id/read', ...auth, asyncRoute(async (req, res) => {
    await db.query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2', [asId(req.params.id), userId(req)]);
    res.status(204).end();
  }));

  app.get('/api/blocks', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT u.public_id, u.display_alias, u.display_name, u.profile_image_url,
              b.created_at
       FROM blocked_users b JOIN users u ON u.id = b.blocked_user_id
       WHERE b.blocker_user_id = $1 ORDER BY b.created_at DESC`,
      [userId(req)]
    );
    res.json({ users: result.rows });
  }));

  app.put('/api/blocks/:id', ...auth, asyncRoute(async (req, res) => {
    const blockedId = await userIdFromPublicId(db, req.params.id);
    if (!blockedId || blockedId === userId(req)) return res.status(400).json({ error: copy.errors.userInvalid });
    await db.query('INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId(req), blockedId]);
    res.status(201).json({ blocked: true });
  }));

  app.delete('/api/blocks/:id', ...auth, asyncRoute(async (req, res) => {
    const blockedId = await userIdFromPublicId(db, req.params.id);
    if (!blockedId) return res.status(404).json({ error: copy.errors.userNotFound });
    await db.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2', [userId(req), blockedId]);
    res.status(204).end();
  }));

  app.get('/admin', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const [users, reports, price] = await Promise.all([
      db.query(`SELECT public_id, display_alias, display_name, email, role, plan,
                       email_verified_at, admin_2fa_enabled_at, created_at
                FROM users WHERE deleted_at IS NULL
                ORDER BY created_at DESC LIMIT 100`),
      db.query(`SELECT r.*, reporter.display_name AS reporter_name, reported.display_name AS reported_name FROM reports r LEFT JOIN users reporter ON reporter.id = r.reporter_user_id LEFT JOIN users reported ON reported.id = r.reported_user_id ORDER BY r.created_at DESC LIMIT 100`),
      db.query(`SELECT * FROM plan_price_history WHERE plan = 'premium' ORDER BY created_at DESC LIMIT 1`)
    ]);
    res.render('admin', {
      pageTitle: copy.pageTitles.admin,
      users: users.rows,
      reports: reports.rows,
      price: price.rows[0],
      csrfToken: res.locals.csrfToken
    });
  }));

  app.post('/api/admin/users/:id/ban', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const targetUserId = await userIdFromPublicId(db, req.params.id);
    if (!targetUserId) return res.status(404).json({ error: copy.errors.userNotFound });
    const type = req.body.type === 'permanent' ? 'permanent' : 'temporary';
    const hours = Math.min(Math.max(Number(req.body.hours) || 24, 1), 24 * 365);
    const result = await db.query(
      `INSERT INTO bans (user_id, type, reason, ends_at, created_by)
       VALUES ($1, $2::varchar(20), $3,
               CASE WHEN $2::varchar(20) = 'temporary'
                 THEN NOW() + make_interval(hours => $4::int)
                 ELSE NULL
               END,
               $5)
       RETURNING id`,
      [targetUserId, type, cleanText(req.body.reason, 500), hours, userId(req)]
    );
    if (type === 'permanent') {
      const user = await db.query('SELECT last_ip FROM users WHERE id = $1', [targetUserId]);
      if (user.rows[0]?.last_ip) {
        await db.query(
          `INSERT INTO bans (user_id, ip_address, type, reason, created_by) VALUES ($1, $2, 'ip', $3, $4)`,
          [targetUserId, user.rows[0].last_ip, cleanText(req.body.reason, 500), userId(req)]
        );
      }
    }
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'ban', $2, $3)`,
      [targetUserId, copy.notifications.suspensionTitle,
        type === 'permanent'
          ? copy.notifications.suspensionPermanent
          : formatCopy(copy.notifications.suspensionTemporary, { hours })]
    );
    await revokeUserSessions(db, targetUserId);
    presence.emitToUser(targetUserId, 'account-banned', { type, hours });
    res.status(201).json({ banId: Number(result.rows[0].id) });
  }));

  app.delete('/api/admin/users/:id', ...highRiskAdmin, asyncRoute(async (req, res) => {
    if (req.body.confirmation !== 'BAN AND DELETE') {
      return res.status(400).json({ error: copy.errors.confirmationRequired });
    }
    const targetUserId = await userIdFromPublicId(db, req.params.id);
    if (!targetUserId) return res.status(404).json({ error: copy.errors.userNotFound });
    if (targetUserId === userId(req)) return res.status(400).json({ error: copy.errors.ownAdminDelete });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT last_ip FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [targetUserId]);
      if (!user.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: copy.errors.userNotFound });
      }
      await client.query(
        `INSERT INTO bans (user_id, type, reason, created_by) VALUES ($1, 'permanent', $2, $3)`,
        [targetUserId, cleanText(req.body.reason, 500) || copy.admin.removalReason, userId(req)]
      );
      if (user.rows[0].last_ip) {
        await client.query(
          `INSERT INTO bans (user_id, ip_address, type, reason, created_by) VALUES ($1, $2, 'ip', $3, $4)`,
          [targetUserId, user.rows[0].last_ip, cleanText(req.body.reason, 500) || copy.admin.removalReason, userId(req)]
        );
      }
      await client.query('UPDATE messages SET sender_user_id = NULL, sender_display_name = $2 WHERE sender_user_id = $1', [targetUserId, copy.common.deletedUser]);
      await client.query('DELETE FROM saved_chats WHERE user_id = $1', [targetUserId]);
      await client.query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [targetUserId]);
      await client.query(
        `UPDATE users SET username = 'deleted_' || id, display_name = $2,
             email = 'deleted_' || id || '@deleted.nevely.invalid', password_hash = $3,
             public_id = 'deleted_' || encode(gen_random_bytes(10), 'hex'),
             display_alias = NULL, profile_image_url = NULL,
             deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [targetUserId, copy.common.deletedUser, crypto.randomBytes(32).toString('hex')]
      );
      await revokeUserSessions(db, targetUserId, { client });
      await client.query('COMMIT');
      presence.emitToUser(targetUserId, 'account-banned', { type: 'permanent' });
      res.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.patch('/api/admin/reports/:id', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const status = req.body.action === 'dismiss' ? 'dismissed' : 'resolved';
    const result = await db.query(
      `UPDATE reports SET status = $1, reviewed_by = $2, reviewed_at = NOW(), resolution = $3 WHERE id = $4
       RETURNING reporter_user_id`,
      [status, userId(req), cleanText(req.body.resolution, 1000), asId(req.params.id)]
    );
    const reporterId = result.rows[0]?.reporter_user_id;
    if (reporterId) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'report_processed', $2, $3)`,
        [reporterId, copy.notifications.reportReviewedTitle,
          status === 'resolved' ? copy.notifications.reportActionTaken : copy.notifications.reportDismissed]
      );
      presence.emitToUser(reporterId, 'notification-created', { type: 'report_processed' });
    }
    res.json({ status });
  }));

  app.post('/api/admin/prices', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const priceCents = Math.max(0, Math.round(Number(req.body.price) * 100));
    await db.query(
      `INSERT INTO plan_price_history (plan, price_cents, currency, changed_by) VALUES ('premium', $1, $2, $3)`,
      [priceCents, cleanText(req.body.currency, 3).toUpperCase() || 'USD', userId(req)]
    );
    res.status(201).json({ priceCents });
  }));

  app.patch('/api/admin/users/:id/role', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const targetUserId = await userIdFromPublicId(db, req.params.id);
    if (!targetUserId) return res.status(404).json({ error: copy.errors.userNotFound });
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    if (targetUserId === userId(req) && role !== 'admin') {
      return res.status(400).json({ error: copy.errors.ownAdminRole });
    }
    await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [
      role,
      targetUserId
    ]);
    await db.query(
      `INSERT INTO security_events
         (actor_user_id, subject_user_id, event_type, metadata)
       VALUES ($1, $2, 'role_changed', jsonb_build_object('role', $3::text))`,
      [userId(req), targetUserId, role]
    );
    await revokeUserSessions(db, targetUserId);
    return res.json({ role });
  }));

  app.patch('/api/admin/users/:id/protected-profile', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const targetUserId = await userIdFromPublicId(db, req.params.id);
    if (!targetUserId) return res.status(404).json({ error: copy.errors.userNotFound });
    const birthDate = cleanText(req.body.birthDate, 10);
    const reason = cleanText(req.body.reason, 500);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !reason) {
      return res.status(400).json({ error: copy.errors.protectedProfileInvalid });
    }
    const result = await db.query(
      `UPDATE users SET birth_date = $1, updated_at = NOW()
       WHERE id = $2
         AND $1::date <= CURRENT_DATE - INTERVAL '18 years'
         AND $1::date >= CURRENT_DATE - INTERVAL '120 years'
       RETURNING public_id`,
      [birthDate, targetUserId]
    );
    if (!result.rowCount) return res.status(400).json({ error: copy.errors.birthDateInvalid });
    await db.query(
      `INSERT INTO security_events
         (actor_user_id, subject_user_id, event_type, metadata)
       VALUES ($1, $2, 'birth_date_support_change',
               jsonb_build_object('reason', $3::text))`,
      [userId(req), targetUserId, reason]
    );
    return res.json({ updated: true });
  }));
}

module.exports = { registerApiRoutes };
