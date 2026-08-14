const { expect, test } = require('@playwright/test');

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
  await expect(page.locator('#friendsPanelEmpty')).toBeVisible();
  await expect(page.locator('.friend-list-item')).toHaveCount(0);
});
