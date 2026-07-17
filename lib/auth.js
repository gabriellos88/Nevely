const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const PASSWORD_ROUNDS = 12;

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeEmail(value) {
  return cleanText(value, 255).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function makePublicId() {
  return `Nevely#${crypto.randomBytes(3).toString('hex')}`;
}

function sessionUser(row) {
  return {
    id: Number(row.id),
    publicId: row.public_id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    plan: row.plan,
    age: row.age,
    gender: row.gender,
    country: row.country,
    profileImageUrl: row.profile_image_url
  };
}

function wantsJson(req) {
  return req.is('application/json') || req.get('accept')?.includes('application/json');
}

function sendAuthError(req, res, status, message, mode) {
  if (wantsJson(req)) return res.status(status).json({ error: message });
  return res.status(status).render('auth-stub', {
    pageTitle: mode === 'login' ? 'Log In' : 'Create Account',
    mode,
    error: message,
    values: { username: req.body.username || '', email: req.body.email || '' }
  });
}

function requireDatabase(db) {
  return (req, res, next) => {
    if (db.isConfigured) return next();
    return res.status(503).json({ error: 'Database unavailable.' });
  };
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (wantsJson(req) || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'An account is required.' });
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Administrator access required.' });
}

function createAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' }
  });
}

function registerAuthRoutes(app, db) {
  const databaseRequired = requireDatabase(db);

  app.get('/register', (req, res) => {
    if (req.session?.user) return res.redirect('/chat');
    return res.render('auth-stub', {
      pageTitle: 'Create Account', mode: 'register', error: null, values: {}
    });
  });

  app.get('/login', (req, res) => {
    if (req.session?.user) return res.redirect('/chat');
    return res.render('auth-stub', {
      pageTitle: 'Log In', mode: 'login', error: null, values: {}
    });
  });

  app.post('/register', async (req, res, next) => {
    if (!db.isConfigured) return res.status(503).send('Database unavailable.');
    const username = cleanText(req.body.username, 30);
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (username.length < 3) return sendAuthError(req, res, 400, 'Username must contain at least 3 characters.', 'register');
    if (!isValidEmail(email)) return sendAuthError(req, res, 400, 'Enter a valid email address.', 'register');
    if (password.length < 8 || password.length > 72) return sendAuthError(req, res, 400, 'Password must contain between 8 and 72 characters.', 'register');

    try {
      const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
      const result = await db.query(
        `INSERT INTO users (username, email, password_hash, public_id, display_name, last_ip)
         VALUES ($1, $2, $3, $4, $1, $5)
         RETURNING *`,
        [username, email, passwordHash, makePublicId(), req.ip]
      );
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = sessionUser(result.rows[0]);
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          if (wantsJson(req)) return res.status(201).json({ user: req.session.user });
          return res.redirect('/chat');
        });
      });
    } catch (error) {
      if (error.code === '23505') return sendAuthError(req, res, 409, 'That username or email is already in use.', 'register');
      return next(error);
    }
  });

  app.post('/login', async (req, res, next) => {
    if (!db.isConfigured) return res.status(503).send('Database unavailable.');
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    try {
      const result = await db.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1', [email]);
      const user = result.rows[0];
      const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
      if (!valid) return sendAuthError(req, res, 401, 'Email or password is incorrect.', 'login');

      const ban = await db.query(
        `SELECT id FROM bans
         WHERE (user_id = $1 OR (type = 'ip' AND ip_address = $2))
           AND (type IN ('permanent', 'ip') OR ends_at > NOW())
         ORDER BY created_at DESC LIMIT 1`,
        [user.id, req.ip]
      );
      if (ban.rowCount) return sendAuthError(req, res, 403, 'This account is currently suspended.', 'login');

      await db.query('UPDATE users SET last_ip = $1 WHERE id = $2', [req.ip, user.id]);

      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = sessionUser(user);
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          if (wantsJson(req)) return res.json({ user: req.session.user });
          return res.redirect('/chat');
        });
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/logout', (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('nevely.sid');
      if (wantsJson(req)) return res.status(204).end();
      return res.redirect('/');
    });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: req.session?.user || null });
  });
}

module.exports = {
  cleanText,
  createAuthLimiter,
  registerAuthRoutes,
  requireAdmin,
  requireAuth,
  sessionUser,
  wantsJson
};
