const uiCopy = window.__COPY__ || { admin: { actionFailed: 'Action failed' } };
const adminConfiguration = window.__ADMIN_CONFIG__ || {};
const dataSections = ['users', 'guests', 'reports', 'bans', 'audit'];
const sections = [...dataSections, 'controls'];
const sectionState = Object.fromEntries(dataSections.map((section) => [section, {
  cursor: null,
  loaded: false,
  loading: false,
  filters: new URLSearchParams()
}]));
let pendingAction = null;
let reauthTimer = null;

function showReauthState(expiresAt) {
  const state = document.getElementById('adminReauthState');
  if (!state) return;
  if (reauthTimer) clearTimeout(reauthTimer);
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const active = expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now();
  state.dataset.unlocked = String(Boolean(active));
  state.textContent = active
    ? `High-risk actions unlocked until ${expiry.toLocaleTimeString()}`
    : 'High-risk actions locked';
  if (active) reauthTimer = setTimeout(() => showReauthState(null), Math.max(0, expiry.getTime() - Date.now()));
}

async function adminApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': adminConfiguration.csrfToken
        || document.querySelector('meta[name="csrf-token"]')?.content
        || '',
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || uiCopy.admin.actionFailed || 'Action failed');
  return data;
}

function text(value, fallback = 'Not retained') {
  if (value === null || value === undefined || value === '') return fallback === '' ? '' : 'Not retained';
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function dateTime(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return parsed.toLocaleString();
}

function cell(row, value, { header = false, fallback = 'Not retained' } = {}) {
  const element = document.createElement(header ? 'th' : 'td');
  if (header) element.scope = 'row';
  element.textContent = text(value, fallback);
  row.append(element);
  return element;
}

function badge(value, tone = '') {
  const element = document.createElement('span');
  element.className = `admin-badge ${tone}`.trim();
  element.textContent = text(value);
  return element;
}

function button(label, attributes = {}, className = 'admin-action') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  Object.entries(attributes).forEach(([name, value]) => element.dataset[name] = value);
  return element;
}

function setTableState(section, message, isError = false) {
  const state = document.querySelector(`[data-admin-state="${section}"]`);
  if (!state) return;
  state.textContent = message;
  state.classList.toggle('is-error', isError);
}

function clearTable(section) {
  document.querySelector(`[data-admin-table="${section}"]`)?.replaceChildren();
}

function appendUsers(users) {
  const body = document.querySelector('[data-admin-table="users"]');
  users.forEach((user) => {
    const row = document.createElement('tr');
    const account = cell(row, '', { header: true, fallback: '' });
    const name = document.createElement('strong');
    const displayName = user.display_name || (user.pii_purged_at ? 'Removed' : user.username) || 'Not retained';
    name.textContent = text(displayName);
    account.append(name);
    const idCell = cell(row, '', { fallback: '' });
    idCell.append(publicIdButton(user.public_id));
    cell(row, user.plan);
    cell(row, user.email || (user.email_retained_in_details ? 'Retained in Details' : 'Removed'));
    cell(row, user.age, { fallback: user.pii_purged_at ? 'Removed' : 'Not retained' });
    cell(row, user.country, { fallback: user.pii_purged_at ? 'Removed' : 'Not retained' });
    const banCell = cell(row, '', { fallback: '' });
    if (user.deleted_at && user.pii_purged_at) {
      banCell.replaceChildren(badge(`Deleted \u00b7 personal data removed on ${dateTime(user.pii_purged_at)}`));
    } else if (user.deleted_at) {
      banCell.replaceChildren(badge(`Deleted \u00b7 retained until ${dateTime(user.retention_until)}`));
    }
    else if (user.active_ban) {
      const expiry = user.active_ban_type === 'permanent' ? 'permanent' : `until ${dateTime(user.active_ban_ends_at)}`;
      banCell.replaceChildren(badge(`Banned · ${user.active_ban_type} · ${expiry}`, 'is-danger'));
    } else banCell.replaceChildren(badge('Active', 'is-success'));
    cell(row, Number(user.recent_chat_count || 0));
    cell(row, dateTime(user.last_seen_at));
    const actions = cell(row, '', { fallback: '' });
    actions.className = 'admin-actions-cell';
    actions.append(button('Details', { adminDetail: user.public_id }));
    if (user.active_ban) actions.append(button('Unban', { adminRevoke: 'account', adminBanId: String(user.active_ban_id) }, 'admin-action admin-action-danger'));
    else if (!user.deleted_at) actions.append(button('Ban', { adminBan: user.public_id }));
    body.append(row);
  });
}

function appendGuests(guests) {
  const body = document.querySelector('[data-admin-table="guests"]');
  guests.forEach((guest) => {
    const row = document.createElement('tr');
    cell(row, guest.name, { header: true });
    const idCell = cell(row, '', { fallback: '' });
    idCell.append(publicIdButton(guest.publicId));
    cell(row, guest.age);
    cell(row, guest.country);
    const banCell = cell(row, '', { fallback: '' });
    if (guest.activeBan) {
      const expiry = guest.activeBan.type === 'permanent' ? 'permanent' : `until ${dateTime(guest.activeBan.endsAt)}`;
      banCell.replaceChildren(badge(`${guest.status} · banned · ${guest.activeBan.type} · ${expiry}`, 'is-danger'));
    } else banCell.replaceChildren(badge(guest.status, guest.status === 'active' ? 'is-success' : ''));
    cell(row, Number(guest.recentChatCount || 0));
    cell(row, dateTime(guest.lastSeenAt));
    const actions = cell(row, '', { fallback: '' });
    actions.className = 'admin-actions-cell';
    actions.append(button('Details', { adminGuestDetail: guest.publicId }));
    if (guest.activeBanId) actions.append(button('Unban', { adminRevoke: 'guest', adminBanId: String(guest.activeBanId) }, 'admin-action admin-action-danger'));
    else if (guest.status === 'active') actions.append(button('Ban', { adminGuestBan: guest.publicId }));
    body.append(row);
  });
}

function abbreviatedId(value) {
  const id = text(value, '');
  return id.length > 15 ? `${id.slice(0, 12)}…` : id;
}

function announceCopy(message) {
  const feedback = document.getElementById('adminCopyFeedback');
  if (feedback) feedback.textContent = message;
}

function publicIdButton(value) {
  const id = text(value, '');
  const control = button(abbreviatedId(id), {}, 'admin-id-copy');
  control.dataset.adminCopyId = id;
  control.title = id;
  control.setAttribute('aria-label', `Copy public ID ${id}`);
  return control;
}

function appendReports(reports) {
  const body = document.querySelector('[data-admin-table="reports"]');
  reports.forEach((report) => {
    const row = document.createElement('tr');
    cell(row, dateTime(report.created_at));
    cell(row, report.reporter_name || report.reporter_guest_public_id || 'Guest');
    cell(row, report.reported_name || report.reported_guest_public_id || 'Guest');
    cell(row, report.reason);
    const state = cell(row, '');
    state.replaceChildren(badge(report.status));
    cell(row, report.has_evidence ? 'Captured' : 'Not captured');
    body.append(row);
  });
}

function appendBans(bans) {
  const body = document.querySelector('[data-admin-table="bans"]');
  bans.forEach((ban) => {
    const row = document.createElement('tr');
    cell(row, ban.scope, { header: true });
    cell(row, ban.target_label || ban.user_name || ban.user_public_id);
    cell(row, ban.type);
    cell(row, ban.reason);
    cell(row, ban.type === 'permanent' ? 'Permanent' : dateTime(ban.ends_at));
    const state = cell(row, '');
    state.replaceChildren(badge(ban.revoked_at ? 'Revoked' : 'Active', ban.revoked_at ? '' : 'is-danger'));
    const actions = cell(row, '', { fallback: '' });
    actions.className = 'admin-actions-cell';
    if (ban.scope === 'account' && ban.user_public_id) {
      actions.append(button('Details', { adminDetail: ban.user_public_id }));
    } else if (ban.scope === 'network') {
      actions.append(button('Details', { adminNetworkDetail: String(ban.ban_id) }));
    }
    if (!ban.revoked_at) actions.append(button('Revoke', {
      adminRevoke: ban.scope,
      adminBanId: String(ban.ban_id)
    }, 'admin-action admin-action-danger'));
    body.append(row);
  });
}

function appendAudit(records) {
  const body = document.querySelector('[data-admin-table="audit"]');
  records.forEach((record) => {
    const row = document.createElement('tr');
    cell(row, dateTime(record.created_at));
    cell(row, record.actor_name || record.actor_public_id || 'System');
    cell(row, record.target_name || record.target_public_id || record.target_type);
    cell(row, record.action);
    cell(row, record.reason);
    body.append(row);
  });
}

const renderers = { users: appendUsers, guests: appendGuests, reports: appendReports, bans: appendBans, audit: appendAudit };

async function loadSection(section, { reset = false } = {}) {
  const state = sectionState[section];
  if (!state || state.loading || (state.loaded && !reset)) return;
  if (reset) {
    state.cursor = null;
    state.loaded = false;
    clearTable(section);
  }
  state.loading = true;
  setTableState(section, 'Loading…');
  const query = new URLSearchParams(state.filters);
  query.set('limit', '30');
  if (state.cursor) query.set('cursor', state.cursor);
  try {
    const data = await adminApi(`/api/admin/${section}?${query.toString()}`);
    const items = data[section] || [];
    renderers[section](items);
    state.cursor = data.page?.nextCursor || null;
    state.loaded = true;
    setTableState(section, items.length ? '' : 'No matching records.');
    const pagination = document.querySelector(`[data-admin-pagination="${section}"]`);
    if (pagination) pagination.hidden = !state.cursor;
  } catch (error) {
    setTableState(section, error.message, true);
  } finally {
    state.loading = false;
  }
}

function selectTab(section) {
  sections.forEach((name) => {
    const active = name === section;
    const tab = document.querySelector(`[data-admin-tab="${name}"]`);
    const panel = document.querySelector(`[data-admin-panel="${name}"]`);
    tab?.setAttribute('aria-selected', String(active));
    if (panel) panel.hidden = !active;
  });
  loadSection(section);
  if (section === 'bans') loadNetworkReviews();
}

function openActionDialog(kind, values = {}) {
  const dialog = document.getElementById('adminActionDialog');
  const title = document.getElementById('adminActionTitle');
  const description = document.getElementById('adminActionDescription');
  const target = document.getElementById('adminActionTarget');
  const banId = document.getElementById('adminActionBanId');
  const type = document.getElementById('adminActionType');
  const typeLabel = document.getElementById('adminActionTypeLabel');
  const hours = document.getElementById('adminActionHours');
  const hoursLabel = document.getElementById('adminActionHoursLabel');
  const submit = document.getElementById('adminActionSubmit');
  document.getElementById('adminActionReason').value = '';
  target.value = values.target || '';
  banId.value = values.banId || '';
  pendingAction = kind;
  if (kind === 'ban') {
    title.textContent = 'Ban account';
    description.textContent = 'Choose the ban type and provide a specific moderation reason.';
    type.hidden = false;
    typeLabel.hidden = false;
    hours.hidden = false;
    hoursLabel.hidden = false;
    submit.textContent = 'Create ban';
  } else if (kind === 'guest-ban') {
    title.textContent = 'Restrict guest';
    description.textContent = 'Choose a temporary or permanent guest restriction and provide a specific moderation reason.';
    type.value = 'temporary';
    type.hidden = false;
    typeLabel.hidden = false;
    hours.hidden = false;
    hoursLabel.hidden = false;
    submit.textContent = 'Restrict guest';
  } else {
    title.textContent = 'Revoke ban';
    description.textContent = 'Provide the reason for revoking this moderation action.';
    type.hidden = true;
    typeLabel.hidden = true;
    hours.hidden = true;
    hoursLabel.hidden = true;
    submit.textContent = 'Revoke ban';
  }
  const needsDuration = (kind === 'ban' || kind === 'guest-ban') && type.value === 'temporary';
  hours.hidden = !needsDuration;
  hoursLabel.hidden = !needsDuration;
  hours.required = needsDuration;
  dialog.showModal();
  document.getElementById('adminActionReason').focus();
}

document.getElementById('adminActionType')?.addEventListener('change', (event) => {
  const visible = event.currentTarget.value === 'temporary';
  const hours = document.getElementById('adminActionHours');
  const label = document.getElementById('adminActionHoursLabel');
  if (hours) { hours.hidden = !visible; hours.required = visible; }
  if (label) label.hidden = !visible;
});

async function openAccountDetail(publicId) {
  const dialog = document.getElementById('adminDetailDialog');
  const content = document.getElementById('adminDetailContent');
  document.getElementById('adminDetailTitle').textContent = 'Account details';
  content.replaceChildren(document.createTextNode('Loading account…'));
  dialog.showModal();
  try {
    const [detail, moderation] = await Promise.all([
      adminApi(`/api/admin/users/${encodeURIComponent(publicId)}`),
      adminApi(`/api/admin/users/${encodeURIComponent(publicId)}/moderation?limit=10`)
    ]);
    const user = detail.user;
    const summary = document.createElement('dl');
    summary.className = 'admin-detail-list';
    const removed = user.personalDataRemoved;
    const summaryFields = [
      ['Public ID', user.publicId], ['Name', user.displayName || (removed ? 'Removed' : 'Not retained')],
      ['Username', user.username || (removed ? 'Removed' : 'Not retained')],
      ['Email', user.email || (removed ? 'Removed' : 'Not retained')],
      ['Role', user.role], ['Plan', user.plan], ['Age', user.age], ['Country', user.country],
      ['Email verification', removed ? 'Removed' : (user.emailVerifiedAt ? `Verified ${dateTime(user.emailVerifiedAt)}` : 'Not verified')],
      ['Recent chats', user.recentChatCount], ['Last seen', dateTime(user.lastSeenAt)],
      ['Active ban', user.activeBan ? `${user.activeBan.type} \u00b7 ${user.activeBan.reason}` : 'None']
    ];
    if (user.deletedAt) {
      summaryFields.push(['Deleted at', dateTime(user.deletedAt)]);
      if (user.piiPurgedAt) {
        summaryFields.push(['Data lifecycle', `Deleted \u00b7 personal data removed on ${dateTime(user.piiPurgedAt)}`]);
      } else {
        summaryFields.push(['Scheduled data removal', dateTime(user.retentionUntil)]);
        summaryFields.push(['Data lifecycle', `Deleted \u00b7 retained until ${dateTime(user.retentionUntil)}`]);
      }
    }
    summaryFields.forEach(([label, value]) => {
      const term = document.createElement('dt'); term.textContent = label;
      const definition = document.createElement('dd'); definition.textContent = text(value);
      summary.append(term, definition);
    });
    const heading = document.createElement('h3'); heading.textContent = 'Moderation history';
    const history = document.createElement('ul'); history.className = 'admin-history-list';
    const records = moderation.moderation || [];
    if (!records.length) {
      const item = document.createElement('li'); item.textContent = 'No moderation records.'; history.append(item);
    } else {
      records.forEach((record) => {
        const item = document.createElement('li');
        item.textContent = `${dateTime(record.created_at)} \u00b7 ${record.action} \u00b7 ${record.reason}`;
        history.append(item);
      });
    }
    content.replaceChildren(summary, heading, history);
  } catch (error) {
    content.replaceChildren(document.createTextNode(error.message));
  }
}

async function openGuestDetail(guestId) {
  const dialog = document.getElementById('adminDetailDialog');
  const content = document.getElementById('adminDetailContent');
  document.getElementById('adminDetailTitle').textContent = 'Guest details';
  content.replaceChildren(document.createTextNode('Loading guest…'));
  dialog.showModal();
  try {
    const { guest } = await adminApi(`/api/admin/guests/${encodeURIComponent(guestId)}`);
    const summary = document.createElement('dl');
    summary.className = 'admin-detail-list';
    [
      ['Guest ID', guest.publicId], ['Name', guest.name], ['State', guest.status], ['Age', guest.age],
      ['Country', guest.country], ['Created', dateTime(guest.createdAt)], ['Recent chats', guest.recentChatCount],
      ['Last seen', dateTime(guest.lastSeenAt)],
      ['Restriction', guest.activeBan ? `${guest.activeBan.type} ${guest.activeBan.endsAt ? `until ${dateTime(guest.activeBan.endsAt)}` : '(no scheduled end)'}: ${guest.activeBan.reason}` : 'None'],
      ...(guest.status === 'deleted' && guest.deletedAt ? [
        ['Deleted at', dateTime(guest.deletedAt)],
        ['Scheduled data removal', dateTime(guest.retentionUntil)],
        ['Data lifecycle', `Deleted \u00b7 retained until ${dateTime(guest.retentionUntil)}`]
      ] : [])
    ].forEach(([label, value]) => {
      const term = document.createElement('dt'); term.textContent = label;
      const definition = document.createElement('dd'); definition.textContent = text(value);
      summary.append(term, definition);
    });
    content.replaceChildren(summary);
  } catch (error) {
    content.replaceChildren(document.createTextNode(error.message));
  }
}

async function openNetworkBanDetail(banId) {
  const dialog = document.getElementById('adminDetailDialog');
  const content = document.getElementById('adminDetailContent');
  document.getElementById('adminDetailTitle').textContent = 'Network ban details';
  content.replaceChildren(document.createTextNode('Loading network ban…'));
  dialog.showModal();
  try {
    const { networkBan } = await adminApi(`/api/admin/network-bans/${encodeURIComponent(banId)}`);
    const summary = document.createElement('dl');
    summary.className = 'admin-detail-list';
    const linkedBan = networkBan.sourceAccountBan
      ? `${networkBan.sourceAccountBan.status} \u00b7 ${networkBan.sourceAccountBan.type}${networkBan.sourceAccountBan.endsAt ? ` \u00b7 until ${dateTime(networkBan.sourceAccountBan.endsAt)}` : ''}`
      : 'Not applicable';
    const fields = [
      ['Network reference', networkBan.networkReference],
      ['Origin', networkBan.sourceType === 'account' ? 'Account-derived' : 'Manual'],
      ...(networkBan.sourcePublicId ? [['Source Public ID', networkBan.sourcePublicId]] : []),
      ['Linked account ban', linkedBan],
      ['Address family', networkBan.addressFamily === 4 ? 'IPv4' : 'IPv6'],
      ['Prefix length', `/${networkBan.prefixLength}`],
      ['Requested by', networkBan.requestedByPublicId || 'Not retained'],
      ['Privacy reviewer', networkBan.privacyReviewerPublicId || 'Not retained'],
      ['Privacy reviewed at', dateTime(networkBan.privacyReviewedAt)],
      ['Reason', networkBan.reason],
      ['Started', dateTime(networkBan.startsAt)],
      ['Expires', dateTime(networkBan.endsAt)],
      ['Status', networkBan.status]
    ];
    if (networkBan.revocation) {
      fields.push(
        ['Revoked at', dateTime(networkBan.revocation.revokedAt)],
        ['Revoked by', networkBan.revocation.revokedByPublicId || 'Not retained'],
        ['Revocation reason', networkBan.revocation.reason]
      );
    }
    fields.forEach(([label, value]) => {
      const term = document.createElement('dt'); term.textContent = label;
      const definition = document.createElement('dd'); definition.textContent = text(value);
      summary.append(term, definition);
    });
    content.replaceChildren(summary);
  } catch (error) {
    content.replaceChildren(document.createTextNode(error.message));
  }
}

document.querySelectorAll('[data-admin-tab]').forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.adminTab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length;
    document.querySelector(`[data-admin-tab="${sections[next]}"]`)?.focus();
    selectTab(sections[next]);
  });
});

document.querySelectorAll('[data-admin-filter]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const section = form.dataset.adminFilter;
    sectionState[section].filters = new URLSearchParams(new FormData(form));
    loadSection(section, { reset: true });
  });
});

document.querySelectorAll('[data-admin-more]').forEach((control) => {
  control.addEventListener('click', () => loadSection(control.dataset.adminMore));
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-admin-unlock]')) {
    selectTab('controls');
    document.getElementById('admin-password')?.focus() || document.getElementById('admin-reauth-code')?.focus();
    return;
  }
  const copyId = event.target.closest('[data-admin-copy-id]');
  if (copyId) {
    navigator.clipboard?.writeText(copyId.dataset.adminCopyId || '')
      .then(() => announceCopy('Public ID copied.'))
      .catch(() => announceCopy('Unable to copy the public ID. Select it from the details view.'));
    return;
  }
  const detail = event.target.closest('[data-admin-detail]');
  if (detail) return openAccountDetail(detail.dataset.adminDetail);
  const guestDetail = event.target.closest('[data-admin-guest-detail]');
  if (guestDetail) return openGuestDetail(guestDetail.dataset.adminGuestDetail);
  const networkDetail = event.target.closest('[data-admin-network-detail]');
  if (networkDetail) return openNetworkBanDetail(networkDetail.dataset.adminNetworkDetail);
  const ban = event.target.closest('[data-admin-ban]');
  if (ban) return openActionDialog('ban', { target: ban.dataset.adminBan });
  const guestBan = event.target.closest('[data-admin-guest-ban]');
  if (guestBan) return openActionDialog('guest-ban', { target: guestBan.dataset.adminGuestBan });
  const revoke = event.target.closest('[data-admin-revoke]');
  if (revoke) return openActionDialog(`revoke-${revoke.dataset.adminRevoke}`, { banId: revoke.dataset.adminBanId });
  if (event.target.closest('[data-admin-dialog-close]')) document.querySelectorAll('.admin-dialog[open]').forEach((dialog) => dialog.close());
});

document.getElementById('adminActionForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !pendingAction) return;
  const values = Object.fromEntries(new FormData(form));
  try {
    if (pendingAction === 'ban') {
      await adminApi(`/api/admin/users/${encodeURIComponent(values.target)}/ban`, {
        method: 'POST', body: JSON.stringify({
          type: values.type,
          ...(values.type === 'temporary' ? { hours: Number(values.hours) } : {}),
          reason: values.reason
        })
      });
      await loadSection('users', { reset: true });
      await loadSection('bans', { reset: true });
    } else if (pendingAction === 'guest-ban') {
      await adminApi(`/api/admin/guests/${encodeURIComponent(values.target)}/ban`, {
        method: 'POST', body: JSON.stringify({
          type: values.type,
          ...(values.type === 'temporary' ? { hours: Number(values.hours) } : {}),
          reason: values.reason
        })
      });
      await loadSection('guests', { reset: true });
      await loadSection('bans', { reset: true });
    } else {
      const scope = pendingAction === 'revoke-network' ? 'network-bans'
        : (pendingAction === 'revoke-guest' ? 'guest-bans' : 'account-bans');
      await adminApi(`/api/admin/${scope}/${encodeURIComponent(values.banId)}/revoke`, {
        method: 'PATCH', body: JSON.stringify({ reason: values.reason })
      });
      await loadSection('bans', { reset: true });
      await loadSection('users', { reset: true });
      await loadSection('guests', { reset: true });
    }
    document.getElementById('adminActionDialog').close();
  } catch (error) {
    document.getElementById('adminActionDescription').textContent = error.message;
  }
});

document.getElementById('adminPriceForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await adminApi('/api/admin/prices', { method: 'POST', body: JSON.stringify(values) });
    window.location.reload();
  } catch (error) {
    window.alert(error.message);
  }
});

document.getElementById('networkApprovalRequestForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = document.querySelector('[data-network-feedback="request"]');
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const manual = document.getElementById('networkManualDisclosure')?.open;
    const result = await adminApi('/api/admin/network-ban-privacy-approvals', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: manual ? 'manual' : 'account',
        publicId: manual ? undefined : values.publicId,
        cidr: manual ? values.cidr : undefined,
        hours: Number(values.hours),
        reason: values.reason
      })
    });
    feedback.textContent = `Review requested. Approval ID: ${result.approvalId}`;
    event.currentTarget.reset();
    document.getElementById('networkManualDisclosure').open = false;
    syncNetworkSourceMode();
    await loadNetworkReviews();
  } catch (error) {
    feedback.textContent = error.message;
  }
});

function syncNetworkSourceMode() {
  const manual = Boolean(document.getElementById('networkManualDisclosure')?.open);
  const publicId = document.getElementById('network-request-public-id');
  const cidr = document.getElementById('network-request-cidr');
  if (publicId) publicId.required = !manual;
  if (cidr) cidr.required = manual;
}

document.getElementById('networkManualDisclosure')?.addEventListener('toggle', syncNetworkSourceMode);

function reviewTerm(list, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const definition = document.createElement('dd');
  definition.textContent = text(value);
  list.append(term, definition);
}

function renderNetworkReviews(reviews) {
  const container = document.getElementById('networkPendingReviews');
  const count = document.getElementById('networkPendingCount');
  if (!container || !count) return;
  count.textContent = `${reviews.length} privacy review${reviews.length === 1 ? '' : 's'} pending`;
  container.setAttribute('aria-busy', 'false');
  if (!reviews.length) {
    container.replaceChildren(document.createTextNode('No pending network reviews.'));
    return;
  }
  const cards = reviews.map((review) => {
    const card = document.createElement('article');
    card.className = 'admin-pending-review';
    const heading = document.createElement('h4');
    heading.textContent = review.sourcePublicId || 'Manual network scope';
    const details = document.createElement('dl');
    details.className = 'admin-detail-list admin-review-metadata';
    reviewTerm(details, 'Account ban', review.sourceType === 'account'
      ? (review.sourceAccountBanActive ? 'Active' : 'No longer active') : 'Not applicable');
    reviewTerm(details, 'Reason', review.reason);
    reviewTerm(details, 'Proposed duration', `${review.durationHours} hours`);
    reviewTerm(details, 'Scope', `IPv${review.addressFamily} /${review.prefixLength}`);
    reviewTerm(details, 'Network reference', review.networkReference);
    reviewTerm(details, 'Requested by', review.requesterPublicId);
    reviewTerm(details, 'Review expires', dateTime(review.expiresAt));
    const form = document.createElement('form');
    form.className = 'admin-risk-form admin-review-form';
    form.dataset.networkReviewId = review.id;
    if (review.sourceType === 'manual') {
      const label = document.createElement('label');
      label.textContent = 'Re-enter exact CIDR';
      const input = document.createElement('input');
      input.name = 'cidr'; input.required = true; input.autocomplete = 'off';
      label.append(input); form.append(label);
    }
    const reasonLabel = document.createElement('label');
    reasonLabel.textContent = 'Review reason';
    const reason = document.createElement('textarea');
    reason.name = 'reason'; reason.required = true; reason.minLength = 3; reason.maxLength = 500;
    reasonLabel.append(reason);
    const actions = document.createElement('div');
    actions.className = 'admin-review-actions';
    const reject = document.createElement('button');
    reject.type = 'submit'; reject.name = 'decision'; reject.value = 'reject'; reject.className = 'btn btn-secondary'; reject.textContent = 'Reject';
    const approve = document.createElement('button');
    approve.type = 'submit'; approve.name = 'decision'; approve.value = 'approve'; approve.className = 'btn btn-primary'; approve.textContent = 'Approve and create ban';
    actions.append(reject, approve);
    const feedback = document.createElement('p');
    feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    form.append(reasonLabel, actions, feedback);
    card.append(heading, details, form);
    return card;
  });
  container.replaceChildren(...cards);
}

async function loadNetworkReviews() {
  const container = document.getElementById('networkPendingReviews');
  const count = document.getElementById('networkPendingCount');
  if (!container || !count) return;
  container.setAttribute('aria-busy', 'true');
  container.textContent = 'Loading pending reviews…';
  try {
    const result = await adminApi('/api/admin/network-ban-privacy-approvals?limit=50');
    renderNetworkReviews(result.reviews || []);
  } catch (error) {
    container.setAttribute('aria-busy', 'false');
    container.textContent = error.message;
    container.classList.add('is-error');
    count.textContent = 'Pending reviews unavailable';
  }
}

document.getElementById('networkPendingReviews')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('[data-network-review-id]');
  if (!form) return;
  const submitter = event.submitter;
  const decision = submitter?.value === 'reject' ? 'reject' : 'approve';
  const feedback = form.querySelector('[role="status"]');
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await adminApi(`/api/admin/network-ban-privacy-approvals/${encodeURIComponent(form.dataset.networkReviewId)}/${decision}`, {
      method: 'POST', body: JSON.stringify({ reason: values.reason, cidr: values.cidr })
    });
    feedback.textContent = decision === 'approve'
      ? `Network ban created until ${dateTime(result.ban?.endsAt)}.`
      : 'Network review rejected.';
    await loadSection('bans', { reset: true });
    await loadNetworkReviews();
  } catch (error) {
    feedback.textContent = error.message;
  }
});

document.getElementById('networkReviewsRefresh')?.addEventListener('click', loadNetworkReviews);

document.getElementById('adminReauthForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (adminConfiguration.reauthMethod !== 'password') return;
  const feedback = document.getElementById('adminReauthFeedback');
  try {
    const result = await adminApi('/api/admin/reauth', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    feedback.textContent = uiCopy.admin?.reauthenticationComplete || 'Re-authentication complete.';
    showReauthState(result.expiresAt);
  } catch (error) {
    feedback.textContent = error.message;
  }
});

window.handleAdminGoogleReauth = async ({ credential } = {}) => {
  if (adminConfiguration.reauthMethod !== 'google' || !credential) return;
  const form = document.getElementById('adminReauthForm');
  const feedback = document.getElementById('adminReauthFeedback');
  if (!form?.reportValidity()) return;
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await adminApi('/api/admin/reauth', { method: 'POST', body: JSON.stringify({ ...values, credential }) });
    feedback.textContent = uiCopy.admin?.reauthenticationComplete || 'Re-authentication complete.';
    showReauthState(result.expiresAt);
  } catch (error) {
    feedback.textContent = error.message;
  }
};

if (document.querySelector('[data-admin-table="users"]')) loadSection('users');
showReauthState(adminConfiguration.reauthExpiresAt);
