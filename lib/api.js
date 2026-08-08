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
const { normalizedCorrelationId, requiredReason } = require('./moderation');
const { requireRecentAdminAuth, revokeUserSessions, sessionUserId } = require('./security');
const {
  cursorPage,
  decodeCursor,
  decodeUuidCursor,
  messagePage,
  pageSize,
  uuidCursorPage
} = require('./pagination');
const {
  bindGuestSession,
  clearGuestSession,
  createGuestPrincipal,
  findActiveGuestPrincipal,
  guestAlias,
  tombstoneGuestPrincipal,
  updateGuestPrincipal
} = require('./guest-principals');
const flagCountries = require('../public/vendor/flag-icons-7.5.0/country.json');
const copy = require('../public/i18n/en.json');
const { PRESET_AVATAR_ID_SET } = require('./avatar-presets');

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

function paginationFor(req, res) {
  const limit = pageSize(req.query.limit);
  if (!req.query.cursor) return { cursor: null, limit };
  const cursor = decodeCursor(req.query.cursor);
  if (!cursor) {
    res.status(400).json({ error: copy.errors.paginationInvalid });
    return null;
  }
  return { cursor, limit };
}

function uuidPaginationFor(req, res) {
  const limit = pageSize(req.query.limit);
  if (!req.query.cursor) return { cursor: null, limit };
  const cursor = decodeUuidCursor(req.query.cursor);
  if (!cursor) {
    res.status(400).json({ error: copy.errors.paginationInvalid });
    return null;
  }
  return { cursor, limit };
}

function evidencePaginationFor(req, res) {
  const limit = pageSize(req.query.limit);
  if (!req.query.cursor) return { index: 0, limit };
  try {
    const decoded = JSON.parse(Buffer.from(String(req.query.cursor), 'base64url').toString('utf8'));
    const index = Number(decoded.index);
    if (decoded.version !== 1 || !Number.isSafeInteger(index) || index < 0 || index > 50) throw new Error('invalid');
    return { index, limit };
  } catch {
    res.status(400).json({ error: copy.errors.paginationInvalid });
    return null;
  }
}

function evidenceCursor(index) {
  return Buffer.from(JSON.stringify({ version: 1, index }), 'utf8').toString('base64url');
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
const GUEST_AVATARS = PRESET_AVATAR_ID_SET;
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

  const id = crypto.randomUUID();
  return {
    profile: {
      id,
      displayAlias: guestAlias(id),
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

async function ensureGuestAccountNotification(db, guestId) {
  if (!db.isConfigured || !guestId) return;
  await db.query(
    `INSERT INTO notifications (guest_id, type, title, body, data)
     VALUES ($1, 'guest_account_claim', $2, $3, '{"action":"login"}'::jsonb)
     ON CONFLICT DO NOTHING`,
    [guestId, copy.chat.feedback.guestNotificationTitle, copy.chat.feedback.guestNotificationBody]
  );
}

async function guestForRequest(db, req, { touch = true, migrateLegacy = true } = {}) {
  if (!db.isConfigured) return req.session.guestProfile || null;

  let guest = req.session.guestPrincipalId
    ? await findActiveGuestPrincipal(db, req.session.guestPrincipalId, { touch })
    : null;
  const legacy = req.session.guestProfile;

  if (!guest && migrateLegacy && legacy) {
    const normalized = normalizeGuestInput(legacy);
    if (!normalized.error) {
      const legacyId = typeof legacy.id === 'string' ? legacy.id : null;
      guest = legacyId
        ? await findActiveGuestPrincipal(db, legacyId, { touch })
        : null;
      if (!guest) {
        guest = await createGuestPrincipal(db, normalized.profile, {
          id: legacyId,
          createdAt: legacy.createdAt
        });
      }
    }
  }

  if (guest) bindGuestSession(req.session, guest);
  else clearGuestSession(req.session);
  return guest;
}

const GUEST_SAVED_CHAT_LIMIT = 2;
const DEFAULT_RECENT_UNSAVED_CHAT_LIMIT = 50;

async function productPrincipalForRequest(db, req, res) {
  if (!db.isConfigured) {
    res.status(503).json({ error: copy.errors.serviceUnavailable });
    return null;
  }
  if (req.session.user) {
    if (!req.session.user.emailVerified) {
      res.status(403).json({
        error: copy.errors.emailVerificationRequired,
        code: 'EMAIL_VERIFICATION_REQUIRED'
      });
      return null;
    }
    return {
      kind: 'user',
      userId: sessionUserId(req),
      guestId: null,
      savedChatLimit: req.session.user.plan === 'premium' ? 10 : 2
    };
  }
  const guest = await guestForRequest(db, req);
  if (!guest) {
    res.status(401).json({ error: copy.errors.guestProfileMissing });
    return null;
  }
  await ensureGuestAccountNotification(db, guest.id);
  await saveSession(req);
  return {
    kind: 'guest',
    userId: null,
    guestId: guest.id,
    savedChatLimit: GUEST_SAVED_CHAT_LIMIT
  };
}

function registerApiRoutes(app, db, presence, options = {}) {
  const environment = options.environment || process.env;
  const moderation = options.moderation;
  const auth = [requireAuth, requireVerifiedEmail];
  const requireAdmin = createRequireAdmin(db);
  const highRiskAdmin = [requireAuth, requireAdmin, requireRecentAdminAuth];
  const userId = (req) => sessionUserId(req);
  const recentUnsavedChatLimit = Math.min(
    Math.max(Number(environment.RETENTION_MAX_UNSAVED_PER_USER) || DEFAULT_RECENT_UNSAVED_CHAT_LIMIT, 10),
    1_000
  );

  app.get('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const guest = await guestForRequest(db, req);
    if (guest) await ensureGuestAccountNotification(db, guest.id);
    await saveSession(req);
    return res.json({ guest, claimEligible: Boolean(guest) });
  }));

  app.post('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const normalized = normalizeGuestInput(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    if (db.isConfigured) {
      const existing = await guestForRequest(db, req);
      if (existing) {
        await ensureGuestAccountNotification(db, existing.id);
        await saveSession(req);
        return res.json({ guest: existing, claimEligible: true });
      }
      const guest = await createGuestPrincipal(db, normalized.profile);
      await ensureGuestAccountNotification(db, guest.id);
      bindGuestSession(req.session, guest);
      await saveSession(req);
      return res.status(201).json({ guest, claimEligible: true });
    }

    req.session.guestProfile = normalized.profile;
    await saveSession(req);
    return res.status(201).json({ guest: normalized.profile });
  }));

  app.patch('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const guest = await guestForRequest(db, req);
    if (!guest) {
      await saveSession(req);
      return res.status(404).json({ error: copy.errors.guestProfileMissing });
    }
    if (db.isConfigured) await saveSession(req);

    let name;
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      name = cleanText(req.body.name, 24).replace(/\s+/g, ' ');
      if (!name) return res.status(400).json({ error: copy.errors.enterName });
      if (name !== guest.name) {
        if (Number(guest.nameChanges) >= 1) {
          return res.status(409).json({ error: copy.errors.guestNameUsed });
        }
      }
    }

    let avatarId;
    if (Object.prototype.hasOwnProperty.call(req.body, 'avatarId')) {
      avatarId = cleanText(req.body.avatarId, 20).toLowerCase();
      if (!GUEST_AVATARS.has(avatarId)) return res.status(400).json({ error: copy.errors.avatarInvalid });
    }

    if (db.isConfigured) {
      const updated = await updateGuestPrincipal(db, guest.id, { name, avatarId });
      if (!updated) return res.status(409).json({ error: copy.errors.guestNameUsed });
      await ensureGuestAccountNotification(db, updated.id);
      bindGuestSession(req.session, updated);
      await saveSession(req);
      return res.json({ guest: updated, claimEligible: true });
    }

    if (name !== undefined && name !== guest.name) {
      guest.name = name;
      guest.nameChanges = 1;
    }
    if (avatarId !== undefined) guest.avatarId = avatarId;
    req.session.guestProfile = guest;
    await saveSession(req);
    return res.json({ guest });
  }));

  app.delete('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.registeredLogout });
    const guest = await guestForRequest(db, req, { touch: false });
    if (db.isConfigured && guest) await tombstoneGuestPrincipal(db, guest.id);
    clearGuestSession(req.session);
    await saveSession(req);
    return res.status(204).end();
  }));

  app.get('/api/account', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT id, public_id, display_alias, username, display_name, email, role, plan,
              birth_date, gender, country, country_code, profile_image_url,
              profile_completed_at, email_verified_at, session_version,
              admin_2fa_enabled_at, created_at,
              password_hash IS NOT NULL AS has_password,
              EXISTS(
                SELECT 1 FROM account_identities
                WHERE user_id = users.id AND provider = 'google'
              ) AS has_google
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
        created_at: result.rows[0].created_at,
        hasPassword: Boolean(result.rows[0].has_password),
        hasGoogle: Boolean(result.rows[0].has_google)
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
      await client.query('DELETE FROM account_identities WHERE user_id = $1', [accountUserId]);
      await client.query(
        `UPDATE account_tokens
         SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE user_id = $1 AND used_at IS NULL`,
        [accountUserId]
      );
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

  app.get('/api/conversations', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const [result, unread] = await Promise.all([
      db.query(
      `SELECT c.id, c.type, c.status, c.started_at, c.ended_at, c.expires_at,
               c.created_at, c.last_activity_at,
               COALESCE(partner.account_name, partner.guest_name, partner.display_name, $3) AS partner_name,
               partner.public_id AS partner_public_id, partner.profile_image_url,
               partner.guest_alias AS partner_guest_alias,
               EXISTS(
                 SELECT 1 FROM saved_chats s
                 WHERE s.conversation_id = c.id
                   AND (s.user_id = $1 OR s.guest_id = $2)
               ) AS saved,
               (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_for_everyone_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message,
               (SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_for_everyone_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
               (SELECT COUNT(*)::int
                FROM message_receipts mr
                JOIN messages unread_message ON unread_message.id = mr.message_id
                WHERE (mr.user_id = $1 OR mr.guest_id = $2)
                  AND mr.read_at IS NULL
                  AND unread_message.conversation_id = c.id
                  AND unread_message.deleted_for_everyone_at IS NULL) AS unread_count
        FROM conversation_participants mine
        JOIN conversations c ON c.id = mine.conversation_id
        LEFT JOIN LATERAL (
          SELECT cp.user_id, cp.guest_id, u.public_id, u.display_name AS account_name,
                 guest.name AS guest_name, guest.display_alias AS guest_alias,
                 cp.display_name, u.profile_image_url
          FROM conversation_participants cp
          LEFT JOIN users u ON u.id = cp.user_id
          LEFT JOIN guest_principals guest ON guest.id = cp.guest_id
          WHERE cp.conversation_id = c.id
            AND NOT (
              COALESCE(cp.user_id = $1, FALSE)
              OR COALESCE(cp.guest_id = $2, FALSE)
            )
          ORDER BY cp.joined_at LIMIT 1
        ) partner ON TRUE
        WHERE (mine.user_id = $1 OR mine.guest_id = $2)
          AND c.deleted_for_everyone_at IS NULL
           AND (c.expires_at > NOW() OR EXISTS (SELECT 1 FROM saved_chats s2 WHERE s2.conversation_id = c.id))
           AND (
             $4::timestamptz IS NULL
             OR (c.created_at, c.id) < ($4::timestamptz, $5::bigint)
           )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $6`,
      [
        principal.userId,
        principal.guestId,
        copy.common.guest,
        cursor?.createdAt || null,
        cursor?.id || null,
        limit + 1
      ]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM message_receipts mr
         JOIN messages m ON m.id = mr.message_id
         JOIN conversations c ON c.id = m.conversation_id
         WHERE (mr.user_id = $1 OR mr.guest_id = $2)
            AND mr.read_at IS NULL
            AND m.deleted_for_everyone_at IS NULL
            AND c.deleted_for_everyone_at IS NULL
           AND (c.expires_at > NOW() OR EXISTS (
              SELECT 1 FROM saved_chats s WHERE s.conversation_id = c.id
            ))`,
        [principal.userId, principal.guestId]
      )
    ]);
    const paged = cursorPage(result.rows, limit);
    res.json({
      conversations: paged.items,
      page: paged.page,
      unreadCount: Number(unread.rows[0].count),
      limits: {
        recentUnsaved: recentUnsavedChatLimit,
        saved: principal.savedChatLimit
      }
    });
  }));

  app.get('/api/conversations/:id/messages', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const conversationId = asId(req.params.id);
    const limit = pageSize(req.query.limit);
    const beforeMessageId = req.query.beforeMessageId
      ? asId(req.query.beforeMessageId)
      : null;
    if (req.query.beforeMessageId && !beforeMessageId) {
      return res.status(400).json({ error: copy.errors.paginationInvalid });
    }
    const allowed = await db.query(
      `SELECT c.id, c.status, c.started_at, c.ended_at,
               EXISTS(
                 SELECT 1 FROM saved_chats s
                 WHERE s.conversation_id = c.id
                   AND (s.user_id = $1 OR s.guest_id = $2)
               ) AS saved
        FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
        WHERE c.id = $3
          AND (cp.user_id = $1 OR cp.guest_id = $2)
          AND c.deleted_for_everyone_at IS NULL
          AND (c.expires_at > NOW() OR EXISTS (SELECT 1 FROM saved_chats s2 WHERE s2.conversation_id = c.id))`,
      [principal.userId, principal.guestId, conversationId]
    );
    if (!allowed.rowCount) return res.status(404).json({ error: copy.errors.conversationUnavailable });
    const messages = await db.query(
      `SELECT m.id, sender.public_id AS sender_public_id,
               sender_guest.display_alias AS sender_guest_alias,
               (
                 COALESCE(m.sender_user_id = $4, FALSE)
                 OR COALESCE(m.sender_guest_id = $5, FALSE)
               ) AS sender_is_owner,
               m.sender_display_name, m.body,
               m.created_at,
              (SELECT MAX(mr.delivered_at) FROM message_receipts mr WHERE mr.message_id = m.id) AS delivered_at,
              (SELECT MAX(mr.read_at) FROM message_receipts mr WHERE mr.message_id = m.id) AS read_at
        FROM messages m
        LEFT JOIN users sender ON sender.id = m.sender_user_id
        LEFT JOIN guest_principals sender_guest ON sender_guest.id = m.sender_guest_id
        WHERE m.conversation_id = $1 AND m.deleted_for_everyone_at IS NULL
          AND ($2::bigint IS NULL OR m.id < $2::bigint)
        ORDER BY m.id DESC
        LIMIT $3`,
      [conversationId, beforeMessageId, limit + 1, principal.userId, principal.guestId]
    );
    const paged = messagePage(messages.rows, limit);
    res.json({
      conversation: allowed.rows[0],
      messages: paged.items,
      page: paged.page
    });
  }));

  app.patch('/api/conversations/:id/read', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
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
      [principal.userId, principal.guestId, conversationId, upToMessageId]
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

  app.get('/api/saved-chats', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const result = await db.query(
      `SELECT s.conversation_id, s.created_at, c.started_at,
               COALESCE(partner.account_name, partner.guest_name, partner.display_name, $3) AS partner_name
        FROM saved_chats s JOIN conversations c ON c.id = s.conversation_id
        LEFT JOIN LATERAL (
          SELECT u.display_name AS account_name, guest.name AS guest_name, cp.display_name
          FROM conversation_participants cp
          LEFT JOIN users u ON u.id = cp.user_id
          LEFT JOIN guest_principals guest ON guest.id = cp.guest_id
          WHERE cp.conversation_id = c.id
            AND NOT (
              COALESCE(cp.user_id = $1, FALSE)
              OR COALESCE(cp.guest_id = $2, FALSE)
            )
          ORDER BY cp.joined_at LIMIT 1
        ) partner ON TRUE
        WHERE (s.user_id = $1 OR s.guest_id = $2)
        ORDER BY s.created_at DESC, s.id DESC`,
      [principal.userId, principal.guestId, copy.common.guest]
    );
    res.json({ chats: result.rows, limit: principal.savedChatLimit, used: result.rowCount });
  }));

  app.put('/api/conversations/:id/saved', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    if (principal.userId && !req.session.user.emailVerified) {
      return res.status(403).json({
        error: copy.errors.emailVerificationRequired,
        code: 'EMAIL_VERIFICATION_REQUIRED'
      });
    }
    const conversationId = asId(req.params.id);
    if (!conversationId) return res.status(404).json({ error: copy.errors.conversationNotFound });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (principal.userId) {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [principal.userId]);
      } else {
        await client.query(
          `SELECT id FROM guest_principals
           WHERE id = $1 AND status = 'active' AND retention_until > NOW()
           FOR UPDATE`,
          [principal.guestId]
        );
      }
      const owns = await client.query(
        `SELECT 1 FROM conversation_participants
         WHERE conversation_id = $1
           AND (user_id = $2 OR guest_id = $3)
         LIMIT 1`,
        [conversationId, principal.userId, principal.guestId]
      );
      if (!owns.rowCount) {
        await client.query('COMMIT');
        return res.status(404).json({ error: copy.errors.conversationNotFound });
      }
      const existing = await client.query(
        `SELECT 1 FROM saved_chats
         WHERE conversation_id = $1
           AND (user_id = $2 OR guest_id = $3)
         LIMIT 1`,
        [conversationId, principal.userId, principal.guestId]
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return res.json({ saved: true, limit: principal.savedChatLimit });
      }
      const count = await client.query(
        `SELECT COUNT(*)::int AS count FROM saved_chats
         WHERE user_id = $1 OR guest_id = $2`,
        [principal.userId, principal.guestId]
      );
      if (count.rows[0].count >= principal.savedChatLimit) {
        await client.query('COMMIT');
        return res.status(409).json({
          error: formatCopy(copy.errors.savedLimit, { limit: principal.savedChatLimit }),
          limit: principal.savedChatLimit
        });
      }
      await client.query(
        `INSERT INTO saved_chats (user_id, guest_id, conversation_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [principal.userId, principal.guestId, conversationId]
      );
      await client.query('COMMIT');
      return res.status(201).json({ saved: true, limit: principal.savedChatLimit });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.delete('/api/conversations/:id/saved', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    await db.query(
      `DELETE FROM saved_chats
       WHERE conversation_id = $1
         AND (user_id = $2 OR guest_id = $3)`,
      [asId(req.params.id), principal.userId, principal.guestId]
    );
    res.status(204).end();
  }));

  app.get('/api/friends', ...auth, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const result = await db.query(
      `SELECT f.id, f.created_at, u.id AS internal_id, u.public_id,
              u.display_alias, u.display_name, u.profile_image_url, u.country
       FROM friendships f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
         AND u.deleted_at IS NULL
         AND (
           $2::timestamptz IS NULL
           OR (f.created_at, f.id) < ($2::timestamptz, $3::bigint)
         )
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({
      friends: paged.items.map(({
        id,
        internal_id: internalId,
        ...friend
      }) => ({
        ...friend,
        online: presence.isOnline(internalId)
      })),
      page: paged.page
    });
  }));

  app.delete('/api/friends/:id', ...auth, asyncRoute(async (req, res) => {
    const friendId = await userIdFromPublicId(db, req.params.id);
    if (!friendId) return res.status(404).json({ error: copy.errors.userNotFound });
    await db.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [userId(req), friendId]);
    res.status(204).end();
  }));

  app.get('/api/friend-requests', ...auth, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const [result, pending] = await Promise.all([
      db.query(
      `SELECT fr.id, fr.created_at, u.public_id AS sender_public_id,
              u.display_name, u.profile_image_url
       FROM friend_requests fr JOIN users u ON u.id = fr.sender_user_id
       WHERE fr.receiver_user_id = $1
         AND fr.status = 'pending'
         AND (
           $2::timestamptz IS NULL
           OR (fr.created_at, fr.id) < ($2::timestamptz, $3::bigint)
         )
       ORDER BY fr.created_at DESC, fr.id DESC
       LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.id || null, limit + 1]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM friend_requests
         WHERE receiver_user_id = $1 AND status = 'pending'`,
        [userId(req)]
      )
    ]);
    const paged = cursorPage(result.rows, limit);
    res.json({
      requests: paged.items,
      page: paged.page,
      pendingCount: Number(pending.rows[0].count)
    });
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
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const [result, pending] = await Promise.all([
      db.query(
      `SELECT cr.id, cr.created_at, u.public_id AS sender_public_id,
              u.display_name, u.profile_image_url
       FROM chat_requests cr JOIN users u ON u.id = cr.sender_user_id
       WHERE cr.receiver_user_id = $1
         AND cr.status = 'pending'
         AND (
           $2::timestamptz IS NULL
           OR (cr.created_at, cr.id) < ($2::timestamptz, $3::bigint)
         )
       ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.id || null, limit + 1]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM chat_requests
         WHERE receiver_user_id = $1 AND status = 'pending'`,
        [userId(req)]
      )
    ]);
    const paged = cursorPage(result.rows, limit);
    res.json({
      requests: paged.items,
      page: paged.page,
      pendingCount: Number(pending.rows[0].count)
    });
  }));

  app.get('/api/notifications', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const [result, unread] = await Promise.all([
      db.query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications
        WHERE (user_id = $1 OR guest_id = $2)
         AND (
            $3::timestamptz IS NULL
            OR (created_at, id) < ($3::timestamptz, $4::bigint)
         )
       ORDER BY created_at DESC, id DESC
        LIMIT $5`,
       [principal.userId, principal.guestId, cursor?.createdAt || null, cursor?.id || null, limit + 1]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
          WHERE (user_id = $1 OR guest_id = $2) AND read_at IS NULL`,
         [principal.userId, principal.guestId]
      )
    ]);
    const paged = cursorPage(result.rows, limit);
    res.json({
      notifications: paged.items,
      page: paged.page,
      unreadCount: Number(unread.rows[0].count)
    });
  }));

  app.patch('/api/notifications/:id/read', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    await db.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND (user_id = $2 OR guest_id = $3)`,
      [asId(req.params.id), principal.userId, principal.guestId]
    );
    res.status(204).end();
  }));

  app.get('/api/blocks', ...auth, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const result = await db.query(
      `SELECT b.id, u.public_id, u.display_alias, u.display_name, u.profile_image_url,
              b.created_at
       FROM blocked_users b JOIN users u ON u.id = b.blocked_user_id
       WHERE b.blocker_user_id = $1
         AND (
           $2::timestamptz IS NULL
           OR (b.created_at, b.id) < ($2::timestamptz, $3::bigint)
         )
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({
      users: paged.items.map(({ id, ...user }) => user),
      page: paged.page
    });
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

  app.get('/api/admin/guests', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = uuidPaginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const statuses = new Set(['active', 'claimed', 'deleted', 'expired']);
    const status = statuses.has(req.query.status) ? req.query.status : null;
    const result = await db.query(
      `SELECT id, display_alias, name, gender, age, country, country_code,
              avatar_id, name_changes, status, created_at, last_seen_at,
              retention_until, deleted_at
       FROM guest_principals
       WHERE ($1::text IS NULL OR status = $1)
         AND (
           $2::timestamptz IS NULL
           OR (created_at, id) < ($2::timestamptz, $3::uuid)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [status, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = uuidCursorPage(result.rows, limit);
    res.json({
      guests: paged.items.map(({ id, ...guest }) => ({
        displayAlias: guest.display_alias,
        name: guest.name,
        gender: guest.gender,
        age: Number(guest.age),
        country: guest.country,
        countryCode: guest.country_code,
        avatarId: guest.avatar_id,
        nameChanges: Number(guest.name_changes),
        status: guest.status,
        createdAt: guest.created_at,
        lastSeenAt: guest.last_seen_at,
        retentionUntil: guest.retention_until,
        deletedAt: guest.deleted_at
      })),
      page: paged.page
    });
  }));

  app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const search = cleanText(req.query.q, 100).toLowerCase();
    const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
    const states = new Set(['active', 'banned']);
    const state = states.has(req.query.state) ? req.query.state : null;
    const result = await db.query(
      `SELECT u.id, u.public_id, u.username, u.display_alias, u.display_name, u.email, u.role, u.plan,
              u.email_verified_at, u.admin_2fa_enabled_at, u.created_at,
              latest_activity.last_seen_at,
              EXISTS (
                SELECT 1 FROM account_bans b
                WHERE b.user_id = u.id AND b.revoked_at IS NULL
                  AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
              ) AS active_ban
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(cp.joined_at) AS last_seen_at
         FROM conversation_participants cp
         WHERE cp.user_id = u.id
       ) latest_activity ON TRUE
       WHERE u.deleted_at IS NULL
         AND (
           $1::text = ''
           OR LOWER(u.username) LIKE $1::text || '%' ESCAPE '\\'
           OR LOWER(u.email) LIKE $1::text || '%' ESCAPE '\\'
           OR u.public_id = $1::text
         )
         AND ($2::text IS NULL OR ($2 = 'banned') = EXISTS (
           SELECT 1 FROM account_bans b
           WHERE b.user_id = u.id AND b.revoked_at IS NULL
             AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
         ))
         AND (
           $3::timestamptz IS NULL
           OR (u.created_at, u.id) < ($3::timestamptz, $4::bigint)
         )
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $5`,
      [escapedSearch, state, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({
      users: paged.items.map(({ id, ...user }) => user),
      page: paged.page
    });
  }));

  app.get('/api/admin/users/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const publicId = cleanText(req.params.id, 40);
    const result = await db.query(
      `SELECT u.public_id, u.username, u.display_alias, u.display_name, u.email, u.role, u.plan,
              u.email_verified_at, u.admin_2fa_enabled_at, u.created_at,
              latest_activity.last_seen_at,
              active_ban.id AS active_ban_id, active_ban.type AS active_ban_type,
              active_ban.reason AS active_ban_reason, active_ban.starts_at AS active_ban_starts_at,
              active_ban.ends_at AS active_ban_ends_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(cp.joined_at) AS last_seen_at
         FROM conversation_participants cp
         WHERE cp.user_id = u.id
       ) latest_activity ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, type, reason, starts_at, ends_at
         FROM account_bans b
         WHERE b.user_id = u.id AND b.revoked_at IS NULL
           AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT 1
       ) active_ban ON TRUE
       WHERE u.public_id = $1 AND u.deleted_at IS NULL`,
      [publicId]
    );
    if (!result.rowCount) return res.status(404).json({ error: copy.errors.userNotFound });
    const row = result.rows[0];
    res.json({
      user: {
        publicId: row.public_id,
        username: row.username,
        displayAlias: row.display_alias,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        plan: row.plan,
        emailVerifiedAt: row.email_verified_at,
        adminTwoFactorEnabledAt: row.admin_2fa_enabled_at,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        activeBan: row.active_ban_id ? {
          id: Number(row.active_ban_id),
          type: row.active_ban_type,
          reason: row.active_ban_reason,
          startsAt: row.active_ban_starts_at,
          endsAt: row.active_ban_ends_at
        } : null
      }
    });
  }));

  app.get('/api/admin/users/:id/moderation', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const targetUserId = await userIdFromPublicId(db, req.params.id);
    if (!targetUserId) return res.status(404).json({ error: copy.errors.userNotFound });
    const { cursor, limit } = pagination;
    const result = await db.query(
      `SELECT a.id, a.action, a.reason, a.created_at,
              actor.public_id AS actor_public_id, actor.display_name AS actor_name
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_user_id
       WHERE a.target_user_id = $1
         AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::bigint))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $4`,
      [targetUserId, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({ moderation: paged.items, page: paged.page });
  }));

  app.get('/api/admin/reports', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const statuses = new Set(['pending', 'resolved', 'dismissed']);
    const status = statuses.has(req.query.status) ? req.query.status : null;
    const result = await db.query(
      `SELECT r.id, r.reason, r.status, r.resolution,
               r.created_at, r.reviewed_at, r.retention_until,
               reporter.public_id AS reporter_public_id,
               reporter_guest.display_alias AS reporter_guest_alias,
               COALESCE(reporter.display_name, reporter_guest.display_alias) AS reporter_name,
               reported.public_id AS reported_public_id,
               reported_guest.display_alias AS reported_guest_alias,
               COALESCE(reported.display_name, reported_guest.display_alias) AS reported_name,
               reviewer.public_id AS reviewer_public_id,
              EXISTS (
                SELECT 1 FROM report_evidence_snapshots evidence
                WHERE evidence.report_id = r.id
              ) AS has_evidence
        FROM reports r
        LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
        LEFT JOIN guest_principals reporter_guest ON reporter_guest.id = r.reporter_guest_id
        LEFT JOIN users reported ON reported.id = r.reported_user_id
        LEFT JOIN guest_principals reported_guest ON reported_guest.id = r.reported_guest_id
        LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
       WHERE ($1::text IS NULL OR r.status = $1)
         AND (
           $2::timestamptz IS NULL
           OR (r.created_at, r.id) < ($2::timestamptz, $3::bigint)
       )
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $4`,
      [status, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({ reports: paged.items, page: paged.page });
  }));

  app.get('/api/admin/bans', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const scopes = new Set(['account', 'network']);
    const scope = scopes.has(req.query.scope) ? req.query.scope : null;
    const result = await db.query(
      `WITH moderation_bans AS (
         SELECT b.id, b.id AS ban_id, b.type, b.reason, b.starts_at, b.ends_at, b.created_at, b.revoked_at,
                'account'::text AS scope, target.public_id AS user_public_id,
                target.display_name AS user_name, creator.public_id AS created_by_public_id
         FROM account_bans b
         JOIN users target ON target.id = b.user_id
         JOIN users creator ON creator.id = b.created_by
         UNION ALL
         SELECT -b.id AS id, b.id AS ban_id, 'temporary'::varchar(20) AS type, b.reason, b.starts_at, b.ends_at,
                b.created_at, b.revoked_at, 'network'::text AS scope,
                NULL::varchar(40) AS user_public_id, NULL::varchar(40) AS user_name,
                creator.public_id AS created_by_public_id
         FROM network_bans b
         JOIN users creator ON creator.id = b.created_by
       )
       SELECT * FROM moderation_bans b
       WHERE ($1::text IS NULL OR b.scope = $1)
         AND (
           $2::timestamptz IS NULL
           OR (b.created_at, b.id) < ($2::timestamptz, $3::bigint)
       )
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT $4`,
      [scope, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({ bans: paged.items, page: paged.page });
  }));

  app.get('/api/admin/appeals', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const statuses = new Set(['pending', 'accepted', 'rejected']);
    const status = statuses.has(req.query.status) ? req.query.status : null;
    const result = await db.query(
      `SELECT a.id, a.status, a.created_at, a.reviewed_at,
              appellant.public_id AS appellant_public_id, appellant.display_name AS appellant_name,
              reviewer.public_id AS reviewer_public_id,
              account_ban.id AS account_ban_id, account_target.public_id AS account_public_id,
              network_ban.id AS network_ban_id
       FROM moderation_appeals a
       LEFT JOIN users appellant ON appellant.id = a.appellant_user_id
       LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
       LEFT JOIN account_bans account_ban ON account_ban.id = a.account_ban_id
       LEFT JOIN users account_target ON account_target.id = account_ban.user_id
       LEFT JOIN network_bans network_ban ON network_ban.id = a.network_ban_id
       WHERE ($1::text IS NULL OR a.status = $1)
         AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::bigint))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $4`,
      [status, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({ appeals: paged.items, page: paged.page });
  }));

  app.get('/api/admin/audit', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const action = cleanText(req.query.action, 80).toLowerCase();
    const targetPublicId = cleanText(req.query.target, 40);
    const result = await db.query(
      `SELECT a.id, a.target_type, a.action, a.reason, a.created_at,
              actor.public_id AS actor_public_id, actor.display_name AS actor_name,
              target.public_id AS target_public_id, target.display_name AS target_name
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_user_id
       LEFT JOIN users target ON target.id = a.target_user_id
       WHERE ($1::text = '' OR a.action = $1)
         AND ($2::text = '' OR target.public_id = $2)
         AND ($3::timestamptz IS NULL OR (a.created_at, a.id) < ($3::timestamptz, $4::bigint))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5`,
      [action, targetPublicId, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({ audit: paged.items, page: paged.page });
  }));

  app.get('/api/admin/database-capacity', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const [capacity, retention] = await Promise.all([
      db.query(
        `SELECT captured_at, database_bytes, table_bytes, index_bytes,
                budget_bytes, used_percent, threshold_percent, largest_relations
         FROM database_capacity_snapshots
         ORDER BY captured_at DESC, id DESC
         LIMIT 30`
      ),
      db.query(
        `SELECT started_at, finished_at, status, duration_ms,
                deleted_counts, error_code
         FROM retention_runs
         ORDER BY started_at DESC, id DESC
         LIMIT 30`
      )
    ]);
    res.json({ capacity: capacity.rows, retention: retention.rows });
  }));

  app.get('/admin', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const [price, adminAccount] = await Promise.all([
      db.query(`SELECT * FROM plan_price_history WHERE plan = 'premium' ORDER BY created_at DESC LIMIT 1`),
      db.query(
        `SELECT password_hash IS NOT NULL AS has_password,
                EXISTS(
                  SELECT 1 FROM account_identities
                  WHERE user_id = users.id AND provider = 'google'
                ) AS has_google
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId(req)]
      )
    ]);
    const methods = adminAccount.rows[0] || {};
    const adminReauthMethod = methods.has_password
      ? 'password'
      : (methods.has_google && environment.GOOGLE_CLIENT_ID ? 'google' : 'unavailable');
    let adminGoogleNonce = '';
    if (adminReauthMethod === 'google') {
      adminGoogleNonce = crypto.randomBytes(24).toString('base64url');
      req.session.adminGoogleReauthNonce = adminGoogleNonce;
      await saveSession(req);
    } else if (req.session.adminGoogleReauthNonce) {
      delete req.session.adminGoogleReauthNonce;
      await saveSession(req);
    }
    res.render('admin', {
      pageTitle: copy.pageTitles.admin,
      price: price.rows[0],
      csrfToken: res.locals.csrfToken,
      adminReauthMethod,
      googleClientId: adminReauthMethod === 'google' ? environment.GOOGLE_CLIENT_ID : '',
      adminGoogleNonce
    });
  }));

  function moderationFailure(error, res) {
    if (error?.code === 'SELF_MODERATION_FORBIDDEN') return res.status(400).json({ error: copy.errors.ownAdminDelete });
    if (error?.code === 'TARGET_NOT_FOUND' || error?.code === 'BAN_NOT_FOUND') return res.status(404).json({ error: copy.errors.userNotFound });
    if (['MODERATION_REASON_REQUIRED', 'NETWORK_INVALID', 'NETWORK_TOO_BROAD', 'BAN_TYPE_INVALID', 'BAN_DURATION_INVALID'].includes(error?.code)) return res.status(400).json({ error: error.message });
    if (error?.code === 'PRIVACY_REVIEW_REQUIRED') return res.status(400).json({ error: error.message });
    throw error;
  }

  app.post('/api/admin/users/:id/ban', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const targetUserId = await userIdFromPublicId(db, req.params.id);
    if (!targetUserId) return res.status(404).json({ error: copy.errors.userNotFound });
    try {
      const ban = await moderation.banAccount({
        actorUserId: userId(req), targetUserId, type: req.body.type, hours: req.body.hours,
        reason: req.body.reason, correlationId: req.get('x-correlation-id') || undefined
      });
      res.status(ban.idempotent ? 200 : 201).json({ banId: Number(ban.id), endsAt: ban.ends_at, idempotent: ban.idempotent });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  app.patch('/api/admin/account-bans/:id/revoke', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const ban = await moderation.revokeAccountBan({
        actorUserId: userId(req), banId: asId(req.params.id), reason: req.body.reason,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.json({ banId: Number(ban.id), revokedAt: ban.revoked_at, idempotent: ban.idempotent });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  app.post('/api/admin/network-bans', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const reviewerId = await userIdFromPublicId(db, req.body.privacyReviewerPublicId);
      const ban = await moderation.createNetworkBan({
        actorUserId: userId(req), cidr: req.body.cidr, reason: req.body.reason, hours: req.body.hours,
        privacyReviewedByUserId: reviewerId, privacyReviewReference: req.body.privacyReviewReference,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.status(ban.idempotent ? 200 : 201).json({
        banId: Number(ban.id), addressFamily: ban.address_family, prefixLength: ban.prefix_length,
        endsAt: ban.ends_at, idempotent: ban.idempotent
      });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  app.patch('/api/admin/network-bans/:id/revoke', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const ban = await moderation.revokeNetworkBan({
        actorUserId: userId(req), banId: asId(req.params.id), reason: req.body.reason,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.json({ banId: Number(ban.id), revokedAt: ban.revoked_at, idempotent: ban.idempotent });
    } catch (error) {
      return moderationFailure(error, res);
    }
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
      const reason = cleanText(req.body.reason, 500);
      if (!reason || reason.length < 3) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A reason is required to delete an account' });
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
      await moderation.appendAudit(client, {
        actorUserId: userId(req), targetUserId, targetType: 'account', action: 'account_deleted',
        reason, before: { deleted: false }, after: { deleted: true },
        correlationId: req.get('x-correlation-id') || crypto.randomUUID()
      });
      await client.query('COMMIT');
      await moderation.disconnectUser(targetUserId, { type: 'account-deleted' });
      res.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.patch('/api/admin/reports/:id', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const reportId = asId(req.params.id);
    const status = req.body.action === 'resolve' ? 'resolved'
      : (req.body.action === 'dismiss' ? 'dismissed' : null);
    if (!reportId || !status) return res.status(400).json({ error: 'A valid report decision is required' });
    let resolution;
    try {
      resolution = requiredReason(req.body.resolution);
    } catch (error) {
      return moderationFailure(error, res);
    }
    const outcome = await moderation.withTransaction(db, async (client) => {
      const report = await client.query(
        `SELECT id, status, reporter_user_id, reported_user_id
         FROM reports WHERE id = $1 FOR UPDATE`,
        [reportId]
      );
      if (!report.rowCount) return null;
      const current = report.rows[0];
      await client.query(
        `UPDATE reports SET status = $1, reviewed_by = $2, reviewed_at = NOW(), resolution = $3 WHERE id = $4`,
        [status, userId(req), resolution, reportId]
      );
      if (current.reporter_user_id) {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body)
           VALUES ($1, 'report_processed', $2, $3)`,
          [current.reporter_user_id, copy.notifications.reportReviewedTitle,
            status === 'resolved' ? copy.notifications.reportActionTaken : copy.notifications.reportDismissed]
        );
      }
      await moderation.appendAudit(client, {
        actorUserId: userId(req), targetUserId: current.reported_user_id || null,
        targetType: 'report', action: 'report_reviewed', reason: resolution,
        before: { reportId, status: current.status }, after: { reportId, status },
        correlationId: req.get('x-correlation-id') || undefined
      });
      return { reporterId: current.reporter_user_id, status };
    });
    if (!outcome) return res.status(404).json({ error: 'The report does not exist' });
    if (outcome.reporterId) presence.emitToUser(outcome.reporterId, 'notification-created', { type: 'report_processed' });
    return res.json({ status: outcome.status });
  }));

  app.post('/api/admin/reports/:id/evidence', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const reportId = asId(req.params.id);
    if (!reportId) return res.status(404).json({ error: 'Evidence is unavailable for this report' });
    const pagination = evidencePaginationFor(req, res);
    if (!pagination) return;
    let reason;
    try {
      reason = requiredReason(req.body.reason);
    } catch (error) {
      return moderationFailure(error, res);
    }
    const correlationId = normalizedCorrelationId(req.get('x-correlation-id'));
    const evidence = await moderation.withTransaction(db, async (client) => {
      const snapshot = await client.query(
        `SELECT r.id, r.reported_user_id, e.captured_at, e.expires_at, e.messages
         FROM reports r
         JOIN report_evidence_snapshots e ON e.report_id = r.id
         WHERE r.id = $1 AND e.expires_at > NOW()
         FOR SHARE OF r, e`,
        [reportId]
      );
      if (!snapshot.rowCount) return null;
      const row = snapshot.rows[0];
      const messages = Array.isArray(row.messages) ? row.messages : [];
      const start = pagination.index;
      const items = messages.slice(start, start + pagination.limit).map((message) => ({
        messageId: Number(message.messageId),
        senderRole: message.senderRole === 'reporter' ? 'reporter' : 'reported',
        body: String(message.body || ''),
        createdAt: message.createdAt
      }));
      const nextIndex = start + items.length;
      await client.query(
        `INSERT INTO report_evidence_access_log (report_id, actor_user_id, reason, correlation_id)
         VALUES ($1, $2, $3, $4::uuid)`,
        [reportId, userId(req), reason, correlationId]
      );
      await moderation.appendAudit(client, {
        actorUserId: userId(req), targetUserId: row.reported_user_id || null,
        targetType: 'report_evidence', action: 'report_evidence_accessed', reason,
        before: {}, after: { reportId, returnedMessageCount: items.length, pageStart: start },
        correlationId
      });
      return {
        capturedAt: row.captured_at,
        expiresAt: row.expires_at,
        messages: items,
        page: {
          limit: pagination.limit,
          hasMore: nextIndex < messages.length,
          nextCursor: nextIndex < messages.length ? evidenceCursor(nextIndex) : null
        }
      };
    });
    if (!evidence) return res.status(404).json({ error: 'Evidence is unavailable for this report' });
    return res.json({ evidence });
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
    const reason = cleanText(req.body.reason, 500);
    if (!reason || reason.length < 3) return res.status(400).json({ error: 'A reason is required to change a role' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const target = await client.query('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [targetUserId]);
      if (!target.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: copy.errors.userNotFound });
      }
      await client.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, targetUserId]);
      await revokeUserSessions(db, targetUserId, { client });
      await moderation.appendAudit(client, {
        actorUserId: userId(req), targetUserId, targetType: 'account', action: 'role_changed', reason,
        before: { role: target.rows[0].role }, after: { role },
        correlationId: req.get('x-correlation-id') || crypto.randomUUID()
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await moderation.disconnectUser(targetUserId, { reason: 'role-changed' }, 'auth-required');
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
