const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('registered profile fields use native gender selects and the local flag country combobox', () => {
  const client = read('public/js/profile-fields.js');
  const authView = read('views/auth-stub.ejs');
  const completionView = read('views/profile-completion.ejs');
  const accountView = read('views/chat.ejs');

  assert.match(client, /query\.length < 2/);
  assert.match(client, /aria-activedescendant/);
  assert.match(client, /FLAG_ICON_ROOT = '\/vendor\/flag-icons-7\.5\.0'/);
  assert.match(client, /country\.json/);
  assert.match(client, /createCountryFlag/);
  assert.doesNotMatch(client, /setGenderChoiceValue/);
  assert.match(authView, /<select id="auth-gender" name="gender" required>/);
  assert.match(authView, /data-country-combobox/);
  assert.match(authView, /profile-country-selected-flag/);
  assert.match(completionView, /<select id="profile-gender" name="gender" required>/);
  assert.match(completionView, /data-country-combobox/);
  assert.match(accountView, /<select name="gender" required>/);
  assert.match(accountView, /account-country-combobox/);
  assert.doesNotMatch(authView, /data-gender-choices/);
  assert.doesNotMatch(completionView, /data-gender-choices/);
  assert.doesNotMatch(accountView, /account-choice-list/);
});

test('guest passport omits visible country search status copy', () => {
  const client = read('public/js/chat-client.js');
  const accountView = read('views/chat.ejs');

  assert.doesNotMatch(client, /guestCountryStatus/);
  assert.doesNotMatch(accountView, /guestCountryStatus/);
});

test('support FAQ overrides the legacy light details surface with one dark grouped panel', () => {
  const styles = read('public/css/style.css');
  assert.match(
    styles,
    /\.support-faq__list \{[\s\S]*border-radius: var\(--radius-xxl\);[\s\S]*background: var\(--color-neutral-primary-soft\);/
  );
  assert.match(
    styles,
    /\.support-faq__item \{[\s\S]*background: transparent;[\s\S]*color: var\(--color-body\);/
  );
  assert.match(styles, /\.support-page \.support-hero \{[\s\S]*padding-block: var\(--spacing-16\);/);
  assert.match(styles, /\.support-page \.support-contact \{[\s\S]*padding-block: var\(--spacing-8\) var\(--spacing-20\);/);
});

test('account security actions use one accessible progressive disclosure controller', () => {
  const client = read('public/js/chat-client.js');
  const accountView = read('views/chat.ejs');

  assert.match(client, /let expandedSecurityAction = null/);
  assert.match(client, /function setExpandedSecurityAction/);
  assert.match(client, /name === expandedSecurityAction/);
  assert.match(client, /setAttribute\('aria-expanded', String\(expanded\)\)/);
  assert.match(client, /firstControl\?\.focus\(\)/);
  assert.match(client, /renderAccountSecurity\(data\?\.user \|\| \{[\s\S]*hasGoogle: false/);
  for (const id of ['googleIdentityUnlink', 'passwordChange', 'emailChange']) {
    assert.match(accountView, new RegExp(`id="${id}Trigger"[\\s\\S]*aria-expanded="false"[\\s\\S]*aria-controls="${id}Form"`));
    assert.match(accountView, new RegExp(`id="${id}Form"`));
    assert.match(accountView, new RegExp(`id="${id}Cancel"`));
  }
});

test('Account Country shares the Gender field shell and preserves combobox DOM behavior', () => {
  const styles = read('public/css/style.css');
  const client = read('public/js/profile-fields.js');
  const accountView = read('views/chat.ejs');

  assert.match(
    styles,
    /\.chat-app-page \.account-form input,[\s\S]*?\.chat-app-page \.account-form select \{[\s\S]*?min-height: var\(--spacing-12\);[\s\S]*?padding: var\(--spacing-2-5\) var\(--spacing-3\);[\s\S]*?border: var\(--spacing-px\) solid var\(--color-border-default\);[\s\S]*?border-radius: var\(--radius-xxl\);[\s\S]*?background: var\(--color-neutral-tertiary\);[\s\S]*?font-size: var\(--font-size-sm\);/
  );
  assert.match(
    styles,
    /\.chat-app-page \.account-country-combobox \.profile-country-search \{[\s\S]*?min-height: var\(--spacing-12\);[\s\S]*?padding: var\(--spacing-2-5\) var\(--spacing-3\);[\s\S]*?border-color: var\(--color-border-default\);[\s\S]*?border-radius: var\(--radius-xxl\);[\s\S]*?background: var\(--color-neutral-tertiary\);/
  );
  assert.match(
    styles,
    /\.chat-app-page \.account-country-combobox \.profile-country-search:focus-within \{[\s\S]*?border-color: var\(--color-brand-medium\);[\s\S]*?box-shadow: var\(--focus-ring-brand\);/
  );
  assert.match(styles, /\.auth-field-shell \{[\s\S]*?width: 100%;/);
  assert.match(styles, /\.chat-app-page \.account-form \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(
    styles,
    /@media \(max-width: 768px\) \{[\s\S]*?\.chat-app-page \.account-form \{[\s\S]*?grid-template-columns: 1fr;/
  );
  assert.match(accountView, /class="account-country-combobox auth-country-combobox" data-country-combobox/);
  assert.match(accountView, /id="account-country-search"[\s\S]*role="combobox"[\s\S]*aria-autocomplete="list"[\s\S]*aria-controls="account-country-suggestions"/);
  assert.match(accountView, /select name="countryCode" class="profile-native-control"/);
  assert.match(client, /query\.length < 2/);
  assert.match(client, /addEventListener\('pointerdown'/);
  assert.match(client, /addEventListener\('click', \(\) => chooseCountry/);
  assert.match(client, /\['ArrowDown', 'ArrowUp', 'Enter'\]/);
  assert.match(client, /state\.select\.value = country\.code/);
  assert.match(client, /setAttribute\('aria-activedescendant'/);
});
