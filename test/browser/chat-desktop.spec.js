const { expect, test } = require('@playwright/test');

async function completeGuestPassport(page, name = 'Synthetic Desktop Guest') {
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#guestPassportModal')).toBeVisible();
  await page.locator('#usernameInput').fill(name);
  await page.locator('#ageInput').selectOption('28');
  await page.locator('#guestCountrySearch').fill('Switzerland');
  await page.locator('#guestCountrySuggestions').getByRole('option', { name: 'Switzerland' }).click();
  await page.locator('#tosInput').check();
  await page.locator('#guestPassportForm button[type="submit"]').click();
  await expect(page.locator('#guestPassportModal')).toBeHidden();
}

async function renderSyntheticConversation(page) {
  await page.evaluate(() => {
    showChatView();
    setChatComposerState('live');
    const card = document.querySelector('#chatCard');
    const name = document.querySelector('#partnerName');
    const avatar = document.querySelector('#partnerAvatar');
    const status = document.querySelector('#statusText');
    const messages = document.querySelector('#messages');
    card.dataset.state = 'live';
    name.textContent = 'Astra Guest';
    avatar.textContent = 'A';
    status.textContent = 'Connected. You both like astronomy.';
    messages.replaceChildren();
    addMessage('You both like astronomy. Say hello!', 'system');
    for (let index = 0; index < 24; index += 1) {
      addMessage(
        index % 2
          ? `A reply that keeps the conversation readable at message ${index + 1}.`
          : `A keyboard-friendly sample message ${index + 1} with enough text to wrap naturally.`,
        index % 2 ? 'them' : 'me',
        index + 1
      );
    }
    messages.scrollTop = 0;
  });
  await expect(page.locator('#chatCard')).toBeVisible();
}

async function expectContainedWorkspace(page) {
  const measurements = await page.evaluate(() => {
    const main = document.querySelector('.chat-main');
    const card = document.querySelector('#chatCard');
    const messages = document.querySelector('#messages');
    const header = document.querySelector('.chat-partner-bar');
    const composer = document.querySelector('#chatComposer');
    const input = document.querySelector('#messageInput');
    const send = document.querySelector('#sendBtn');
    const next = document.querySelector('#newBtn');
    const lastMessage = messages.lastElementChild;
    const headerBefore = header.getBoundingClientRect();
    const composerBefore = composer.getBoundingClientRect();
    messages.scrollTop = messages.scrollHeight;
    const headerAfter = header.getBoundingClientRect();
    const composerAfter = composer.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    const sendBox = send.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();
    const lastMessageBox = lastMessage.getBoundingClientRect();
    return {
      mainOverflowY: getComputedStyle(main).overflowY,
      messagesOverflowY: getComputedStyle(messages).overflowY,
      mainContained: main.scrollHeight <= main.clientHeight + 1,
      cardContained: cardBox.top >= 0 && cardBox.bottom <= window.innerHeight + 1,
      headerStayed: Math.abs(headerBefore.top - headerAfter.top) < 1,
      composerStayed: Math.abs(composerBefore.bottom - composerAfter.bottom) < 1,
      messageListScrolls: messages.scrollHeight > messages.clientHeight && messages.scrollTop > 0,
      sendTouchesField: Math.abs(inputBox.right - sendBox.left) < 1,
      skipSeparation: inputBox.left - nextBox.right,
      inputUsable: inputBox.width >= 120,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      lastMessageAboveComposer: lastMessageBox.bottom <= composerAfter.top + 1,
      sendBackground: getComputedStyle(send).backgroundColor,
      nextBackground: getComputedStyle(next).backgroundColor
    };
  });
  expect(measurements).toEqual({
    mainOverflowY: 'hidden',
    messagesOverflowY: 'auto',
    mainContained: true,
    cardContained: true,
    headerStayed: true,
    composerStayed: true,
    messageListScrolls: true,
    sendTouchesField: true,
    skipSeparation: measurements.skipSeparation,
    inputUsable: true,
    noHorizontalOverflow: true,
    lastMessageAboveComposer: true,
    sendBackground: measurements.sendBackground,
    nextBackground: measurements.nextBackground
  });
  expect(measurements.skipSeparation).toBeGreaterThanOrEqual(16);
  expect(measurements.sendBackground).not.toBe(measurements.nextBackground);
  await expect(page.locator('#endChatBtn')).toHaveCount(0);
  await expect(page.locator('#endDirectChatBtn')).toBeHidden();
  await expect(page.locator('#newBtn span')).toBeVisible();
  await expect(page.locator('#newBtn span')).toHaveText('Next');
  await expect(page.locator('#newBtn [data-lucide]')).toHaveCount(0);

  for (const selector of ['#conversationMenuBtn', '#sendBtn', '#newBtn']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator('#messageInput').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#sendBtn')).toBeFocused();
  const focusShadow = await page.locator('#sendBtn').evaluate((element) => getComputedStyle(element).boxShadow);
  expect(focusShadow).not.toBe('none');
}

test('desktop chat keeps one contained scroll surface and accessible controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeGuestPassport(page);
  await page.locator('#waitingTimeRange').fill('35');
  await expect(page.locator('#waitingTimeOutput')).toHaveText('Unlimited');
  await expect(page.locator('#waitingTimeRange')).toHaveAttribute('aria-valuetext', 'Unlimited');
  await renderSyntheticConversation(page);
  await expectContainedWorkspace(page);
  await page.evaluate(() => { currentConversationType = 'random'; });
  await page.locator('#newBtn').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#newBtn span')).toHaveText('Confirm?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#newBtn span')).toHaveText('Next');

  await page.locator('#messagesToggle').click();
  await expect(page.locator('#chatRequestsSection')).toBeHidden();
  await page.locator('#messagesDrawer [data-drawer-close]').click();

  await page.locator('#conversationMenuBtn').click();
  await page.locator('#reportBtn').click();
  await expect(page.locator('#reportModal')).toBeVisible();
  await expect(page.locator('#reportModal')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#reportReason')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reportModal')).toBeHidden();
  await expect(page.locator('#conversationMenuBtn')).toBeFocused();

  const desktopScreenshot = testInfo.outputPath('n5.3-chat-1366x768.png');
  await page.screenshot({ path: desktopScreenshot });
  await testInfo.attach('N5.3 chat 1366x768', { path: desktopScreenshot, contentType: 'image/png' });

  await page.setViewportSize({ width: 1366, height: 640 });
  await expectContainedWorkspace(page);
  const compactDesktopScreenshot = testInfo.outputPath('n5.3-chat-1366x640.png');
  await page.screenshot({ path: compactDesktopScreenshot });
  await testInfo.attach('N5.3 chat 1366x640', { path: compactDesktopScreenshot, contentType: 'image/png' });

  await page.setViewportSize({ width: 768, height: 1024 });
  await expectContainedWorkspace(page);
  const tabletScreenshot = testInfo.outputPath('n5.3-chat-768x1024.png');
  await page.screenshot({ path: tabletScreenshot });
  await testInfo.attach('N5.3 chat 768x1024', { path: tabletScreenshot, contentType: 'image/png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectContainedWorkspace(page);
  const mobileScreenshot = testInfo.outputPath('n5.3-chat-390x844.png');
  await page.screenshot({ path: mobileScreenshot });
  await testInfo.attach('N5.3 chat 390x844', { path: mobileScreenshot, contentType: 'image/png' });

  await page.setViewportSize({ width: 844, height: 390 });
  await expectContainedWorkspace(page);
  const landscapeScreenshot = testInfo.outputPath('n5.4-chat-844x390.png');
  await page.screenshot({ path: landscapeScreenshot });
  await testInfo.attach('N5.4 chat landscape 844x390', {
    path: landscapeScreenshot,
    contentType: 'image/png'
  });

  await page.locator('#messagesToggle').click();
  await expect(page.locator('#messagesDrawer')).toBeVisible();
  await expect.poll(() => page.locator('#messagesDrawer').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth + 1
      && bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1;
  })).toBe(true);
  const drawerMeasurements = await page.locator('#messagesDrawer').evaluate((element) => {
    const closeBounds = element.querySelector('[data-drawer-close]').getBoundingClientRect();
    return { closeWidth: closeBounds.width, closeHeight: closeBounds.height };
  });
  expect(drawerMeasurements.closeWidth).toBeGreaterThanOrEqual(44);
  expect(drawerMeasurements.closeHeight).toBeGreaterThanOrEqual(44);
  await page.locator('#messagesDrawer [data-drawer-close]').click();
  await expect(page.locator('#messagesDrawer')).toBeHidden();

  await page.locator('#conversationMenuBtn').click();
  await page.locator('#reportBtn').click();
  const modalMeasurements = await page.locator('#reportModal .report-modal-card').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      contained: bounds.left >= 0 && bounds.right <= window.innerWidth + 1
        && bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1,
      scrollable: element.scrollHeight <= element.clientHeight || getComputedStyle(element).overflowY === 'auto'
    };
  });
  expect(modalMeasurements).toEqual({ contained: true, scrollable: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#reportModal')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 520 });
  await page.locator('#messageInput').focus();
  await expectContainedWorkspace(page);
  const keyboardScreenshot = testInfo.outputPath('n5.4-chat-390x520-keyboard-viewport.png');
  await page.screenshot({ path: keyboardScreenshot });
  await testInfo.attach('N5.4 chat reduced keyboard viewport 390x520', {
    path: keyboardScreenshot,
    contentType: 'image/png'
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#profileModal').classList.remove('hidden'));
  const profileSurface = await page.locator('.public-profile-card').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(profileSurface).not.toBe('rgb(255, 255, 255)');
  const profileCloseBox = await page.locator('#profileModal .modal-close').boundingBox();
  expect(profileCloseBox.width).toBeGreaterThanOrEqual(44);
  expect(profileCloseBox.height).toBeGreaterThanOrEqual(44);
  const profileAvatarBox = await page.locator('#publicProfileAvatar').boundingBox();
  expect(profileAvatarBox.width).toBeLessThanOrEqual(56);
  expect(profileAvatarBox.height).toBeLessThanOrEqual(56);
  await page.locator('#profileModal .modal-close').click();
  await expect(page.locator('#profileModal')).toBeHidden();
});

test('direct friend chat keeps End as an accessible destructive overflow action', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeGuestPassport(page, 'Direct UI Guest');
  await renderSyntheticConversation(page);
  await page.evaluate(() => {
    currentConversationType = 'direct';
    setChatComposerState('live');
  });

  await expect(page.locator('#newBtn')).toBeHidden();
  const end = page.locator('#endDirectChatBtn');
  await expect(end).toBeHidden();
  await page.locator('#conversationMenuBtn').click();
  await expect(end).toBeVisible();
  await expect(end.locator('span')).toHaveText('End conversation');
  await expect(end.locator('[data-lucide="phone-off"]')).toHaveCount(1);
  const endBox = await end.boundingBox();
  expect(endBox.width).toBeGreaterThanOrEqual(44);
  expect(endBox.height).toBeGreaterThanOrEqual(44);
  const input = page.locator('#messageInput');
  await end.focus();
  await expect(end).toBeFocused();
  const styles = await end.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { boxShadow: computed.boxShadow, background: computed.backgroundColor };
  });
  expect(styles.background).not.toBe('rgba(0, 0, 0, 0)');
  await end.click();
  await expect(page.locator('#friendSafetyConfirmModal')).toBeVisible();
  await expect(page.locator('#friendSafetyConfirmDescription')).toHaveText(
    'End this direct conversation? Messages will remain in both participants’ history.'
  );
  await page.locator('#friendSafetyConfirmCancel').click();
  await expect(page.locator('#conversationMenuBtn')).toBeFocused();

  await page.locator('#conversationMenuBtn').click();
  await page.locator('#reportBtn').click();
  await expect(page.locator('#reportReason')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversationMenuBtn')).toBeFocused();

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1366, height: 640 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    const screenshot = testInfo.outputPath(`n5.3.2-direct-chat-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`N5.3.2 direct chat ${viewport.width}x${viewport.height}`, {
      path: screenshot,
      contentType: 'image/png'
    });
    const composer = await page.locator('#chatComposer').boundingBox();
    expect(composer.x).toBeGreaterThanOrEqual(0);
    expect(composer.x + composer.width).toBeLessThanOrEqual(viewport.width + 1);
    const messageGroup = await page.locator('#messageSendGroup').boundingBox();
    expect(messageGroup.x - composer.x).toBeLessThanOrEqual(20);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('#newRandomChatBtn').click();
  await expect(page.locator('#matchSetup')).toBeVisible();
  await expect(page.locator('#chatCard')).toBeHidden();
  await expect(page.locator('#startBtnBottom')).toBeFocused();
});

test('Nevely navigation always returns to the match composer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Start chatting' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('#matchSetup')).toBeVisible();

  await page.evaluate(() => closeGuestPassport());
  await renderSyntheticConversation(page);
  await page.locator('.chat-brand').click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('#matchSetup')).toBeVisible();
  await expect(page.locator('#chatCard')).toBeHidden();
});

test('report feedback waits for the server response and stays generic', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeGuestPassport(page);
  await renderSyntheticConversation(page);
  await page.locator('#conversationMenuBtn').click();
  await page.locator('#reportBtn').click();
  await page.locator('#reportReason').selectOption('spam');
  await page.locator('#reportForm button[type="submit"]').click();

  await expect(page.locator('#reportFeedback')).not.toHaveText('Submitting…');
  await expect(page.locator('#reportFeedback')).not.toBeEmpty();
  await expect(page.locator('#reportForm button[type="submit"]')).toBeEnabled();
});

test('live report and Next lifecycle follow Socket.IO confirmation', async ({ browser }) => {
  test.setTimeout(35_000);
  const firstContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const secondContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await completeGuestPassport(first, 'First Desktop Guest');
    await completeGuestPassport(second, 'Second Desktop Guest');
    await first.locator('#waitingTimeRange').fill('30');
    await second.locator('#waitingTimeRange').fill('30');

    await first.locator('#startBtnBottom').click();
    await expect(first.locator('#searchCard')).toBeVisible();
    await expect(first.locator('#chatCard')).toBeHidden();
    await second.locator('#startBtnBottom').click();
    await expect(first.locator('#chatCard')).toHaveAttribute('data-state', 'live');
    await expect(second.locator('#chatCard')).toHaveAttribute('data-state', 'live');

    await first.locator('#conversationMenuBtn').click();
    await first.locator('#reportBtn').click();
    await first.locator('#reportReason').selectOption('spam');
    await first.locator('#reportForm button[type="submit"]').click();
    await expect(first.locator('#reportFeedback')).toHaveText(/review your report/i);
    await expect(first.locator('#reportForm button[type="submit"]')).toBeHidden();
    await first.locator('#reportCancel').click();

    const secondPartnerName = await second.locator('#partnerName').textContent();
    await first.locator('#newBtn').click();
    await expect(first.locator('#newBtn span')).toHaveText('Confirm?');
    await expect(first.locator('#chatCard')).toHaveAttribute('data-state', 'live');
    await first.locator('#newBtn').click();
    await expect(first.locator('#searchCard')).toBeVisible();
    await expect(second.locator('#statusText')).toHaveText('Conversation ended');
    await expect(second.locator('#partnerName')).toHaveText(secondPartnerName);
    await expect(second.locator('#messageInput')).toBeDisabled();
    await second.locator('#conversationMenuBtn').click();
    await expect(second.locator('#conversationMenu')).toBeVisible();
    await second.locator('#saveConversationBtn').click();
    await expect(second.locator('#saveConversationBtn')).toHaveText('Remove from saved');
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test('cancel search waits for the server and returns to the match composer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await completeGuestPassport(page, 'Cancel Search Guest');
  await page.locator('#startBtnBottom').click();
  await expect(page.locator('#searchCard')).toBeVisible();
  await expect(page.locator('#chatCard')).toBeHidden();
  await expect(page.locator('#searchPhaseStatus')).toHaveText(/Looking more broadly/i);
  await expect(page.locator('#searchTopicList')).toHaveText('Any topic');
  await expect(page.locator('#cancelSearchBtn')).toBeVisible();
  await expect(page.locator('#cancelSearchBtn')).toBeEnabled();
  await expect(page.locator('#searchCard .loading-spinner')).toBeVisible();
  const searchSurface = await page.locator('#searchCard').evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderStyle, shadow: style.boxShadow };
  });
  expect(searchSurface.background).toBe('rgba(0, 0, 0, 0)');
  expect(searchSurface.border).toBe('none');
  expect(searchSurface.shadow).toBe('none');
  const cancelBox = await page.locator('#cancelSearchBtn').boundingBox();
  expect(cancelBox.width).toBeGreaterThanOrEqual(44);
  expect(cancelBox.height).toBeGreaterThanOrEqual(44);

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1366, height: 640 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    const searchScreenshot = testInfo.outputPath(`n5.3-search-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: searchScreenshot });
    await testInfo.attach(`N5.3 search ${viewport.width}x${viewport.height}`, {
      path: searchScreenshot,
      contentType: 'image/png'
    });
  }
  await page.locator('#cancelSearchBtn').click();
  await expect(page.locator('#matchSetup')).toBeVisible();
  await expect(page.locator('#chatCard')).toBeHidden();
  await expect(page.locator('#waitingTimeHint')).toHaveText('Search cancelled.');
});
