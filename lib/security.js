const crypto = require('crypto');
const copy = require('../public/i18n/en.json');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_REAUTH_WINDOW_MS = 10 * 60 * 1000;

function timingSafeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function csrfProtection({ publicOrigin }) {
  const allowedOrigin = (() => {
    try {
      return new URL(publicOrigin || 'http://localhost:3000').origin;
    } catch {
      return 'http://localhost:3000';
    }
  })();

  return (req, res, next) => {
    if (!req.session.csrfToken) req.session.csrfToken = createCsrfToken();
    res.locals.csrfToken = req.session.csrfToken;
    res.set('X-CSRF-Token', req.session.csrfToken);
    if (SAFE_METHODS.has(req.method)) return next();

    const fetchSite = req.get('sec-fetch-site');
    const origin = req.get('origin');
    const referer = req.get('referer');
    const browserRequest = Boolean(fetchSite || origin || referer);
    if (fetchSite === 'cross-site') {
      return res.status(403).json({ error: copy.errors.csrfRejected });
    }
    if (origin && origin !== allowedOrigin) {
      return res.status(403).json({ error: copy.errors.csrfRejected });
    }
    if (!origin && referer) {
      try {
        if (new URL(referer).origin !== allowedOrigin) {
          return res.status(403).json({ error: copy.errors.csrfRejected });
        }
      } catch {
        return res.status(403).json({ error: copy.errors.csrfRejected });
      }
    }

    const supplied = req.get('x-csrf-token') || req.body?._csrf;
    if (browserRequest && !timingSafeEqual(supplied, req.session.csrfToken)) {
      return res.status(403).json({ error: copy.errors.csrfRejected });
    }
    return next();
  };
}

function secureHeaders({ googleEnabled = false } = {}) {
  const frameSources = ["'none'"];
  const connectSources = ["'self'"];
  if (googleEnabled) {
    frameSources.push('https://accounts.google.com');
    connectSources.push('https://accounts.google.com');
  }

  return (req, res, next) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.cspNonce = nonce;
    const scriptSources = ["'self'", `'nonce-${nonce}'`];
    const imageSources = ["'self'", 'data:', 'blob:'];
    if (googleEnabled) {
      scriptSources.push('https://accounts.google.com');
      imageSources.push('https://lh3.googleusercontent.com');
    }
    const contentSecurityPolicy = [
      "default-src 'self'",
      `script-src ${scriptSources.join(' ')}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src ${imageSources.join(' ')}`,
      `connect-src ${connectSources.join(' ')}`,
      `frame-src ${frameSources.join(' ')}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests'
    ].join('; ');
    res.set({
      'Content-Security-Policy': contentSecurityPolicy,
      'Cross-Origin-Opener-Policy': googleEnabled ? 'same-origin-allow-popups' : 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    next();
  };
}

function sessionUserId(req) {
  return Number(req.session?.user?.internalId || req.session?.user?.id) || null;
}

async function revokeUserSessions(db, userId, { exceptSid = null, client = null } = {}) {
  const executor = client || db;
  await executor.query(
    'UPDATE users SET session_version = session_version + 1, updated_at = NOW() WHERE id = $1',
    [userId]
  );
  const params = [String(userId)];
  let exception = '';
  if (exceptSid) {
    params.push(exceptSid);
    exception = ' AND sid <> $2';
  }
  await executor.query(
    `DELETE FROM session
     WHERE COALESCE(sess::jsonb #>> '{user,internalId}', sess::jsonb #>> '{user,id}') = $1${exception}`,
    params
  );
}

function requireRecentAdminAuth(req, res, next) {
  const authenticatedAt = Number(req.session?.adminReauthenticatedAt);
  if (authenticatedAt && Date.now() - authenticatedAt <= ADMIN_REAUTH_WINDOW_MS) return next();
  return res.status(401).json({
    error: copy.errors.adminReauthenticationRequired,
    code: 'ADMIN_REAUTH_REQUIRED'
  });
}

module.exports = {
  ADMIN_REAUTH_WINDOW_MS,
  csrfProtection,
  requireRecentAdminAuth,
  revokeUserSessions,
  secureHeaders,
  sessionUserId,
  timingSafeEqual
};
