const uiCopy = window.__COPY__;
const chatCopy = uiCopy.chat;

function formatCopy(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

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
const releaseNotice = document.getElementById('releaseNotice');
const releaseNoticeBody = document.getElementById('releaseNoticeBody');
const chatComposerStatus = document.getElementById('chatComposerStatus');
const chatComposer = document.getElementById('chatComposer');
const chatCard = document.getElementById('chatCard');
const matchSetup = document.getElementById('matchSetup');
const timerBadge = document.getElementById('timerBadge');
const usernameInput = document.getElementById('usernameInput');
const ageInput = document.getElementById('ageInput');
const countryInput = document.getElementById('countryInput');
const guestCountrySearch = document.getElementById('guestCountrySearch');
const guestCountrySuggestions = document.getElementById('guestCountrySuggestions');
const guestCountrySelectedFlag = document.getElementById('guestCountrySelectedFlag');
const guestCountryStatus = document.getElementById('guestCountryStatus');
const guestPassportModal = document.getElementById('guestPassportModal');
const guestPassportForm = document.getElementById('guestPassportForm');
const guestGenderInput = document.getElementById('guestGenderInput');
const guestGenderChips = document.getElementById('guestGenderChips');
const genderFilterChips = document.getElementById('genderFilterChips');
const ageRangeControl = document.getElementById('ageRangeControl');
const ageRangeMin = document.getElementById('ageRangeMin');
const ageRangeMax = document.getElementById('ageRangeMax');
const ageRangeMinOutput = document.getElementById('ageRangeMinOutput');
const ageRangeMaxOutput = document.getElementById('ageRangeMaxOutput');
const premiumCountryInput = document.getElementById('premiumCountry');
const countryFilterTags = document.getElementById('countryFilterTags');
const countryFilterSuggestions = document.getElementById('countryFilterSuggestions');
const countryFilterStatus = document.getElementById('countryFilterStatus');
const waitingTimeRange = document.getElementById('waitingTimeRange');
const waitingTimeOutput = document.getElementById('waitingTimeOutput');
const waitingTimeHint = document.getElementById('waitingTimeHint');
const tosInput = document.getElementById('tosInput');
const quickStartError = document.getElementById('quickStartError');
const profileName = document.getElementById('profileName');
const profileInitial = document.getElementById('profileInitial');
const profileAvatarImage = document.getElementById('profileAvatarImage');
const activityScrim = document.getElementById('activityScrim');
const drawerConfigs = [
  { name: 'messages', trigger: document.getElementById('messagesToggle'), drawer: document.getElementById('messagesDrawer') },
  { name: 'friends', trigger: document.getElementById('friendsToggle'), drawer: document.getElementById('friendsDrawer') },
  { name: 'notifications', trigger: document.getElementById('notificationsToggle'), drawer: document.getElementById('notificationsDrawer') }
];
const drawerCloseButtons = document.querySelectorAll('[data-drawer-close]');
const messagesBadge = document.getElementById('messagesBadge');
const friendsBadge = document.getElementById('friendsBadge');
const notificationsBadge = document.getElementById('notificationsBadge');
const partnerAvatar = document.getElementById('partnerAvatar');
const partnerName = document.getElementById('partnerName');
const settingsBtn = document.getElementById('settingsBtn');
const plansOpenButtons = Array.from(document.querySelectorAll('[data-open-plans]'));
const accountModal = document.getElementById('accountModal');
const accountForm = document.getElementById('accountForm');
const accountTabButtons = Array.from(document.querySelectorAll('[data-account-tab]'));
const accountTabPanels = Array.from(document.querySelectorAll('.account-tab-panel'));
const registeredPrivacySettings = document.getElementById('registeredPrivacySettings');
const guestPrivacySettings = document.getElementById('guestPrivacySettings');
const accountAvatarImage = document.getElementById('accountAvatarImage');
const accountAvatarFallback = document.getElementById('accountAvatarFallback');
const guestAccountPrompt = document.getElementById('guestAccountPrompt');
const guestSettingsAvatar = document.getElementById('guestSettingsAvatar');
const guestSettingsName = document.getElementById('guestSettingsName');
const guestAvatarPresets = document.getElementById('guestAvatarPresets');
const guestNameForm = document.getElementById('guestNameForm');
const guestSettingsNameInput = document.getElementById('guestSettingsNameInput');
const guestNameChangeHint = document.getElementById('guestNameChangeHint');
const guestSettingsUserId = document.getElementById('guestSettingsUserId');
const guestSettingsAge = document.getElementById('guestSettingsAge');
const guestSettingsGender = document.getElementById('guestSettingsGender');
const guestSettingsCountry = document.getElementById('guestSettingsCountry');
const guestSettingsCountryFlag = document.getElementById('guestSettingsCountryFlag');
const guestAccountFeedback = document.getElementById('guestAccountFeedback');
const guestLogoutBtn = document.getElementById('guestLogoutBtn');
const guestReminderDismiss = document.getElementById('guestReminderDismiss');
const accountFeedback = document.getElementById('accountFeedback');
const accountPlan = document.getElementById('accountPlan');
const logoutBtn = document.getElementById('logoutBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const deleteAccountModal = document.getElementById('deleteAccountModal');
const deleteAccountModalClose = document.getElementById('deleteAccountModalClose');
const deleteAccountModalTitle = document.getElementById('deleteAccountModalTitle');
const deleteAccountModalDescription = document.getElementById('deleteAccountModalDescription');
const deleteAccountCancel = document.getElementById('deleteAccountCancel');
const deleteAccountConfirm = document.getElementById('deleteAccountConfirm');
const deleteAccountFeedback = document.getElementById('deleteAccountFeedback');
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
const GuestProfileStore = window.NevelyGuestProfileStore;
let currentConversationId = null;
let currentPartner = null;
let currentProfile = null;
let readOnlyConversation = false;
let currentConversationSaved = false;
let skipCooldownTimer = null;
let activeDrawerConfig = null;
let drawerRestoreFocus = null;
let drawerTouchStart = null;
let pendingReadReceipt = null;
let lastPartnerReadMessageId = 0;
let guestProfile = null;
let guestPassportRestoreFocus = null;
let accountModalRestoreFocus = null;
let guestCountryActiveIndex = -1;
let chatComposerMode = 'idle';
let releaseDraining = false;
let releaseCountdownTimer = null;
const pendingSentMessages = [];

const topbarCounts = { messages: 0, friends: 0, notifications: 0 };
const defaultWaitingTimeHint = waitingTimeHint?.textContent || '';

let countdownInterval = null;
const selectedInterests = [];
const maxInterests = 5;
const selectedGenderFilters = new Set();
const selectedCountryFilters = new Map();
const FLAG_ICON_ROOT = '/vendor/flag-icons-7.5.0';
let countryCatalog = [];
let countryCatalogPromise = null;

const strangerNames = chatCopy.strangerNames;

function loadCountryCatalog() {
  if (countryCatalogPromise) return countryCatalogPromise;
  countryCatalogPromise = fetch(`${FLAG_ICON_ROOT}/country.json`)
    .then((response) => {
      if (!response.ok) throw new Error(chatCopy.feedback.countryListError);
      return response.json();
    })
    .then((entries) => {
      countryCatalog = entries
        .filter((country) => country.iso === true || country.code === 'xk')
        .filter((country) => country.code && country.name && country.flag_4x3)
        .sort((a, b) => a.name.localeCompare(b.name));
      return countryCatalog;
    });
  return countryCatalogPromise;
}

function createCountryFlag(country) {
  const image = document.createElement('img');
  image.className = 'country-flag-icon';
  image.src = `${FLAG_ICON_ROOT}/${country.flag_4x3}`;
  image.alt = '';
  image.loading = 'lazy';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function createCountryOption(country, onSelect) {
  const button = document.createElement('button');
  const label = document.createElement('strong');
  button.type = 'button';
  button.setAttribute('role', 'option');
  button.dataset.countryCode = country.code;
  label.textContent = country.name;
  button.append(createCountryFlag(country), label);
  button.addEventListener('click', () => onSelect(country));
  return button;
}

function hideGuestCountrySuggestions() {
  if (!guestCountrySuggestions || !guestCountrySearch) return;
  guestCountrySuggestions.classList.add('hidden');
  guestCountrySearch.setAttribute('aria-expanded', 'false');
  guestCountryActiveIndex = -1;
}

function renderGuestCountrySelection(country) {
  if (!countryInput || !guestCountrySearch || !guestCountrySelectedFlag) return;
  countryInput.value = country?.code || '';
  guestCountrySearch.value = country?.name || '';
  guestCountrySelectedFlag.innerHTML = '';
  guestCountrySelectedFlag.classList.toggle('hidden', !country);
  document.querySelector('.guest-country-search-icon')?.classList.toggle('hidden', Boolean(country));
  if (country) guestCountrySelectedFlag.appendChild(createCountryFlag(country));
}

function selectGuestCountry(country) {
  renderGuestCountrySelection(country);
  hideGuestCountrySuggestions();
  if (guestCountryStatus) guestCountryStatus.textContent = formatCopy(chatCopy.dynamic.countrySelected, { country: country.name });
  guestCountrySearch?.focus();
}

function updateGuestCountrySuggestions() {
  if (!guestCountrySearch || !guestCountrySuggestions || !countryInput) return;
  const query = guestCountrySearch.value.trim().toLocaleLowerCase();
  const selected = countryCatalog.find((country) => country.code === countryInput.value);
  if (!selected || selected.name.toLocaleLowerCase() !== query) {
    countryInput.value = '';
    guestCountrySelectedFlag.innerHTML = '';
    guestCountrySelectedFlag.classList.add('hidden');
    document.querySelector('.guest-country-search-icon')?.classList.remove('hidden');
  }
  guestCountrySuggestions.innerHTML = '';
  guestCountryActiveIndex = -1;

  if (query.length < 2) {
    hideGuestCountrySuggestions();
    if (guestCountryStatus) guestCountryStatus.textContent = chatCopy.guestPassport.countryHint;
    return;
  }

  const matches = countryCatalog
    .filter((country) => country.name.toLocaleLowerCase().includes(query))
    .slice(0, 12);
  matches.forEach((country) => guestCountrySuggestions.appendChild(createCountryOption(country, selectGuestCountry)));
  guestCountrySuggestions.classList.toggle('hidden', matches.length === 0);
  guestCountrySearch.setAttribute('aria-expanded', String(matches.length > 0));
  if (guestCountryStatus) {
    guestCountryStatus.textContent = matches.length
      ? formatCopy(chatCopy.dynamic.countryResults, { count: matches.length })
      : chatCopy.dynamic.countryNotFound;
  }
}

function handleGuestCountryKeydown(event) {
  if (!guestCountrySuggestions || guestCountrySuggestions.classList.contains('hidden')) {
    if (event.key === 'Escape') hideGuestCountrySuggestions();
    return;
  }
  const options = Array.from(guestCountrySuggestions.querySelectorAll('[role="option"]'));
  if (!options.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    guestCountryActiveIndex = (guestCountryActiveIndex + direction + options.length) % options.length;
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === guestCountryActiveIndex)));
    options[guestCountryActiveIndex].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && guestCountryActiveIndex >= 0) {
    event.preventDefault();
    options[guestCountryActiveIndex].click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideGuestCountrySuggestions();
  }
}

if (startBtn) startBtn.addEventListener('click', startSearch);
if (startBtnSidebar) startBtnSidebar.addEventListener('click', startSearch);
if (startBtnBottom) startBtnBottom.addEventListener('click', startSearch);
newBtn.addEventListener('click', startSearch);
sendBtn.addEventListener('click', sendMessage);
reportBtn.addEventListener('click', reportUser);
if (addInterestBtn) addInterestBtn.addEventListener('click', () => addInterest(interestsInput.value));
drawerConfigs.forEach((config) => config.trigger?.addEventListener('click', () => openDrawer(config.name)));
drawerCloseButtons.forEach((button) => button.addEventListener('click', closeActiveDrawer));
if (activityScrim) activityScrim.addEventListener('click', closeActiveDrawer);
if (settingsBtn) settingsBtn.addEventListener('click', () => openAccountSettings());
plansOpenButtons.forEach((button) => button.addEventListener('click', () => openAccountSettings('plans', { focusTab: true })));
accountTabButtons.forEach((button) => {
  button.addEventListener('click', () => setAccountTab(button.dataset.accountTab));
  button.addEventListener('keydown', handleAccountTabKeydown);
});
if (conversationMenuBtn) conversationMenuBtn.addEventListener('click', () => conversationMenu.classList.toggle('hidden'));
if (saveConversationBtn) saveConversationBtn.addEventListener('click', saveCurrentConversation);
if (blockPartnerBtn) blockPartnerBtn.addEventListener('click', blockCurrentPartner);
if (deleteConversationBtn) deleteConversationBtn.addEventListener('click', deleteCurrentConversation);
if (partnerProfileBtn) partnerProfileBtn.addEventListener('click', openPartnerProfile);
if (accountForm) accountForm.addEventListener('submit', saveAccount);
if (logoutBtn) logoutBtn.addEventListener('click', logout);
if (deleteAccountBtn) deleteAccountBtn.addEventListener('click', openDeleteAccountConfirmation);
if (friendActionBtn) friendActionBtn.addEventListener('click', toggleFriendship);
if (profileBlockBtn) profileBlockBtn.addEventListener('click', toggleProfileBlock);
if (guestPassportForm) guestPassportForm.addEventListener('submit', saveGuestPassport);
if (guestNameForm) guestNameForm.addEventListener('submit', saveGuestName);
if (guestLogoutBtn) guestLogoutBtn.addEventListener('click', openDeleteAccountConfirmation);
if (deleteAccountModalClose) deleteAccountModalClose.addEventListener('click', closeDeleteAccountConfirmation);
if (deleteAccountCancel) deleteAccountCancel.addEventListener('click', closeDeleteAccountConfirmation);
if (deleteAccountConfirm) deleteAccountConfirm.addEventListener('click', confirmDeleteAccount);
document.addEventListener('keydown', handleDeleteAccountKeydown);
document.addEventListener('keydown', handleAccountModalKeydown);
if (guestReminderDismiss) guestReminderDismiss.addEventListener('click', () => guestReminderDismiss.closest('.guest-access-reminder')?.remove());
guestGenderChips?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-gender-value]');
  if (!button) return;
  setGuestGender(button.dataset.genderValue);
});
guestCountrySearch?.addEventListener('input', updateGuestCountrySuggestions);
guestCountrySearch?.addEventListener('focus', updateGuestCountrySuggestions);
guestCountrySearch?.addEventListener('keydown', handleGuestCountryKeydown);
guestCountrySearch?.addEventListener('blur', () => setTimeout(hideGuestCountrySuggestions, 140));
waitingTimeRange?.addEventListener('input', updateWaitingTimeControl);
ageRangeMin?.addEventListener('input', () => updateAgeRangeControl('min'));
ageRangeMax?.addEventListener('input', () => updateAgeRangeControl('max'));
document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModals));
document.addEventListener('keydown', handleDrawerKeydown);
document.addEventListener('keydown', handleGuestPassportKeydown);
document.addEventListener('touchstart', handleDrawerTouchStart, { passive: true });
document.addEventListener('touchend', handleDrawerTouchEnd, { passive: true });
document.addEventListener('visibilitychange', flushPendingReadReceipt);

function wireTabs(tablist, onChange) {
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const activate = (tab, moveFocus = false) => {
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.classList.toggle('active', selected);
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
    if (moveFocus) tab.focus();
    onChange?.(tab.id);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      activate(tabs[nextIndex], true);
    });
  });
}

wireTabs(document.querySelector('#messagesDrawer .drawer-tablist'), (tabId) => {
  if (tabId === 'messagesTabInbox') Promise.all([loadMessagesPanel(), loadChatRequestsPanel()]);
  if (tabId === 'messagesTabRecent') loadHistoryPanel();
  if (tabId === 'messagesTabSaved') loadSavedPanel();
});
wireTabs(document.querySelector('#friendsDrawer .drawer-tablist'), (tabId) => {
  if (tabId === 'friendsTabFriends') loadFriendsPanel();
  if (tabId === 'friendsTabRequests') loadFriendRequestsPanel();
});

wireMultiChoiceFilter(genderFilterChips, selectedGenderFilters);
premiumCountryInput?.addEventListener('input', renderCountryFilterList);
premiumCountryInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    premiumCountryInput.value = '';
    renderCountryFilterList();
  }
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
document.addEventListener('click', (event) => {
  if (!event.target.closest('.partner-actions')) conversationMenu?.classList.add('hidden');
});

function updateInterestTags() {
  interestTags.innerHTML = '';

  selectedInterests.forEach((interest) => {
    const chip = document.createElement('span');
    chip.className = 'topic-chip';
    const label = document.createElement('span');
    const removeButton = document.createElement('button');
    const removeIcon = document.createElement('i');

    label.textContent = interest;
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', formatCopy(chatCopy.dynamic.removeItem, { item: interest }));
    removeIcon.dataset.lucide = 'x';
    removeIcon.setAttribute('aria-hidden', 'true');
    removeButton.appendChild(removeIcon);
    removeButton.addEventListener('click', () => removeInterest(interest));

    chip.appendChild(label);
    chip.appendChild(removeButton);
    interestTags.appendChild(chip);
  });

  window.lucide?.createIcons();
}

function addInterest(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (selectedInterests.includes(normalized)) return false;
  if (selectedInterests.length >= maxInterests) {
    alert(chatCopy.feedback.topicLimit);
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

function setChatComposerState(mode, message = '') {
  const fallbackMessages = {
    idle: chatCopy.composer.idle,
    searching: chatCopy.composer.searching,
    live: chatCopy.composer.live,
    ended: chatCopy.composer.partnerLeft,
    history: chatCopy.composer.history,
    error: chatCopy.composer.chatError
  };
  const stateMessage = message || fallbackMessages[mode] || chatCopy.composer.idle;
  const isLive = mode === 'live';

  chatComposerMode = mode;
  messageInput.disabled = !isLive;
  sendBtn.disabled = !isLive;
  reportBtn.disabled = !isLive;
  messageInput.placeholder = isLive ? chatCopy.conversation.messagePlaceholder : stateMessage;
  if (chatComposerStatus) {
    chatComposerStatus.textContent = stateMessage;
    chatComposerStatus.classList.toggle('is-error', mode === 'error');
  }

  if (mode === 'searching') {
    newBtn.textContent = chatCopy.conversation.next;
    newBtn.disabled = true;
  } else if (mode === 'live') {
    newBtn.textContent = chatCopy.conversation.next;
    newBtn.disabled = false;
  } else {
    newBtn.textContent = chatCopy.conversation.start;
    newBtn.disabled = false;
  }
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
  chatComposer?.classList.remove('hidden');
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
  chatComposer?.classList.add('hidden');
}

function setGuestGender(value) {
  if (!guestGenderInput || !GuestProfileStore?.GENDERS.some((gender) => gender.value === value)) return;
  guestGenderInput.value = value;
  guestGenderChips?.querySelectorAll('[data-gender-value]').forEach((button) => {
    const selected = button.dataset.genderValue === value;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function persistServerGuest(serverGuest, localProfile = guestProfile) {
  if (!GuestProfileStore || !serverGuest) return localProfile;
  return GuestProfileStore.save(localStorage, {
    name: serverGuest.name,
    gender: serverGuest.gender,
    age: serverGuest.age,
    country: serverGuest.country,
    avatarId: serverGuest.avatarId,
    guestId: serverGuest.id,
    nameChanges: serverGuest.nameChanges,
    accountNotificationRead: localProfile?.accountNotificationRead === true
  }, countryCatalog);
}

function refreshGuestSocketSession() {
  if (currentUser || !socket.connected) return Promise.resolve();
  return new Promise((resolve) => {
    socket.timeout(3000).emit('refresh-guest-session', (error) => resolve(!error));
  });
}

function renderGuestIdentity() {
  const name = currentUser?.displayName || guestProfile?.name || uiCopy.common.guest;
  const avatarUrl = !currentUser && guestProfile ? GuestProfileStore?.avatarUrl(guestProfile.avatarId) : '';
  profileName.textContent = name;
  profileInitial.textContent = name.charAt(0).toUpperCase() || 'G';
  profileInitial.classList.toggle('hidden', Boolean(avatarUrl));
  profileAvatarImage.classList.toggle('hidden', !avatarUrl);
  if (avatarUrl) profileAvatarImage.src = avatarUrl;
  else profileAvatarImage.removeAttribute('src');

  if (guestSettingsName) guestSettingsName.textContent = guestProfile?.name || uiCopy.common.guest;
  if (guestSettingsAvatar) {
    guestSettingsAvatar.classList.toggle('hidden', !avatarUrl);
    if (avatarUrl) guestSettingsAvatar.src = avatarUrl;
    else guestSettingsAvatar.removeAttribute('src');
  }

  if (guestSettingsNameInput) {
    guestSettingsNameInput.value = guestProfile?.name || '';
    guestSettingsNameInput.disabled = !guestProfile || Number(guestProfile.nameChanges) >= 1;
  }
  const nameSaveButton = guestNameForm?.querySelector('button[type="submit"]');
  if (nameSaveButton) nameSaveButton.disabled = !guestProfile || Number(guestProfile.nameChanges) >= 1;
  if (guestNameChangeHint) {
    guestNameChangeHint.textContent = Number(guestProfile?.nameChanges) >= 1
      ? chatCopy.feedback.nameChangeUsed
      : chatCopy.feedback.nameChangeAvailable;
  }
  if (guestSettingsUserId) guestSettingsUserId.textContent = guestProfile?.guestId || uiCopy.account.settingUp;
  if (guestSettingsAge) guestSettingsAge.textContent = guestProfile?.age ? String(guestProfile.age) : '—';
  if (guestSettingsGender) {
    guestSettingsGender.textContent = GuestProfileStore?.GENDERS.find((item) => item.value === guestProfile?.gender)?.label || '—';
  }
  if (guestSettingsCountry) guestSettingsCountry.textContent = guestProfile?.country?.name || '—';
  if (guestSettingsCountryFlag) {
    guestSettingsCountryFlag.innerHTML = '';
    const country = countryCatalog.find((item) => item.code === guestProfile?.country?.code);
    guestSettingsCountryFlag.classList.toggle('hidden', !country);
    if (country) guestSettingsCountryFlag.appendChild(createCountryFlag(country));
  }
}

function renderGuestAvatarPresets() {
  if (!guestAvatarPresets || !GuestProfileStore) return;
  guestAvatarPresets.innerHTML = '';
  GuestProfileStore.AVATAR_PRESETS.forEach((preset) => {
    const button = document.createElement('button');
    const image = document.createElement('img');
    const selected = guestProfile?.avatarId === preset.id;
    button.type = 'button';
    button.className = 'guest-avatar-preset';
    button.dataset.avatarId = preset.id;
    button.setAttribute('aria-label', `${uiCopy.account.chooseAvatar}: ${preset.id}`);
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
    image.src = preset.src;
    image.alt = '';
    button.appendChild(image);
    button.addEventListener('click', () => selectGuestAvatar(preset.id));
    guestAvatarPresets.appendChild(button);
  });
}

async function selectGuestAvatar(avatarId) {
  if (currentUser || !guestProfile || !GuestProfileStore) return;
  try {
    const data = await api('/api/guest-profile', { method: 'PATCH', body: JSON.stringify({ avatarId }) });
    guestProfile = persistServerGuest(data.guest, guestProfile);
    renderGuestIdentity();
    renderGuestAvatarPresets();
  } catch (error) {
    if (guestAccountFeedback) guestAccountFeedback.textContent = error.message;
  }
}

function showQuickStartError(message) {
  if (!quickStartError) return;
  quickStartError.textContent = message;
  quickStartError.classList.remove('hidden');
}

function clearQuickStartError() {
  if (!quickStartError) return;
  quickStartError.textContent = '';
  quickStartError.classList.add('hidden');
}

function getGuestPassportFocusables() {
  if (!guestPassportModal) return [];
  return Array.from(guestPassportModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.getClientRects().length > 0);
}

function openGuestPassport() {
  if (currentUser || !guestPassportModal) return;
  guestPassportRestoreFocus = document.activeElement;
  guestPassportModal.classList.remove('hidden');
  guestPassportModal.removeAttribute('inert');
  guestPassportModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('guest-passport-open');
  const chatLayout = document.querySelector('.chat-layout');
  if (chatLayout) chatLayout.inert = true;
  window.requestAnimationFrame(() => usernameInput?.focus());
}

function closeGuestPassport({ restoreFocus = false } = {}) {
  if (!guestPassportModal) return;
  guestPassportModal.classList.add('hidden');
  guestPassportModal.setAttribute('inert', '');
  guestPassportModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('guest-passport-open');
  const chatLayout = document.querySelector('.chat-layout');
  if (chatLayout) chatLayout.inert = false;
  if (restoreFocus && guestPassportRestoreFocus?.focus) guestPassportRestoreFocus.focus();
  guestPassportRestoreFocus = null;
}

function handleGuestPassportKeydown(event) {
  if (!guestPassportModal || guestPassportModal.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = getGuestPassportFocusables();
  if (!focusables.length) return event.preventDefault();
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function saveGuestPassport(event) {
  event.preventDefault();
  clearQuickStartError();
  const name = usernameInput?.value.trim() || '';
  const age = Number(ageInput?.value);
  const country = countryCatalog.find((entry) => entry.code === countryInput?.value);

  if (!name) {
    showQuickStartError(chatCopy.feedback.enterName);
    return usernameInput?.focus();
  }
  if (!Number.isInteger(age) || age < 18) {
    showQuickStartError(chatCopy.feedback.chooseAge);
    return ageInput?.focus();
  }
  if (!country) {
    showQuickStartError(chatCopy.feedback.chooseCountry);
    return guestCountrySearch?.focus();
  }
  if (!tosInput?.checked) {
    showQuickStartError(chatCopy.feedback.acceptTerms);
    return tosInput?.focus();
  }

  try {
    const localProfile = {
      name,
      gender: guestGenderInput.value,
      age,
      country: { code: country.code, name: country.name },
      avatarId: guestProfile?.avatarId || GuestProfileStore.pickRandomAvatar(),
      accountNotificationRead: false
    };
    const data = await api('/api/guest-profile', { method: 'POST', body: JSON.stringify(localProfile) });
    guestProfile = persistServerGuest(data.guest, localProfile);
    await refreshGuestSocketSession();
    renderGuestIdentity();
    renderGuestAvatarPresets();
    refreshTopbarBadges();
    closeGuestPassport();
  } catch (error) {
    showQuickStartError(error.message);
  }
}

async function saveGuestName(event) {
  event.preventDefault();
  if (!guestProfile || !guestSettingsNameInput) return;
  if (guestAccountFeedback) guestAccountFeedback.textContent = '';
  const name = guestSettingsNameInput.value.trim();
  if (!name) {
    if (guestAccountFeedback) guestAccountFeedback.textContent = chatCopy.feedback.enterName;
    return guestSettingsNameInput.focus();
  }
  try {
    const previousName = guestProfile.name;
    const data = await api('/api/guest-profile', { method: 'PATCH', body: JSON.stringify({ name }) });
    guestProfile = persistServerGuest(data.guest, guestProfile);
    await refreshGuestSocketSession();
    renderGuestIdentity();
    if (guestAccountFeedback) {
      guestAccountFeedback.textContent = previousName === guestProfile.name
        ? chatCopy.feedback.nameUnchanged
        : chatCopy.feedback.nameSaved;
    }
  } catch (error) {
    if (guestAccountFeedback) guestAccountFeedback.textContent = error.message;
  }
}

function resetGuestPassportForm() {
  guestPassportForm?.reset();
  setGuestGender('any');
  renderGuestCountrySelection(null);
  hideGuestCountrySuggestions();
  if (guestCountryStatus) guestCountryStatus.textContent = chatCopy.guestPassport.countryHint;
  clearQuickStartError();
}

async function logoutGuestAccount() {
  if (currentUser) return;
  if (guestAccountFeedback) guestAccountFeedback.textContent = '';
  try {
    await api('/api/guest-profile', { method: 'DELETE', body: '{}' });
    GuestProfileStore?.remove(localStorage);
    guestProfile = null;
    if (socket.connected) socket.disconnect();
    socket.connect();
    resetGuestPassportForm();
    renderGuestIdentity();
    renderGuestAvatarPresets();
    closeModals();
    refreshTopbarBadges();
    openGuestPassport();
    return true;
  } catch (error) {
    if (guestAccountFeedback) guestAccountFeedback.textContent = error.message;
    return false;
  }
}

function currentChatProfile() {
  if (currentUser) {
    return {
      username: currentUser.displayName,
      gender: currentUser.gender || 'any',
      age: Number(currentUser.age),
      country: currentUser.country || ''
    };
  }
  if (!guestProfile) return null;
  return {
    username: guestProfile.name,
    gender: guestProfile.gender,
    age: guestProfile.age,
    country: guestProfile.country.name,
    avatarId: guestProfile.avatarId
  };
}

async function initializeGuestExperience() {
  renderGuestIdentity();
  if (currentUser) return;
  if (!GuestProfileStore) {
    openGuestPassport();
    return showQuickStartError(chatCopy.feedback.guestProfileLoadError);
  }

  guestProfile = GuestProfileStore.read(localStorage);
  if (guestProfile) renderGuestIdentity();
  else openGuestPassport();

  try {
    const catalog = await loadCountryCatalog();
    guestProfile = GuestProfileStore.read(localStorage, catalog);
    const serverData = await api('/api/guest-profile');
    if (serverData.guest) {
      guestProfile = persistServerGuest(serverData.guest, guestProfile);
    } else if (guestProfile) {
      const created = await api('/api/guest-profile', { method: 'POST', body: JSON.stringify(guestProfile) });
      guestProfile = persistServerGuest(created.guest, guestProfile);
      await refreshGuestSocketSession();
    }

    if (guestProfile) {
      usernameInput.value = guestProfile.name;
      ageInput.value = String(guestProfile.age);
      renderGuestCountrySelection(catalog.find((country) => country.code === guestProfile.country.code));
      setGuestGender(guestProfile.gender);
      renderGuestIdentity();
      renderGuestAvatarPresets();
      closeGuestPassport();
    } else {
      renderGuestCountrySelection(null);
    }
  } catch (error) {
    if (!guestProfile) showQuickStartError(chatCopy.feedback.countryListError);
    else if (guestAccountFeedback) guestAccountFeedback.textContent = chatCopy.feedback.guestIdError;
  }
}

function wireMultiChoiceFilter(container, selection) {
  if (!container) return;
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter-value]');
    if (!button || button.disabled) return;
    if (button.dataset.premiumLocked === 'true') {
      openAccountSettings('plans', { focusTab: true });
      return;
    }
    const value = button.dataset.filterValue;

    if (!value) {
      selection.clear();
    } else if (selection.has(value)) {
      selection.delete(value);
    } else {
      selection.add(value);
    }

    syncMultiChoiceFilter(container, selection);
  });
  syncMultiChoiceFilter(container, selection);
}

function syncMultiChoiceFilter(container, selection) {
  container.querySelectorAll('[data-filter-value]').forEach((button) => {
    const value = button.dataset.filterValue;
    const selected = value ? selection.has(value) : selection.size === 0;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function updateCountryFilterStatus(message = '') {
  if (!countryFilterStatus) return;
  if (message) {
    countryFilterStatus.textContent = message;
    return;
  }
  const count = selectedCountryFilters.size;
  countryFilterStatus.textContent = count
    ? formatCopy(chatCopy.dynamic.placeSelected, {
      count,
      unit: count === 1 ? chatCopy.dynamic.placeSingular : chatCopy.dynamic.placePlural
    })
    : chatCopy.match.countryListHint;
}

function removeCountryFilter(code) {
  selectedCountryFilters.delete(code);
  renderCountryFilterTags();
  renderCountryFilterList();
}

function renderCountryFilterTags() {
  if (!countryFilterTags) return;
  countryFilterTags.innerHTML = '';

  selectedCountryFilters.forEach((country, code) => {
    const tag = document.createElement('span');
    const label = document.createElement('span');
    const removeButton = document.createElement('button');
    const removeIcon = document.createElement('i');
    tag.className = 'country-filter-tag';
    label.textContent = country.name;
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', formatCopy(chatCopy.dynamic.removeItem, { item: country.name }));
    removeIcon.dataset.lucide = 'x';
    removeIcon.setAttribute('aria-hidden', 'true');
    removeButton.appendChild(removeIcon);
    removeButton.addEventListener('click', () => removeCountryFilter(code));
    tag.append(createCountryFlag(country), label, removeButton);
    countryFilterTags.appendChild(tag);
  });

  updateCountryFilterStatus();
  window.lucide?.createIcons();
}

function toggleCountryFilter(country) {
  if (currentUser?.plan !== 'premium') {
    openAccountSettings('plans', { focusTab: true });
    return;
  }
  if (selectedCountryFilters.has(country.code)) selectedCountryFilters.delete(country.code);
  else selectedCountryFilters.set(country.code, country);
  renderCountryFilterTags();
  renderCountryFilterList();
}

async function renderCountryFilterList() {
  if (!premiumCountryInput || !countryFilterSuggestions) return;
  const query = premiumCountryInput.value.trim().toLowerCase();
  countryFilterSuggestions.innerHTML = '';

  let catalog;
  try {
    catalog = await loadCountryCatalog();
  } catch (error) {
    updateCountryFilterStatus(chatCopy.dynamic.countryUnavailable);
    return;
  }

  if (premiumCountryInput.value.trim().toLowerCase() !== query) return;
  const matches = query.length >= 3
    ? catalog.filter((country) => country.name.toLowerCase().includes(query))
    : catalog;

  if (!matches.length) {
    updateCountryFilterStatus(chatCopy.dynamic.placeNotFound);
    return;
  }

  matches.forEach((country) => {
    const option = createCountryOption(country, toggleCountryFilter);
    const selected = selectedCountryFilters.has(country.code);
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-selected', String(selected));
    if (currentUser?.plan !== 'premium') {
      option.tabIndex = -1;
      option.setAttribute('aria-disabled', 'true');
    }
    if (selected) {
      const check = document.createElement('i');
      check.dataset.lucide = 'check';
      check.setAttribute('aria-hidden', 'true');
      option.appendChild(check);
    }
    countryFilterSuggestions.appendChild(option);
  });

  if (query && query.length < 3) updateCountryFilterStatus(chatCopy.dynamic.countryKeepTyping);
  else if (query) updateCountryFilterStatus(formatCopy(chatCopy.dynamic.placesFound, { count: matches.length }));
  else updateCountryFilterStatus();
  window.lucide?.createIcons();
}

function getDrawerFocusables() {
  const drawer = activeDrawerConfig?.drawer;
  if (!drawer) return [];
  return Array.from(drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
}

function openDrawer(name) {
  const config = drawerConfigs.find((item) => item.name === name);
  if (!config?.drawer) return;
  if (activeDrawerConfig === config) return closeActiveDrawer();
  if (activeDrawerConfig) closeActiveDrawer({ restoreFocus: false });

  activeDrawerConfig = config;
  drawerRestoreFocus = config.trigger || document.activeElement;
  config.drawer.inert = false;
  config.drawer.classList.add('is-open');
  config.drawer.setAttribute('aria-hidden', 'false');
  config.trigger?.setAttribute('aria-expanded', 'true');
  activityScrim?.classList.add('is-visible');
  document.body.classList.add('activity-drawer-open');
  loadOpenDrawer(name);
  refreshTopbarBadges();
  requestAnimationFrame(() => config.drawer.querySelector('[data-drawer-close]')?.focus());
}

function closeActiveDrawer(options = {}) {
  const restoreFocus = options.restoreFocus !== false;
  if (!activeDrawerConfig) return;
  const { drawer, trigger } = activeDrawerConfig;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.inert = true;
  trigger?.setAttribute('aria-expanded', 'false');
  activityScrim?.classList.remove('is-visible');
  document.body.classList.remove('activity-drawer-open');
  if (restoreFocus && drawerRestoreFocus instanceof HTMLElement) drawerRestoreFocus.focus();
  drawerRestoreFocus = null;
  activeDrawerConfig = null;
}

function handleDrawerKeydown(event) {
  if (!activeDrawerConfig) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeActiveDrawer();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = getDrawerFocusables();
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleDrawerTouchStart(event) {
  if (!activeDrawerConfig || !window.matchMedia('(max-width: 768px)').matches || !event.touches.length) return;
  if (!event.target.closest('.activity-drawer')?.classList.contains('is-open')) return;
  const touch = event.touches[0];
  drawerTouchStart = { x: touch.clientX, y: touch.clientY };
}

function handleDrawerTouchEnd(event) {
  if (!drawerTouchStart || !event.changedTouches.length) return;
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - drawerTouchStart.x;
  const deltaY = touch.clientY - drawerTouchStart.y;
  const horizontalGesture = Math.abs(deltaX) >= 64 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
  if (horizontalGesture && deltaX > 0) closeActiveDrawer();
  drawerTouchStart = null;
}

function loadOpenDrawer(name) {
  if (name === 'messages') {
    const selected = document.querySelector('#messagesDrawer [role="tab"][aria-selected="true"]')?.id;
    if (selected === 'messagesTabRecent') return loadHistoryPanel();
    if (selected === 'messagesTabSaved') return loadSavedPanel();
    return Promise.all([loadMessagesPanel(), loadChatRequestsPanel()]);
  }
  if (name === 'friends') {
    const selected = document.querySelector('#friendsDrawer [role="tab"][aria-selected="true"]')?.id;
    return selected === 'friendsTabRequests' ? loadFriendRequestsPanel() : loadFriendsPanel();
  }
  if (name === 'notifications') return loadNotificationsPanel();
}

function updateTopbarBadge(name, count) {
  const config = drawerConfigs.find((item) => item.name === name);
  const badges = { messages: messagesBadge, friends: friendsBadge, notifications: notificationsBadge };
  const badge = badges[name];
  if (!config?.trigger || !badge) return;
  const canShowCount = Boolean(currentUser) || name === 'notifications';
  const safeCount = canShowCount ? Math.max(0, Number(count) || 0) : 0;
  topbarCounts[name] = safeCount;
  badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
  badge.classList.toggle('hidden', safeCount === 0);
  const labels = {
    messages: formatCopy(safeCount === 1 ? chatCopy.dynamic.unreadMessage : chatCopy.dynamic.unreadMessages, { count: safeCount }),
    friends: formatCopy(safeCount === 1 ? chatCopy.dynamic.friendRequest : chatCopy.dynamic.friendRequests, { count: safeCount }),
    notifications: formatCopy(safeCount === 1 ? chatCopy.dynamic.unreadNotification : chatCopy.dynamic.unreadNotifications, { count: safeCount })
  };
  const titles = {
    messages: chatCopy.drawers.messages.title,
    friends: chatCopy.drawers.friends.title,
    notifications: chatCopy.drawers.notifications.title
  };
  config.trigger.setAttribute('aria-label', safeCount
    ? formatCopy(chatCopy.dynamic.openWithCount, { title: titles[name], countLabel: labels[name] })
    : formatCopy(chatCopy.dynamic.open, { title: titles[name] }));
}

async function refreshTopbarBadges() {
  if (!currentUser) {
    updateTopbarBadge('messages', 0);
    updateTopbarBadge('friends', 0);
    updateTopbarBadge('notifications', guestProfile?.accountNotificationRead ? 0 : 1);
    return;
  }
  try {
    const [conversations, friendRequests, notifications] = await Promise.all([
      api('/api/conversations'),
      api('/api/friend-requests'),
      api('/api/notifications')
    ]);
    const unreadMessages = conversations.conversations?.reduce((total, item) => total + (Number(item.unread_count) || 0), 0) || 0;
    updateTopbarBadge('messages', unreadMessages);
    updateTopbarBadge('friends', friendRequests.requests?.length || 0);
    updateTopbarBadge('notifications', notifications.notifications?.filter((item) => !item.read_at).length || 0);
  } catch (error) {
    // Keep request failures local; error objects may contain sensitive context.
  }
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
  partnerAvatar.innerHTML = '<i data-lucide="user" aria-hidden="true"></i>';
  partnerName.textContent = label;
  window.lucide?.createIcons();
}

function selectedAgeBounds() {
  const min = Math.min(Math.max(Number(ageRangeMin?.value) || 18, 18), 60);
  const max = Math.min(Math.max(Number(ageRangeMax?.value) || 60, 18), 60);
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function updateAgeRangeControl(changedHandle = '') {
  if (!ageRangeMin || !ageRangeMax || !ageRangeControl) return;
  let min = Number(ageRangeMin.value);
  let max = Number(ageRangeMax.value);
  if (min > max) {
    if (changedHandle === 'min') {
      max = min;
      ageRangeMax.value = String(max);
    } else {
      min = max;
      ageRangeMin.value = String(min);
    }
  }
  const span = 60 - 18;
  ageRangeControl.style.setProperty('--age-min-percent', `${((min - 18) / span) * 100}%`);
  ageRangeControl.style.setProperty('--age-max-percent', `${((max - 18) / span) * 100}%`);
  if (ageRangeMinOutput) ageRangeMinOutput.textContent = String(min);
  if (ageRangeMaxOutput) ageRangeMaxOutput.textContent = max >= 60 ? '60+' : String(max);
}

function selectedWaitingTimeSeconds() {
  if (!waitingTimeRange) return 10;
  const value = Number(waitingTimeRange.value);
  return value >= 35 ? null : Math.min(Math.max(Math.round(value / 5) * 5, 5), 30);
}

function updateWaitingTimeControl() {
  const seconds = selectedWaitingTimeSeconds();
  const label = seconds === null ? chatCopy.match.noLimit : `${seconds} ${chatCopy.match.secondsShort}`;
  if (waitingTimeOutput) waitingTimeOutput.textContent = label;
  if (waitingTimeRange) waitingTimeRange.setAttribute('aria-valuetext', label);
  if (waitingTimeHint) waitingTimeHint.textContent = defaultWaitingTimeHint;
}

function startSearch() {
  if (releaseDraining) {
    if (!currentConversationId) setChatComposerState('error', uiCopy.release.drainingTitle);
    return;
  }
  const profile = currentChatProfile();
  if (!profile) {
    openGuestPassport();
    return;
  }

  const interests = parseInterests(interestsInput.value);

  clearCountdown();
  readOnlyConversation = false;
  currentConversationId = null;
  currentPartner = null;
  currentConversationSaved = false;
  setChatComposerState('searching');
  statusText.textContent = chatCopy.conversation.looking;
  resetPartnerBar(chatCopy.conversation.looking);
  showWaitingState(chatCopy.composer.searching);
  showChatView();
  closeActiveDrawer({ restoreFocus: false });

  socket.emit('find-partner', {
    interests,
    profile,
    filters: getPremiumFilters(),
    waitingTimeSeconds: selectedWaitingTimeSeconds()
  });
}

// Aggiunge un messaggio mantenendo lo scroll ancorato in basso, ma solo
// all'interno del contenitore messaggi (mai la pagina intera).
function addMessage(text, who, messageId = null) {
  const message = document.createElement('div');
  message.className = `msg ${who}`;
  message.textContent = text;
  if (Number.isSafeInteger(Number(messageId)) && Number(messageId) > 0) {
    message.dataset.messageId = String(messageId);
  }
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

function sendMessage() {
  if (readOnlyConversation) return;
  const text = messageInput.value.trim();
  if (!text) return;
  pendingSentMessages.push(addMessage(text, 'me'));
  socket.emit('send-message', text);
  messageInput.value = '';
}

function queueReadReceipt(conversationId, messageId) {
  const safeConversationId = Number(conversationId);
  const safeMessageId = Number(messageId);
  if (!currentUser || !Number.isSafeInteger(safeConversationId) || safeConversationId <= 0
      || !Number.isSafeInteger(safeMessageId) || safeMessageId <= 0) return;
  pendingReadReceipt = { conversationId: safeConversationId, upToMessageId: safeMessageId };
  flushPendingReadReceipt();
}

function flushPendingReadReceipt() {
  if (!pendingReadReceipt || document.visibilityState !== 'visible') return;
  const receipt = pendingReadReceipt;
  pendingReadReceipt = null;
  socket.emit('messages-read', receipt, (response = {}) => {
    if (!response.ok) {
      pendingReadReceipt = receipt;
      return;
    }
    refreshTopbarBadges();
    if (activeDrawerConfig?.name === 'messages') loadMessagesPanel();
  });
}

function markOutgoingMessagesRead(upToMessageId) {
  const safeMessageId = Number(upToMessageId);
  if (!Number.isSafeInteger(safeMessageId)) return;
  lastPartnerReadMessageId = Math.max(lastPartnerReadMessageId, safeMessageId);
  messagesEl.querySelectorAll('.msg.me[data-message-id]').forEach((message) => {
    if (Number(message.dataset.messageId) <= lastPartnerReadMessageId) message.dataset.read = 'true';
  });
}

function reportUser() {
  socket.emit('report');
  alert(chatCopy.feedback.reportThanks);
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

socket.on('waiting', ({ waitingTimeSeconds } = {}) => {
  showChatView();
  statusText.textContent = waitingTimeSeconds === null
    ? chatCopy.composer.searching
    : formatCopy(chatCopy.dynamic.waitingSeconds, { seconds: waitingTimeSeconds });
  setChatComposerState('searching', statusText.textContent);
  resetPartnerBar(chatCopy.conversation.looking);
  showWaitingState(chatCopy.composer.searching);
});

socket.on('waiting-timeout', ({ seconds } = {}) => {
  showSetupView();
  statusText.textContent = chatCopy.feedback.noMatch;
  setChatComposerState('ended', chatCopy.feedback.tryLonger);
  if (waitingTimeHint) waitingTimeHint.textContent = chatCopy.feedback.tryLonger;
});

socket.on('matched', (data) => {
  showChatView();
  closeActiveDrawer({ restoreFocus: false });
  const shared = data.sharedInterests.length
    ? formatCopy(chatCopy.dynamic.sharedTopics, { topics: data.sharedInterests.join(', ') })
    : chatCopy.feedback.noSharedTopics;
  statusText.textContent = formatCopy(chatCopy.feedback.connected, { shared });

  const fallbackName = strangerNames[Math.floor(Math.random() * strangerNames.length)];
  currentConversationId = data.conversationId || null;
  currentPartner = data.partner || null;
  currentConversationSaved = false;
  saveConversationBtn.textContent = chatCopy.conversation.saveChat;
  partnerAvatar.textContent = (data.partner?.displayName || fallbackName).charAt(0).toUpperCase();
  partnerName.textContent = data.partner?.displayName || fallbackName;
  readOnlyConversation = false;
  pendingReadReceipt = null;
  lastPartnerReadMessageId = 0;
  pendingSentMessages.length = 0;
  setChatComposerState('live');

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
  const messageId = typeof message === 'object' ? Number(message.id) : null;
  addMessage(typeof message === 'string' ? message : message.text, 'them', messageId);
  if (currentUser && document.visibilityState !== 'visible') refreshTopbarBadges();
  queueReadReceipt(currentConversationId, messageId);
});

socket.on('message-sent', ({ id } = {}) => {
  const message = pendingSentMessages.shift();
  const messageId = Number(id);
  if (!message || !Number.isSafeInteger(messageId) || messageId <= 0) return;
  message.dataset.messageId = String(messageId);
  if (messageId <= lastPartnerReadMessageId) message.dataset.read = 'true';
});

socket.on('message-read', ({ conversationId, upToMessageId } = {}) => {
  if (Number(conversationId) !== Number(currentConversationId)) return;
  markOutgoingMessagesRead(upToMessageId);
});

socket.on('partner-left', () => {
  showChatView();
  statusText.textContent = chatCopy.feedback.partnerLeft;
  addMessage(chatCopy.feedback.partnerLeft, 'system');
  resetPartnerBar(chatCopy.feedback.chatEnded);
  clearCountdown();
  readOnlyConversation = true;
  setChatComposerState('ended');
  loadPanel('history');
});

socket.on('guest-time-expired', () => {
  showChatView();
  addMessage(chatCopy.feedback.guestExpired, 'system');
  setChatComposerState('searching');
  clearCountdown();
  setTimeout(() => {
    startSearch();
  }, 1200);
});

socket.on('message-error', (data) => {
  pendingSentMessages.shift();
  addMessage(data.message || chatCopy.feedback.messageSendError, 'system');
});
socket.on('chat-error', (data) => {
  const message = data.message || chatCopy.feedback.chatUnavailable;
  addMessage(message, 'system');
  setChatComposerState('error', message);
});
socket.on('release-draining', ({ retryAfterSeconds = 0 } = {}) => {
  releaseDraining = true;
  releaseNotice?.classList.remove('hidden');
  for (const button of [startBtn, startBtnSidebar, startBtnBottom, newBtn]) {
    if (button) button.disabled = true;
  }

  clearInterval(releaseCountdownTimer);
  let remaining = Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0));
  const renderNotice = () => {
    if (!releaseNoticeBody) return;
    releaseNoticeBody.textContent = formatCopy(uiCopy.release.drainingBody, { seconds: remaining });
  };
  renderNotice();
  releaseCountdownTimer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    renderNotice();
    if (!remaining) clearInterval(releaseCountdownTimer);
  }, 1000);

  if (!currentConversationId) setChatComposerState('error', uiCopy.release.drainingTitle);
});
socket.on('server-shutdown', () => {
  releaseDraining = true;
  clearInterval(releaseCountdownTimer);
  releaseNotice?.classList.remove('hidden');
  if (releaseNoticeBody) releaseNoticeBody.textContent = uiCopy.release.complete;
  setChatComposerState('error', uiCopy.release.complete);
});
socket.on('disconnect', () => {
  if (releaseDraining) return;
  setChatComposerState('error', chatCopy.composer.reconnecting);
});
socket.on('connect_error', () => {
  setChatComposerState('error', chatCopy.composer.connectionError);
});
socket.on('connect', () => {
  if (releaseDraining) return;
  if (chatComposerMode === 'error') {
    showSetupView();
    setChatComposerState('idle');
  }
});
socket.on('skip-cooldown', ({ remainingMs }) => startSkipCooldown(remainingMs));
socket.on('notification-created', ({ type } = {}) => {
  loadNotificationsPanel();
  if (type === 'friend_request') loadFriendRequestsPanel();
  refreshTopbarBadges();
});
socket.on('direct-chat-requested', () => {
  loadChatRequestsPanel();
});
socket.on('account-banned', () => {
  alert(chatCopy.feedback.accountSuspended);
  logout();
});

function getPremiumFilters() {
  if (currentUser?.plan !== 'premium') return null;
  const age = selectedAgeBounds();
  const filters = {
    genders: [...selectedGenderFilters],
    countries: [...selectedCountryFilters.values()].map((country) => country.name)
  };
  if (age.min > 18 || age.max < 60) {
    filters.minAge = age.min;
    filters.maxAge = age.max >= 60 ? 99 : age.max;
  }
  return filters;
}

function startSkipCooldown(remainingMs) {
  clearInterval(skipCooldownTimer);
  const endsAt = Date.now() + remainingMs;
  newBtn.disabled = true;
  const update = () => {
    const remaining = Math.max(0, endsAt - Date.now());
    newBtn.textContent = remaining
      ? formatCopy(chatCopy.dynamic.skipCountdown, { seconds: Math.ceil(remaining / 1000) })
      : chatCopy.conversation.next;
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
  if (!response.ok) throw new Error(data.error || uiCopy.errors.unexpected);
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
  const heading = document.createElement('strong');
  const body = document.createElement('span');
  const link = document.createElement('a');
  heading.textContent = chatCopy.feedback.accountRequiredTitle;
  body.textContent = chatCopy.feedback.accountRequiredBody;
  link.href = '/register';
  link.textContent = uiCopy.common.createAccount;
  block.append(heading, body, link);
  list.appendChild(block);
  showListState(name, true);
}

function makeListItem(title, meta, onClick, badge) {
  const item = document.createElement(onClick ? 'button' : 'div');
  if (onClick) item.type = 'button';
  item.className = 'panel-data-item';
  const initial = document.createElement('span');
  initial.className = 'panel-item-avatar';
  initial.textContent = title?.charAt(0).toUpperCase() || '?';
  const copy = document.createElement('span');
  copy.className = 'panel-item-copy';
  const strong = document.createElement('strong');
  strong.textContent = title || uiCopy.common.unknownUser;
  const small = document.createElement('small');
  small.textContent = meta || '';
  copy.append(strong, small);
  item.append(initial, copy);
  if (badge) {
    const status = document.createElement('span');
    status.className = `panel-item-status ${badge === uiCopy.common.online ? 'online' : ''}`;
    status.textContent = badge;
    item.appendChild(status);
  }
  if (onClick) item.addEventListener('click', onClick);
  return item;
}

async function loadPanel(name) {
  if (!currentUser && ['messages', 'history', 'friends', 'saved'].includes(name)) {
    renderAccountRequired(name);
    return;
  }
  try {
    if (name === 'messages') return await loadMessagesPanel();
    if (name === 'history') return await loadHistoryPanel();
    if (name === 'friends') return await loadFriendsPanel();
    if (name === 'notifications') return await loadNotificationsPanel();
    if (name === 'saved') return await loadSavedPanel();
  } catch (error) {
    // Panel failures are rendered by their next user action; do not log request context.
  }
}

async function loadMessagesPanel() {
  if (!currentUser) return renderAccountRequired('messages');
  const { list } = listElements('messages');
  list.innerHTML = '';
  const data = await api('/api/conversations');
  const conversations = data.conversations.filter((item) => item.type === 'direct');
  const unreadMessages = data.conversations.reduce((total, item) => total + (Number(item.unread_count) || 0), 0);
  updateTopbarBadge('messages', unreadMessages);
  conversations.forEach((item) => list.appendChild(makeListItem(
    item.partner_name,
    item.last_message || new Date(item.started_at).toLocaleString(),
    () => openStoredConversation(item),
    Number(item.unread_count) > 0
      ? formatCopy(chatCopy.dynamic.unread, { count: Number(item.unread_count) > 99 ? '99+' : item.unread_count })
      : ''
  )));
  showListState('messages', conversations.length > 0);
}

function updateChatRequestBadge(count) {
  const badge = document.getElementById('chatRequestsBadge');
  if (!badge) return;
  const safeCount = currentUser ? Math.max(0, Number(count) || 0) : 0;
  badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
  badge.classList.toggle('hidden', safeCount === 0);
  badge.setAttribute('aria-hidden', String(safeCount === 0));
}

async function respondToChatRequest(requestId, action) {
  await new Promise((resolve, reject) => {
    socket.timeout(6000).emit('direct-chat-response', { requestId, action }, (error, response = {}) => {
      if (error) return reject(new Error(chatCopy.feedback.chatRequestTimeout));
      if (!response.ok) return reject(new Error(response.error || chatCopy.feedback.chatRequestUpdateError));
      resolve(response);
    });
  });
  await loadChatRequestsPanel();
}

async function loadChatRequestsPanel() {
  const { list } = listElements('chatRequests');
  if (!list) return;
  list.innerHTML = '';
  if (!currentUser) {
    updateChatRequestBadge(0);
    return showListState('chatRequests', false);
  }
  const data = await api('/api/chat-requests');
  updateChatRequestBadge(data.requests.length);
  data.requests.forEach((request) => {
    const row = makeListItem(request.display_name, chatCopy.feedback.wantsToChat, null);
    const actions = document.createElement('span');
    actions.className = 'panel-inline-actions';
    actions.append(
      actionButton(chatCopy.feedback.acceptChatRequest, () => respondToChatRequest(request.id, 'accept'), 'check'),
      actionButton(chatCopy.feedback.declineChatRequest, () => respondToChatRequest(request.id, 'decline'), 'x')
    );
    row.appendChild(actions);
    list.appendChild(row);
  });
  showListState('chatRequests', data.requests.length > 0);
  window.lucide?.createIcons();
}

async function loadHistoryPanel() {
  const { list } = listElements('history');
  list.innerHTML = '';
  const data = await api('/api/conversations');
  data.conversations.forEach((item) => list.appendChild(makeListItem(
    item.partner_name,
    `${item.last_message || new Date(item.started_at).toLocaleString()}${item.saved ? ` · ${chatCopy.dynamic.historySaved}` : ''}`,
    () => openStoredConversation(item),
    Number(item.unread_count) > 0
      ? formatCopy(chatCopy.dynamic.unread, { count: Number(item.unread_count) > 99 ? '99+' : item.unread_count })
      : ''
  )));
  showListState('history', data.conversations.length > 0);
}

async function loadFriendsPanel() {
  if (!currentUser) return renderAccountRequired('friends');
  const { list } = listElements('friends');
  list.innerHTML = '';
  const data = await api('/api/friends');
  data.friends.forEach((friend) => list.appendChild(makeListItem(
    friend.display_name,
    chatCopy.feedback.friendChatHint,
    () => socket.emit('direct-chat-request', { userId: friend.id }),
    friend.online ? uiCopy.common.online : uiCopy.common.offline
  )));
  showListState('friends', data.friends.length > 0);
}

async function loadFriendRequestsPanel() {
  if (!currentUser) return renderAccountRequired('friendRequests');
  const { list } = listElements('friendRequests');
  list.innerHTML = '';
  const data = await api('/api/friend-requests');
  updateTopbarBadge('friends', data.requests.length);
  data.requests.forEach((request) => {
    const row = makeListItem(request.display_name, chatCopy.feedback.sentFriendRequest, null);
    const actions = document.createElement('span');
    actions.className = 'panel-inline-actions';
    actions.append(
      actionButton(chatCopy.feedback.acceptFriendRequest, async () => {
        await api(`/api/friend-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) });
        await Promise.all([loadFriendRequestsPanel(), loadFriendsPanel()]);
      }, 'check'),
      actionButton(chatCopy.feedback.declineFriendRequest, async () => {
        await api(`/api/friend-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'decline' }) });
        await loadFriendRequestsPanel();
      }, 'x')
    );
    row.appendChild(actions);
    list.appendChild(row);
  });
  showListState('friendRequests', data.requests.length > 0);
  window.lucide?.createIcons();
}

function actionButton(label, handler, icon = null) {
  const button = document.createElement('button');
  button.type = 'button';
  if (icon) {
    button.classList.add('panel-icon-action');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
  } else {
    button.textContent = label;
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    Promise.resolve(handler()).catch((error) => alert(error.message));
  });
  return button;
}

async function loadNotificationsPanel() {
  const { list } = listElements('notifications');
  list.innerHTML = '';
  if (!currentUser) {
    const isUnread = guestProfile?.accountNotificationRead !== true;
    updateTopbarBadge('notifications', isUnread ? 1 : 0);
    const reminder = document.createElement('a');
    const icon = document.createElement('span');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const body = document.createElement('small');
    const status = document.createElement('span');
    reminder.className = 'panel-data-item guest-system-notification';
    reminder.href = '/register';
    icon.className = 'panel-item-avatar';
    icon.innerHTML = '<i data-lucide="user-plus" aria-hidden="true"></i>';
    copy.className = 'panel-item-copy';
    title.textContent = chatCopy.feedback.guestNotificationTitle;
    body.textContent = chatCopy.feedback.guestNotificationBody;
    status.className = 'panel-item-status';
    status.textContent = isUnread ? uiCopy.common.new : '';
    copy.append(title, body);
    reminder.append(icon, copy);
    if (isUnread) reminder.appendChild(status);
    reminder.addEventListener('click', () => {
      if (guestProfile && GuestProfileStore) {
        guestProfile = GuestProfileStore.save(localStorage, {
          ...guestProfile,
          accountNotificationRead: true
        }, countryCatalog);
      }
      updateTopbarBadge('notifications', 0);
    });
    list.appendChild(reminder);
    showListState('notifications', true);
    window.lucide?.createIcons();
    return;
  }
  const data = await api('/api/notifications');
  updateTopbarBadge('notifications', data.notifications.filter((item) => !item.read_at).length);
  data.notifications.forEach((item) => list.appendChild(makeListItem(
    item.title,
    `${item.body || ''} ${new Date(item.created_at).toLocaleString()}`,
    async () => {
      await api(`/api/notifications/${item.id}/read`, { method: 'PATCH', body: '{}' });
      loadNotificationsPanel();
    },
    item.read_at ? '' : uiCopy.common.new
  )));
  showListState('notifications', data.notifications.length > 0);
}

async function loadSavedPanel() {
  const { list } = listElements('saved');
  list.innerHTML = '';
  const data = await api('/api/saved-chats');
  const limitLine = document.getElementById('savedLimitLine');
  limitLine.textContent = formatCopy(chatCopy.dynamic.savedUsage, { used: data.used, limit: data.limit });
  data.chats.forEach((item) => list.appendChild(makeListItem(
    item.partner_name,
    formatCopy(chatCopy.dynamic.savedOn, { date: new Date(item.created_at).toLocaleString() }),
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
    saveConversationBtn.textContent = currentConversationSaved
      ? chatCopy.conversation.removeSaved
      : chatCopy.conversation.saveChat;
    readOnlyConversation = true;
    showChatView();
    closeActiveDrawer({ restoreFocus: false });
    messagesEl.innerHTML = '';
    partnerName.textContent = item.partner_name || chatCopy.drawers.messages.conversations;
    partnerAvatar.textContent = (item.partner_name || '?').charAt(0).toUpperCase();
    data.messages.forEach((message) => {
      const mine = Number(message.sender_user_id) === Number(currentUser.id);
      const element = addMessage(message.body, mine ? 'me' : 'them', Number(message.id));
      if (mine && message.delivered_at) element.dataset.delivered = 'true';
      if (mine && message.read_at) element.dataset.read = 'true';
    });
    const lastIncomingMessage = [...data.messages].reverse().find((message) => Number(message.sender_user_id) !== Number(currentUser.id));
    if (lastIncomingMessage) {
      await api(`/api/conversations/${item.id}/read`, {
        method: 'PATCH',
        body: JSON.stringify({ upToMessageId: Number(lastIncomingMessage.id) })
      });
      refreshTopbarBadges();
    }
    addMessage(chatCopy.feedback.historyReadOnly, 'system');
    setChatComposerState('history');
    newBtn.disabled = false;
  } catch (error) {
    alert(error.message);
  }
}

async function saveCurrentConversation() {
  conversationMenu.classList.add('hidden');
  if (!currentUser) return openAccountSettings();
  if (!currentConversationId) return alert(chatCopy.feedback.nothingToSave);
  try {
    if (currentConversationSaved) {
      await api(`/api/conversations/${currentConversationId}/saved`, { method: 'DELETE' });
      currentConversationSaved = false;
      saveConversationBtn.textContent = chatCopy.conversation.saveChat;
    } else {
      await api(`/api/conversations/${currentConversationId}/saved`, { method: 'PUT', body: '{}' });
      currentConversationSaved = true;
      saveConversationBtn.textContent = chatCopy.conversation.removeSaved;
    }
    loadPanel('saved');
  } catch (error) {
    alert(error.message);
  }
}

async function deleteCurrentConversation() {
  conversationMenu.classList.add('hidden');
  if (!currentUser || !currentConversationId) return;
  if (!confirm(chatCopy.feedback.deleteConversationConfirm)) return;
  try {
    await api(`/api/conversations/${currentConversationId}`, { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE FOR EVERYONE' }) });
    messagesEl.innerHTML = '';
    addMessage(chatCopy.feedback.conversationDeleted, 'system');
    setChatComposerState('history', chatCopy.feedback.conversationDeleted);
    readOnlyConversation = true;
    loadPanel('history');
  } catch (error) {
    alert(error.message);
  }
}

async function blockCurrentPartner() {
  conversationMenu.classList.add('hidden');
  if (!currentUser) return openAccountSettings();
  if (!currentPartner?.userId) return alert(chatCopy.feedback.guestBlockUnavailable);
  try {
    await api(`/api/blocks/${currentPartner.userId}`, { method: 'PUT', body: '{}' });
    blockPartnerBtn.textContent = chatCopy.conversation.blocked;
    socket.emit('leave-chat');
  } catch (error) {
    alert(error.message);
  }
}

function openModal(modal) {
  modal?.classList.remove('hidden');
}

function closeModals() {
  const restoreAccountFocus = accountModal && !accountModal.classList.contains('hidden');
  accountModal?.classList.add('hidden');
  deleteAccountModal?.classList.add('hidden');
  profileModal?.classList.add('hidden');
  if (restoreAccountFocus && accountModalRestoreFocus?.isConnected) {
    window.requestAnimationFrame(() => accountModalRestoreFocus.focus());
  }
}

function setAccountTab(tabName, { focus = false } = {}) {
  const activeButton = accountTabButtons.find((button) => button.dataset.accountTab === tabName);
  if (!activeButton) return;
  accountTabButtons.forEach((button) => {
    const active = button === activeButton;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  accountTabPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== activeButton.getAttribute('aria-controls'));
  });
  if (focus) activeButton.focus();
  if (tabName === 'privacy' && currentUser) loadBlockList();
}

function handleAccountTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = accountTabButtons.indexOf(event.currentTarget);
  let nextIndex = currentIndex;
  if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + accountTabButtons.length) % accountTabButtons.length;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % accountTabButtons.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = accountTabButtons.length - 1;
  setAccountTab(accountTabButtons[nextIndex].dataset.accountTab, { focus: true });
}

function handleAccountModalKeydown(event) {
  if (!accountModal || accountModal.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModals();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = Array.from(accountModal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.closest('.hidden'));
  if (!focusables.length) return event.preventDefault();
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function openAccountSettings(initialTab = 'account', { focusTab = false } = {}) {
  if (accountModal?.classList.contains('hidden')) {
    accountModalRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  openModal(accountModal);
  accountModal?.classList.toggle('guest-account-mode', !currentUser);
  registeredPrivacySettings?.classList.toggle('hidden', !currentUser);
  guestPrivacySettings?.classList.toggle('hidden', Boolean(currentUser));
  setAccountTab(initialTab, { focus: focusTab });
  if (!currentUser) {
    guestAccountPrompt.classList.remove('hidden');
    accountForm.classList.add('hidden');
    if (accountPlan) accountPlan.textContent = uiCopy.account.guestPlan;
    renderGuestIdentity();
    renderGuestAvatarPresets();
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
    accountPlan.textContent = user.plan === 'premium' ? uiCopy.account.premiumPlan : uiCopy.account.freePlan;
    const displayName = user.display_name || uiCopy.common.profile;
    if (accountAvatarFallback) {
      accountAvatarFallback.textContent = displayName.charAt(0).toUpperCase();
      accountAvatarFallback.classList.toggle('hidden', Boolean(user.profile_image_url));
    }
    if (accountAvatarImage) {
      accountAvatarImage.classList.toggle('hidden', !user.profile_image_url);
      if (user.profile_image_url) accountAvatarImage.src = user.profile_image_url;
      else accountAvatarImage.removeAttribute('src');
    }
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
      container.textContent = chatCopy.feedback.emptyBlockList;
      return;
    }
    data.users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'account-block-row';
      const name = document.createElement('span');
      name.textContent = user.display_name;
      const button = actionButton(uiCopy.common.unblock, async () => {
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
    accountFeedback.textContent = chatCopy.feedback.profileSaved;
  } catch (error) {
    accountFeedback.textContent = error.message;
  }
}

async function logout() {
  await api('/logout', { method: 'POST', body: '{}' });
  window.location.href = '/';
}

function openDeleteAccountConfirmation() {
  if (!deleteAccountModal) return;
  accountModal?.classList.add('hidden');
  deleteAccountFeedback.textContent = '';
  deleteAccountModalTitle.textContent = currentUser ? uiCopy.account.deleteAccountTitle : uiCopy.account.deleteGuestTitle;
  deleteAccountModalDescription.textContent = currentUser ? uiCopy.account.deleteAccountDescription : uiCopy.account.deleteGuestDescription;
  deleteAccountCancel.textContent = currentUser ? uiCopy.account.cancelDeleteAccount : uiCopy.account.cancelDeleteGuest;
  deleteAccountConfirm.textContent = currentUser ? uiCopy.account.confirmDeleteAccount : uiCopy.account.confirmDeleteGuest;
  deleteAccountModal.classList.remove('hidden');
  window.requestAnimationFrame(() => deleteAccountCancel?.focus());
}

function closeDeleteAccountConfirmation() {
  deleteAccountModal?.classList.add('hidden');
  openModal(accountModal);
  setAccountTab('privacy');
  window.requestAnimationFrame(() => (currentUser ? deleteAccountBtn : guestLogoutBtn)?.focus());
}

function handleDeleteAccountKeydown(event) {
  if (!deleteAccountModal || deleteAccountModal.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDeleteAccountConfirmation();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = Array.from(deleteAccountModal.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
  if (!focusables.length) return event.preventDefault();
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function confirmDeleteAccount() {
  if (!deleteAccountConfirm) return;
  deleteAccountConfirm.disabled = true;
  deleteAccountConfirm.setAttribute('aria-busy', 'true');
  deleteAccountFeedback.textContent = '';
  try {
    if (!currentUser) {
      const deleted = await logoutGuestAccount();
      if (!deleted) deleteAccountFeedback.textContent = guestAccountFeedback?.textContent || uiCopy.errors.unexpected;
      return;
    }
    await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }) });
    window.location.assign('/');
  } catch (error) {
    deleteAccountFeedback.textContent = error.message;
  } finally {
    deleteAccountConfirm.disabled = false;
    deleteAccountConfirm.removeAttribute('aria-busy');
  }
}

async function openPartnerProfile() {
  if (!currentPartner?.userId || !currentUser) return;
  try {
    const data = await api(`/api/users/${currentPartner.userId}/profile`);
    currentProfile = data.user;
    publicProfileAvatar.textContent = data.user.display_name.charAt(0).toUpperCase();
    document.getElementById('profileModalTitle').textContent = data.user.display_name;
    publicProfileMeta.textContent = formatCopy(chatCopy.dynamic.publicProfileMeta, {
      id: data.user.public_id,
      country: data.user.country || chatCopy.feedback.countryHidden,
      status: data.online ? uiCopy.common.online : uiCopy.common.offline
    });
    friendActionBtn.textContent = data.user.is_friend ? uiCopy.common.removeFriend : uiCopy.common.addFriend;
    profileBlockBtn.textContent = data.user.is_blocked ? uiCopy.common.unblock : uiCopy.common.block;
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
      friendActionBtn.textContent = uiCopy.common.addFriend;
    } else {
      await api('/api/friend-requests', { method: 'POST', body: JSON.stringify({ userId: currentProfile.id }) });
      friendActionBtn.textContent = uiCopy.common.requestSent;
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
      profileBlockBtn.textContent = uiCopy.common.block;
    } else {
      await api(`/api/blocks/${currentProfile.id}`, { method: 'PUT', body: '{}' });
      currentProfile.is_blocked = true;
      profileBlockBtn.textContent = uiCopy.common.unblock;
    }
  } catch (error) {
    alert(error.message);
  }
}

updateWaitingTimeControl();
updateAgeRangeControl();
setChatComposerState('idle');
renderCountryFilterTags();
renderCountryFilterList();
window.lucide?.createIcons();
initializeGuestExperience().finally(refreshTopbarBadges);
