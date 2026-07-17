require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Config ---
const GUEST_CHAT_DURATION_SECONDS = 120; // durata max di una chat per utenti senza account

// --- View engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Dati blog temporanei (da spostare su file/DB in futuro) ---
const blogPosts = [
  {
    slug: 'benvenuti-su-interest-chat',
    tag: 'Novità',
    title: 'Benvenuti su Interest Chat',
    excerpt: 'Perché abbiamo creato questo sito e cosa lo rende diverso dalle altre chat casuali.',
    body: `
      <p>Interest Chat nasce per offrire un'alternativa alle chat casuali tradizionali,
      mettendo al centro la sicurezza e gli interessi condivisi.</p>
      <p>In questa fase di test stiamo costruendo le fondamenta: moderazione, regole chiare
      e strumenti di segnalazione. Nei prossimi articoli parleremo di sicurezza online e
      buone pratiche per chattare con sconosciuti.</p>
    `
  },
  {
    slug: 'consigli-sicurezza-chat-sconosciuti',
    tag: 'Sicurezza',
    title: 'Consigli di sicurezza per chattare con sconosciuti',
    excerpt: 'Le basi per proteggerti quando parli con persone che non conosci online.',
    body: `
      <p><em>Articolo in arrivo.</em> Qui pubblicheremo consigli pratici su privacy,
      riconoscimento di comportamenti sospetti e come usare al meglio gli strumenti
      di segnalazione del sito.</p>
    `
  }
];

// --- Pagine statiche/contenuto ---
app.get('/', (req, res) => {
  res.render('home', { pageTitle: 'Home' });
});

app.get('/about', (req, res) => {
  res.render('about', { pageTitle: 'Chi siamo' });
});

app.get('/register', (req, res) => {
  res.render('auth-stub', {
    pageTitle: 'Create Account',
    mode: 'register'
  });
});

app.get('/login', (req, res) => {
  res.render('auth-stub', {
    pageTitle: 'Log In',
    mode: 'login'
  });
});

app.get('/blog', (req, res) => {
  res.render('blog', { pageTitle: 'Blog', posts: blogPosts });
});

app.get('/blog/:slug', (req, res) => {
  const post = blogPosts.find(p => p.slug === req.params.slug);
  if (!post) return res.redirect('/blog');
  res.render('blog-post', { pageTitle: post.title, post });
});

app.get('/support', (req, res) => {
  res.render('support', { pageTitle: 'Supporto' });
});

app.get('/privacy', (req, res) => {
  res.render('privacy', { pageTitle: 'Privacy Policy' });
});

app.get('/terms', (req, res) => {
  res.render('terms', { pageTitle: 'Termini di Servizio' });
});


app.get('/api/database-health', async (req, res) => {
  if (!db.isConfigured) {
    return res.status(503).json({
      connected: false,
      configured: false
    });
  }

  try {
    const result = await db.query('SELECT NOW() AS server_time');

    res.json({
      connected: true,
      configured: true,
      serverTime: result.rows[0].server_time
    });
  } catch (error) {
    console.error('Database health check failed:', error);

    res.status(500).json({
      connected: false,
      configured: true
    });
  }
});

app.get('/chat', (req, res) => {
  // Nella versione attuale (senza login reale) chiunque arrivi qui è un ospite
  const isGuest = req.query.guest === '1';

  if (!isGuest) {
    return res.redirect('/login');
  }

  res.render('chat', {
    pageTitle: 'Chat',
    isGuest,
    guestDurationSeconds: GUEST_CHAT_DURATION_SECONDS
  });
});

// --- Stato chat in memoria (solo per test locale, non per produzione) ---
const waitingUsers = []; // { socketId, interests, isGuest }
const activePairs = new Map(); // socketId -> partnerSocketId
const guestTimers = new Map(); // socketId -> timeoutId

function findMatch(user) {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < waitingUsers.length; i++) {
    const candidate = waitingUsers[i];
    if (candidate.socketId === user.socketId) continue;

    const shared = candidate.interests.filter(tag =>
      user.interests.includes(tag)
    ).length;

    if (shared > bestScore) {
      bestScore = shared;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 && waitingUsers.length > 0) {
    bestIndex = 0;
  }

  if (bestIndex !== -1) {
    const [match] = waitingUsers.splice(bestIndex, 1);
    return match;
  }

  return null;
}

function intersect(a, b) {
  return a.filter(x => b.includes(x));
}

function clearGuestTimer(socketId) {
  const timeoutId = guestTimers.get(socketId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    guestTimers.delete(socketId);
  }
}

function pairUsers(a, b) {
  activePairs.set(a.socketId, b.socketId);
  activePairs.set(b.socketId, a.socketId);

  const shared = intersect(a.interests, b.interests);

  io.to(a.socketId).emit('matched', { sharedInterests: shared, isGuest: a.isGuest, durationSeconds: GUEST_CHAT_DURATION_SECONDS });
  io.to(b.socketId).emit('matched', { sharedInterests: shared, isGuest: b.isGuest, durationSeconds: GUEST_CHAT_DURATION_SECONDS });

  // Se uno dei due (o entrambi) è ospite, la coppia viene comunque limitata
  // alla durata massima consentita per sessione ospite.
  if (a.isGuest || b.isGuest) {
    const timeoutId = setTimeout(() => {
      endPairDueToGuestTimeout(a.socketId, b.socketId);
    }, GUEST_CHAT_DURATION_SECONDS * 1000);

    guestTimers.set(a.socketId, timeoutId);
    guestTimers.set(b.socketId, timeoutId);
  }
}

function endPairDueToGuestTimeout(idA, idB) {
  io.to(idA).emit('guest-time-expired');
  io.to(idB).emit('guest-time-expired');
  activePairs.delete(idA);
  activePairs.delete(idB);
  clearGuestTimer(idA);
  clearGuestTimer(idB);
}

function disconnectPartner(socketId) {
  const partnerId = activePairs.get(socketId);
  if (partnerId) {
    io.to(partnerId).emit('partner-left');
    activePairs.delete(socketId);
    activePairs.delete(partnerId);
    clearGuestTimer(socketId);
    clearGuestTimer(partnerId);
  }
}

function removeFromWaiting(socketId) {
  const idx = waitingUsers.findIndex(u => u.socketId === socketId);
  if (idx !== -1) waitingUsers.splice(idx, 1);
}

function normalizeInterests(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .filter(item => typeof item === 'string')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length >= 2 && item.length <= 30)
  )].slice(0, 5);
}

io.on('connection', (socket) => {
  console.log('Nuova connessione:', socket.id);

  socket.on('find-partner', (payload) => {
    const interests = normalizeInterests(payload && payload.interests);
    const isGuest = true;

    removeFromWaiting(socket.id);
    disconnectPartner(socket.id);

    const user = { socketId: socket.id, interests, isGuest };
    const match = findMatch(user);

    if (match) {
      pairUsers(user, match);
    } else {
      waitingUsers.push(user);
      socket.emit('waiting');
    }
  });

  socket.on('send-message', (text) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      // Qui in futuro va inserito un controllo di moderazione sul testo
      io.to(partnerId).emit('receive-message', text);
    }
  });

  socket.on('leave-chat', () => {
    disconnectPartner(socket.id);
    removeFromWaiting(socket.id);
  });

  socket.on('report', async (payload = {}) => {
    const partnerId = activePairs.get(socket.id);

    if (!partnerId) {
      socket.emit('report-error', { message: 'No active chat to report.' });
      return;
    }

    const reason = typeof payload.reason === 'string'
      ? payload.reason.trim().slice(0, 100)
      : 'unspecified';
    const details = typeof payload.details === 'string'
      ? payload.details.trim().slice(0, 1000)
      : null;

    console.log(`REPORT: ${socket.id} reported ${partnerId}`);

    if (!db.isConfigured) {
      socket.emit('report-submitted', { stored: false });
      return;
    }

    try {
      await db.query(
        `
          INSERT INTO reports (
            reporter_socket_id,
            reported_socket_id,
            reason,
            details
          )
          VALUES ($1, $2, $3, $4)
        `,
        [socket.id, partnerId, reason, details]
      );

      socket.emit('report-submitted', { stored: true });
    } catch (error) {
      console.error('Failed to save report:', error);
      socket.emit('report-error', { message: 'Report could not be saved.' });
    }
  });

  socket.on('disconnect', () => {
    disconnectPartner(socket.id);
    removeFromWaiting(socket.id);
    console.log('Disconnesso:', socket.id);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
