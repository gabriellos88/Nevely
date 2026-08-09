const { expect, test } = require('@playwright/test');

async function expectInsideViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} has a rendered box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test('Google onboarding keeps expected information contextual and controls stable at 1366x768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const loginTop = (await page.locator('.auth-shell').boundingBox()).y;
  await expect(page.locator('#auth-error')).toHaveCount(0);
  await expectInsideViewport(page, '.auth-provider-stack');
  await expectInsideViewport(page, '#auth-email');

  await page.goto('/register?google=profile-required', { waitUntil: 'domcontentloaded' });
  const profileTop = (await page.locator('.auth-shell').boundingBox()).y;
  expect(Math.abs(profileTop - loginTop)).toBeLessThanOrEqual(1);
  await expect(page.locator('.auth-notice')).toHaveCount(1);
  await expect(page.locator('.auth-error')).toHaveCount(0);
  await expect(page.locator('.auth-notice')).toContainText('Complete your profile');
  await expectInsideViewport(page, '.auth-provider-stack');
  await expectInsideViewport(page, '#auth-country-search');
});

test('registered profile fields use a native gender select and local-flag country combobox', async ({ page }) => {
  await page.goto('/register?google=profile-required', { waitUntil: 'domcontentloaded' });

  const gender = page.locator('#auth-gender');
  await expect(gender).toBeVisible();
  await gender.selectOption('non-binary');
  await expect(gender).toHaveValue('non-binary');
  await expect(page.locator('[data-gender-choices]')).toHaveCount(0);

  const country = page.locator('#auth-country-search');
  await expect(page.locator('[data-country-combobox]')).toHaveAttribute('data-country-ready', 'true');
  await country.fill('s');
  await expect(page.locator('#auth-country-suggestions')).toBeHidden();
  await country.fill('sw');
  await expect(page.getByRole('option', { name: 'Switzerland', exact: true })).toBeVisible();
  expect(await country.evaluate((input) => input.checkValidity())).toBe(false);
  await expect(page.getByRole('option', { name: 'Switzerland', exact: true }).locator('img')).toHaveAttribute('src', /\/vendor\/flag-icons-7\.5\.0\/flags\/4x3\/ch\.svg$/);
  await country.fill('swit');
  await country.press('ArrowDown');
  await expect(country).toHaveAttribute('aria-activedescendant', /auth-country-search-option-0/);
  await country.press('Enter');
  await expect(country).toHaveValue('Switzerland');
  await expect(page.locator('#auth-country')).toHaveValue('ch');
  expect(await country.evaluate((input) => input.checkValidity())).toBe(true);
  await expect(country).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.profile-country-selected-flag img')).toHaveAttribute('src', /\/vendor\/flag-icons-7\.5\.0\/flags\/4x3\/ch\.svg$/);
});

test('support FAQ renders on a dark grouped Astra panel', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/support', { waitUntil: 'domcontentloaded' });
  const styles = await page.locator('.support-faq__list').evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      background: computed.backgroundColor,
      radius: computed.borderRadius,
      overflow: computed.overflow
    };
  });
  expect(styles.background).toBe('rgb(15, 7, 32)');
  expect(styles.radius).toBe('24px');
  expect(styles.overflow).toBe('hidden');
  const hero = await page.locator('.support-hero').boundingBox();
  const faq = await page.locator('.support-faq').boundingBox();
  const contact = await page.locator('.support-contact__panel').boundingBox();
  expect(hero.height).toBeLessThan(380);
  expect(contact.y - (faq.y + faq.height)).toBeLessThanOrEqual(100);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.support-hero__symbol')).toBeHidden();
  const mobileHero = await page.locator('.support-hero').boundingBox();
  const mobileLink = await page.locator('.support-contact__links a').first().boundingBox();
  expect(mobileHero.height).toBeLessThan(280);
  expect(mobileLink.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByText('What can I do if my account or guest access is restricted?')).toBeVisible();
});

test('restricted guest page uses the Astra action layout and links to support', async ({ page }) => {
  await page.goto('/guest-restricted', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Guest access is limited' })).toBeVisible();
  const support = page.getByRole('link', { name: 'Contact support' });
  await expect(support).toHaveAttribute('href', '/support');
  const box = await support.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('account security forms are mutually exclusive disclosures with cancel focus restoration', async ({ page }) => {
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  const state = await page.evaluate(async () => {
    document.getElementById('accountModal').classList.remove('hidden');
    document.getElementById('accountPanelPrivacy').classList.remove('hidden');
    document.getElementById('registeredPrivacySettings').classList.remove('hidden');
    renderAccountSecurity({ email: 'owner@example.test', hasGoogle: false, hasPassword: true });
    document.getElementById('passwordChangeTrigger').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const passwordOpened = {
      expanded: document.getElementById('passwordChangeTrigger').getAttribute('aria-expanded'),
      passwordHidden: document.getElementById('passwordChangeForm').classList.contains('hidden'),
      emailHidden: document.getElementById('emailChangeForm').classList.contains('hidden'),
      focused: document.activeElement?.name
    };
    document.getElementById('emailChangeTrigger').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const emailOpened = {
      passwordExpanded: document.getElementById('passwordChangeTrigger').getAttribute('aria-expanded'),
      emailExpanded: document.getElementById('emailChangeTrigger').getAttribute('aria-expanded'),
      passwordHidden: document.getElementById('passwordChangeForm').classList.contains('hidden'),
      emailHidden: document.getElementById('emailChangeForm').classList.contains('hidden'),
      focused: document.activeElement?.name
    };
    document.getElementById('emailChangeCancel').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      passwordOpened,
      emailOpened,
      emailHiddenAfterCancel: document.getElementById('emailChangeForm').classList.contains('hidden'),
      focusedAfterCancel: document.activeElement?.id
    };
  });
  expect(state.passwordOpened).toEqual({ expanded: 'true', passwordHidden: false, emailHidden: true, focused: 'currentPassword' });
  expect(state.emailOpened).toEqual({ passwordExpanded: 'false', emailExpanded: 'true', passwordHidden: true, emailHidden: false, focused: 'email' });
  expect(state.emailHiddenAfterCancel).toBe(true);
  expect(state.focusedAfterCancel).toBe('emailChangeTrigger');
});

test('narrow authentication layout compacts context and visually subordinates the guest CTA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const contextBox = await page.locator('.auth-context').boundingBox();
  expect(contextBox.height).toBeLessThan(220);
  const guestStyle = await page.locator('.auth-guest-link').evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderWidth: style.borderTopWidth, width: style.width };
  });
  expect(guestStyle.borderWidth).toBe('1px');
  expect(Number.parseFloat(guestStyle.width)).toBeGreaterThan(300);
});

test('verification pending essentials fit a standard desktop viewport', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'A disposable database is required for pending registration state');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const responseStatus = await page.evaluate(async ({ suffix }) => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const response = await fetch('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        username: `pending_${suffix}`.slice(0, 30),
        email: `pending-${suffix}@example.test`,
        password: 'SyntheticPassword123!',
        birthDate: '1990-06-15',
        gender: 'non-binary',
        countryCode: 'ch'
      })
    });
    return response.status;
  }, { suffix });
  expect(responseStatus).toBe(201);

  await page.goto('/verify-email/pending', { waitUntil: 'domcontentloaded' });
  await expectInsideViewport(page, '#auth-action-title');
  await expectInsideViewport(page, '.auth-entry__header > p:last-of-type');
  await expectInsideViewport(page, '.auth-form .auth-submit');
});

test('add-password security copy and field fit a standard desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/add-password?token=synthetic-token', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#auth-action-title')).toHaveText('Add a Nevely password');
  await expect(page.locator('.auth-entry__header > p:last-of-type')).toContainText('Google will remain connected');
  await expectInsideViewport(page, '#auth-action-title');
  await expectInsideViewport(page, '.auth-entry__header > p:last-of-type');
  await expectInsideViewport(page, 'input[name="password"]');
});

test('an unauthorized chat API response redirects immediately to login', async ({ page }) => {
  await page.route('**/api/synthetic-auth-check', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Sign in to continue.' })
  }));
  await page.goto('/chat?guest=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => api('/api/synthetic-auth-check').catch(() => {}));
  await expect(page).toHaveURL(/\/login$/);
});
