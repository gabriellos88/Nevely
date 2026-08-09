const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { createPublicId, insertWithUniquePublicId } = require('./public-identifiers');
const rateLimit = require('express-rate-limit');
const flagCountries = require('../public/vendor/flag-icons-7.5.0/country.json');
const copy = require('../public/i18n/en.json');
const {
  consumeAccountToken,
  hashToken,
  queueAccountEmail,
  queueAccountEmailTransaction
} = require('./account-email');
const { createGoogleVerifier } = require('./google-auth');
const { presetAvatarUrl, randomPresetAvatarUrl } = require('./avatar-presets');
const {
  deleteExpiredPendingRegistrations,
  deleteExpiredPendingRegistrationsTransaction,
  findActivePendingRegistration
} = require('./pending-registrations');
const {
  bindGuestSession,
  clearGuestSession,
  findActiveGuestPrincipal,
  guestPassportComplete
} = require('./guest-principals');
const {
  claimRequested,
  createGuestAccountClaim,
  finalizeGuestAccountClaim
} = require('./guest-claims');
const { revokeUserSessions, sessionUserId } = require('./security');
const {
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  verifyTotp
} = require('./totp');

const PASSWORD_ROUNDS = 12;
const REGISTERED_GENDERS = new Set([
  'male',
  'female',
  'non-binary',
  'other',
  'prefer-not-to-say'
]);
const REGISTERED_COUNTRIES = new Map(flagCountries
  .filter((country) => country.iso === true || country.code === 'xk')
  .filter((country) => country.code && country.name)
  .map((country) => [country.code.toLowerCase(), country.name]));

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeEmail(value) {
  return cleanText(value, 255).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeUsername(value) {
  const username = cleanText(value, 30);
  return /^[A-Za-z0-9_-]{3,30}$/.test(username) ? username : '';
}

function makePublicId() {
  return createPublicId('user');
}

function makeDisplayAlias() {
  return `Nevely#${crypto.randomBytes(3).toString('hex')}`;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // PostgreSQL DATE values are parsed as a local calendar date by `pg`.
    // Serializing through UTC shifts the day in positive-offset time zones.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function ageFromBirthDate(value, today = new Date()) {
  const date = dateOnly(value);
  if (!date) return null;
  const birthDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) return null;
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < birthDate.getUTCMonth()
    || (today.getUTCMonth() === birthDate.getUTCMonth()
      && today.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function normalizeRegisteredProfile(value = {}) {
  const birthDate = cleanText(value.birthDate || value.birth_date, 10);
  const gender = cleanText(value.gender, 30).toLowerCase();
  const countryCode = cleanText(
    value.countryCode || value.country_code || value.country?.code,
    2
  ).toLowerCase();
  const age = ageFromBirthDate(birthDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || age === null || age < 18 || age > 120) {
    return { error: copy.errors.birthDateInvalid };
  }
  if (!REGISTERED_GENDERS.has(gender)) return { error: copy.errors.genderInvalid };
  if (!REGISTERED_COUNTRIES.has(countryCode)) return { error: copy.errors.countryInvalid };
  return {
    birthDate,
    gender,
    countryCode,
    country: REGISTERED_COUNTRIES.get(countryCode),
    age
  };
}

function sessionUser(row) {
  return {
    internalId: Number(row.id),
    sessionVersion: Number(row.session_version || 1),
    publicId: row.public_id,
    displayAlias: row.display_alias,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    role: row.role,
    plan: row.plan,
    birthDate: dateOnly(row.birth_date),
    age: ageFromBirthDate(row.birth_date) ?? row.age ?? null,
    gender: row.gender,
    countryCode: row.country_code,
    country: row.country_code ? REGISTERED_COUNTRIES.get(row.country_code) || row.country : row.country,
    profileComplete: Boolean(row.profile_completed_at),
    profileImageUrl: row.profile_image_url,
    adminTwoFactorEnabled: Boolean(row.admin_2fa_enabled_at)
  };
}

function publicSessionUser(user) {
  if (!user) return null;
  const {
    internalId,
    sessionVersion,
    ...safeUser
  } = user;
  return safeUser;
}

function wantsJson(req) {
  return req.is('application/json') || req.get('accept')?.includes('application/json');
}

function authViewModel(req, mode, overrides = {}, environment = process.env) {
  if (!req.session.googleNonce) req.session.googleNonce = crypto.randomBytes(24).toString('base64url');
  return {
    pageTitle: mode === 'login' ? copy.pageTitles.login : copy.pageTitles.register,
    mode,
    error: null,
    notice: null,
    values: {},
    googleProfileRequired: false,
    claimMode: false,
    claimGuest: null,
    countries: [...REGISTERED_COUNTRIES].map(([code, name]) => ({ code, name })),
    googleClientId: environment.GOOGLE_CLIENT_ID || '',
    googleNonce: req.session.googleNonce,
    ...overrides
  };
}

function guestClaimView(guest) {
  if (!guestPassportComplete(guest)) return null;
  return {
    name: guest.name,
    avatarUrl: presetAvatarUrl(guest.avatarId)
  };
}

function registrationProfileFromGuest(guest, username) {
  if (!guestPassportComplete(guest)) return null;
  const gender = guest.gender === 'any' ? 'prefer-not-to-say' : guest.gender;
  if (!REGISTERED_GENDERS.has(gender) || !REGISTERED_COUNTRIES.has(guest.country.code)) return null;
  return {
    username: normalizeUsername(username),
    displayName: guest.name,
    birthDate: null,
    age: Number(guest.age),
    gender,
    countryCode: guest.country.code,
    country: REGISTERED_COUNTRIES.get(guest.country.code)
  };
}

async function activeGuestForSession(db, req, { touch = false } = {}) {
  if (!db.isConfigured || req.session?.user || !req.session?.guestPrincipalId) return null;
  const guest = await findActiveGuestPrincipal(db, req.session.guestPrincipalId, { touch });
  return guestPassportComplete(guest) ? guest : null;
}

function sendAuthError(req, res, status, message, mode, environment, viewOverrides = {}) {
  if (wantsJson(req)) return res.status(status).json({ error: message });
  return res.status(status).render('auth-stub', authViewModel(req, mode, {
    error: message,
    values: {
      username: req.body.username || '',
      email: req.body.email || '',
      birthDate: req.body.birthDate || '',
      gender: req.body.gender || '',
      countryCode: req.body.countryCode || ''
    },
    ...viewOverrides
  }, environment));
}

function requireDatabase(db) {
  return (req, res, next) => {
    if (db.isConfigured) return next();
    return res.status(503).json({ error: copy.errors.serviceUnavailable });
  };
}

function requireAuth(req, res, next) {
  if (sessionUserId(req)) return next();
  if (wantsJson(req) || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: copy.errors.accountRequired });
  }
  return res.redirect('/login');
}

function requireVerifiedEmail(req, res, next) {
  if (req.session?.user?.emailVerified) return next();
  if (!wantsJson(req) && !req.path.startsWith('/api/')) {
    return res.redirect('/verify-email/pending');
  }
  return res.status(403).json({
    error: copy.errors.emailVerificationRequired,
    code: 'EMAIL_VERIFICATION_REQUIRED'
  });
}

function createRequireAdmin(db) {
  return async function requireAdmin(req, res, next) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: copy.errors.accountRequired });
    try {
      const result = await db.query(
        `SELECT id, role, session_version, email_verified_at, admin_2fa_enabled_at, deleted_at,
                EXISTS(
                  SELECT 1 FROM account_bans
                  WHERE user_id = users.id AND revoked_at IS NULL
                    AND starts_at <= NOW() AND (type = 'permanent' OR ends_at > NOW())
                ) AS banned
         FROM users
         WHERE id = $1`,
        [userId]
      );
      const user = result.rows[0];
      if (!user || user.deleted_at || user.banned
        || Number(user.session_version) !== Number(req.session.user.sessionVersion)) {
        return req.session.destroy(() => res.status(401).json({ error: copy.errors.accountRequired }));
      }
      if (user.role !== 'admin') return res.status(403).json({ error: copy.errors.adminRequired });
      req.session.user.role = user.role;
      req.session.user.emailVerified = Boolean(user.email_verified_at);
      req.session.user.adminTwoFactorEnabled = Boolean(user.admin_2fa_enabled_at);
      if (!user.email_verified_at) {
        if (!wantsJson(req) && !req.path.startsWith('/api/')) {
          return res.redirect('/admin/security');
        }
        return res.status(403).json({
          error: copy.errors.emailVerificationRequired,
          code: 'EMAIL_VERIFICATION_REQUIRED'
        });
      }
      if (!user.admin_2fa_enabled_at) {
        if (!wantsJson(req) && !req.path.startsWith('/api/')) {
          return res.redirect('/admin/security');
        }
        return res.status(428).json({
          error: copy.errors.adminTwoFactorRequired,
          code: 'ADMIN_2FA_REQUIRED'
        });
      }
      if (!req.session.adminTwoFactorVerifiedAt) {
        if (!wantsJson(req) && !req.path.startsWith('/api/')) {
          return res.redirect('/login');
        }
        return res.status(401).json({
          error: copy.errors.adminTwoFactorChallengeRequired,
          code: 'ADMIN_2FA_CHALLENGE_REQUIRED'
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function createAuthLimiter(limit = 10) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: copy.errors.tooManyAttempts }
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

async function establishSession(req, row, {
  twoFactorVerified = false,
  restoreGuestId = null
} = {}) {
  const guestToRestore = restoreGuestId || req.session?.returnGuestPrincipalId || null;
  await regenerateSession(req);
  req.session.user = sessionUser(row);
  req.session.authenticatedAt = Date.now();
  if (guestToRestore) req.session.returnGuestPrincipalId = guestToRestore;
  if (twoFactorVerified) {
    const verifiedAt = Date.now();
    req.session.adminTwoFactorVerifiedAt = verifiedAt;
    if (row.role === 'admin') req.session.adminReauthenticatedAt = verifiedAt;
  }
  await saveSession(req);
  return publicSessionUser(req.session.user);
}

async function establishSuspendedSession(req, userId, ban) {
  await regenerateSession(req);
  req.session.suspension = {
    userId: Number(userId),
    accountBanId: ban.source === 'account' ? Number(ban.id) : null,
    type: ban.type,
    reason: ban.reason,
    startsAt: ban.starts_at,
    endsAt: ban.ends_at
  };
  await saveSession(req);
}

function suspensionPayload(ban) {
  return {
    code: 'ACCOUNT_SUSPENDED',
    suspension: { type: ban.type, reason: ban.reason, startsAt: ban.starts_at, endsAt: ban.ends_at }
  };
}

async function beginAdminTwoFactorChallenge(req, userId, { restoreGuestId = null } = {}) {
  await regenerateSession(req);
  req.session.pendingAdminTwoFactorUserId = Number(userId);
  req.session.pendingAdminTwoFactorExpiresAt = Date.now() + 5 * 60 * 1000;
  if (restoreGuestId) req.session.pendingReturnGuestPrincipalId = restoreGuestId;
  await saveSession(req);
}

async function findActiveBan(db, userId, ip) {
  return db.query(
    `SELECT id, type, reason, starts_at, ends_at, 'account'::text AS source FROM account_bans
     WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
       AND (type = 'permanent' OR ends_at > NOW())
     UNION ALL
     SELECT NULL::bigint AS id, type, COALESCE(reason, 'Account suspended') AS reason,
            starts_at, ends_at, 'legacy'::text AS source FROM bans
     WHERE (user_id = $1 OR (type = 'ip' AND ip_address = $2))
       AND starts_at <= NOW()
       AND (type = 'permanent' OR (type = 'ip' AND (ends_at IS NULL OR ends_at > NOW())) OR ends_at > NOW())
     LIMIT 1`,
    [userId, ip]
  );
}

function renderAction(res, req, values) {
  if (wantsJson(req)) return res.status(values.status || 200).json(values.json);
  return res.status(values.status || 200).render('auth-action', {
    pageTitle: values.title,
    title: values.title,
    message: values.message,
    mode: values.mode || 'message',
    token: values.token || '',
    error: values.error || null,
    csrfToken: res.locals.csrfToken,
    clearGuestProfile: Boolean(values.clearGuestProfile)
  });
}

function registerAuthRoutes(app, db, options = {}) {
  const environment = options.environment || process.env;
  const databaseRequired = requireDatabase(db);
  const googleVerifier = options.googleVerifier || createGoogleVerifier({
    clientId: environment.GOOGLE_CLIENT_ID
  });
  const publicOrigin = environment.PUBLIC_ORIGIN || 'http://localhost:3000';
  const emailSender = environment.RESEND_FROM
    || 'Verify <noreply@notifications.nevely.app>';
  const metadataPepper = environment.SESSION_SECRET;
  const totpEncryptionKey = environment.ADMIN_TOTP_ENCRYPTION_KEY
    || environment.SESSION_SECRET;

  app.get('/register', async (req, res, next) => {
    if (req.session?.user) return res.redirect('/chat');
    try {
      const guest = claimRequested(req.query.claim) ? await activeGuestForSession(db, req) : null;
      return res.render('auth-stub', authViewModel(req, 'register', {
        googleProfileRequired: req.query.google === 'profile-required',
        claimMode: Boolean(guest),
        claimGuest: guestClaimView(guest)
      }, environment));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/login', async (req, res, next) => {
    if (req.session?.user) return res.redirect('/chat');
    try {
      const guest = await activeGuestForSession(db, req);
      return res.render('auth-stub', authViewModel(req, 'login', {
        claimGuest: guestClaimView(guest),
        notice: req.query['email-changed'] === '1'
          ? copy.auth.emailChangeLoginNotice
          : null
      }, environment));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/register', databaseRequired, async (req, res, next) => {
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    let sessionGuest = null;
    try {
      sessionGuest = await activeGuestForSession(db, req);
    } catch (error) {
      return next(error);
    }
    const claimGuest = claimRequested(req.body.claim) ? sessionGuest : null;
    const claimMode = Boolean(claimGuest);
    const submittedProfile = claimMode ? registrationProfileFromGuest(claimGuest, req.body.username) : normalizeRegisteredProfile(req.body);
    const username = claimMode ? submittedProfile?.username : normalizeUsername(req.body.username);
    const claimView = {
      claimMode,
      claimGuest: guestClaimView(claimGuest)
    };
    if (!username) {
      return sendAuthError(req, res, 400, copy.errors.usernameLength, 'register', environment, claimView);
    }
    if (!isValidEmail(email)) {
      return sendAuthError(req, res, 400, copy.errors.emailInvalid, 'register', environment, claimView);
    }
    if (password.length < 8 || password.length > 72) {
      return sendAuthError(req, res, 400, copy.errors.passwordLength, 'register', environment, claimView);
    }
    if (!submittedProfile || submittedProfile.error) {
      return sendAuthError(req, res, 400, submittedProfile?.error || copy.errors.guestClaimUnavailable, 'register', environment, claimView);
    }

    const client = await db.getClient();
    try {
      const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
      await client.query('BEGIN');
      await deleteExpiredPendingRegistrations(client, {
        limit: 2,
        email,
        username
      });
      const pendingRegistration = await findActivePendingRegistration(client, {
        email,
        username
      });
      if (pendingRegistration.rowCount) {
        const pending = new Error(copy.errors.registrationPending);
        pending.code = 'REGISTRATION_PENDING';
        throw pending;
      }
      const existingUsername = await client.query(
        'SELECT 1 FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [username]
      );
      if (existingUsername.rowCount) {
        const unavailable = new Error(copy.errors.usernameTaken || 'This username is already in use.');
        unavailable.code = 'USERNAME_TAKEN';
        throw unavailable;
      }
      const result = await insertWithUniquePublicId(client, 'user', (publicId) => client.query(
        `INSERT INTO users
           (username, email, password_hash, public_id, display_alias, display_name,
              birth_date, age, gender, country, country_code, profile_completed_at,
              profile_image_url, last_ip, registration_pending_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12, $13, NOW())
         RETURNING *`,
        [
          username,
          email,
          passwordHash,
          publicId,
          makeDisplayAlias(),
          submittedProfile.displayName || username,
          submittedProfile.birthDate,
          submittedProfile.age,
          submittedProfile.gender,
          submittedProfile.country,
          submittedProfile.countryCode,
          claimMode ? null : randomPresetAvatarUrl(),
          req.ip
        ]
      ));
      if (claimMode) {
        const claim = await createGuestAccountClaim(client, {
          guestId: claimGuest.id,
          userId: Number(result.rows[0].id)
        });
        if (!claim) {
          const unavailable = new Error(copy.errors.guestClaimUnavailable);
          unavailable.code = 'GUEST_CLAIM_UNAVAILABLE';
          throw unavailable;
        }
      }
      await queueAccountEmail(client, {
        userId: result.rows[0].id,
        purpose: 'verify_email',
        recipient: email,
        publicOrigin,
        sender: emailSender,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        metadataPepper
      });
      await client.query('COMMIT');
      const user = await establishSession(req, result.rows[0], {
        restoreGuestId: sessionGuest?.id || null
      });
      if (wantsJson(req)) return res.status(201).json({
        user,
        verificationEmailQueued: true,
        guestClaimPending: claimMode
      });
      return res.redirect('/verify-email/pending');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === 'REGISTRATION_PENDING') {
        return sendAuthError(req, res, 409, copy.errors.registrationPending, 'register', environment, claimView);
      }
      if (error.code === 'USERNAME_TAKEN') {
        return sendAuthError(req, res, 409, error.message, 'register', environment, claimView);
      }
      if (error.code === '23505') {
        const pendingRegistration = await findActivePendingRegistration(db, {
          email,
          username
        });
        if (pendingRegistration.rowCount) {
          return sendAuthError(req, res, 409, copy.errors.registrationPending, 'register', environment, claimView);
        }
        return sendAuthError(req, res, 409, copy.errors.identityTaken, 'register', environment, claimView);
      }
      if (error.code === 'GUEST_CLAIM_UNAVAILABLE') {
        return sendAuthError(req, res, 409, error.message, 'register', environment, claimView);
      }
      return next(error);
    } finally {
      client.release();
    }
  });

  app.post('/login', databaseRequired, async (req, res, next) => {
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    try {
      await deleteExpiredPendingRegistrationsTransaction(db, {
        limit: 1,
        email
      });
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1',
        [email]
      );
      const user = result.rows[0];
      const valid = user?.password_hash
        ? await bcrypt.compare(password, user.password_hash)
        : false;
      if (!valid) {
        return sendAuthError(req, res, 401, copy.errors.credentialsIncorrect, 'login', environment);
      }
      const activeBan = await findActiveBan(db, user.id, req.ip);
      if (activeBan.rowCount) {
        await revokeUserSessions(db, user.id);
        const ban = activeBan.rows[0];
        await establishSuspendedSession(req, user.id, ban);
        if (wantsJson(req)) return res.status(403).json({ error: copy.errors.accountSuspended, ...suspensionPayload(ban) });
        return res.redirect('/suspension');
      }
      await db.query('UPDATE users SET last_ip = $1, last_seen_at = NOW() WHERE id = $2', [req.ip, user.id]);
      const returnGuest = await activeGuestForSession(db, req);
      if (user.role === 'admin' && user.admin_2fa_enabled_at) {
        await beginAdminTwoFactorChallenge(req, user.id, { restoreGuestId: returnGuest?.id || null });
        if (wantsJson(req)) {
          return res.status(202).json({ twoFactorRequired: true });
        }
        return res.redirect('/login/2fa');
      }
      const safeUser = await establishSession(req, user, { restoreGuestId: returnGuest?.id || null });
      if (wantsJson(req)) return res.json({
        user: safeUser,
        profileCompletionRequired: !safeUser.profileComplete,
        adminTwoFactorSetupRequired: safeUser.role === 'admin'
          && !safeUser.adminTwoFactorEnabled
      });
      if (safeUser.role === 'admin' && !safeUser.adminTwoFactorEnabled) {
        return res.redirect('/admin/security');
      }
      if (!safeUser.emailVerified) return res.redirect('/verify-email/pending');
      if (!safeUser.profileComplete) return res.redirect('/complete-profile');
      return res.redirect('/chat');
    } catch (error) {
      return next(error);
    }
  });

  app.get('/login/2fa', (req, res) => {
    if (!req.session.pendingAdminTwoFactorUserId) return res.redirect('/login');
    return renderAction(res, req, {
      title: copy.auth.twoFactorTitle,
      message: copy.auth.twoFactorBody,
      mode: 'two-factor'
    });
  });

  app.post('/login/2fa', databaseRequired, async (req, res, next) => {
    const userId = Number(req.session.pendingAdminTwoFactorUserId);
    if (!userId || Number(req.session.pendingAdminTwoFactorExpiresAt) < Date.now()) {
      return res.status(401).json({ error: copy.errors.twoFactorExpired });
    }
    try {
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1 AND role = $2 AND deleted_at IS NULL',
        [userId, 'admin']
      );
      const user = result.rows[0];
      const secret = user?.admin_totp_secret
        ? decryptSecret(user.admin_totp_secret, totpEncryptionKey)
        : null;
      if (!secret || !verifyTotp(secret, req.body.code)) {
        return res.status(401).json({ error: copy.errors.twoFactorInvalid });
      }
      const safeUser = await establishSession(req, user, {
        twoFactorVerified: true,
        restoreGuestId: req.session.pendingReturnGuestPrincipalId || null
      });
      if (wantsJson(req)) return res.json({ user: safeUser });
      return res.redirect('/admin');
    } catch (error) {
      return next(error);
    }
  });

  app.post('/logout', async (req, res, next) => {
    try {
      const guestId = req.session?.user ? req.session.returnGuestPrincipalId : null;
      const returnGuest = guestId
        ? await findActiveGuestPrincipal(db, guestId, { touch: false })
        : null;
      if (returnGuest) {
        await regenerateSession(req);
        bindGuestSession(req.session, returnGuest);
        await saveSession(req);
        if (wantsJson(req)) return res.json({ guestRestored: true });
        return res.redirect('/chat?guest=1');
      }
      return req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie('nevely.sid');
        if (wantsJson(req)) return res.status(204).end();
        return res.redirect('/');
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/suspension', databaseRequired, async (req, res, next) => {
    try {
      const suspension = req.session?.suspension;
      if (!suspension?.userId) return res.redirect('/login');
      const activeBan = await findActiveBan(db, suspension.userId, null);
      const ban = activeBan.rows.find((row) => row.source === 'account' && Number(row.id) === Number(suspension.accountBanId))
        || activeBan.rows[0];
      if (!ban) {
        return req.session.destroy(() => res.redirect('/login'));
      }
      req.session.suspension = {
        userId: Number(suspension.userId), accountBanId: ban.source === 'account' ? Number(ban.id) : null,
        type: ban.type, reason: ban.reason, startsAt: ban.starts_at, endsAt: ban.ends_at
      };
      await saveSession(req);
      if (wantsJson(req)) return res.json(suspensionPayload(ban));
      return res.render('suspension', {
        pageTitle: 'Account suspended',
        csrfToken: res.locals.csrfToken
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: publicSessionUser(req.session?.user || null) });
  });

  app.get('/complete-profile', requireAuth, requireVerifiedEmail, databaseRequired, async (req, res, next) => {
    try {
      const user = (await db.query(
        `SELECT profile_completed_at FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [sessionUserId(req)]
      )).rows[0];
      if (!user) return res.redirect('/login');
      if (user.profile_completed_at) return res.redirect('/chat');
      return res.render('profile-completion', {
        pageTitle: copy.auth.completeProfileTitle,
        countries: [...REGISTERED_COUNTRIES].map(([code, name]) => ({ code, name })),
        error: null,
        values: {},
        csrfToken: res.locals.csrfToken
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/complete-profile', requireAuth, requireVerifiedEmail, databaseRequired, async (req, res, next) => {
    const profile = normalizeRegisteredProfile(req.body);
    if (profile.error) {
      if (wantsJson(req)) return res.status(400).json({ error: profile.error });
      return res.status(400).render('profile-completion', {
        pageTitle: copy.auth.completeProfileTitle,
        countries: [...REGISTERED_COUNTRIES].map(([code, name]) => ({ code, name })),
        error: profile.error,
        values: req.body,
        csrfToken: res.locals.csrfToken
      });
    }
    try {
      const result = await db.query(
        `UPDATE users
         SET birth_date = $1, gender = $2, country = $3, country_code = $4,
             profile_completed_at = NOW(), updated_at = NOW()
         WHERE id = $5 AND deleted_at IS NULL AND profile_completed_at IS NULL
         RETURNING *`,
        [
          profile.birthDate,
          profile.gender,
          profile.country,
          profile.countryCode,
          sessionUserId(req)
        ]
      );
      if (!result.rowCount) return res.status(409).json({ error: copy.errors.profileAlreadyComplete });
      await db.query(
        `INSERT INTO security_events
           (actor_user_id, subject_user_id, event_type)
         VALUES ($1, $1, 'legacy_profile_completed')`,
        [sessionUserId(req)]
      );
      req.session.user = sessionUser(result.rows[0]);
      await saveSession(req);
      if (wantsJson(req)) return res.json({ user: publicSessionUser(req.session.user) });
      return res.redirect('/chat');
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/security', requireAuth, databaseRequired, async (req, res, next) => {
    try {
      const user = (await db.query(
        `SELECT role, email, email_verified_at, admin_2fa_enabled_at,
                password_hash IS NOT NULL AS has_password
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [sessionUserId(req)]
      )).rows[0];
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: copy.errors.adminRequired });
      }
      return res.render('admin-security', {
        pageTitle: copy.admin.securityTitle,
        user,
        hasPassword: Boolean(user.has_password),
        csrfToken: res.locals.csrfToken
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/verification/resend', databaseRequired, async (req, res, next) => {
    const email = normalizeEmail(req.body.email || req.session?.user?.email);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await deleteExpiredPendingRegistrations(client, { limit: 1, email });
      const user = (await client.query(
        `SELECT id, email, email_verified_at
         FROM users WHERE email = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [email]
      )).rows[0];
      if (user && !user.email_verified_at) {
        const recent = await client.query(
          `SELECT COUNT(*)::int AS count FROM account_tokens
           WHERE user_id = $1 AND purpose = 'verify_email'
             AND created_at > NOW() - INTERVAL '1 hour'`,
          [user.id]
        );
        if (recent.rows[0].count < 3) {
          await queueAccountEmail(client, {
            userId: user.id,
            purpose: 'verify_email',
            recipient: user.email,
            publicOrigin,
            sender: emailSender,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            metadataPepper
          });
        }
      }
      await client.query('COMMIT');
      return res.status(202).json({ message: copy.auth.genericEmailResponse });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });

  app.get('/verify-email/pending', requireAuth, databaseRequired, async (req, res, next) => {
    try {
      await deleteExpiredPendingRegistrationsTransaction(db, {
        limit: 1,
        userId: sessionUserId(req)
      });
      const user = (await db.query(
        'SELECT email_verified_at FROM users WHERE id = $1 AND deleted_at IS NULL',
        [sessionUserId(req)]
      )).rows[0];
      if (!user) return req.session.destroy(() => res.redirect('/login'));
      if (user.email_verified_at) {
        req.session.user.emailVerified = true;
        await saveSession(req);
        return res.redirect('/chat');
      }
      return renderAction(res, req, {
        title: copy.auth.verificationPendingTitle,
        message: copy.auth.verificationPendingBody,
        mode: 'verification-pending'
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/verify-email/resend', requireAuth, databaseRequired, async (req, res, next) => {
    if (req.session.user.emailVerified) return res.redirect('/chat');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await deleteExpiredPendingRegistrations(client, {
        limit: 1,
        userId: sessionUserId(req)
      });
      const user = (await client.query(
        `SELECT id, email, email_verified_at
         FROM users WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [sessionUserId(req)]
      )).rows[0];
      if (!user) {
        await client.query('COMMIT');
        return req.session.destroy(() => res.redirect('/login'));
      }
      if (user.email_verified_at) {
        await client.query('COMMIT');
        req.session.user.emailVerified = true;
        await saveSession(req);
        return res.redirect('/chat');
      }
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM account_tokens
         WHERE user_id = $1 AND purpose = 'verify_email'
           AND created_at > NOW() - INTERVAL '1 hour'`,
        [user.id]
      );
      if (recent.rows[0].count < 3) {
        await queueAccountEmail(client, {
          userId: user.id,
          purpose: 'verify_email',
          recipient: user.email,
          publicOrigin,
          sender: emailSender,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          metadataPepper
        });
      }
      await client.query('COMMIT');
      return renderAction(res, req, {
        title: copy.auth.verificationPendingTitle,
        message: copy.auth.verificationResentBody,
        mode: 'verification-pending',
        json: { verificationEmailQueued: true }
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });

  app.get('/verify-email', (req, res) => renderAction(res, req, {
    title: copy.auth.verifyEmailTitle,
    message: copy.auth.verifyEmailBody,
    mode: 'verify-email',
    token: cleanText(req.query.token, 100)
  }));

  app.post('/verify-email', databaseRequired, async (req, res, next) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const consumed = await consumeAccountToken(client, 'verify_email', req.body.token);
      if (consumed.status !== 'valid') {
        await client.query('COMMIT');
        return renderAction(res, req, {
          status: consumed.status === 'expired' ? 410 : 400,
          title: copy.auth.verificationFailedTitle,
          message: copy.auth.tokenState[consumed.status] || copy.auth.tokenState.invalid,
          json: { status: consumed.status }
        });
      }
      await client.query(
        `UPDATE users
         SET email_verified_at = NOW(), registration_pending_at = NULL, updated_at = NOW()
         WHERE id = $1 AND email = $2`,
        [consumed.token.user_id, consumed.token.target_email]
      );
      const finalizedClaim = await finalizeGuestAccountClaim(client, Number(consumed.token.user_id));
      await client.query('UPDATE account_tokens SET used_at = NOW() WHERE id = $1', [consumed.token.id]);
      await client.query(
        `UPDATE account_tokens SET revoked_at = NOW()
         WHERE user_id = $1 AND purpose = 'verify_email'
           AND id <> $2 AND used_at IS NULL AND revoked_at IS NULL`,
        [consumed.token.user_id, consumed.token.id]
      );
      await client.query('COMMIT');
      if (sessionUserId(req) === Number(consumed.token.user_id)) {
        req.session.user.emailVerified = true;
        if (finalizedClaim.status === 'claimed') {
          delete req.session.returnGuestPrincipalId;
          clearGuestSession(req.session);
        }
        await saveSession(req);
      }
      return renderAction(res, req, {
        title: copy.auth.verificationCompleteTitle,
        message: copy.auth.verificationCompleteBody,
        json: { status: 'verified', guestClaimed: finalizedClaim.status === 'claimed' },
        clearGuestProfile: finalizedClaim.status === 'claimed'
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });

  app.get('/forgot-password', (req, res) => renderAction(res, req, {
    title: copy.auth.forgotPasswordTitle,
    message: copy.auth.forgotPasswordBody,
    mode: 'request-reset'
  }));

  app.post('/forgot-password', databaseRequired, async (req, res, next) => {
    const email = normalizeEmail(req.body.email);
    try {
      const user = (await db.query(
        `SELECT id FROM users
         WHERE email = $1 AND deleted_at IS NULL
           AND email_verified_at IS NOT NULL
           AND password_hash IS NOT NULL`,
        [email]
      )).rows[0];
      if (user) {
        const recent = await db.query(
          `SELECT COUNT(*)::int AS count FROM account_tokens
           WHERE user_id = $1 AND purpose = 'password_reset'
             AND created_at > NOW() - INTERVAL '1 hour'`,
          [user.id]
        );
        if (recent.rows[0].count < 3) {
          await queueAccountEmailTransaction(db, {
            userId: user.id,
            purpose: 'password_reset',
            recipient: email,
            publicOrigin,
            sender: emailSender,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            metadataPepper
          });
        }
      }
      return renderAction(res, req, {
        status: 202,
        title: copy.auth.emailSentTitle,
        message: copy.auth.genericEmailResponse,
        json: { message: copy.auth.genericEmailResponse }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/reset-password', (req, res) => renderAction(res, req, {
    title: copy.auth.resetPasswordTitle,
    message: copy.auth.resetPasswordBody,
    mode: 'reset-password',
    token: cleanText(req.query.token, 100)
  }));

  app.get('/add-password', (req, res) => renderAction(res, req, {
    title: copy.auth.passwordSetupTitle,
    message: copy.auth.passwordSetupBody,
    mode: 'add-password',
    token: cleanText(req.query.token, 100)
  }));

  const completePasswordToken = (purpose, completion) => async (req, res, next) => {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: copy.errors.passwordLength });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const consumed = await consumeAccountToken(client, purpose, req.body.token);
      if (consumed.status !== 'valid') {
        await client.query('COMMIT');
        return res.status(consumed.status === 'expired' ? 410 : 400)
          .json({ error: copy.auth.tokenState[consumed.status] || copy.auth.tokenState.invalid });
      }
      const user = (await client.query(
        `SELECT u.id, u.email, u.email_verified_at, u.password_hash,
                EXISTS(
                  SELECT 1 FROM account_identities identity
                  WHERE identity.user_id = u.id AND identity.provider = 'google'
                ) AS has_google
         FROM users u
         WHERE u.id = $1 AND u.deleted_at IS NULL
         FOR UPDATE OF u`,
        [consumed.token.user_id]
      )).rows[0];
      const setupAllowed = purpose !== 'password_setup'
        || (user?.email_verified_at
          && !user.password_hash
          && user.has_google
          && user.email === consumed.token.target_email);
      if (!user || !setupAllowed) {
        await client.query('COMMIT');
        return res.status(409).json({ error: copy.auth.tokenState.invalid });
      }
      const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, consumed.token.user_id]
      );
      await client.query('UPDATE account_tokens SET used_at = NOW() WHERE id = $1', [consumed.token.id]);
      await revokeUserSessions(db, consumed.token.user_id, { client });
      await client.query('COMMIT');
      return req.session.destroy(() => {
        if (wantsJson(req)) return res.json({ status: completion.status });
        return res.render('auth-action', {
          pageTitle: completion.title,
          title: completion.title,
          message: completion.message,
          mode: 'message',
          token: '',
          error: null
        });
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  };

  app.post('/reset-password', databaseRequired, completePasswordToken('password_reset', {
    status: 'password-reset',
    title: copy.auth.passwordResetCompleteTitle,
    message: copy.auth.passwordResetCompleteBody
  }));

  app.post('/add-password', databaseRequired, completePasswordToken('password_setup', {
    status: 'password-added',
    title: copy.auth.passwordSetupCompleteTitle,
    message: copy.auth.passwordSetupCompleteBody
  }));

  app.post('/api/account/password', requireAuth, databaseRequired, async (req, res, next) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 72) {
      return res.status(400).json({ error: copy.errors.passwordLength });
    }
    try {
      const userId = sessionUserId(req);
      const user = (await db.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0];
      if (!user?.password_hash || !await bcrypt.compare(currentPassword, user.password_hash)) {
        return res.status(401).json({ error: copy.errors.credentialsIncorrect });
      }
      const passwordHash = await bcrypt.hash(newPassword, PASSWORD_ROUNDS);
      await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
        passwordHash,
        userId
      ]);
      await revokeUserSessions(db, userId);
      return req.session.destroy(() => res.status(204).end());
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/account/password/setup', requireAuth, requireVerifiedEmail, databaseRequired, async (req, res, next) => {
    try {
      const userId = sessionUserId(req);
      const user = (await db.query(
        `SELECT email, email_verified_at, password_hash
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      )).rows[0];
      if (!user || !user.email_verified_at) {
        return res.status(403).json({ error: copy.errors.emailVerificationRequired });
      }
      if (user.password_hash) {
        return res.status(409).json({ error: copy.errors.passwordAlreadySet });
      }
      const recent = await db.query(
        `SELECT COUNT(*)::int AS count FROM account_tokens
         WHERE user_id = $1 AND purpose = 'password_setup'
           AND created_at > NOW() - INTERVAL '1 hour'`,
        [userId]
      );
      if (recent.rows[0].count < 3) {
        await queueAccountEmailTransaction(db, {
          userId,
          purpose: 'password_setup',
          recipient: user.email,
          publicOrigin,
          sender: emailSender,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          metadataPepper
        });
      }
      return res.status(202).json({ message: copy.auth.passwordSetupQueued });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/account/email-change', requireAuth, databaseRequired, async (req, res, next) => {
    const targetEmail = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!isValidEmail(targetEmail)) return res.status(400).json({ error: copy.errors.emailInvalid });
    try {
      const userId = sessionUserId(req);
      const user = (await db.query(
        'SELECT email, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
        [userId]
      )).rows[0];
      if (!user?.password_hash || !await bcrypt.compare(password, user.password_hash)) {
        return res.status(401).json({ error: copy.errors.credentialsIncorrect });
      }
      const conflict = await db.query(
        'SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL',
        [targetEmail, userId]
      );
      if (conflict.rowCount) return res.status(409).json({ error: copy.errors.emailInUse });
      await queueAccountEmailTransaction(db, {
        userId,
        purpose: 'email_change',
        recipient: targetEmail,
        publicOrigin,
        sender: emailSender,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        metadataPepper
      });
      return res.status(202).json({ message: copy.auth.emailChangeQueued });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/confirm-email-change', (req, res) => renderAction(res, req, {
    title: copy.auth.confirmEmailTitle,
    message: copy.auth.confirmEmailBody,
    mode: 'confirm-email',
    token: cleanText(req.query.token, 100)
  }));

  app.post('/confirm-email-change', databaseRequired, async (req, res, next) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const consumed = await consumeAccountToken(client, 'email_change', req.body.token);
      if (consumed.status !== 'valid') {
        await client.query('COMMIT');
        return res.status(consumed.status === 'expired' ? 410 : 400)
          .json({ error: copy.auth.tokenState[consumed.status] || copy.auth.tokenState.invalid });
      }
      const user = (await client.query(
        'SELECT email FROM users WHERE id = $1 FOR UPDATE',
        [consumed.token.user_id]
      )).rows[0];
      const conflict = await client.query(
        'SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL',
        [consumed.token.target_email, consumed.token.user_id]
      );
      if (conflict.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: copy.errors.emailInUse });
      }
      await client.query(
        `UPDATE users
         SET email = $1, email_verified_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [consumed.token.target_email, consumed.token.user_id]
      );
      await client.query('UPDATE account_tokens SET used_at = NOW() WHERE id = $1', [consumed.token.id]);
      await revokeUserSessions(db, consumed.token.user_id, { client });
      await client.query(
        `INSERT INTO email_outbox
           (user_id, purpose, idempotency_key, recipient, sender, subject, text_body, html_body)
         VALUES ($1, 'email_change_notice', $2, $3, $4, $5, $6, $7)`,
        [
          consumed.token.user_id,
          `email-change-notice:${consumed.token.id}`,
          user.email,
          emailSender,
          'Your Nevely email address changed',
          'Your Nevely account email address was changed. Contact support@nevely.app immediately if this was not you.',
          '<p>Your Nevely account email address was changed.</p><p>Contact support@nevely.app immediately if this was not you.</p>'
        ]
      );
      await client.query('COMMIT');
      return req.session.destroy(() => {
        if (wantsJson(req)) {
          return res.json({ status: 'email-changed', redirect: '/login?email-changed=1' });
        }
        return res.redirect('/login?email-changed=1');
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });

  app.post('/auth/google', databaseRequired, async (req, res, next) => {
    if (!environment.GOOGLE_CLIENT_ID && !options.googleVerifier) {
      return res.status(503).json({ error: copy.errors.googleUnavailable });
    }
    try {
      const nonce = req.session.googleNonce;
      const google = await googleVerifier(req.body.credential, { nonce });
      const tokenDigest = hashToken(req.body.credential);
      await db.query('DELETE FROM google_token_replays WHERE expires_at <= NOW()');
      try {
        await db.query(
          'INSERT INTO google_token_replays (token_hash, expires_at) VALUES ($1, $2)',
          [tokenDigest, google.expiresAt]
        );
      } catch (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: copy.errors.googleReplay });
        }
        throw error;
      }

      const identity = await db.query(
        `SELECT u.* FROM account_identities ai
         JOIN users u ON u.id = ai.user_id
         WHERE ai.provider = 'google' AND ai.provider_subject = $1
           AND u.deleted_at IS NULL`,
        [google.subject]
      );
      if (identity.rowCount) {
        const user = identity.rows[0];
        const activeBan = await findActiveBan(db, user.id, req.ip);
        if (activeBan.rowCount) {
          await revokeUserSessions(db, user.id);
          await establishSuspendedSession(req, user.id, activeBan.rows[0]);
          return res.status(403).json({ error: copy.errors.accountSuspended, ...suspensionPayload(activeBan.rows[0]) });
        }
        await db.query(
          `UPDATE account_identities SET last_used_at = NOW(), provider_email = $1
           WHERE provider = 'google' AND provider_subject = $2`,
          [google.email, google.subject]
        );
        await db.query('UPDATE users SET last_ip = $1, last_seen_at = NOW() WHERE id = $2', [req.ip, user.id]);
        const returnGuest = await activeGuestForSession(db, req);
        if (user.role === 'admin' && user.admin_2fa_enabled_at) {
          await beginAdminTwoFactorChallenge(req, user.id, { restoreGuestId: returnGuest?.id || null });
          return res.status(202).json({ twoFactorRequired: true });
        }
        const safeUser = await establishSession(req, user, {
          restoreGuestId: returnGuest?.id || null
        });
        return res.json({
          user: safeUser,
          profileCompletionRequired: !safeUser.profileComplete,
          adminTwoFactorSetupRequired: safeUser.role === 'admin'
            && !safeUser.adminTwoFactorEnabled
        });
      }

      const emailOwner = await db.query(
        'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
        [google.email]
      );
      if (emailOwner.rowCount) {
        return res.status(409).json({
          error: copy.errors.googleLinkRequired,
          code: 'GOOGLE_LINK_REQUIRED'
        });
      }

      const sessionGuest = await activeGuestForSession(db, req);
      const claimGuest = claimRequested(req.body.claim) ? sessionGuest : null;
      const claimMode = Boolean(claimGuest);
      const profile = claimMode ? registrationProfileFromGuest(claimGuest, req.body.username) : normalizeRegisteredProfile(req.body);
      const username = claimMode ? profile?.username : normalizeUsername(req.body.username);
      if (!profile || profile.error || !username) {
        const suppliedProfileData = [
          req.body.username,
          req.body.birthDate,
          req.body.gender,
          req.body.countryCode
        ].some((value) => cleanText(value, 30).length > 0);
        const invalidCompletion = req.body.profileCompletion === '1' && suppliedProfileData;
        return res.status(422).json({
          error: invalidCompletion
            ? profile?.error || copy.errors.usernameLength
            : copy.errors.googleRegistrationProfileRequired,
          code: invalidCompletion ? 'GOOGLE_PROFILE_INVALID' : 'GOOGLE_PROFILE_REQUIRED'
        });
      }
      const returnGuest = claimMode ? null : sessionGuest;
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM account_identities identity
           USING users deleted_user
           WHERE identity.user_id = deleted_user.id
             AND identity.provider = 'google'
             AND identity.provider_subject = $1
             AND deleted_user.deleted_at IS NOT NULL`,
          [google.subject]
        );
        const existingUsername = await client.query(
          'SELECT 1 FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
          [username]
        );
        if (existingUsername.rowCount) {
          const unavailable = new Error(copy.errors.usernameTaken || 'This username is already in use.');
          unavailable.code = 'USERNAME_TAKEN';
          throw unavailable;
        }
        const created = await insertWithUniquePublicId(client, 'user', (publicId) => client.query(
           `INSERT INTO users
              (username, email, password_hash, public_id, display_alias, display_name,
               birth_date, age, gender, country, country_code, profile_completed_at,
               email_verified_at, profile_image_url, last_ip)
            VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11, $12)
           RETURNING *`,
          [
            username,
            google.email,
            publicId,
            makeDisplayAlias(),
            claimMode ? profile.displayName : cleanText(google.name, 40) || username,
            profile.birthDate,
            profile.age,
            profile.gender,
            profile.country,
            profile.countryCode,
            claimMode ? null : randomPresetAvatarUrl(),
            req.ip
          ]
        ));
        await client.query(
          `INSERT INTO account_identities
             (user_id, provider, provider_subject, provider_email)
           VALUES ($1, 'google', $2, $3)`,
          [created.rows[0].id, google.subject, google.email]
        );
        if (claimMode) {
          const claim = await createGuestAccountClaim(client, {
            guestId: claimGuest.id,
            userId: Number(created.rows[0].id)
          });
          if (!claim) {
            const unavailable = new Error(copy.errors.guestClaimUnavailable);
            unavailable.code = 'GUEST_CLAIM_UNAVAILABLE';
            throw unavailable;
          }
          const finalizedClaim = await finalizeGuestAccountClaim(client, Number(created.rows[0].id));
          if (finalizedClaim.status !== 'claimed') {
            const unavailable = new Error(copy.errors.guestClaimUnavailable);
            unavailable.code = 'GUEST_CLAIM_UNAVAILABLE';
            throw unavailable;
          }
        }
        await client.query('COMMIT');
        const safeUser = await establishSession(req, created.rows[0], {
          restoreGuestId: returnGuest?.id || null
        });
        return res.status(201).json({ user: safeUser, guestClaimed: claimMode });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === 'USERNAME_TAKEN') {
          return res.status(409).json({ error: error.message, code: error.code });
        }
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: copy.errors.identityTaken });
      if (error.code === 'GUEST_CLAIM_UNAVAILABLE') {
        return res.status(409).json({ error: error.message, code: 'GUEST_CLAIM_UNAVAILABLE' });
      }
      if (/Google credential|Google signing|Malformed|Unsupported|Unknown/.test(error.message)) {
        return res.status(401).json({ error: copy.errors.googleInvalid });
      }
      return next(error);
    }
  });

  app.post('/api/account/identities/google', requireAuth, databaseRequired, async (req, res, next) => {
    if (!environment.GOOGLE_CLIENT_ID && !options.googleVerifier) {
      return res.status(503).json({ error: copy.errors.googleUnavailable });
    }
    try {
      const google = await googleVerifier(req.body.credential, {
        nonce: req.session.googleNonce
      });
      const userId = sessionUserId(req);
      const user = (await db.query(
        'SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL',
        [userId]
      )).rows[0];
      if (!user || user.email !== google.email) {
        return res.status(409).json({ error: copy.errors.googleEmailMismatch });
      }
      await db.query(
        `INSERT INTO account_identities
           (user_id, provider, provider_subject, provider_email)
         VALUES ($1, 'google', $2, $3)`,
        [userId, google.subject, google.email]
      );
      return res.status(201).json({ linked: true });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: copy.errors.googleIdentityInUse });
      if (/Google credential|Google signing|Malformed|Unsupported|Unknown/.test(error.message)) {
        return res.status(401).json({ error: copy.errors.googleInvalid });
      }
      return next(error);
    }
  });

  app.delete('/api/account/identities/google', requireAuth, databaseRequired, async (req, res, next) => {
    try {
      const userId = sessionUserId(req);
      const user = (await db.query(
        `SELECT email, password_hash,
                EXISTS(SELECT 1 FROM account_identities WHERE user_id = users.id AND provider = 'google') AS has_google
         FROM users WHERE id = $1`,
        [userId]
      )).rows[0];
      if (!user?.has_google) return res.status(404).json({ error: copy.errors.googleIdentityMissing });
      if (!user.password_hash) {
        return res.status(409).json({ error: copy.errors.googleOnlyLogin });
      }
      if (!await bcrypt.compare(String(req.body.password || ''), user.password_hash)) {
        return res.status(401).json({ error: copy.errors.credentialsIncorrect });
      }
      await db.query(
        `DELETE FROM account_identities WHERE user_id = $1 AND provider = 'google'`,
        [userId]
      );
      return res.json({
        user: {
          email: user.email,
          hasGoogle: false,
          hasPassword: true
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/reauth', requireAuth, databaseRequired, async (req, res, next) => {
    try {
      const userId = sessionUserId(req);
      const user = (await db.query(
        `SELECT role, password_hash, admin_totp_secret, admin_2fa_enabled_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      )).rows[0];
      if (!user || user.role !== 'admin') return res.status(403).json({ error: copy.errors.adminRequired });
      let primaryFactorValid = false;
      if (user.password_hash) {
        primaryFactorValid = await bcrypt.compare(
          String(req.body.password || ''),
          user.password_hash
        );
      } else if ((environment.GOOGLE_CLIENT_ID || options.googleVerifier)
        && req.session.adminGoogleReauthNonce) {
        try {
          const google = await googleVerifier(req.body.credential, {
            nonce: req.session.adminGoogleReauthNonce
          });
          const tokenDigest = hashToken(req.body.credential);
          await db.query('DELETE FROM google_token_replays WHERE expires_at <= NOW()');
          try {
            await db.query(
              'INSERT INTO google_token_replays (token_hash, expires_at) VALUES ($1, $2)',
              [tokenDigest, google.expiresAt]
            );
          } catch (error) {
            if (error.code !== '23505') throw error;
            return res.status(401).json({ error: copy.errors.adminReauthenticationFailed });
          }
          const identity = await db.query(
            `SELECT 1 FROM account_identities
             WHERE user_id = $1 AND provider = 'google' AND provider_subject = $2`,
            [userId, google.subject]
          );
          primaryFactorValid = Boolean(identity.rowCount);
          if (primaryFactorValid) {
            await db.query(
              `UPDATE account_identities
               SET last_used_at = NOW(), provider_email = $1
               WHERE user_id = $2 AND provider = 'google' AND provider_subject = $3`,
              [google.email, userId, google.subject]
            );
          }
        } catch (error) {
          if (!/Google credential|Google signing|Malformed|Unsupported|Unknown/.test(error.message)) {
            throw error;
          }
        }
      }
      const secret = user.admin_totp_secret
        ? decryptSecret(user.admin_totp_secret, totpEncryptionKey)
        : null;
      if (!primaryFactorValid || !secret || !verifyTotp(secret, req.body.code)) {
        return res.status(401).json({ error: copy.errors.adminReauthenticationFailed });
      }
      delete req.session.adminGoogleReauthNonce;
      const verifiedAt = Date.now();
      req.session.adminReauthenticatedAt = verifiedAt;
      req.session.adminTwoFactorVerifiedAt = verifiedAt;
      await saveSession(req);
      return res.json({ expiresAt: new Date(verifiedAt + 10 * 60 * 1000).toISOString() });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/2fa/setup', requireAuth, databaseRequired, async (req, res, next) => {
    try {
      const userId = sessionUserId(req);
      const user = (await db.query(
        'SELECT email, role, password_hash, admin_2fa_enabled_at FROM users WHERE id = $1',
        [userId]
      )).rows[0];
      if (!user || user.role !== 'admin') return res.status(403).json({ error: copy.errors.adminRequired });
      if (user.admin_2fa_enabled_at) return res.status(409).json({ error: copy.errors.twoFactorAlreadyEnabled });
      if (user.password_hash
        && !await bcrypt.compare(String(req.body.password || ''), user.password_hash)) {
        return res.status(401).json({ error: copy.errors.credentialsIncorrect });
      }
      const secret = createTotpSecret();
      req.session.pendingAdminTotpSecret = encryptSecret(secret, totpEncryptionKey);
      await saveSession(req);
      const label = encodeURIComponent(`Nevely:${user.email}`);
      const issuer = encodeURIComponent('Nevely');
      return res.json({
        secret,
        otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/2fa/confirm', requireAuth, databaseRequired, async (req, res, next) => {
    try {
      const encrypted = req.session.pendingAdminTotpSecret;
      if (!encrypted) return res.status(409).json({ error: copy.errors.twoFactorSetupMissing });
      const secret = decryptSecret(encrypted, totpEncryptionKey);
      if (!verifyTotp(secret, req.body.code)) {
        return res.status(401).json({ error: copy.errors.twoFactorInvalid });
      }
      const userId = sessionUserId(req);
      const enabled = await db.query(
        `UPDATE users
         SET admin_totp_secret = $1, admin_2fa_enabled_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND role = 'admin'`,
        [encrypted, userId]
      );
      if (!enabled.rowCount) return res.status(403).json({ error: copy.errors.adminRequired });
      await revokeUserSessions(db, userId);
      const refreshed = (await db.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
      await establishSession(req, refreshed, { twoFactorVerified: true });
      req.session.adminReauthenticatedAt = Date.now();
      await saveSession(req);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  REGISTERED_COUNTRIES,
  REGISTERED_GENDERS,
  ageFromBirthDate,
  cleanText,
  createAuthLimiter,
  createRequireAdmin,
  makePublicId,
  normalizeRegisteredProfile,
  publicSessionUser,
  registerAuthRoutes,
  requireAuth,
  requireVerifiedEmail,
  sessionUser,
  wantsJson
};
