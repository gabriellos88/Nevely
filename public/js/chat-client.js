const socket = io();

const startBtn = document.getElementById('startBtn');
const startBtnSidebar = document.getElementById('startBtnSidebar');
const startBtnBottom = document.getElementById('startBtnBottom');
const newBtn = document.getElementById('newBtn');
const reportBtn = document.getElementById('reportBtn');
const sendBtn = document.getElementById('sendBtn');
const addInterestBtn = document.getElementById('addInterestBtn');
const interestsInput = document.getElementById('interestsInput');
const interestTags = document.getElementById('interestTags');
const messageInput = document.getElementById('messageInput');
const messagesEl = document.getElementById('messages');
const statusText = document.getElementById('statusText');
const chatCard = document.getElementById('chatCard');
const matchSetup = document.getElementById('matchSetup');
const timerBadge = document.getElementById('timerBadge');
const usernameInput = document.getElementById('usernameInput');
const ageInput = document.getElementById('ageInput');
const countryInput = document.getElementById('countryInput');
const countryValue = document.getElementById('countryValue');
const countrySuggestions = document.getElementById('countrySuggestions');
const tosInput = document.getElementById('tosInput');
const quickStartError = document.getElementById('quickStartError');
const profileName = document.getElementById('profileName');
const profileInitial = document.getElementById('profileInitial');
const sidebarToggle = document.getElementById('sidebarToggle');
const chatSidebar = document.getElementById('chatSidebar');
const collapsiblePanels = document.querySelectorAll('[data-collapsible]');
const partnerAvatar = document.getElementById('partnerAvatar');
const partnerName = document.getElementById('partnerName');
const settingsBtn = document.getElementById('settingsBtn');
const accountModal = document.getElementById('accountModal');
const accountForm = document.getElementById('accountForm');
const guestAccountPrompt = document.getElementById('guestAccountPrompt');
const accountFeedback = document.getElementById('accountFeedback');
const accountPlan = document.getElementById('accountPlan');
const logoutBtn = document.getElementById('logoutBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const profileModal = document.getElementById('profileModal');
const partnerProfileBtn = document.getElementById('partnerProfileBtn');
const publicProfileAvatar = document.getElementById('publicProfileAvatar');
const publicProfileMeta = document.getElementById('publicProfileMeta');
const friendActionBtn = document.getElementById('friendActionBtn');
const profileBlockBtn = document.getElementById('profileBlockBtn');
const conversationMenuBtn = document.getElementById('conversationMenuBtn');
const conversationMenu = document.getElementById('conversationMenu');
const saveConversationBtn = document.getElementById('saveConversationBtn');
const blockPartnerBtn = document.getElementById('blockPartnerBtn');
const deleteConversationBtn = document.getElementById('deleteConversationBtn');

const currentUser = window.__CURRENT_USER__ || null;
let currentConversationId = null;
let currentPartner = null;
let currentProfile = null;
let readOnlyConversation = false;
let currentConversationSaved = false;
let skipCooldownTimer = null;

let countdownInterval = null;
const selectedInterests = [];
const maxInterests = 5;

// Piccolo set di avatar/nomi placeholder per dare un po' di personalità
// ai match, finché non esiste un vero sistema di profili.
const strangerFlavors = [
  { emoji: '🦊', name: 'Fox' },
  { emoji: '🐼', name: 'Panda' },
  { emoji: '🐨', name: 'Koala' },
  { emoji: '🦉', name: 'Owl' },
  { emoji: '🐙', name: 'Octopus' },
  { emoji: '🦋', name: 'Butterfly' },
  { emoji: '🐢', name: 'Turtle' },
  { emoji: '🦁', name: 'Lion' }
];

const countries = [
  { name: 'Italy', flag: '🇮🇹' },
  { name: 'France', flag: '🇫🇷' },
  { name: 'Germany', flag: '🇩🇪' },
  { name: 'Spain', flag: '🇪🇸' },
  { name: 'Switzerland', flag: '🇨🇭' },
  { name: 'Austria', flag: '🇦🇹' },
  { name: 'United Kingdom', flag: '🇬🇧' },
  { name: 'United States', flag: '🇺🇸' },
  { name: 'Canada', flag: '🇨🇦' },
  { name: 'Portugal', flag: '🇵🇹' },
  { name: 'Netherlands', flag: '🇳🇱' },
  { name: 'Belgium', flag: '🇧🇪' },
  { name: 'Poland', flag: '🇵🇱' },
  { name: 'Romania', flag: '🇷🇴' },
  { name: 'Brazil', flag: '🇧🇷' },
  { name: 'Argentina', flag: '🇦🇷' },
  { name: 'Mexico', flag: '🇲🇽' },
  { name: 'Japan', flag: '🇯🇵' },
  { name: 'South Korea', flag: '🇰🇷' },
  { name: 'Australia', flag: '🇦🇺' }
];

if (startBtn) startBtn.addEventListener('click', startSearch);
if (startBtnSidebar) startBtnSidebar.addEventListener('click', startSearch);
if (startBtnBottom) startBtnBottom.addEventListener('click', startSearch);
newBtn.addEventListener('click', startSearch);
sendBtn.addEventListener('click', sendMessage);
reportBtn.addEventListener('click', reportUser);
if (addInterestBtn) addInterestBtn.addEventListener('click', () => addInterest(interestsInput.value));
if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
if (settingsBtn) settingsBtn.addEventListener('click', openAccountSettings);
if (conversationMenuBtn) conversationMenuBtn.addEventListener('click', () => conversationMenu.classList.toggle('hidden'));
if (saveConversationBtn) saveConversationBtn.addEventListener('click', saveCurrentConversation);
if (blockPartnerBtn) blockPartnerBtn.addEventListener('click', blockCurrentPartner);
if (deleteConversationBtn) deleteConversationBtn.addEventListener('click', deleteCurrentConversation);
if (partnerProfileBtn) partnerProfileBtn.addEventListener('click', openPartnerProfile);
if (accountForm) accountForm.addEventListener('submit', saveAccount);
if (logoutBtn) logoutBtn.addEventListener('click', logout);
if (deleteAccountBtn) deleteAccountBtn.addEventListener('click', deleteAccount);
if (friendActionBtn) friendActionBtn.addEventListener('click', toggleFriendship);
if (profileBlockBtn) profileBlockBtn.addEventListener('click', toggleProfileBlock);
document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModals));

// --- Tab a due stati (Messages/Requests, Friends/Requests): solo stato
// visivo per ora, nessun dato reale dietro finché non c'è un backend. ---
function wireTabPair(idA, idB, onChange) {
  const a = document.getElementById(idA);
  const b = document.getElementById(idB);
  if (!a || !b) return;
  [a, b].forEach((tab) => {
    tab.addEventListener('click', () => {
      a.classList.toggle('active', tab === a);
      b.classList.toggle('active', tab === b);
      if (onChange) onChange(tab === a ? 'primary' : 'requests');
    });
  });
}
wireTabPair('inboxTabMessages', 'inboxTabRequests', (tab) => loadMessagesPanel(tab));
wireTabPair('friendsTabFriends', 'friendsTabRequests', (tab) => loadFriendsPanel(tab));

// --- Icon rail: ogni icona mostra il pannello corrispondente nella
// colonna "discord-scroll". Solo "Messages" ha contenuto reale oggi,
// gli altri sono stub pronti per essere collegati in futuro. ---
const iconRailButtons = document.querySelectorAll('.icon-rail button[data-panel]');
const inboxPanels = document.querySelectorAll('.inbox-panel[data-panel-content]');
iconRailButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.panel;

    iconRailButtons.forEach((b) => b.classList.remove('active'));
    button.classList.add('active');

    inboxPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panelContent === target);
    });
    loadPanel(target);
  });
});

collapsiblePanels.forEach((panel) => {
  panel.addEventListener('click', (event) => {
    const isInteractive = event.target.closest('input, button, select, a, .pill, .chip');
    if (isInteractive && !event.target.closest('.collapse-dot') && !event.target.closest('.filter-card > button')) {
      return;
    }
    panel.classList.toggle('collapsed');
  });
});
messageInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') sendMessage();
});
interestsInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addInterest(interestsInput.value);
  }
});
usernameInput.addEventListener('input', updateProfilePreview);
countryInput.addEventListener('input', updateCountrySuggestions);
countryInput.addEventListener('blur', () => {
  setTimeout(() => countrySuggestions.classList.add('hidden'), 140);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.chat-sidebar') && !event.target.closest('.mobile-sidebar-toggle')) {
    chatSidebar.classList.remove('open');
  }
  if (!event.target.closest('.partner-actions')) conversationMenu?.classList.add('hidden');
});

function updateInterestTags() {
  interestTags.innerHTML = '';

  selectedInterests.forEach((interest) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    const removeButton = document.createElement('button');

    label.textContent = interest;
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', `Remove ${interest}`);
    removeButton.textContent = 'x';
    removeButton.addEventListener('click', () => removeInterest(interest));

    chip.appendChild(label);
    chip.appendChild(removeButton);
    interestTags.appendChild(chip);
  });
}

function addInterest(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (selectedInterests.includes(normalized)) return false;
  if (selectedInterests.length >= maxInterests) {
    alert('You can add up to 5 interests.');
    return false;
  }

  selectedInterests.push(normalized);
  updateInterestTags();
  interestsInput.value = '';
  return true;
}

function removeInterest(value) {
  const index = selectedInterests.indexOf(value);
  if (index !== -1) {
    selectedInterests.splice(index, 1);
    updateInterestTags();
  }
}

function parseInterests(value) {
  const interests = value
    .split(/[\n,]/)
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);

  interests.forEach((tag) => addInterest(tag));
  return [...selectedInterests];
}

function showChatView() {
  if (matchSetup) {
    matchSetup.classList.add('hidden');
  }
  if (chatCard) {
    chatCard.classList.remove('hidden');
  }
  if (startBtnBottom) {
    startBtnBottom.classList.add('hidden');
  }
}

function showSetupView() {
  if (chatCard) {
    chatCard.classList.add('hidden');
  }
  if (matchSetup) {
    matchSetup.classList.remove('hidden');
  }
  if (startBtnBottom) {
    startBtnBottom.classList.remove('hidden');
  }
}

function updateProfilePreview() {
  const username = usernameInput.value.trim();
  profileName.textContent = username || 'Guest';
  profileInitial.textContent = username ? username.charAt(0).toUpperCase() : '🍇';
}

function updateCountrySuggestions() {
  const query = countryInput.value.trim().toLowerCase();
  countryValue.value = '';
  countrySuggestions.innerHTML = '';

  if (query.length < 2) {
    countrySuggestions.classList.add('hidden');
    return;
  }

  const matches = countries
    .filter(country => country.name.toLowerCase().includes(query))
    .slice(0, 8);

  if (!matches.length) {
    countrySuggestions.classList.add('hidden');
    return;
  }

  matches.forEach((country) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span>${country.flag}</span><strong>${country.name}</strong>`;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      countryInput.value = `${country.flag} ${country.name}`;
      countryValue.value = country.name;
      countrySuggestions.classList.add('hidden');
    });
    countrySuggestions.appendChild(button);
  });

  countrySuggestions.classList.remove('hidden');
}

function validateQuickStart() {
  const username = usernameInput.value.trim();
  const age = Number(ageInput.value);
  const selectedCountry = countryValue.value.trim();

  if (!username) {
    showQuickStartError('Please enter your username.');
    usernameInput.focus();
    return false;
  }

  if (!age || age < 18) {
    showQuickStartError('Please select your age. You must be at least 18.');
    ageInput.focus();
    return false;
  }

  if (!selectedCountry) {
    showQuickStartError('Please select your country from the list.');
    countryInput.focus();
    return false;
  }

  if (!tosInput.checked) {
    showQuickStartError('Please accept the ToS and privacy policy to continue.');
    tosInput.focus();
    return false;
  }

  quickStartError.classList.add('hidden');
  quickStartError.textContent = '';
  return true;
}

function showQuickStartError(message) {
  quickStartError.textContent = message;
  quickStartError.classList.remove('hidden');
}

function toggleSidebar() {
  chatSidebar.classList.toggle('open');
}

// --- Stato di attesa: spinner animato al posto dei messaggi ---
function showWaitingState(label) {
  messagesEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'waiting-state';
  wrap.innerHTML = `
    <div class="loading-spinner" aria-hidden="true"></div>
    <p>${label}</p>
  `;
  messagesEl.appendChild(wrap);
}

function resetPartnerBar(label) {
  partnerAvatar.textContent = '🙂';
  partnerName.textContent = label;
}

function startSearch() {
  if (!validateQuickStart()) {
    return;
  }

  const interests = parseInterests(interestsInput.value);

  clearCountdown();
  readOnlyConversation = false;
  currentConversationId = null;
  currentPartner = null;
  currentConversationSaved = false;
  messageInput.disabled = false;
  sendBtn.disabled = false;
  statusText.textContent = 'Looking for a partner...';
  resetPartnerBar('Looking for someone…');
  showWaitingState('Looking for a partner...');
  showChatView();
  chatSidebar.classList.remove('open');

  socket.emit('find-partner', {
    interests,
    profile: {
      username: usernameInput.value.trim(),
      age: Number(ageInput.value),
      country: countryValue.value.trim()
    },
    filters: getPremiumFilters()
  });
}

// Aggiunge un messaggio mantenendo lo scroll ancorato in basso, ma solo
// all'interno del contenitore messaggi (mai la pagina intera).
function addMessage(text, who) {
  const message = document.createElement('div');
  message.className = `msg ${who}`;
  message.textContent = text;
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sendMessage() {
  if (readOnlyConversation) return;
  const text = messageInput.value.trim();
  if (!text) return;
  addMessage(text, 'me');
  socket.emit('send-message', text);
  messageInput.value = '';
}

function reportUser() {
  socket.emit('report');
  alert('User reported. Thanks for your report.');
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
  timerBadge.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  if (remaining <= 15) {
    timerBadge.classList.add('warning');
  } else {
    timerBadge.classList.remove('warning');
  }
}

socket.on('waiting', () => {
  showChatView();
  statusText.textContent = 'Waiting for a partner...';
  resetPartnerBar('Looking for someone…');
  showWaitingState('Waiting for a partner...');
});

socket.on('matched', (data) => {
  showChatView();
  const shared = data.sharedInterests.length
    ? `Common interests: ${data.sharedInterests.join(', ')}`
    : 'No shared interests, but you can still talk!';
  statusText.textContent = 'Connected! ' + shared;

  const flavor = strangerFlavors[Math.floor(Math.random() * strangerFlavors.length)];
  currentConversationId = data.conversationId || null;
  currentPartner = data.partner || null;
  currentConversationSaved = false;
  saveConversationBtn.textContent = 'Save chat';
  partnerAvatar.textContent = data.partner?.displayName?.charAt(0).toUpperCase() || flavor.emoji;
  partnerName.textContent = data.partner?.displayName || flavor.name;
  readOnlyConversation = false;
  messageInput.disabled = false;
  sendBtn.disabled = false;

  messagesEl.innerHTML = '';
  addMessage(shared, 'system');

  if (data.isGuest && data.durationSeconds) {
    startCountdown(data.durationSeconds);
  } else {
    clearCountdown();
  }
  if (data.skipCooldownSeconds) startSkipCooldown(data.skipCooldownSeconds * 1000);
});

socket.on('receive-message', (message) => {
  addMessage(typeof message === 'string' ? message : message.text, 'them');
});

socket.on('partner-left', () => {
  showChatView();
  statusText.textContent = 'Your partner left the chat.';
  addMessage('Your partner left the chat.', 'system');
  resetPartnerBar('Partner left');
  clearCountdown();
  readOnlyConversation = true;
  messageInput.disabled = true;
  sendBtn.disabled = true;
  loadPanel('history');
});

socket.on('guest-time-expired', () => {
  showChatView();
  addMessage('Guest session time expired. Looking for a new partner...', 'system');
  clearCountdown();
  setTimeout(() => {
    startSearch();
  }, 1200);
});

socket.on('message-error', (data) => addMessage(data.message || 'Message could not be sent.', 'system'));
socket.on('chat-error', (data) => addMessage(data.message || 'Chat is temporarily unavailable.', 'system'));
socket.on('skip-cooldown', ({ remainingMs }) => startSkipCooldown(remainingMs));
socket.on('notification-created', () => loadPanel('notifications'));
socket.on('direct-chat-requested', () => {
  loadMessagesPanel('requests');
  loadPanel('notifications');
});
socket.on('account-banned', () => {
  alert('Your account has been suspended. You will be logged out.');
  logout();
});

function getPremiumFilters() {
  if (currentUser?.plan !== 'premium') return null;
  return {
    gender: document.getElementById('premiumGender')?.value || '',
    minAge: document.getElementById('premiumMinAge')?.value || 18,
    maxAge: document.getElementById('premiumMaxAge')?.value || 99,
    country: document.getElementById('premiumCountry')?.value || ''
  };
}

function startSkipCooldown(remainingMs) {
  clearInterval(skipCooldownTimer);
  const endsAt = Date.now() + remainingMs;
  newBtn.disabled = true;
  const update = () => {
    const remaining = Math.max(0, endsAt - Date.now());
    newBtn.textContent = remaining ? `Skip (${Math.ceil(remaining / 1000)}s)` : 'Skip';
    if (!remaining) {
      clearInterval(skipCooldownTimer);
      newBtn.disabled = false;
    }
  };
  update();
  skipCooldownTimer = setInterval(update, 250);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function listElements(name) {
  return {
    list: document.getElementById(`${name}PanelList`),
    empty: document.getElementById(`${name}PanelEmpty`)
  };
}

function showListState(name, hasItems) {
  const { list, empty } = listElements(name);
  if (list) list.classList.toggle('hidden', !hasItems);
  if (empty) empty.classList.toggle('hidden', hasItems);
}

function renderAccountRequired(name) {
  const { list } = listElements(name);
  if (!list) return;
  list.innerHTML = '';
  const block = document.createElement('div');
  block.className = 'panel-account-required';
  block.innerHTML = '<strong>Account required</strong><span>Create a free account to use this section.</span><a href="/register">Create Account</a>';
  list.appendChild(block);
  showListState(name, true);
}

function makeListItem(title, meta, onClick, badge) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'panel-data-item';
  const initial = document.createElement('span');
  initial.className = 'panel-item-avatar';
  initial.textContent = title?.charAt(0).toUpperCase() || '?';
  const copy = document.createElement('span');
  copy.className = 'panel-item-copy';
  const strong = document.createElement('strong');
  strong.textContent = title || 'Unknown';
  const small = document.createElement('small');
  small.textContent = meta || '';
  copy.append(strong, small);
  button.append(initial, copy);
  if (badge) {
    const status = document.createElement('span');
    status.className = `panel-item-status ${badge === 'Online' ? 'online' : ''}`;
    status.textContent = badge;
    button.appendChild(status);
  }
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

async function loadPanel(name) {
  if (!currentUser && ['messages', 'history', 'friends', 'notifications', 'saved'].includes(name)) {
    renderAccountRequired(name);
    return;
  }
  try {
    if (name === 'messages') return loadMessagesPanel(document.getElementById('inboxTabRequests')?.classList.contains('active') ? 'requests' : 'primary');
    if (name === 'history') return loadHistoryPanel();
    if (name === 'friends') return loadFriendsPanel(document.getElementById('friendsTabRequests')?.classList.contains('active') ? 'requests' : 'primary');
    if (name === 'notifications') return loadNotificationsPanel();
    if (name === 'saved') return loadSavedPanel();
  } catch (error) {
    console.error(error);
  }
}

async function loadMessagesPanel(tab = 'primary') {
  if (!currentUser) return renderAccountRequired('messages');
  const { list } = listElements('messages');
  list.innerHTML = '';
  if (tab === 'requests') {
    const data = await api('/api/chat-requests');
    data.requests.forEach((request) => {
      const row = makeListItem(request.display_name, 'Wants to chat', null);
      const actions = document.createElement('span');
      actions.className = 'panel-inline-actions';
      actions.append(
        actionButton('Accept', () => socket.emit('direct-chat-response', { requestId: request.id, action: 'accept' })),
        actionButton('Decline', () => socket.emit('direct-chat-response', { requestId: request.id, action: 'decline' }))
      );
      row.appendChild(actions);
      list.appendChild(row);
    });
    return showListState('messages', data.requests.length > 0);
  }
  const data = await api('/api/conversations');
  const conversations = data.conversations.filter((item) => item.type === 'direct');
  conversations.forEach((item) => list.appendChild(makeListItem(
    item.partner_name,
    item.last_message || new Date(item.started_at).toLocaleString(),
    () => openStoredConversation(item)
  )));
  showListState('messages', conversations.length > 0);
}

async function loadHistoryPanel() {
  const { list } = listElements('history');
  list.innerHTML = '';
  const data = await api('/api/conversations');
  data.conversations.forEach((item) => list.appendChild(makeListItem(
    item.partner_name,
    `${new Date(item.started_at).toLocaleString()}${item.saved ? ' - Saved' : ''}`,
    () => openStoredConversation(item)
  )));
  showListState('history', data.conversations.length > 0);
}

async function loadFriendsPanel(tab = 'primary') {
  if (!currentUser) return renderAccountRequired('friends');
  const { list } = listElements('friends');
  list.innerHTML = '';
  if (tab === 'requests') {
    const data = await api('/api/friend-requests');
    data.requests.forEach((request) => {
      const row = makeListItem(request.display_name, 'Friend request', null);
      const actions = document.createElement('span');
      actions.className = 'panel-inline-actions';
      actions.append(
        actionButton('Accept', async () => { await api(`/api/friend-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }); loadFriendsPanel('requests'); }),
        actionButton('Decline', async () => { await api(`/api/friend-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'decline' }) }); loadFriendsPanel('requests'); })
      );
      row.appendChild(actions);
      list.appendChild(row);
    });
    return showListState('friends', data.requests.length > 0);
  }
  const data = await api('/api/friends');
  data.friends.forEach((friend) => list.appendChild(makeListItem(
    friend.display_name,
    'Click a friend to chat with them!',
    () => socket.emit('direct-chat-request', { userId: friend.id }),
    friend.online ? 'Online' : 'Offline'
  )));
  showListState('friends', data.friends.length > 0);
}

function actionButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    Promise.resolve(handler()).catch((error) => alert(error.message));
  });
  return button;
}

async function loadNotificationsPanel() {
  const { list } = listElements('notifications');
  list.innerHTML = '';
  const data = await api('/api/notifications');
  data.notifications.forEach((item) => list.appendChild(makeListItem(
    item.title,
    `${item.body || ''} ${new Date(item.created_at).toLocaleString()}`,
    async () => {
      await api(`/api/notifications/${item.id}/read`, { method: 'PATCH', body: '{}' });
      loadNotificationsPanel();
    },
    item.read_at ? '' : 'New'
  )));
  showListState('notifications', data.notifications.length > 0);
}

async function loadSavedPanel() {
  const { list } = listElements('saved');
  list.innerHTML = '';
  const data = await api('/api/saved-chats');
  const limitLine = document.getElementById('savedLimitLine');
  limitLine.textContent = `${data.used} of ${data.limit} saved chats used`;
  data.chats.forEach((item) => list.appendChild(makeListItem(
    item.partner_name,
    `Saved ${new Date(item.created_at).toLocaleString()}`,
    () => openStoredConversation({ id: item.conversation_id, partner_name: item.partner_name, saved: true })
  )));
  showListState('saved', data.chats.length > 0);
}

async function openStoredConversation(item) {
  try {
    const data = await api(`/api/conversations/${item.id}/messages`);
    currentConversationId = Number(item.id);
    currentPartner = item.partner_user_id ? { userId: Number(item.partner_user_id), displayName: item.partner_name } : null;
    currentConversationSaved = Boolean(item.saved);
    saveConversationBtn.textContent = currentConversationSaved ? 'Remove from saved' : 'Save chat';
    readOnlyConversation = true;
    showChatView();
    messagesEl.innerHTML = '';
    partnerName.textContent = item.partner_name || 'Conversation';
    partnerAvatar.textContent = (item.partner_name || '?').charAt(0).toUpperCase();
    data.messages.forEach((message) => addMessage(message.body, Number(message.sender_user_id) === currentUser.id ? 'me' : 'them'));
    addMessage('This history view is read-only.', 'system');
    messageInput.disabled = true;
    sendBtn.disabled = true;
    newBtn.disabled = false;
  } catch (error) {
    alert(error.message);
  }
}

async function saveCurrentConversation() {
  conversationMenu.classList.add('hidden');
  if (!currentUser) return openAccountSettings();
  if (!currentConversationId) return alert('There is no conversation to save yet.');
  try {
    if (currentConversationSaved) {
      await api(`/api/conversations/${currentConversationId}/saved`, { method: 'DELETE' });
      currentConversationSaved = false;
      saveConversationBtn.textContent = 'Save chat';
    } else {
      await api(`/api/conversations/${currentConversationId}/saved`, { method: 'PUT', body: '{}' });
      currentConversationSaved = true;
      saveConversationBtn.textContent = 'Remove from saved';
    }
    loadPanel('saved');
  } catch (error) {
    alert(error.message);
  }
}

async function deleteCurrentConversation() {
  conversationMenu.classList.add('hidden');
  if (!currentUser || !currentConversationId) return;
  if (!confirm('Delete this conversation and its messages for both participants? This cannot be undone.')) return;
  try {
    await api(`/api/conversations/${currentConversationId}`, { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE FOR EVERYONE' }) });
    messagesEl.innerHTML = '';
    addMessage('Conversation deleted for everyone.', 'system');
    readOnlyConversation = true;
    loadPanel('history');
  } catch (error) {
    alert(error.message);
  }
}

async function blockCurrentPartner() {
  conversationMenu.classList.add('hidden');
  if (!currentUser) return openAccountSettings();
  if (!currentPartner?.userId) return alert('Guest profiles cannot be added to your block list yet.');
  try {
    await api(`/api/blocks/${currentPartner.userId}`, { method: 'PUT', body: '{}' });
    blockPartnerBtn.textContent = 'Blocked';
    socket.emit('leave-chat');
  } catch (error) {
    alert(error.message);
  }
}

function openModal(modal) {
  modal?.classList.remove('hidden');
}

function closeModals() {
  accountModal?.classList.add('hidden');
  profileModal?.classList.add('hidden');
}

async function openAccountSettings() {
  openModal(accountModal);
  if (!currentUser) {
    guestAccountPrompt.classList.remove('hidden');
    accountForm.classList.add('hidden');
    return;
  }
  guestAccountPrompt.classList.add('hidden');
  accountForm.classList.remove('hidden');
  try {
    const data = await api('/api/account');
    const user = data.user;
    accountForm.elements.displayName.value = user.display_name || '';
    accountForm.elements.email.value = user.email || '';
    accountForm.elements.publicId.value = user.public_id || '';
    accountForm.elements.age.value = user.age || '';
    accountForm.elements.gender.value = user.gender || '';
    accountForm.elements.country.value = user.country || '';
    accountForm.elements.profileImageUrl.value = user.profile_image_url || '';
    accountPlan.textContent = user.plan === 'premium' ? 'Premium plan' : 'Free plan';
    loadBlockList();
  } catch (error) {
    accountFeedback.textContent = error.message;
  }
}

async function loadBlockList() {
  const container = document.getElementById('accountBlockList');
  if (!container || !currentUser) return;
  try {
    const data = await api('/api/blocks');
    container.innerHTML = '';
    if (!data.users.length) {
      container.textContent = 'No blocked users.';
      return;
    }
    data.users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'account-block-row';
      const name = document.createElement('span');
      name.textContent = user.display_name;
      const button = actionButton('Unblock', async () => {
        await api(`/api/blocks/${user.id}`, { method: 'DELETE' });
        loadBlockList();
      });
      row.append(name, button);
      container.appendChild(row);
    });
  } catch (error) {
    container.textContent = error.message;
  }
}

async function saveAccount(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(accountForm));
  try {
    const data = await api('/api/account', { method: 'PATCH', body: JSON.stringify(values) });
    profileName.textContent = data.user.displayName;
    profileInitial.textContent = data.user.displayName.charAt(0).toUpperCase();
    accountFeedback.textContent = 'Profile saved.';
  } catch (error) {
    accountFeedback.textContent = error.message;
  }
}

async function logout() {
  await api('/logout', { method: 'POST', body: '{}' });
  window.location.href = '/';
}

async function deleteAccount() {
  const confirmation = prompt('Type DELETE to permanently delete your account.');
  if (confirmation !== 'DELETE') return;
  try {
    await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirmation }) });
    window.location.href = '/';
  } catch (error) {
    accountFeedback.textContent = error.message;
  }
}

async function openPartnerProfile() {
  if (!currentPartner?.userId || !currentUser) return;
  try {
    const data = await api(`/api/users/${currentPartner.userId}/profile`);
    currentProfile = data.user;
    publicProfileAvatar.textContent = data.user.display_name.charAt(0).toUpperCase();
    document.getElementById('profileModalTitle').textContent = data.user.display_name;
    publicProfileMeta.textContent = `${data.user.public_id} - ${data.user.country || 'Country not shared'} - ${data.online ? 'Online' : 'Offline'}`;
    friendActionBtn.textContent = data.user.is_friend ? 'Remove friend' : 'Add friend';
    profileBlockBtn.textContent = data.user.is_blocked ? 'Unblock' : 'Block';
    openModal(profileModal);
  } catch (error) {
    alert(error.message);
  }
}

async function toggleFriendship() {
  if (!currentProfile) return;
  try {
    if (currentProfile.is_friend) {
      await api(`/api/friends/${currentProfile.id}`, { method: 'DELETE' });
      currentProfile.is_friend = false;
      friendActionBtn.textContent = 'Add friend';
    } else {
      await api('/api/friend-requests', { method: 'POST', body: JSON.stringify({ userId: currentProfile.id }) });
      friendActionBtn.textContent = 'Request sent';
      friendActionBtn.disabled = true;
    }
    loadPanel('friends');
  } catch (error) {
    alert(error.message);
  }
}

async function toggleProfileBlock() {
  if (!currentProfile) return;
  try {
    if (currentProfile.is_blocked) {
      await api(`/api/blocks/${currentProfile.id}`, { method: 'DELETE' });
      currentProfile.is_blocked = false;
      profileBlockBtn.textContent = 'Block';
    } else {
      await api(`/api/blocks/${currentProfile.id}`, { method: 'PUT', body: '{}' });
      currentProfile.is_blocked = true;
      profileBlockBtn.textContent = 'Unblock';
    }
  } catch (error) {
    alert(error.message);
  }
}

updateProfilePreview();
loadPanel('messages');
