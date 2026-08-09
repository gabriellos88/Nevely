require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');
const { createAuthLimiter, publicSessionUser, registerAuthRoutes } = require('./lib/auth');
const { createOutboxWorker } = require('./lib/account-email');
const { registerApiRoutes } = require('./lib/api');
const { registerChat } = require('./lib/chat');
const { findActiveGuestPrincipal, guestPassportComplete } = require('./lib/guest-principals');
const { createPresence } = require('./lib/presence');
const { createModerationService } = require('./lib/moderation');
const { createModerationControlChannel } = require('./lib/moderation-control');
const { createRetentionWorker } = require('./lib/retention');
const { csrfProtection, secureHeaders } = require('./lib/security');
const { createPrivatePreview } = require('./lib/private-preview');
const { trustApplicationProxy, trustedClientAddress } = require('./lib/client-address');
const safeLog = require('./lib/safe-log');
const uiCopy = require('./public/i18n/en.json');

const GUEST_CHAT_DURATION_SECONDS = 120;
const DEFAULT_SHUTDOWN_GRACE_MS = 25_000;
const DATABASE_HEALTH_TIMEOUT_MS = 2_000;

function boundedGracePeriod(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return DEFAULT_SHUTDOWN_GRACE_MS;
  return Math.min(Math.max(Math.trunc(value), 1_000), 120_000);
}

function createRuntime(options = {}) {
  const environment = options.env || process.env;
  const db = options.db || require('./db');
  const log = options.log || safeLog;
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const isProduction = environment.NODE_ENV === 'production';
  const shutdownGraceMs = boundedGracePeriod(environment.SHUTDOWN_GRACE_MS);
  const lifecycle = { phase: 'starting' };
  let shutdownPromise = null;
  let removeSignalHandlers = null;

  app.disable('x-powered-by');
  app.set('trust proxy', trustApplicationProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.copy = uiCopy;
  app.use(secureHeaders({ googleEnabled: Boolean(environment.GOOGLE_CLIENT_ID) }));

  if (environment.ROBOTS_INDEXING !== 'enabled') {
    app.use((req, res, next) => {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      next();
    });
  }

  app.get('/health/live', (req, res) => {
    const healthy = lifecycle.phase !== 'stopped';
    return res.status(healthy ? 200 : 503).json({ status: healthy ? 'live' : 'stopped' });
  });

  async function databaseReady() {
    if (!db.isConfigured) return false;
    let timeout;
    try {
      await Promise.race([
        db.query('SELECT 1 AS ready'),
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new Error('Database readiness timed out');
            error.code = 'DB_READY_TIMEOUT';
            reject(error);
          }, DATABASE_HEALTH_TIMEOUT_MS);
        })
      ]);
      return true;
    } catch (error) {
      log.error('health.database_not_ready', error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  app.get('/health/ready', async (req, res) => {
    if (lifecycle.phase !== 'ready') {
      return res.status(503).json({ status: 'not-ready' });
    }
    const ready = await databaseReady();
    return res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready' });
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    if (environment.ROBOTS_INDEXING !== 'enabled') {
      return res.send('User-agent: *\nDisallow: /\n');
    }
    return res.send('User-agent: *\nAllow: /\n');
  });

  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  if (isProduction && (!environment.DATABASE_URL || !db.isConfigured)) {
    throw new Error('DATABASE_URL must be configured in production.');
  }
  if (isProduction && (!environment.SESSION_SECRET || environment.SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET with at least 32 characters must be configured in production.');
  }
  if (isProduction && !environment.ADMIN_TOTP_ENCRYPTION_KEY) {
    throw new Error('ADMIN_TOTP_ENCRYPTION_KEY must be configured in production.');
  }
  if (isProduction && !environment.NETWORK_BAN_HMAC_KEY) {
    throw new Error('NETWORK_BAN_HMAC_KEY must be configured in production.');
  }
  if (isProduction && environment.EMAIL_DELIVERY_MODE === 'live') {
    if (!environment.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY must be configured for live email delivery.');
    }
    if (environment.RESEND_FROM !== 'Verify <noreply@notifications.nevely.app>') {
      throw new Error('RESEND_FROM must use the verified Nevely verification sender.');
    }
  }

  const privatePreview = createPrivatePreview({
    environment,
    copy: uiCopy
  });

  const sessionMiddleware = session({
    name: 'nevely.sid',
    store: db.isConfigured && db.pool
      ? new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: false })
      : undefined,
    secret: environment.SESSION_SECRET || 'local-development-only-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  });

  if (!db.isConfigured) log.warn('session.temporary_memory_store');

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(sessionMiddleware);
  app.use(csrfProtection({ publicOrigin: environment.PUBLIC_ORIGIN }));
  app.use((req, res, next) => {
    if (!req.session?.suspension) return next();
    const allowed = (req.method === 'GET' && (req.path === '/suspension' || req.path === '/support'))
      || (req.method === 'POST' && req.path === '/logout');
    if (allowed) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: uiCopy.errors.accountSuspended, code: 'ACCOUNT_SUSPENDED' });
    }
    return res.redirect('/suspension');
  });
  io.engine.use(sessionMiddleware);
  privatePreview.registerHttp(app);
  privatePreview.registerSocket(io);

  app.get('/', (req, res) => res.render('home', {
    pageTitle: uiCopy.pageTitles.home,
    currentUser: publicSessionUser(req.session.user || null)
  }));
  app.get('/about', (req, res) => res.render('about', { pageTitle: uiCopy.pageTitles.about }));
  app.get('/support', (req, res) => res.render('support', { pageTitle: uiCopy.pageTitles.support }));
  app.get('/guest-restricted', (req, res) => res.status(403).render('guest-restricted', {
    pageTitle: 'Guest access limited'
  }));
  app.get('/privacy', (req, res) => res.render('privacy', { pageTitle: uiCopy.pageTitles.privacy }));
  app.get('/terms', (req, res) => res.render('terms', { pageTitle: uiCopy.pageTitles.terms }));

  app.get('/api/database-health', async (req, res) => {
    const ready = lifecycle.phase === 'ready' && await databaseReady();
    return res.status(ready ? 200 : 503).json({ connected: ready, configured: db.isConfigured });
  });

  const authLimiter = createAuthLimiter();
  app.post([
    '/login',
    '/register',
    '/login/2fa',
    '/forgot-password',
    '/reset-password',
    '/auth/google',
    '/api/auth/verification/resend',
    '/verify-email/resend',
    '/api/account/password/setup'
  ], authLimiter);
  app.use(async (req, res, next) => {
    if (!db.isConfigured || !moderation) return next();
    if (req.path === '/support' || req.path === '/guest-restricted'
        || req.path === '/logout' || req.path.startsWith('/health/')) return next();
    try {
      if (!await moderation.isNetworkBlocked(req.ip)) return next();
      if (req.path.startsWith('/api/') || req.method !== 'GET') {
        return res.status(403).json({ error: uiCopy.errors.networkBlocked, code: 'NETWORK_RESTRICTED' });
      }
      return res.redirect('/guest-restricted');
    } catch (error) {
      return next(error);
    }
  });
  registerAuthRoutes(app, db, {
    environment,
    googleVerifier: options.googleVerifier
  });

  let moderation;
  app.get('/chat', async (req, res, next) => {
    if (db.isConfigured) {
      try {
        if (await moderation.isNetworkBlocked(req.ip)) return res.status(403).send(uiCopy.errors.networkBlocked);
      } catch (error) {
        return next(error);
      }
    }
    const currentUser = publicSessionUser(req.session.user || null);
    const isGuest = !currentUser;
    if (isGuest && req.query.guest !== '1') return res.redirect('/login');
    if (currentUser && !currentUser.emailVerified) return res.redirect('/verify-email/pending');
    let guestClaimEligible = false;
    if (isGuest && db.isConfigured && req.session.guestPrincipalId) {
      try {
        if (await moderation.isGuestBlocked(req.session.guestPrincipalId)
          || await moderation.isGuestDeviceRestrictedForGuest(req.session.guestPrincipalId)) {
          return res.redirect('/guest-restricted');
        }
        const guest = await findActiveGuestPrincipal(db, req.session.guestPrincipalId, { touch: false });
        guestClaimEligible = guestPassportComplete(guest);
      } catch (error) {
        return next(error);
      }
    }
    if (currentUser && !currentUser.profileComplete) return res.redirect('/complete-profile');
    if (currentUser && environment.GOOGLE_CLIENT_ID && !req.session.googleNonce) {
      req.session.googleNonce = crypto.randomBytes(24).toString('base64url');
    }
    return res.render('chat', {
      pageTitle: uiCopy.pageTitles.chat,
      isGuest,
      currentUser,
      guestClaimEligible,
      guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS,
      googleClientId: currentUser ? environment.GOOGLE_CLIENT_ID || '' : '',
      googleNonce: currentUser ? req.session.googleNonce || '' : ''
    });
  });

  const presence = createPresence(io);
  const chat = registerChat(io, db, presence, {
    guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS,
    enforcePersistentGuestOwnership: options.enforcePersistentGuestOwnership,
    isNetworkBlocked: (address) => moderation?.isNetworkBlocked(address) || Promise.resolve(false),
    isGuestBlocked: (guestId) => moderation?.isGuestBlocked(guestId) || Promise.resolve(false),
    isGuestDeviceRestricted: (guestId) => moderation?.isGuestDeviceRestrictedForGuest(guestId) || Promise.resolve(false),
    matchesNetworkControl: (address, control) => moderation?.matchesNetworkControl(address, control) || false,
    clientAddressForSocket: (socket) => trustedClientAddress(socket.request),
    rateLimiter: options.rateLimiter,
    rateLimitPrincipalResolver: options.rateLimitPrincipalResolver,
    log
  });
  const moderationControl = createModerationControlChannel({ db, chat, log });
  moderation = createModerationService({ db, presence, chat, controlChannel: moderationControl, environment });
  registerApiRoutes(app, db, presence, { environment, moderation });
  const outboxWorker = createOutboxWorker({
    db,
    environment,
    log,
    fetchImpl: options.fetchImpl
  });
  outboxWorker.start();
  const retentionWorker = createRetentionWorker({
    db,
    environment,
    log
  });
  retentionWorker.start();

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: uiCopy.errors.notFound });
    }
    return res.status(404).render('404', { pageTitle: uiCopy.pageTitles.notFound });
  });

  app.use((error, req, res, next) => {
    log.error('http.unhandled_request_error', error);
    if (res.headersSent) return next(error);
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ error: uiCopy.errors.unexpected });
    }
    return res.status(500).send(uiCopy.errors.unexpected);
  });

  lifecycle.phase = 'ready';

  async function start({ port = Number(environment.PORT) || 3000, host = '0.0.0.0' } = {}) {
    if (server.listening) return server.address();
    lifecycle.phase = 'starting';
    const controlStarted = await moderationControl.start();
    if (isProduction && !controlStarted) throw new Error('PostgreSQL moderation control channel must be available in production.');
    await new Promise((resolve, reject) => {
      const handleError = (error) => {
        server.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off('error', handleError);
        resolve();
      };
      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(port, host);
    });
    lifecycle.phase = 'ready';
    log.info('server.listening');
    return server.address();
  }

  async function closeSocketServer() {
    io.disconnectSockets(true);
    await Promise.race([
      new Promise((resolve) => io.close(() => resolve())),
      new Promise((resolve) => setTimeout(resolve, Math.min(shutdownGraceMs, 2_000)))
    ]);
  }

  async function waitForIdleOrDeadline() {
    let timeout;
    const deadline = new Promise((resolve) => {
      timeout = setTimeout(resolve, shutdownGraceMs);
    });
    await Promise.race([chat.whenIdle(), deadline]);
    clearTimeout(timeout);
  }

  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      lifecycle.phase = 'draining';
      log.info('server.draining');

      chat.beginDrain({ retryAfterSeconds: Math.ceil(shutdownGraceMs / 1000) });

      const httpClosed = server.listening
        ? new Promise((resolve) => server.close(() => resolve()))
        : Promise.resolve();

      await waitForIdleOrDeadline();
      await chat.stop();
      await moderationControl.stop();
      await retentionWorker.stop();
      await outboxWorker.stop();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closeSocketServer();
      await Promise.race([
        httpClosed,
        new Promise((resolve) => setTimeout(resolve, Math.min(shutdownGraceMs, 2_000)))
      ]);

      if (options.closeDatabaseOnShutdown !== false && typeof db.close === 'function') {
        await db.close();
      }

      removeSignalHandlers?.();
      lifecycle.phase = 'stopped';
      log.info('server.stopped');
    })();
    return shutdownPromise;
  }

  function installSignalHandlers() {
    if (removeSignalHandlers) return removeSignalHandlers;
    const handleSignal = () => {
      void shutdown().catch((error) => {
        log.error('server.shutdown_failed', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);
    removeSignalHandlers = () => {
      process.off('SIGTERM', handleSignal);
      process.off('SIGINT', handleSignal);
      removeSignalHandlers = null;
    };
    return removeSignalHandlers;
  }

  return {
    app,
    server,
    io,
    chat,
    moderation,
    moderationControl,
    outboxWorker,
    retentionWorker,
    privatePreview,
    lifecycle,
    start,
    shutdown,
    installSignalHandlers
  };
}

if (require.main === module) {
  const runtime = createRuntime();
  runtime.start()
    .then(() => runtime.installSignalHandlers())
    .catch((error) => {
      safeLog.error('server.start_failed', error);
      process.exitCode = 1;
    });
}

module.exports = { createRuntime };
