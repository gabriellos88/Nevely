require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');
const db = require('./db');
const { createAuthLimiter, registerAuthRoutes } = require('./lib/auth');
const { registerApiRoutes } = require('./lib/api');
const { registerChat } = require('./lib/chat');
const { createPresence } = require('./lib/presence');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const GUEST_CHAT_DURATION_SECONDS = 120;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production.');
}

const sessionMiddleware = session({
  name: 'nevely.sid',
  store: db.isConfigured
    ? new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: false })
    : undefined,
  secret: process.env.SESSION_SECRET || 'local-development-only-change-me',
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

if (!db.isConfigured) {
  console.warn('Sessions are using temporary memory storage because DATABASE_URL is missing.');
}

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
io.engine.use(sessionMiddleware);

const blogPosts = [
  {
    slug: 'welcome-to-nevely',
    tag: 'News',
    title: 'Welcome to Nevely',
    excerpt: 'Why we are building a safer interest-based random chat.',
    body: '<p>Nevely puts shared interests, privacy and user safety at the center of random chat.</p>'
  }
];

app.get('/', (req, res) => res.render('home', { pageTitle: 'Home', currentUser: req.session.user || null }));
app.get('/blog', (req, res) => res.render('blog', { pageTitle: 'Blog', posts: blogPosts }));
app.get('/blog/:slug', (req, res) => {
  const post = blogPosts.find((item) => item.slug === req.params.slug);
  if (!post) return res.redirect('/blog');
  return res.render('blog-post', { pageTitle: post.title, post });
});
app.get('/privacy', (req, res) => res.render('privacy', { pageTitle: 'Privacy Policy' }));
app.get('/terms', (req, res) => res.render('terms', { pageTitle: 'Terms of Service' }));

app.get('/api/database-health', async (req, res) => {
  if (!db.isConfigured) return res.status(503).json({ connected: false, configured: false });
  try {
    const result = await db.query('SELECT NOW() AS server_time');
    return res.json({ connected: true, configured: true, serverTime: result.rows[0].server_time });
  } catch (error) {
    console.error('Database health check failed:', error);
    return res.status(500).json({ connected: false, configured: true });
  }
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
      if (ipBan.rowCount) return res.status(403).send('Access to Nevely is blocked from this network address.');
    } catch (error) {
      return next(error);
    }
  }
  const currentUser = req.session.user || null;
  const isGuest = !currentUser;
  if (isGuest && req.query.guest !== '1') return res.redirect('/login');
  return res.render('chat', {
    pageTitle: 'Chat',
    isGuest,
    currentUser,
    guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS
  });
});

const presence = createPresence(io);
registerApiRoutes(app, db, presence);
registerChat(io, db, presence, { guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS });

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Unexpected server error.' });
  return res.status(500).send('Unexpected server error.');
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nevely is listening on port ${PORT}`);
});
