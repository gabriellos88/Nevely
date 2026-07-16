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
<<<<<<< HEAD
const collapsiblePanels = document.querySelectorAll('[data-collapsible]');
=======
>>>>>>> 417b026c459db09f0c4f6bd59a12fcff806cb7cf

let countdownInterval = null;
const selectedInterests = [];
const maxInterests = 5;
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

<<<<<<< HEAD
if (startBtn) startBtn.addEventListener('click', startSearch);
=======
startBtn.addEventListener('click', startSearch);
>>>>>>> 417b026c459db09f0c4f6bd59a12fcff806cb7cf
if (startBtnSidebar) startBtnSidebar.addEventListener('click', startSearch);
if (startBtnBottom) startBtnBottom.addEventListener('click', startSearch);
newBtn.addEventListener('click', startSearch);
sendBtn.addEventListener('click', sendMessage);
reportBtn.addEventListener('click', reportUser);
if (addInterestBtn) addInterestBtn.addEventListener('click', () => addInterest(interestsInput.value));
if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
<<<<<<< HEAD
collapsiblePanels.forEach((panel) => {
  panel.addEventListener('click', (event) => {
    const isInteractive = event.target.closest('input, button, select, a, .pill, .chip');
    if (isInteractive && !event.target.closest('.collapse-dot') && !event.target.closest('.filter-card > button')) {
      return;
    }
    panel.classList.toggle('collapsed');
  });
});
=======
>>>>>>> 417b026c459db09f0c4f6bd59a12fcff806cb7cf
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
<<<<<<< HEAD
  if (startBtnBottom) {
    startBtnBottom.classList.add('hidden');
  }
=======
>>>>>>> 417b026c459db09f0c4f6bd59a12fcff806cb7cf
}

function showSetupView() {
  if (chatCard) {
    chatCard.classList.add('hidden');
  }
  if (matchSetup) {
    matchSetup.classList.remove('hidden');
  }
<<<<<<< HEAD
  if (startBtnBottom) {
    startBtnBottom.classList.remove('hidden');
  }
=======
>>>>>>> 417b026c459db09f0c4f6bd59a12fcff806cb7cf
}

function updateProfilePreview() {
  const username = usernameInput.value.trim();
  profileName.textContent = username || 'Guest';
  profileInitial.textContent = username ? username.charAt(0).toUpperCase() : 'G';
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

function startSearch() {
  if (!validateQuickStart()) {
    return;
  }

  const interests = parseInterests(interestsInput.value);
<<<<<<< HEAD
=======
  if (!interests.length) {
    alert('Please add at least one interest.');
    return;
  }
>>>>>>> 417b026c459db09f0c4f6bd59a12fcff806cb7cf

  clearCountdown();
  statusText.textContent = 'Looking for a partner...';
  messagesEl.innerHTML = '';
  showChatView();
  chatSidebar.classList.remove('open');

  socket.emit('find-partner', {
    interests,
    profile: {
      username: usernameInput.value.trim(),
      age: Number(ageInput.value),
      country: countryValue.value.trim()
    }
  });
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
});

socket.on('matched', (data) => {
  showChatView();
  const shared = data.sharedInterests.length
    ? `Common interests: ${data.sharedInterests.join(', ')}`
    : 'No shared interests, but you can still talk!';
  statusText.textContent = 'Connected! ' + shared;

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
  showChatView();
  statusText.textContent = 'Your partner left the chat.';
  clearCountdown();
});

socket.on('guest-time-expired', () => {
  showChatView();
  addMessage('Guest session time expired. Looking for a new partner...', 'system');
  clearCountdown();
  setTimeout(() => {
    startSearch();
  }, 1200);
});
