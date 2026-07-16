const socket = io();

const startBtn = document.getElementById('startBtn');
const newBtn = document.getElementById('newBtn');
const reportBtn = document.getElementById('reportBtn');
const sendBtn = document.getElementById('sendBtn');
const interestsInput = document.getElementById('interests');
const messageInput = document.getElementById('messageInput');
const messagesEl = document.getElementById('messages');
const statusText = document.getElementById('statusText');
const chatCard = document.getElementById('chatCard');
const prefCard = document.getElementById('prefCard');
const timerBadge = document.getElementById('timerBadge');

let countdownInterval = null;

startBtn.addEventListener('click', startSearch);
newBtn.addEventListener('click', startSearch);
sendBtn.addEventListener('click', sendMessage);
reportBtn.addEventListener('click', reportUser);
messageInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') sendMessage();
});

function parseInterests(value) {
  return value
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
}

function startSearch() {
  const interests = parseInterests(interestsInput.value);
  if (!interests.length) {
    alert('Inserisci almeno un interesse.');
    return;
  }

  clearCountdown();
  statusText.textContent = 'Ricerca di un partner...';
  messagesEl.innerHTML = '';
  chatCard.classList.remove('hidden');
  prefCard.classList.add('hidden');

  socket.emit('find-partner', { interests, isGuest: window.__IS_GUEST__ });
}

function addMessage(text, who) {
  const message = document.createElement('div');
  message.className = `msg ${who}`;
  message.textContent = text;
  messagesEl.appendChild(message);
  message.scrollIntoView({ block: 'end' });
}

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  addMessage(text, 'me');
  socket.emit('send-message', text);
  messageInput.value = '';
}

function reportUser() {
  socket.emit('report');
  alert('Utente segnalato. Grazie della segnalazione.');
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  timerBadge.classList.add('hidden');
  timerBadge.classList.remove('warning');
}

function startCountdown(seconds) {
  clearCountdown();
  let remaining = seconds;
  timerBadge.classList.remove('hidden');
  updateTimerBadge(remaining);

  countdownInterval = setInterval(() => {
    remaining -= 1;
    updateTimerBadge(remaining);
    if (remaining <= 0) {
      clearCountdown();
    }
  }, 1000);
}

function updateTimerBadge(remaining) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  timerBadge.textContent = `⏱ ${mins}:${String(secs).padStart(2, '0')}`;
  if (remaining <= 15) {
    timerBadge.classList.add('warning');
  } else {
    timerBadge.classList.remove('warning');
  }
}

socket.on('waiting', () => {
  statusText.textContent = 'In attesa di un partner...';
});

socket.on('matched', (data) => {
  const shared = data.sharedInterests.length
    ? `Interessi in comune: ${data.sharedInterests.join(', ')}`
    : 'Nessun interesse in comune, ma potete comunque parlare!';
  statusText.textContent = 'Connesso! ' + shared;

  if (data.isGuest && data.durationSeconds) {
    startCountdown(data.durationSeconds);
  } else {
    clearCountdown();
  }
});

socket.on('receive-message', (text) => {
  addMessage(text, 'them');
});

socket.on('partner-left', () => {
  statusText.textContent = 'Il tuo partner ha lasciato la chat.';
  clearCountdown();
});

// Il server forza la chiusura quando il tempo per gli ospiti scade
socket.on('guest-time-expired', () => {
  addMessage('Tempo scaduto per la sessione ospite. Cerco un nuovo partner...', 'system');
  clearCountdown();
  setTimeout(() => {
    startSearch();
  }, 1200);
});
