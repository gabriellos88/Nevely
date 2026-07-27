require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');
const { createAuthLimiter, registerAuthRoutes } = require('./lib/auth');
const { registerApiRoutes } = require('./lib/api');
const { registerChat } = require('./lib/chat');
const { createPresence } = require('./lib/presence');
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
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.copy = uiCopy;

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

  if (isProduction && !environment.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be configured in production.');
  }

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

  app.use(sessionMiddleware);
  app.use(express.static(path.join(__dirname, 'public')));
  io.engine.use(sessionMiddleware);

  app.get('/', (req, res) => res.render('home', {
    pageTitle: uiCopy.pageTitles.home,
    currentUser: req.session.user || null
  }));
  app.get('/about', (req, res) => res.render('about', { pageTitle: uiCopy.pageTitles.about }));
  app.get('/support', (req, res) => res.render('support', { pageTitle: uiCopy.pageTitles.support }));
  app.get('/privacy', (req, res) => res.render('privacy', { pageTitle: uiCopy.pageTitles.privacy }));
  app.get('/terms', (req, res) => res.render('terms', { pageTitle: uiCopy.pageTitles.terms }));

  app.get('/api/database-health', async (req, res) => {
    const ready = lifecycle.phase === 'ready' && await databaseReady();
    return res.status(ready ? 200 : 503).json({ connected: ready, configured: db.isConfigured });
  });

  const authLimiter = createAuthLimiter();
  app.post(['/login', '/register'], authLimiter);
  registerAuthRoutes(app, db);

  app.get('/chat', async (req, res, next) => {
    if (db.isConfigured) {
      try {
        const ipBan = await db.query(
          `SELECT 1 FROM bans WHERE type = 'ip' AND ip_address = $1 LIMIT 1`,
          [req.ip]
        );
        if (ipBan.rowCount) return res.status(403).send(uiCopy.errors.networkBlocked);
      } catch (error) {
        return next(error);
      }
    }
    const currentUser = req.session.user || null;
    const isGuest = !currentUser;
    if (isGuest && req.query.guest !== '1') return res.redirect('/login');
    return res.render('chat', {
      pageTitle: uiCopy.pageTitles.chat,
      isGuest,
      currentUser,
      guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS
    });
  });

  const presence = createPresence(io);
  registerApiRoutes(app, db, presence);
  const chat = registerChat(io, db, presence, {
    guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS,
    log
  });

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
    await new Promise((resolve) => io.close(() => resolve()));
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
      await closeSocketServer();
      await httpClosed;

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
