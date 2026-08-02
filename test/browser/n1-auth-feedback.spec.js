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

test('registered profile fields use Astra choices and a keyboard-searchable country combobox', async ({ page }) => {
  await page.goto('/register?google=profile-required', { waitUntil: 'domcontentloaded' });

  const gender = page.getByRole('button', { name: 'Non-binary', exact: true });
  await gender.click();
  await expect(gender).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#auth-gender')).toHaveValue('non-binary');

  const country = page.locator('#auth-country-search');
  await country.fill('s');
  await expect(page.locator('#auth-country-suggestions')).toBeHidden();
  await country.fill('sw');
  await expect(page.getByRole('option', { name: 'Switzerland', exact: true })).toBeVisible();
  await country.fill('swit');
  await country.press('ArrowDown');
  await expect(country).toHaveAttribute('aria-activedescendant', /auth-country-search-option-0/);
  await country.press('Enter');
  await expect(country).toHaveValue('Switzerland');
  await expect(page.locator('#auth-country')).toHaveValue('ch');
  await expect(country).toHaveAttribute('aria-expanded', 'false');
});

test('support FAQ renders on a dark grouped Astra panel', async ({ page }) => {
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
