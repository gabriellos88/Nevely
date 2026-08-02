const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const COOKIE_NAME = 'nevely.preview';
const COOKIE_VERSION = 'v1';
const PREVIEW_PATH = '/preview-access';

function normalizedEnabled(rawValue) {
  const value = String(rawValue || 'false').trim().toLowerCase();
  if (value !== 'true' && value !== 'false') {
    throw new Error('PRIVATE_PREVIEW_ENABLED must be true or false.');
  }
  return value === 'true';
}

function validatedPasswordHash(rawValue) {
  const value = String(rawValue || '').trim();
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)) {
    throw new Error('PRIVATE_PREVIEW_PASSWORD_HASH must be a valid bcrypt hash.');
  }
  const rounds = bcrypt.getRounds(value);
  if (rounds < 10 || rounds > 15) {
    throw new Error('PRIVATE_PREVIEW_PASSWORD_HASH must use 10 to 15 bcrypt rounds.');
  }
  return value;
}

function safeReturnTo(rawValue) {
  if (typeof rawValue !== 'string') return '/';
  const value = rawValue.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const base = new URL('https://preview.invalid');
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin || parsed.pathname === PREVIEW_PATH) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function cookieValue(header, name) {
  if (typeof header !== 'string' || !header) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function accessToken(passwordHash, secret) {
  return `${COOKIE_VERSION}.${crypto
    .createHmac('sha256', secret)
    .update(`nevely-private-preview:${COOKIE_VERSION}:${passwordHash}`)
    .digest('base64url')}`;
}

function timingSafeTokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createPrivatePreview({ environment, copy }) {
  const enabled = normalizedEnabled(environment.PRIVATE_PREVIEW_ENABLED);
  if (!enabled) {
    return {
      enabled: false,
      registerHttp() {},
      registerSocket() {}
    };
  }

  const passwordHash = validatedPasswordHash(environment.PRIVATE_PREVIEW_PASSWORD_HASH);
  const secret = environment.SESSION_SECRET || 'local-development-only-change-me';
  const expectedToken = accessToken(passwordHash, secret);
  const secureCookie = environment.NODE_ENV === 'production';

  function hasAccessFromHeader(cookieHeader) {
    return timingSafeTokenEqual(cookieValue(cookieHeader, COOKIE_NAME), expectedToken);
  }

  function renderPage(req, res, { status = 401, error = null, returnTo } = {}) {
    res.set({
      'Cache-Control': 'no-store',
      Vary: 'Cookie'
    });
    return res.status(status).render('work-in-progress', {
      pageTitle: copy.pageTitles.privatePreview,
      error,
      returnTo: safeReturnTo(returnTo ?? req.originalUrl),
      csrfToken: res.locals.csrfToken
    });
  }

  function registerHttp(app) {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      handler: (req, res) => renderPage(req, res, {
        status: 429,
        error: copy.privatePreview.tooManyAttempts,
        returnTo: req.body?.returnTo
      })
    });

    app.get(PREVIEW_PATH, (req, res) => {
      if (hasAccessFromHeader(req.get('cookie'))) return res.redirect('/');
      return renderPage(req, res, { returnTo: req.query.returnTo });
    });

    app.post(PREVIEW_PATH, limiter, async (req, res, next) => {
      try {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const valid = Buffer.byteLength(password, 'utf8') <= 72
          && await bcrypt.compare(password, passwordHash);
        if (!valid) {
          return renderPage(req, res, {
            error: copy.privatePreview.invalidPassword,
            returnTo: req.body?.returnTo
          });
        }

        res.cookie(COOKIE_NAME, expectedToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: secureCookie,
          path: '/'
        });
        return res.redirect(303, safeReturnTo(req.body?.returnTo));
      } catch (error) {
        return next(error);
      }
    });

    app.use((req, res, next) => {
      if (hasAccessFromHeader(req.get('cookie'))) return next();
      if (req.path.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) {
        res.set('Cache-Control', 'no-store');
        return res.status(401).json({
          error: copy.privatePreview.accessRequired,
          code: 'PRIVATE_PREVIEW_REQUIRED'
        });
      }
      return renderPage(req, res);
    });
  }

  function requireSocketAccess(socket, next) {
    if (hasAccessFromHeader(socket.handshake.headers.cookie)) return next();
    const error = new Error(copy.privatePreview.accessRequired);
    error.data = { code: 'PRIVATE_PREVIEW_REQUIRED' };
    return next(error);
  }

  function registerSocket(io) {
    io.use(requireSocketAccess);
  }

  return {
    enabled: true,
    hasAccessFromHeader,
    requireSocketAccess,
    registerHttp,
    registerSocket
  };
}

module.exports = {
  COOKIE_NAME,
  createPrivatePreview,
  safeReturnTo
};
