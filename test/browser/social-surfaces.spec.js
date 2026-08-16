const { expect, test } = require('@playwright/test');

test('recent conversations show server-capability actions instead of the message composer', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/socket.io/socket.io.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.io = () => ({
      connected: false,
      on() { return this; },
      emit() { return this; },
      timeout() { return this; },
      disconnect() { return this; },
      connect() { return this; }
    });`
  }));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}'
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, '__CURRENT_USER__', {
      configurable: false,
      writable: false,
      value: {
        publicId: 'nvy_aabbccddeeff',
        displayName: 'Synthetic Account',
        emailVerified: true,
        role: 'user',
        plan: 'free'
      }
    });
  });
  const conversation = {
    id: 81,
    public_id: 'cnv_0123456789abcdef01234567',
    type: 'direct',
    status: 'ended',
    started_at: new Date().toISOString(),
    partner_name: 'History Partner',
    partner_public_id: 'nvy_0123456789ab',
    saved: false,
    capabilities: {
      canAddFriend: true,
      canSave: true,
      canUnsave: false,
      canBlock: true,
      canRemoveFromHistory: true,
      canDeleteUnsavedMessages: true
    }
  };
  await page.route('**/api/conversations/81/messages**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ conversation, messages: [], page: { hasMore: false } })
  }));
  await page.route('**/api/conversations**', (route) => {
    if (new URL(route.request().url()).pathname !== '/api/conversations') {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        conversations: [conversation],
        directInbox: { active: [], recent: [conversation], limit: 5 },
        unreadCount: 0,
        messageBadgeCount: 0,
        page: { hasMore: false }
      })
    });
  });
  await page.route('**/api/friend-requests**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], pendingCount: 0, page: { hasMore: false } })
  }));
  await page.route('**/api/notifications**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ notifications: [], unreadCount: 0, page: { hasMore: false } })
  }));

  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  expect(pageErrors).toEqual([]);
  await page.locator('#messagesToggle').click();
  await expect(page.locator('#messagesDrawer')).toBeVisible();
  await page.locator('#messagesTabRecent').click();
  await page.getByRole('button', { name: /History Partner/ }).click();

  await expect(page.locator('#liveComposerBar')).toBeHidden();
  const toolbar = page.getByRole('toolbar', { name: 'Conversation actions' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Add friend' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Save chat' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Block' })).toBeVisible();
  await expect(page.locator('#statusText')).toHaveText('Viewing a recent conversation');

  await page.locator('#conversationMenuBtn').click();
  await expect(page.locator('#addFriendMenuBtn')).toBeVisible();
  await expect(page.locator('#saveConversationBtn')).toBeVisible();
  await expect(page.locator('#blockPartnerBtn')).toBeVisible();
  await expect(page.locator('#removeConversationHistoryBtn')).toBeVisible();
  await expect(page.locator('#deleteUnsavedMessagesBtn')).toBeVisible();
  await expect(page.locator('#historySaveBtn .lucide-bookmark')).toHaveCount(1);
  await page.locator('#removeConversationHistoryBtn').click();
  await expect(page.locator('#friendSafetyConfirmModal')).toBeVisible();
  await expect(page.locator('#friendSafetyConfirmDescription')).toHaveText(
    'Remove this conversation from your history? This won’t affect the other person.'
  );
  await page.locator('#friendSafetyConfirmCancel').click();
});

test('friend list exposes only server capabilities with accessible responsive menus', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__CURRENT_USER__', {
      configurable: false,
      writable: false,
      value: {
        publicId: 'nvy_aabbccddeeff',
        displayName: 'Synthetic Account',
        emailVerified: true,
        role: 'user',
        plan: 'free'
      }
    });
  });

  let friendsError = false;
  let removed = false;
  let firstFriendsLoad = true;
  await page.route('**/api/friends**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'DELETE') {
      removed = true;
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname !== '/api/friends') return route.continue();
    if (firstFriendsLoad) {
      firstFriendsLoad = false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (friendsError) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unavailable' })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        friends: removed ? [] : [{
          public_id: 'nvy_0123456789ab',
          display_name: 'Astra Friend',
          online: true,
          capabilities: {
            canStartDirectChat: true,
            canRemoveFriend: true,
            canBlock: false
          }
        }],
        page: { limit: 30, hasMore: false, nextCursor: null }
      })
    });
  });
  await page.route('**/api/friend-requests**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], pendingCount: 0, page: { hasMore: false } })
  }));
  await page.route('**/api/notifications**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ notifications: [], unreadCount: 0, page: { hasMore: false } })
  }));
  await page.route('**/api/conversations**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ conversations: [], unreadCount: 0, page: { hasMore: false } })
  }));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#guestPassportModal')).toBeHidden();
  await page.locator('#friendsToggle').click();
  await expect(page.locator('#friendsPanelList')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#friendsPanelList .panel-load-state')).toContainText('Loading friends');
  await expect(page.locator('.friend-list-item')).toContainText('Astra Friend');

  const trigger = page.getByRole('button', { name: 'Actions for Astra Friend' });
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox.height).toBeGreaterThanOrEqual(44);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Start chat' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Remove friend' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Block' })).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Remove friend' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1366, height: 640 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    const screenshot = testInfo.outputPath(`n5.3.2-friends-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`N5.3.2 friends ${viewport.width}x${viewport.height}`, {
      path: screenshot,
      contentType: 'image/png'
    });
    const bounds = await page.locator('#friendsDrawer').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  friendsError = true;
  await page.evaluate(() => loadFriendsPanel());
  await expect(page.locator('#friendsPanelList [role="alert"]')).toContainText('couldn’t load your friends');
  const retry = page.getByRole('button', { name: 'Try again' });
  const retryBox = await retry.boundingBox();
  expect(retryBox.height).toBeGreaterThanOrEqual(44);
  friendsError = false;
  await retry.click();
  await expect(page.locator('.friend-list-item')).toContainText('Astra Friend');

  await page.getByRole('button', { name: 'Actions for Astra Friend' }).click();
  await page.getByRole('menuitem', { name: 'Remove friend' }).click();
  await expect(page.locator('#friendSafetyConfirmModal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(page.locator('#friendSafetyConfirmDescription')).toContainText('Remove Astra Friend');
  await page.locator('#friendSafetyConfirmSubmit').click();
  await expect(page.locator('#friendsPanelEmpty')).toBeVisible();
  await expect(page.locator('.friend-list-item')).toHaveCount(0);
});

test('friendship notifications link to Friend requests and accepted notices can be dismissed', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__CURRENT_USER__', {
      configurable: false,
      writable: false,
      value: {
        publicId: 'nvy_aabbccddeeff',
        displayName: 'Synthetic Account',
        emailVerified: true,
        role: 'user',
        plan: 'free'
      }
    });
  });
  let firstLoad = true;
  let notification = {
    id: 'ntf_0123456789abcdef01234567',
    public_id: 'ntf_0123456789abcdef01234567',
    type: 'friend_accepted',
    title: 'Friend request accepted',
    body: 'Astra Friend accepted your request.',
    data: { userPublicId: 'nvy_0123456789ab' },
    actor: {
      publicId: 'nvy_0123456789ab',
      displayName: 'Astra Friend',
      profileImageUrl: '/vendor/dicebear-presets-10.2.0/astra.svg'
    },
    read_at: null,
    created_at: new Date().toISOString()
  };
  await page.route('**/api/friends**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ friends: [], page: { hasMore: false } })
  }));
  await page.route('**/api/notifications**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      notification = notification ? { ...notification, read_at: new Date().toISOString() } : null;
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'DELETE') {
      notification = null;
      return route.fulfill({ status: 204, body: '' });
    }
    if (firstLoad) {
      firstLoad = false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        notifications: notification ? [notification] : [],
        unreadCount: notification && !notification.read_at ? 1 : 0,
        page: { limit: 30, hasMore: false, nextCursor: null }
      })
    });
  });
  await page.route('**/api/friend-requests**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], pendingCount: 0, page: { hasMore: false } })
  }));
  await page.route('**/api/conversations**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ conversations: [], unreadCount: 0, page: { hasMore: false } })
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  firstLoad = true;
  await page.locator('#notificationsToggle').click();
  await expect(page.locator('#notificationsPanelList')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.notification-list-item')).toContainText('Friend request accepted');
  const friendshipNotification = page.getByRole('button', { name: /Friend request accepted.*Open Friend requests/ });
  await expect(friendshipNotification).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
  await expect(friendshipNotification.locator('.panel-item-avatar-image')).toHaveAttribute(
    'src',
    '/vendor/dicebear-presets-10.2.0/astra.svg'
  );

  const screenshot = testInfo.outputPath('n5.3.2-notifications-390x844.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('N5.3.2 notifications 390x844', { path: screenshot, contentType: 'image/png' });

  await friendshipNotification.click();
  await expect(page.locator('#friendsDrawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#friendsTabRequests')).toHaveAttribute('aria-selected', 'true');
});

test('direct chat request notifications open Conversations and preserve inline controls', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__CURRENT_USER__', {
      configurable: false,
      writable: false,
      value: {
        publicId: 'nvy_aabbccddeeff', displayName: 'Synthetic Account',
        emailVerified: true, role: 'user', plan: 'free'
      }
    });
  });
  const requestId = 'crq_0123456789abcdef01234567';
  await page.route('**/api/notifications**', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        notifications: [{
          id: 'ntf_0123456789abcdef01234567', type: 'chat_request',
          title: 'New chat request', body: 'Astra Friend wants to chat.',
          data: { requestPublicId: requestId, userPublicId: 'nvy_0123456789ab' },
          actor: {
            publicId: 'nvy_0123456789ab', displayName: 'Astra Friend',
            profileImageUrl: '/vendor/dicebear-presets-10.2.0/astra.svg'
          },
          read_at: null, created_at: new Date().toISOString()
        }],
        unreadCount: 1,
        page: { limit: 30, hasMore: false, nextCursor: null }
      })
    });
  });
  await page.route('**/api/conversations**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ conversations: [], directInbox: { active: [], recent: [], limit: 5 }, messageBadgeCount: 1 })
  }));
  await page.route('**/api/friend-requests**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], pendingCount: 0 })
  }));
  await page.route('**/api/chat-requests**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      requests: [{
        id: requestId, public_id: requestId, person_public_id: 'nvy_0123456789ab',
        display_name: 'Astra Friend', expires_at: new Date(Date.now() + 60_000).toISOString()
      }],
      direction: 'incoming', pendingCount: 1, page: { hasMore: false }
    })
  }));
  await page.route('**/api/friends**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ friends: [] })
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#notificationsToggle').click();
  const notification = page.getByRole('button', { name: /New chat request.*Open Conversations/ });
  await notification.click();
  await expect(page.locator('#messagesDrawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#messagesTabInbox')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#chatRequestsSection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept chat request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline chat request' })).toBeVisible();
});

test('chat requests stay hidden when empty and render incoming and outgoing actions responsively', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__CURRENT_USER__', {
      configurable: false,
      writable: false,
      value: {
        publicId: 'nvy_aabbccddeeff',
        displayName: 'Synthetic Account',
        emailVerified: true,
        role: 'user',
        plan: 'free'
      }
    });
  });
  let incoming = [];
  let outgoing = [];
  await page.route('**/api/chat-requests**', (route) => {
    const direction = new URL(route.request().url()).searchParams.get('direction') === 'outgoing'
      ? 'outgoing'
      : 'incoming';
    const requests = direction === 'outgoing' ? outgoing : incoming;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requests,
        direction,
        pendingCount: requests.length,
        page: { limit: 30, hasMore: false, nextCursor: null }
      })
    });
  });
  await page.route('**/api/conversations**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ conversations: [], unreadCount: 0, page: { hasMore: false } })
  }));
  await page.route('**/api/friend-requests**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], pendingCount: 0, page: { hasMore: false } })
  }));
  await page.route('**/api/notifications**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ notifications: [], unreadCount: 0, page: { hasMore: false } })
  }));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#guestPassportModal')).toBeHidden();
  await page.locator('#messagesToggle').click();
  await expect(page.locator('#chatRequestsSection')).toBeHidden();

  incoming = [{
    id: 'crq_0123456789abcdef01234567',
    public_id: 'crq_0123456789abcdef01234567',
    person_public_id: 'nvy_0123456789ab',
    display_name: 'Incoming Friend',
    expires_at: new Date(Date.now() + 60_000).toISOString()
  }];
  outgoing = [{
    id: 'crq_89abcdef0123456701234567',
    public_id: 'crq_89abcdef0123456701234567',
    person_public_id: 'nvy_89abcdef0123',
    display_name: 'Outgoing Friend',
    expires_at: new Date(Date.now() + 60_000).toISOString()
  }];
  await page.evaluate(() => loadChatRequestsPanel());
  await expect(page.locator('#chatRequestsSection')).toBeVisible();
  await expect(page.locator('#chatRequestsPanelList')).toContainText('Wants to chat');
  await expect(page.locator('#chatRequestsPanelList')).toContainText('Chat request pending');
  const accept = page.getByRole('button', { name: 'Accept chat request' });
  const decline = page.getByRole('button', { name: 'Decline chat request' });
  const cancel = page.getByRole('button', { name: 'Cancel chat request' });
  for (const action of [accept, decline, cancel]) {
    const bounds = await action.boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await accept.focus();
  await expect(accept).toBeFocused();

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1366, height: 640 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const drawer = await page.locator('#messagesDrawer').boundingBox();
      return Math.ceil(drawer.x + drawer.width);
    }).toBeLessThanOrEqual(viewport.width + 1);
    const screenshot = testInfo.outputPath(`n5.3.2-chat-requests-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`N5.3.2 chat requests ${viewport.width}x${viewport.height}`, {
      path: screenshot,
      contentType: 'image/png'
    });
    const drawer = await page.locator('#messagesDrawer').boundingBox();
    expect(drawer.x).toBeGreaterThanOrEqual(0);
    expect(drawer.x + drawer.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  incoming = [];
  outgoing = [];
  await page.evaluate(() => loadChatRequestsPanel());
  await expect(page.locator('#chatRequestsSection')).toBeHidden();
});
