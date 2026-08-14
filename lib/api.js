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
const { ADMIN_REAUTH_WINDOW_MS, requireRecentAdminAuth, revokeUserSessions, sessionUserId } = require('./security');
const {
  cursorPage,
  decodeCursor,
  decodePublicIdCursor,
  messagePage,
  pageSize,
  publicIdCursorPage
} = require('./pagination');
const {
  bindGuestDevice,
  bindGuestSession,
  clearGuestSession,
  createGuestPrincipal,
  findActiveGuestPrincipal,
  guestIdFromPublicId,
  UUID_PATTERN,
  tombstoneGuestPrincipal,
  updateGuestPrincipal
} = require('./guest-principals');
const { devicePrincipal } = require('./device-principal');
const {
  cleanPublicId,
  createPublicId,
  insertWithUniquePublicId,
  isPublicId
} = require('./public-identifiers');
const { deleteAccountLifecycle } = require('./account-lifecycle');
const flagCountries = require('../public/vendor/flag-icons-7.5.0/country.json');
const copy = require('../public/i18n/en.json');
const { PRESET_AVATAR_ID_SET } = require('./avatar-presets');

function formatCopy(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function lockSocialAccountPair(executor, firstUserId, secondUserId) {
  return executor.query(
    `SELECT u.id, u.deleted_at, u.email_verified_at,
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

function socialAccountPairIsActive(rows) {
  return rows.length === 2 && rows.every((row) => (
    !row.deleted_at && row.email_verified_at && !row.banned
  ));
}

function notificationDataForClient(notification) {
  const data = notification?.data && typeof notification.data === 'object'
    ? notification.data
    : {};
  if (notification.type === 'friend_request') {
    return {
      ...(isPublicId(data.requestPublicId, 'friendRequest')
        ? { requestPublicId: data.requestPublicId }
        : {}),
      ...(isPublicId(data.userPublicId, 'user') ? { userPublicId: data.userPublicId } : {})
    };
  }
  if (notification.type === 'friend_accepted' && isPublicId(data.userPublicId, 'user')) {
    return { userPublicId: data.userPublicId };
  }
  if (notification.type === 'guest_account_claim') return { action: 'login' };
  return {};
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

function guestPaginationFor(req, res) {
  const limit = pageSize(req.query.limit);
  if (!req.query.cursor) return { cursor: null, limit };
  const cursor = decodePublicIdCursor(req.query.cursor, 'guest');
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

async function userIdFromPublicId(executor, value, { includeDeleted = false } = {}) {
  const publicId = cleanPublicId(value);
  if (!publicId) return null;
  const canonical = isPublicId(publicId, 'user');
  const result = await executor.query(
    `SELECT id FROM users
     WHERE ${canonical ? 'public_id' : 'legacy_public_id'} = $1
       AND ($2::boolean OR deleted_at IS NULL)`,
    [publicId, includeDeleted]
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

  const profile = {
      publicId: createPublicId('guest'),
      name,
      gender,
      age,
      country: { code: countryCode, name: countryName },
      avatarId,
      nameChanges: Number(value.nameChanges) >= 1 ? 1 : 0,
      createdAt: new Date().toISOString()
  };
  Object.defineProperty(profile, 'id', { value: crypto.randomUUID(), enumerable: false });
  return { profile };
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

async function guestForRequest(db, req, { touch = true, migrateLegacy = true, devicePrincipalFingerprint = null } = {}) {
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
          createdAt: legacy.createdAt,
          devicePrincipalFingerprint
        });
      }
    }
  }

  if (guest) {
    if (devicePrincipalFingerprint) await bindGuestDevice(db, guest.id, devicePrincipalFingerprint);
    bindGuestSession(req.session, guest);
  }
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
  const requireAdmin = createRequireAdmin(db);
  const adminOnly = [requireAuth, requireAdmin];
  const highRiskAdmin = [requireAuth, requireAdmin, requireRecentAdminAuth];
  const userId = (req) => sessionUserId(req);
  const requireActiveAccount = asyncRoute(async (req, res, next) => {
    const accountId = userId(req);
    const account = (await db.query(
      `SELECT u.deleted_at, u.session_version,
              EXISTS (
                SELECT 1 FROM account_bans b
                WHERE b.user_id = u.id AND b.revoked_at IS NULL AND b.starts_at <= NOW()
                  AND (b.type = 'permanent' OR b.ends_at > NOW())
              ) AS banned
       FROM users u WHERE u.id = $1`,
      [accountId]
    )).rows[0];
    if (account && !account.deleted_at && !account.banned
        && Number(account.session_version) === Number(req.session.user.sessionVersion)) return next();
    return req.session.destroy(() => res.status(401).json({ error: copy.errors.accountRequired }));
  });
  const auth = [requireAuth, requireActiveAccount, requireVerifiedEmail];
  const recentUnsavedChatLimit = Math.min(
    Math.max(Number(environment.RETENTION_MAX_UNSAVED_PER_USER) || DEFAULT_RECENT_UNSAVED_CHAT_LIMIT, 10),
    1_000
  );

  async function guestDevice(req, res) {
    if (!db.isConfigured) return null;
    const fingerprint = devicePrincipal(req, res, environment);
    const guestId = req.session?.guestPrincipalId || req.session?.guestProfile?.id || null;
    const [guestBlocked, deviceBlocked] = await Promise.all([
      guestId ? moderation?.isGuestBlocked(guestId) : false,
      moderation?.isGuestDeviceRestricted(fingerprint)
    ]);
    if (guestBlocked || deviceBlocked) {
      return false;
    }
    return fingerprint;
  }

  function guestDeviceRestricted(res) {
    return res.status(403).json({
      error: copy.errors.guestRestricted,
      code: 'GUEST_ACCESS_RESTRICTED',
      redirect: '/guest-restricted',
      supportUrl: '/support'
    });
  }

  app.get('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const fingerprint = await guestDevice(req, res);
    if (fingerprint === false) return guestDeviceRestricted(res);
    const guest = await guestForRequest(db, req, { devicePrincipalFingerprint: fingerprint });
    if (guest) await ensureGuestAccountNotification(db, guest.id);
    await saveSession(req);
    return res.json({ guest, claimEligible: Boolean(guest) });
  }));

  app.post('/api/guest-profile', asyncRoute(async (req, res) => {
    if (req.session.user) return res.status(409).json({ error: copy.errors.alreadySignedIn });
    const normalized = normalizeGuestInput(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    if (db.isConfigured) {
      const fingerprint = await guestDevice(req, res);
      if (fingerprint === false) return guestDeviceRestricted(res);
      const existing = await guestForRequest(db, req, { devicePrincipalFingerprint: fingerprint });
      if (existing) {
        await ensureGuestAccountNotification(db, existing.id);
        await saveSession(req);
        return res.json({ guest: existing, claimEligible: true });
      }
      const guest = await createGuestPrincipal(db, normalized.profile, { devicePrincipalFingerprint: fingerprint });
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
    const fingerprint = await guestDevice(req, res);
    if (fingerprint === false) return guestDeviceRestricted(res);
    const guest = await guestForRequest(db, req, { devicePrincipalFingerprint: fingerprint });
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
    const fingerprint = await guestDevice(req, res);
    if (fingerprint === false) return guestDeviceRestricted(res);
    const guest = await guestForRequest(db, req, { touch: false, devicePrincipalFingerprint: fingerprint });
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
    await deleteAccountLifecycle({ db, targetUserId: accountUserId });
    await moderation.disconnectUser(accountUserId, {}, 'auth-required');
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
               COALESCE(partner.public_id, partner.guest_public_id) AS partner_public_id, partner.profile_image_url,
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
          SELECT cp.user_id, cp.guest_id, u.public_id, guest.public_id AS guest_public_id,
                 u.display_name AS account_name, guest.name AS guest_name,
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
      `SELECT m.id, COALESCE(sender.public_id, sender_guest.public_id) AS sender_public_id,
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
    const limit = pageSize(req.query.limit);
    const cursor = req.query.cursor ? decodePublicIdCursor(req.query.cursor, 'user') : null;
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: copy.errors.paginationInvalid });
    }
    const result = await db.query(
      `SELECT f.created_at, u.id AS internal_id, u.public_id,
              u.display_alias, u.display_name, u.profile_image_url, u.country,
              u.email_verified_at,
              EXISTS (
                SELECT 1 FROM account_bans ban
                WHERE ban.user_id = u.id AND ban.revoked_at IS NULL AND ban.starts_at <= NOW()
                  AND (ban.type = 'permanent' OR ban.ends_at > NOW())
              ) AS banned,
              EXISTS (
                SELECT 1 FROM blocked_users block
                WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = u.id)
                   OR (block.blocker_user_id = u.id AND block.blocked_user_id = $1)
              ) AS blocked
       FROM friendships f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
         AND u.deleted_at IS NULL
         AND (
           $2::timestamptz IS NULL
           OR (f.created_at, u.public_id) < ($2::timestamptz, $3::text)
         )
       ORDER BY f.created_at DESC, u.public_id DESC
       LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.publicId || null, limit + 1]
    );
    const paged = publicIdCursorPage(result.rows, limit, 'user');
    res.json({
      friends: paged.items.map(({
        internal_id: internalId,
        email_verified_at: emailVerifiedAt,
        banned,
        blocked,
        ...friend
      }) => ({
        ...friend,
        online: presence.isOnline(internalId),
        capabilities: {
          canStartDirectChat: Boolean(emailVerifiedAt && !banned && !blocked),
          canRemoveFriend: true,
          canBlock: !blocked
        }
      })),
      page: paged.page
    });
  }));

  app.delete('/api/friends/:id', ...auth, asyncRoute(async (req, res) => {
    const friendId = await userIdFromPublicId(db, req.params.id);
    if (!friendId) return res.status(404).json({ error: copy.errors.userNotFound });
    const ownerId = userId(req);
    if (friendId === ownerId) return res.status(404).json({ error: copy.errors.userNotFound });
    const client = await db.getClient();
    let changed = false;
    try {
      await client.query('BEGIN');
      await lockSocialAccountPair(client, ownerId, friendId);
      const removed = await client.query(
        `DELETE FROM friendships
         WHERE (user_id = $1 AND friend_id = $2)
            OR (user_id = $2 AND friend_id = $1)`,
        [ownerId, friendId]
      );
      changed = removed.rowCount > 0;
      await client.query(
        `UPDATE friend_requests SET status = 'cancelled', responded_at = NOW()
         WHERE status = 'pending'
           AND LEAST(sender_user_id, receiver_user_id) = LEAST($1::bigint, $2::bigint)
           AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($1::bigint, $2::bigint)`,
        [ownerId, friendId]
      );
      await client.query(
        `UPDATE chat_requests SET status = 'cancelled', responded_at = NOW()
         WHERE status = 'pending'
           AND LEAST(sender_user_id, receiver_user_id) = LEAST($1::bigint, $2::bigint)
           AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($1::bigint, $2::bigint)`,
        [ownerId, friendId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (changed) {
      const friendPublicId = cleanPublicId(req.params.id);
      presence.emitToUser(ownerId, 'friendship-updated', { userPublicId: friendPublicId, status: 'removed' });
      presence.emitToUser(friendId, 'friendship-updated', {
        userPublicId: req.session.user.publicId,
        status: 'removed'
      });
    }
    return res.status(204).end();
  }));

  app.get('/api/friend-requests', ...auth, asyncRoute(async (req, res) => {
    const direction = req.query.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const limit = pageSize(req.query.limit);
    const cursor = req.query.cursor
      ? decodePublicIdCursor(req.query.cursor, 'friendRequest')
      : null;
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: copy.errors.paginationInvalid });
    }
    const ownerColumn = direction === 'outgoing' ? 'sender_user_id' : 'receiver_user_id';
    const personColumn = direction === 'outgoing' ? 'receiver_user_id' : 'sender_user_id';
    const [result, pending] = await Promise.all([
      db.query(
      `SELECT fr.public_id, fr.public_id AS id, fr.created_at,
              u.public_id AS person_public_id,
              u.display_name, u.profile_image_url
       FROM friend_requests fr JOIN users u ON u.id = fr.${personColumn}
       WHERE fr.${ownerColumn} = $1
         AND fr.status = 'pending'
         AND (
           $2::timestamptz IS NULL
           OR (fr.created_at, fr.public_id) < ($2::timestamptz, $3::text)
         )
       ORDER BY fr.created_at DESC, fr.public_id DESC
       LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.publicId || null, limit + 1]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM friend_requests
         WHERE ${ownerColumn} = $1 AND status = 'pending'`,
        [userId(req)]
      )
    ]);
    const paged = publicIdCursorPage(result.rows, limit, 'friendRequest');
    res.json({
      requests: paged.items,
      page: paged.page,
      pendingCount: Number(pending.rows[0].count),
      direction
    });
  }));

  app.post('/api/friend-requests', ...auth, asyncRoute(async (req, res) => {
    const receiverId = await userIdFromPublicId(db, req.body.publicId || req.body.userId);
    if (!receiverId || receiverId === userId(req)) return res.status(400).json({ error: copy.errors.userInvalid });
    const senderId = userId(req);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const accounts = await lockSocialAccountPair(client, senderId, receiverId);
      if (!socialAccountPairIsActive(accounts.rows)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: copy.errors.requestUnavailable });
      }
      const existing = await client.query(
        `SELECT public_id FROM friend_requests
         WHERE sender_user_id = $1 AND receiver_user_id = $2 AND status = 'pending'
         LIMIT 1`,
        [senderId, receiverId]
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return res.json({ requestId: existing.rows[0].public_id });
      }
      const eligibility = await client.query(
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
           WHERE sender_user_id = $2 AND receiver_user_id = $1 AND status = 'pending'
         ) AS allowed`,
        [senderId, receiverId]
      );
      if (!eligibility.rows[0]?.allowed) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: copy.errors.requestUnavailable });
      }
      const result = await insertWithUniquePublicId(
        client,
        'friendRequest',
        (publicId) => client.query(
          `INSERT INTO friend_requests (public_id, sender_user_id, receiver_user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (sender_user_id, receiver_user_id)
           DO UPDATE SET status = 'pending', created_at = NOW(), responded_at = NULL
           RETURNING public_id`,
          [publicId, senderId, receiverId]
        )
      );
      const requestPublicId = result.rows[0].public_id;
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
          VALUES ($1, 'friend_request', $2, $3,
                  jsonb_build_object('requestPublicId', $4::text, 'userPublicId', $5::text))`,
        [receiverId, copy.notifications.friendRequestTitle,
          formatCopy(copy.notifications.friendRequestBody, { name: req.session.user.displayName }),
          requestPublicId, req.session.user.publicId]
      );
      await client.query('COMMIT');
      presence.emitToUser(receiverId, 'notification-created', { type: 'friend_request' });
      presence.emitToUser(receiverId, 'friend-request-updated', { requestId: requestPublicId, status: 'pending' });
      return res.status(201).json({ requestId: requestPublicId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.patch('/api/friend-requests/:id', ...auth, asyncRoute(async (req, res) => {
    const status = req.body.action === 'accept'
      ? 'accepted'
      : req.body.action === 'decline' ? 'declined' : null;
    const requestPublicId = cleanPublicId(req.params.id);
    if (!status || !isPublicId(requestPublicId, 'friendRequest')) {
      return res.status(400).json({ error: copy.errors.requestUnavailable });
    }
    const ownerId = userId(req);
    const client = await db.getClient();
    let senderId = null;
    let notificationCreated = false;
    try {
      await client.query('BEGIN');
      const located = await client.query(
        `SELECT sender_user_id, receiver_user_id
         FROM friend_requests
         WHERE public_id = $1 AND receiver_user_id = $2`,
        [requestPublicId, ownerId]
      );
      if (!located.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: copy.errors.requestUnavailable });
      }
      senderId = Number(located.rows[0].sender_user_id);
      const accounts = await lockSocialAccountPair(client, senderId, ownerId);
      const request = await client.query(
        `SELECT status FROM friend_requests
         WHERE public_id = $1 AND receiver_user_id = $2
         FOR UPDATE`,
        [requestPublicId, ownerId]
      );
      const currentStatus = request.rows[0]?.status;
      if (currentStatus === status) {
        await client.query('COMMIT');
        return res.json({ status });
      }
      if (currentStatus !== 'pending' || !socialAccountPairIsActive(accounts.rows)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: copy.errors.requestUnavailable });
      }
      if (status === 'accepted') {
        const blocked = await client.query(
          `SELECT 1 FROM blocked_users
           WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
              OR (blocker_user_id = $2 AND blocked_user_id = $1)
           LIMIT 1`,
          [ownerId, senderId]
        );
        if (blocked.rowCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: copy.errors.requestUnavailable });
        }
        const friendship = await client.query(
          `INSERT INTO friendships (user_id, friend_id)
           VALUES ($1, $2), ($2, $1)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [ownerId, senderId]
        );
        notificationCreated = friendship.rowCount > 0;
        if (notificationCreated) {
          await client.query(
            `INSERT INTO notifications (user_id, type, title, body, data)
             VALUES ($1, 'friend_accepted', $2, $3,
                     jsonb_build_object('userPublicId', $4::text))`,
            [senderId, copy.notifications.friendAcceptedTitle,
              formatCopy(copy.notifications.friendAcceptedBody, { name: req.session.user.displayName }),
              req.session.user.publicId]
          );
        }
      }
      await client.query(
        `UPDATE friend_requests SET status = $1, responded_at = NOW()
         WHERE public_id = $2 AND receiver_user_id = $3 AND status = 'pending'`,
        [status, requestPublicId, ownerId]
      );
      if (status === 'accepted') {
        await client.query(
          `UPDATE friend_requests SET status = 'cancelled', responded_at = NOW()
           WHERE status = 'pending' AND public_id <> $1
             AND LEAST(sender_user_id, receiver_user_id) = LEAST($2::bigint, $3::bigint)
             AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($2::bigint, $3::bigint)`,
          [requestPublicId, senderId, ownerId]
        );
      }
      await client.query('COMMIT');
      presence.emitToUser(senderId, 'friend-request-updated', { requestId: requestPublicId, status });
      presence.emitToUser(ownerId, 'friend-request-updated', { requestId: requestPublicId, status });
      if (notificationCreated) {
        presence.emitToUser(senderId, 'notification-created', { type: 'friend_accepted' });
      }
      return res.json({ status });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.delete('/api/friend-requests/:id', ...auth, asyncRoute(async (req, res) => {
    const requestPublicId = cleanPublicId(req.params.id);
    if (!isPublicId(requestPublicId, 'friendRequest')) {
      return res.status(404).json({ error: copy.errors.requestUnavailable });
    }
    const senderId = userId(req);
    const client = await db.getClient();
    let receiverId = null;
    try {
      await client.query('BEGIN');
      const located = await client.query(
        `SELECT receiver_user_id FROM friend_requests
         WHERE public_id = $1 AND sender_user_id = $2`,
        [requestPublicId, senderId]
      );
      if (!located.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: copy.errors.requestUnavailable });
      }
      receiverId = Number(located.rows[0].receiver_user_id);
      await lockSocialAccountPair(client, senderId, receiverId);
      const request = await client.query(
        `SELECT status FROM friend_requests
         WHERE public_id = $1 AND sender_user_id = $2
         FOR UPDATE`,
        [requestPublicId, senderId]
      );
      if (request.rows[0]?.status === 'cancelled') {
        await client.query('COMMIT');
        return res.status(204).end();
      }
      if (request.rows[0]?.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: copy.errors.requestUnavailable });
      }
      await client.query(
        `UPDATE friend_requests SET status = 'cancelled', responded_at = NOW()
         WHERE public_id = $1 AND sender_user_id = $2 AND status = 'pending'`,
        [requestPublicId, senderId]
      );
      await client.query('COMMIT');
      presence.emitToUser(receiverId, 'friend-request-updated', {
        requestId: requestPublicId,
        status: 'cancelled'
      });
      presence.emitToUser(senderId, 'friend-request-updated', {
        requestId: requestPublicId,
        status: 'cancelled'
      });
      return res.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.get('/api/chat-requests', ...auth, asyncRoute(async (req, res) => {
    const direction = req.query.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const limit = pageSize(req.query.limit);
    const cursor = req.query.cursor ? decodePublicIdCursor(req.query.cursor, 'chatRequest') : null;
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: copy.errors.paginationInvalid });
    }
    const ownerColumn = direction === 'outgoing' ? 'sender_user_id' : 'receiver_user_id';
    const personColumn = direction === 'outgoing' ? 'receiver_user_id' : 'sender_user_id';
    await db.query(
      `UPDATE chat_requests SET status = 'expired', responded_at = COALESCE(responded_at, expires_at)
       WHERE status = 'pending' AND expires_at <= NOW()
         AND (sender_user_id = $1 OR receiver_user_id = $1)`,
      [userId(req)]
    );
    const [result, pending] = await Promise.all([
      db.query(
      `SELECT cr.public_id, cr.public_id AS id, cr.created_at, cr.expires_at,
              u.public_id AS person_public_id,
              u.display_name, u.profile_image_url
       FROM chat_requests cr JOIN users u ON u.id = cr.${personColumn}
       WHERE cr.${ownerColumn} = $1
         AND cr.status = 'pending'
         AND cr.expires_at > NOW()
         AND (
           $2::timestamptz IS NULL
           OR (cr.created_at, cr.public_id) < ($2::timestamptz, $3::text)
         )
       ORDER BY cr.created_at DESC, cr.public_id DESC
      LIMIT $4`,
      [userId(req), cursor?.createdAt || null, cursor?.publicId || null, limit + 1]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM chat_requests
         WHERE ${ownerColumn} = $1 AND status = 'pending' AND expires_at > NOW()`,
        [userId(req)]
      )
    ]);
    const paged = publicIdCursorPage(result.rows, limit, 'chatRequest');
    res.json({
      requests: paged.items,
      page: paged.page,
      pendingCount: Number(pending.rows[0].count),
      direction
    });
  }));

  app.get('/api/notifications', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const limit = pageSize(req.query.limit);
    const cursor = req.query.cursor ? decodePublicIdCursor(req.query.cursor, 'notification') : null;
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: copy.errors.paginationInvalid });
    }
    const [result, unread] = await Promise.all([
      db.query(
      `SELECT public_id, public_id AS id, type, title, body, data, read_at, created_at
       FROM notifications
        WHERE (user_id = $1 OR guest_id = $2)
         AND type <> 'account_ban'
         AND dismissed_at IS NULL
         AND (
            $3::timestamptz IS NULL
            OR (created_at, public_id) < ($3::timestamptz, $4::text)
         )
       ORDER BY created_at DESC, public_id DESC
        LIMIT $5`,
       [principal.userId, principal.guestId, cursor?.createdAt || null, cursor?.publicId || null, limit + 1]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
          WHERE (user_id = $1 OR guest_id = $2) AND read_at IS NULL
            AND type <> 'account_ban' AND dismissed_at IS NULL`,
         [principal.userId, principal.guestId]
      )
    ]);
    const paged = publicIdCursorPage(result.rows, limit, 'notification');
    res.json({
      notifications: paged.items.map((notification) => ({
        ...notification,
        data: notificationDataForClient(notification)
      })),
      page: paged.page,
      unreadCount: Number(unread.rows[0].count)
    });
  }));

  app.patch('/api/notifications/:id/read', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const notificationPublicId = cleanPublicId(req.params.id);
    if (!isPublicId(notificationPublicId, 'notification')) {
      return res.status(404).json({ error: copy.errors.requestUnavailable });
    }
    const updated = await db.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE public_id = $1 AND (user_id = $2 OR guest_id = $3)
         AND type <> 'account_ban' AND dismissed_at IS NULL AND read_at IS NULL
       RETURNING user_id`,
      [notificationPublicId, principal.userId, principal.guestId]
    );
    if (updated.rows[0]?.user_id) {
      presence.emitToUser(Number(updated.rows[0].user_id), 'notification-updated', {
        notificationId: notificationPublicId,
        status: 'read'
      });
    }
    return res.status(204).end();
  }));

  app.delete('/api/notifications/:id', asyncRoute(async (req, res) => {
    const principal = await productPrincipalForRequest(db, req, res);
    if (!principal) return;
    const notificationPublicId = cleanPublicId(req.params.id);
    if (!isPublicId(notificationPublicId, 'notification')) {
      return res.status(404).json({ error: copy.errors.requestUnavailable });
    }
    const updated = await db.query(
      `UPDATE notifications
       SET dismissed_at = COALESCE(dismissed_at, NOW())
       WHERE public_id = $1 AND (user_id = $2 OR guest_id = $3)
         AND type = ANY($4::text[])
         AND dismissed_at IS NULL
       RETURNING user_id`,
      [notificationPublicId, principal.userId, principal.guestId,
        ['friend_request', 'friend_accepted', 'report_processed', 'guest_account_claim']]
    );
    if (updated.rows[0]?.user_id) {
      presence.emitToUser(Number(updated.rows[0].user_id), 'notification-updated', {
        notificationId: notificationPublicId,
        status: 'dismissed'
      });
    }
    return res.status(204).end();
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
    const blockerId = userId(req);
    const client = await db.getClient();
    let created = false;
    try {
      await client.query('BEGIN');
      await lockSocialAccountPair(client, blockerId, blockedId);
      const block = await client.query(
        `INSERT INTO blocked_users (blocker_user_id, blocked_user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [blockerId, blockedId]
      );
      created = block.rowCount > 0;
      await client.query(
        `DELETE FROM friendships
         WHERE (user_id = $1 AND friend_id = $2)
            OR (user_id = $2 AND friend_id = $1)`,
        [blockerId, blockedId]
      );
      await client.query(
        `UPDATE friend_requests SET status = 'cancelled', responded_at = NOW()
         WHERE status = 'pending'
           AND LEAST(sender_user_id, receiver_user_id) = LEAST($1::bigint, $2::bigint)
           AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($1::bigint, $2::bigint)`,
        [blockerId, blockedId]
      );
      await client.query(
        `UPDATE chat_requests SET status = 'cancelled', responded_at = NOW()
         WHERE status = 'pending'
           AND LEAST(sender_user_id, receiver_user_id) = LEAST($1::bigint, $2::bigint)
           AND GREATEST(sender_user_id, receiver_user_id) = GREATEST($1::bigint, $2::bigint)`,
        [blockerId, blockedId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (created) {
      presence.emitToUser(blockerId, 'friendship-updated', {
        userPublicId: cleanPublicId(req.params.id),
        status: 'blocked'
      });
      presence.emitToUser(blockedId, 'friendship-updated', {
        userPublicId: req.session.user.publicId,
        status: 'blocked'
      });
    }
    return res.status(created ? 201 : 200).json({ blocked: true });
  }));

  app.delete('/api/blocks/:id', ...auth, asyncRoute(async (req, res) => {
    const blockedId = await userIdFromPublicId(db, req.params.id);
    if (!blockedId) return res.status(404).json({ error: copy.errors.userNotFound });
    await db.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2', [userId(req), blockedId]);
    res.status(204).end();
  }));

  app.get('/api/admin/guests', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const pagination = guestPaginationFor(req, res);
    if (!pagination) return;
    const { cursor, limit } = pagination;
    const statuses = new Set(['active', 'banned', 'claimed', 'deleted', 'expired']);
    const status = statuses.has(req.query.status) ? req.query.status : null;
    const search = cleanText(req.query.q, 100).toLowerCase();
    const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
    const result = await db.query(
      `SELECT g.public_id, g.name, g.gender, g.age, g.country, g.country_code,
              g.avatar_id, g.name_changes, g.status, g.created_at, g.last_seen_at,
              g.retention_until, g.deleted_at, active_ban.id AS active_ban_id,
              active_ban.type AS active_ban_type, active_ban.starts_at AS active_ban_starts_at,
              active_ban.ends_at AS active_ban_ends_at,
              latest_activity.recent_chat_count
       FROM guest_principals g
       LEFT JOIN LATERAL (
         SELECT b.id, b.type, b.starts_at, b.ends_at FROM guest_bans b
         WHERE b.guest_id = g.id AND b.revoked_at IS NULL
           AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
         ORDER BY b.created_at DESC, b.id DESC LIMIT 1
       ) active_ban ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT cp.conversation_id) FILTER (
           WHERE c.last_activity_at >= NOW() - INTERVAL '30 days'
         )::int AS recent_chat_count
         FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
         WHERE cp.guest_id = g.id
       ) latest_activity ON TRUE
       WHERE (
         $1::text IS NULL
         OR ($1 = 'banned' AND active_ban.id IS NOT NULL)
         OR ($1 <> 'banned' AND g.status = $1 AND ($1 <> 'active' OR active_ban.id IS NULL))
       )
         AND ($2::text = '' OR LOWER(g.public_id) LIKE $2::text || '%' ESCAPE '\\'
              OR LOWER(g.name) LIKE $2::text || '%' ESCAPE '\\' OR LOWER(g.legacy_public_id) LIKE $2::text || '%' ESCAPE '\\')
         AND ($3::timestamptz IS NULL OR (g.created_at, g.public_id) < ($3::timestamptz, $4::text))
       ORDER BY g.created_at DESC, g.public_id DESC
       LIMIT $5`,
      [status, escapedSearch, cursor?.createdAt || null, cursor?.publicId || null, limit + 1]
    );
    const paged = publicIdCursorPage(result.rows, limit, 'guest');
    res.json({
      guests: paged.items.map((guest) => ({
        publicId: guest.public_id,
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
        deletedAt: guest.deleted_at,
        activeBanId: guest.active_ban_id ? Number(guest.active_ban_id) : null,
        activeBan: guest.active_ban_id ? {
          id: Number(guest.active_ban_id), type: guest.active_ban_type,
          startsAt: guest.active_ban_starts_at, endsAt: guest.active_ban_ends_at
        } : null,
        recentChatCount: Number(guest.recent_chat_count || 0)
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
    const states = new Set(['active', 'banned', 'deleted']);
    const state = states.has(req.query.state) ? req.query.state : null;
    const result = await db.query(
      `SELECT u.id, u.public_id, u.username, u.display_name, u.email, u.role, u.plan,
              u.email_verified_at, u.admin_2fa_enabled_at, u.created_at, u.deleted_at,
              u.retention_until, u.pii_purged_at,
              DATE_PART('year', AGE(u.birth_date))::int AS age, u.country, u.country_code,
              CASE WHEN u.last_seen_at IS NULL AND latest_activity.last_seen_at IS NULL THEN NULL
                   ELSE GREATEST(COALESCE(u.last_seen_at, '-infinity'::timestamptz),
                                 COALESCE(latest_activity.last_seen_at, '-infinity'::timestamptz)) END AS last_seen_at,
              latest_activity.recent_chat_count,
              active_ban.id AS active_ban_id, active_ban.type AS active_ban_type,
              active_ban.starts_at AS active_ban_starts_at, active_ban.ends_at AS active_ban_ends_at,
              EXISTS (
                SELECT 1 FROM account_bans b
                WHERE b.user_id = u.id AND b.revoked_at IS NULL
                  AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
              ) AS active_ban
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(c.last_activity_at) AS last_seen_at,
                COUNT(DISTINCT cp.conversation_id) FILTER (
                  WHERE c.last_activity_at >= NOW() - INTERVAL '30 days'
                )::int AS recent_chat_count
         FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
         WHERE cp.user_id = u.id
       ) latest_activity ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, type, starts_at, ends_at FROM account_bans b
         WHERE b.user_id = u.id AND b.revoked_at IS NULL
           AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
         ORDER BY b.created_at DESC, b.id DESC LIMIT 1
       ) active_ban ON TRUE
       WHERE (
           $1::text = ''
           OR LOWER(u.username) LIKE $1::text || '%' ESCAPE '\\'
           OR LOWER(u.email) LIKE $1::text || '%' ESCAPE '\\'
           OR u.public_id = $2::text
           OR u.legacy_public_id = $2::text
         )
         AND (
           $3::text IS NULL
           OR ($3 = 'deleted' AND u.deleted_at IS NOT NULL)
           OR ($3 = 'banned' AND u.deleted_at IS NULL AND active_ban.id IS NOT NULL)
           OR ($3 = 'active' AND u.deleted_at IS NULL AND active_ban.id IS NULL)
         )
         AND (
           $4::timestamptz IS NULL
           OR (u.created_at, u.id) < ($4::timestamptz, $5::bigint)
         )
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $6`,
      [escapedSearch, search, state, cursor?.createdAt || null, cursor?.id || null, limit + 1]
    );
    const paged = cursorPage(result.rows, limit);
    res.json({
      users: paged.items.map((user) => {
        const deleted = Boolean(user.deleted_at);
        const purged = Boolean(user.pii_purged_at);
        const retained = deleted && !purged;
        return {
          public_id: user.public_id,
          username: purged ? null : user.username,
          display_name: purged ? null : user.display_name,
          email: deleted ? null : user.email,
          email_retained_in_details: retained,
          role: user.role,
          plan: user.plan,
          email_verified_at: purged ? null : user.email_verified_at,
          admin_2fa_enabled_at: purged ? null : user.admin_2fa_enabled_at,
          created_at: user.created_at,
          deleted_at: user.deleted_at,
          retention_until: user.retention_until,
          pii_purged_at: user.pii_purged_at,
          age: purged || user.age === null ? null : Number(user.age),
          country: purged ? null : user.country,
          country_code: purged ? null : user.country_code,
          last_seen_at: user.last_seen_at,
          recent_chat_count: Number(user.recent_chat_count || 0),
          active_ban: Boolean(user.active_ban),
          active_ban_id: user.active_ban_id ? Number(user.active_ban_id) : null,
          active_ban_type: user.active_ban_type,
          active_ban_starts_at: user.active_ban_starts_at,
          active_ban_ends_at: user.active_ban_ends_at
        };
      }),
      page: paged.page
    });
  }));

  app.get('/api/admin/guests/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const guestId = await guestIdFromPublicId(db, req.params.id);
    if (!guestId) return res.status(404).json({ error: copy.errors.guestProfileMissing });
    const result = await db.query(
      `SELECT g.public_id, g.name, g.gender, g.age, g.country, g.country_code, g.avatar_id,
              g.status, g.created_at, g.last_seen_at, g.retention_until, g.deleted_at,
              active_ban.id AS active_ban_id, active_ban.type AS active_ban_type,
              active_ban.reason AS active_ban_reason, active_ban.starts_at AS active_ban_starts_at,
              active_ban.ends_at AS active_ban_ends_at, latest_activity.recent_chat_count
       FROM guest_principals g
       LEFT JOIN LATERAL (
         SELECT id, type, reason, starts_at, ends_at FROM guest_bans b
         WHERE b.guest_id = g.id AND b.revoked_at IS NULL
           AND b.starts_at <= NOW() AND (b.type = 'permanent' OR b.ends_at > NOW())
         ORDER BY b.created_at DESC, b.id DESC LIMIT 1
       ) active_ban ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT cp.conversation_id) FILTER (
           WHERE c.last_activity_at >= NOW() - INTERVAL '30 days'
         )::int AS recent_chat_count
         FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
         WHERE cp.guest_id = g.id
       ) latest_activity ON TRUE
       WHERE g.id = $1`,
      [guestId]
    );
    if (!result.rowCount) return res.status(404).json({ error: copy.errors.guestProfileMissing });
    const row = result.rows[0];
    res.json({ guest: {
      publicId: row.public_id, name: row.name, gender: row.gender,
      age: Number(row.age), country: row.country, countryCode: row.country_code, avatarId: row.avatar_id,
      status: row.status, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
      retentionUntil: row.retention_until, deletedAt: row.deleted_at,
      recentChatCount: Number(row.recent_chat_count || 0),
      activeBan: row.active_ban_id ? {
        id: Number(row.active_ban_id), type: row.active_ban_type, reason: row.active_ban_reason,
        startsAt: row.active_ban_starts_at, endsAt: row.active_ban_ends_at
      } : null
    } });
  }));

  app.get('/api/admin/users/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const publicId = cleanPublicId(req.params.id);
    const result = await db.query(
      `SELECT u.public_id, u.username, u.display_name, u.email, u.role, u.plan,
              u.email_verified_at, u.admin_2fa_enabled_at, u.created_at, u.deleted_at,
              u.retention_until, u.pii_purged_at,
              DATE_PART('year', AGE(u.birth_date))::int AS age, u.country, u.country_code,
              CASE WHEN u.last_seen_at IS NULL AND latest_activity.last_seen_at IS NULL THEN NULL
                   ELSE GREATEST(COALESCE(u.last_seen_at, '-infinity'::timestamptz),
                                 COALESCE(latest_activity.last_seen_at, '-infinity'::timestamptz)) END AS last_seen_at,
              latest_activity.recent_chat_count,
              active_ban.id AS active_ban_id, active_ban.type AS active_ban_type,
              active_ban.reason AS active_ban_reason, active_ban.starts_at AS active_ban_starts_at,
              active_ban.ends_at AS active_ban_ends_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(c.last_activity_at) AS last_seen_at,
                COUNT(DISTINCT cp.conversation_id) FILTER (
                  WHERE c.last_activity_at >= NOW() - INTERVAL '30 days'
                )::int AS recent_chat_count
         FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
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
       WHERE (u.public_id = $1 OR u.legacy_public_id = $1)`,
      [publicId]
    );
    if (!result.rowCount) return res.status(404).json({ error: copy.errors.userNotFound });
    const row = result.rows[0];
    const deleted = Boolean(row.deleted_at);
    const purged = Boolean(row.pii_purged_at);
    res.json({
      user: {
        publicId: row.public_id,
        username: purged ? null : row.username,
        displayName: purged ? null : row.display_name,
        email: purged ? null : row.email,
        role: row.role,
        plan: row.plan,
        emailVerifiedAt: purged ? null : row.email_verified_at,
        adminTwoFactorEnabledAt: purged ? null : row.admin_2fa_enabled_at,
        createdAt: row.created_at,
        deletedAt: row.deleted_at,
        retentionUntil: row.retention_until,
        piiPurgedAt: row.pii_purged_at,
        personalDataRemoved: purged,
        age: purged || row.age === null ? null : Number(row.age),
        country: purged ? null : row.country,
        countryCode: purged ? null : row.country_code,
        lastSeenAt: row.last_seen_at,
        recentChatCount: Number(row.recent_chat_count || 0),
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
    const targetUserId = await userIdFromPublicId(db, req.params.id, { includeDeleted: true });
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
              reporter_guest.public_id AS reporter_guest_public_id,
               COALESCE(reporter.display_name, reporter_guest.name) AS reporter_name,
               reported.public_id AS reported_public_id,
               reported_guest.public_id AS reported_guest_public_id,
               COALESCE(reported.display_name, reported_guest.name) AS reported_name,
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
    const scopes = new Set(['account', 'guest', 'network']);
    const scope = scopes.has(req.query.scope) ? req.query.scope : null;
    const result = await db.query(
      `WITH moderation_bans AS (
         SELECT b.id, b.id AS ban_id, b.type, b.reason, b.starts_at, b.ends_at, b.created_at, b.revoked_at,
                'account'::text AS scope, target.public_id AS user_public_id,
                target.display_name AS user_name, creator.public_id AS created_by_public_id,
                COALESCE(target.display_name, target.public_id)::text AS target_label
         FROM account_bans b
         JOIN users target ON target.id = b.user_id
         JOIN users creator ON creator.id = b.created_by
         UNION ALL
         SELECT -b.id AS id, b.id AS ban_id, 'temporary'::varchar(20) AS type, b.reason, b.starts_at, b.ends_at,
                b.created_at, b.revoked_at, 'network'::text AS scope,
                NULL::varchar(40) AS user_public_id, NULL::varchar(40) AS user_name,
                creator.public_id AS created_by_public_id,
                CASE
                  WHEN b.source_type = 'account' AND source.public_id IS NOT NULL
                    THEN 'Public ID ' || source.public_id
                  ELSE 'Manual \u00b7 net_' || LEFT(TRIM(b.network_fingerprint), 12)
                END AS target_label
         FROM network_bans b
         JOIN users creator ON creator.id = b.created_by
         LEFT JOIN users source ON source.id = b.source_user_id
         UNION ALL
         SELECT -1000000000000 - b.id AS id, b.id AS ban_id, b.type,
                b.reason, b.starts_at, b.ends_at, b.created_at, b.revoked_at, 'guest'::text AS scope,
                target.public_id AS user_public_id, target.name AS user_name,
                creator.public_id AS created_by_public_id,
                COALESCE(target.name, target.public_id)::text AS target_label
         FROM guest_bans b
         JOIN guest_principals target ON target.id = b.guest_id
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

  app.get('/api/admin/network-bans/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const banId = asId(req.params.id);
    if (!banId) return res.status(404).json({ error: 'Network ban not found' });
    const result = await db.query(
      `SELECT 'net_' || LEFT(TRIM(b.network_fingerprint), 12) AS network_reference,
              b.source_type, source.public_id AS source_public_id,
              b.address_family, b.prefix_length, b.reason, b.starts_at, b.ends_at,
              CASE
                WHEN b.revoked_at IS NOT NULL THEN 'revoked'
                WHEN b.ends_at <= NOW() THEN 'expired'
                WHEN b.starts_at > NOW() THEN 'scheduled'
                ELSE 'active'
              END AS status,
              source_ban.type AS source_account_ban_type,
              source_ban.ends_at AS source_account_ban_ends_at,
              CASE
                WHEN source_ban.id IS NULL THEN NULL
                WHEN source_ban.revoked_at IS NOT NULL THEN 'revoked'
                WHEN source_ban.ends_at IS NOT NULL AND source_ban.ends_at <= NOW() THEN 'expired'
                WHEN source_ban.starts_at > NOW() THEN 'scheduled'
                ELSE 'active'
              END AS source_account_ban_status,
              requester.public_id AS requested_by_public_id,
              COALESCE(reviewer.public_id, legacy_reviewer.public_id) AS privacy_reviewer_public_id,
              COALESCE(approval.approved_at, b.privacy_reviewed_at) AS privacy_reviewed_at,
              b.revoked_at, revoker.public_id AS revoked_by_public_id, b.revoke_reason
       FROM network_bans b
       LEFT JOIN users source ON source.id = b.source_user_id
       LEFT JOIN account_bans source_ban ON source_ban.id = b.source_account_ban_id
       LEFT JOIN network_ban_privacy_approvals approval ON approval.id = b.privacy_approval_id
       LEFT JOIN users requester ON requester.id = approval.requested_by
       LEFT JOIN users reviewer ON reviewer.id = approval.approved_by
       LEFT JOIN users legacy_reviewer ON legacy_reviewer.id = b.privacy_reviewed_by
       LEFT JOIN users revoker ON revoker.id = b.revoked_by
       WHERE b.id = $1`,
      [banId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Network ban not found' });
    const ban = result.rows[0];
    return res.json({
      networkBan: {
        networkReference: ban.network_reference,
        sourceType: ban.source_type,
        sourcePublicId: ban.source_public_id || null,
        sourceAccountBan: ban.source_account_ban_status ? {
          status: ban.source_account_ban_status,
          type: ban.source_account_ban_type,
          endsAt: ban.source_account_ban_ends_at
        } : null,
        addressFamily: Number(ban.address_family),
        prefixLength: Number(ban.prefix_length),
        requestedByPublicId: ban.requested_by_public_id || null,
        privacyReviewerPublicId: ban.privacy_reviewer_public_id || null,
        privacyReviewedAt: ban.privacy_reviewed_at,
        reason: ban.reason,
        startsAt: ban.starts_at,
        endsAt: ban.ends_at,
        status: ban.status,
        revocation: ban.revoked_at ? {
          revokedAt: ban.revoked_at,
          revokedByPublicId: ban.revoked_by_public_id || null,
          reason: ban.revoke_reason
        } : null
      }
    });
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
         AND ($2::text = '' OR target.public_id = $2 OR target.legacy_public_id = $2)
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
    const reauthenticatedAt = Number(req.session.adminReauthenticatedAt || 0);
    const adminReauthExpiresAt = reauthenticatedAt + ADMIN_REAUTH_WINDOW_MS > Date.now()
      ? new Date(reauthenticatedAt + ADMIN_REAUTH_WINDOW_MS).toISOString()
      : null;
    res.render('admin', {
      pageTitle: copy.pageTitles.admin,
      price: price.rows[0],
      csrfToken: res.locals.csrfToken,
      adminReauthMethod,
      adminReauthActive: Boolean(adminReauthExpiresAt),
      adminReauthExpiresAt,
      googleClientId: adminReauthMethod === 'google' ? environment.GOOGLE_CLIENT_ID : '',
      adminGoogleNonce
    });
  }));

  function moderationFailure(error, res) {
    if (error?.code === 'SELF_MODERATION_FORBIDDEN') return res.status(400).json({ error: copy.errors.ownAdminDelete });
    if (error?.code === 'TARGET_NOT_FOUND' || error?.code === 'BAN_NOT_FOUND') return res.status(404).json({ error: copy.errors.userNotFound });
    if (error?.code === 'GUEST_NOT_FOUND') return res.status(404).json({ error: copy.errors.guestProfileMissing });
    if (error?.code === 'ADMIN_AUTH_REQUIRED') return res.status(403).json({ error: copy.errors.adminRequired });
    if (['MODERATION_REASON_REQUIRED', 'NETWORK_INVALID', 'NETWORK_TOO_BROAD', 'NETWORK_SOURCE_INVALID',
      'NETWORK_CONFIRMATION_MISMATCH', 'BAN_TYPE_INVALID', 'BAN_DURATION_INVALID',
      'GUEST_BAN_TYPE_INVALID', 'GUEST_BAN_DURATION_INVALID'].includes(error?.code)) {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === 'GUEST_DEVICE_UNAVAILABLE') return res.status(409).json({ error: error.message });
    if (error?.code === 'PRIVACY_REVIEW_REQUIRED') return res.status(400).json({ error: error.message });
    if (['ACTIVE_ACCOUNT_BAN_REQUIRED', 'NETWORK_SIGNAL_STALE', 'NETWORK_ALREADY_ACTIVE'].includes(error?.code)) {
      return res.status(409).json({ error: error.message });
    }
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

  app.post('/api/admin/guests/:id/ban', ...highRiskAdmin, asyncRoute(async (req, res) => {
    const targetGuestId = await guestIdFromPublicId(db, req.params.id);
    if (!targetGuestId) return res.status(404).json({ error: copy.errors.guestProfileMissing });
    try {
      const ban = await moderation.banGuest({
        actorUserId: userId(req), targetGuestId, type: req.body.type, hours: req.body.hours, reason: req.body.reason,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.status(ban.idempotent ? 200 : 201).json({
        banId: Number(ban.id), type: ban.type, endsAt: ban.ends_at, idempotent: ban.idempotent
      });
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

  app.patch('/api/admin/guest-bans/:id/revoke', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const ban = await moderation.revokeGuestBan({
        actorUserId: userId(req), banId: asId(req.params.id), reason: req.body.reason,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.json({ banId: Number(ban.id), revokedAt: ban.revoked_at, idempotent: ban.idempotent });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  app.get('/api/admin/network-ban-privacy-approvals', ...adminOnly, asyncRoute(async (req, res) => {
    const reviews = await moderation.listPendingNetworkBanPrivacyApprovals({ limit: req.query.limit });
    res.json({ reviews, pendingCount: reviews.length });
  }));

  app.post('/api/admin/network-ban-privacy-approvals', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const approval = await moderation.requestNetworkBanPrivacyApproval({
        actorUserId: userId(req), sourceType: req.body.sourceType || 'account',
        publicId: req.body.publicId, cidr: req.body.cidr, reason: req.body.reason,
        hours: req.body.hours,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.status(201).json({ approvalId: approval.id, expiresAt: approval.expires_at });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  app.post('/api/admin/network-ban-privacy-approvals/:id/approve', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const outcome = await moderation.reviewNetworkBanPrivacyApproval({
        reviewerUserId: userId(req), approvalId: req.params.id, reason: req.body.reason,
        decision: 'approve', cidr: req.body.cidr,
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.json({ approvalId: req.params.id, ban: outcome.ban ? {
        id: Number(outcome.ban.id), addressFamily: Number(outcome.ban.address_family),
        prefixLength: Number(outcome.ban.prefix_length), endsAt: outcome.ban.ends_at
      } : null, idempotent: outcome.idempotent });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  app.post('/api/admin/network-ban-privacy-approvals/:id/reject', ...highRiskAdmin, asyncRoute(async (req, res) => {
    try {
      const outcome = await moderation.reviewNetworkBanPrivacyApproval({
        reviewerUserId: userId(req), approvalId: req.params.id, reason: req.body.reason,
        decision: 'reject',
        correlationId: req.get('x-correlation-id') || undefined
      });
      return res.json({ approvalId: req.params.id, rejected: outcome.rejected, idempotent: outcome.idempotent });
    } catch (error) {
      return moderationFailure(error, res);
    }
  }));

  // Compatibility guard for pre-018 clients. Authentication still runs first,
  // but the former third creation step can no longer create a restriction.
  app.post('/api/admin/network-bans', ...highRiskAdmin, (req, res) => {
    res.status(410).json({ error: 'Network bans are created by the independent review confirmation' });
  });

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
    try {
      const reason = cleanText(req.body.reason, 500);
      if (!reason || reason.length < 3) {
        return res.status(400).json({ error: 'A reason is required to delete an account' });
      }
      await deleteAccountLifecycle({
        db,
        targetUserId,
        actorUserId: userId(req),
        adminAction: true,
        reason,
        correlationId: req.get('x-correlation-id') || undefined
      });
      await moderation.disconnectUser(targetUserId, {}, 'auth-required');
      res.status(204).end();
    } catch (error) {
      return moderationFailure(error, res);
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
