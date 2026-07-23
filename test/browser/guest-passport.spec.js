const { expect, test } = require('@playwright/test');

async function openGuestChat(page) {
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#guestPassportModal')).toBeVisible();
}

async function completeGuestPassport(page) {
  await page.locator('#usernameInput').fill('Synthetic Guest');
  await page.locator('#ageInput').selectOption('28');
  await page.locator('#guestCountrySearch').fill('Switzerland');
  await page.locator('#guestCountrySuggestions').getByRole('option', { name: 'Switzerland' }).click();
  await page.locator('#tosInput').check();
  await page.locator('#guestPassportForm button[type="submit"]').click();
  await expect(page.locator('#guestPassportModal')).toBeHidden();
  await expect(page.locator('#profileName')).toHaveText('Synthetic Guest');
}

test('guest passport traps focus and validates required input', async ({ page }) => {
  await openGuestChat(page);
  await expect(page.locator('#usernameInput')).toBeFocused();

  await page.locator('#guestPassportForm button[type="submit"]').click();
  await expect(page.locator('#quickStartError')).toBeVisible();
  await expect(page.locator('#usernameInput')).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  const inside = await page.evaluate(() => (
    document.querySelector('#guestPassportModal')?.contains(document.activeElement)
  ));
  expect(inside).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('#guestPassportModal')).toBeVisible();
});

test('guest identity persists, recovers after cleared storage and supports responsive drawers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuestChat(page);
  await completeGuestPassport(page);

  const storedBeforeReload = await page.evaluate(() => (
    Boolean(localStorage.getItem('nevely.guestPassport.v1'))
  ));
  expect(storedBeforeReload).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#guestPassportModal')).toBeHidden();
  await expect(page.locator('#profileName')).toHaveText('Synthetic Guest');

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#guestPassportModal')).toBeHidden();
  await expect(page.locator('#profileName')).toHaveText('Synthetic Guest');
  expect(await page.evaluate(() => (
    Boolean(localStorage.getItem('nevely.guestPassport.v1'))
  ))).toBe(true);

  const trigger = page.locator('#messagesToggle');
  const drawer = page.locator('#messagesDrawer');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  await expect(drawer).not.toHaveAttribute('inert', '');

  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  await expect(trigger).toBeFocused();
});
