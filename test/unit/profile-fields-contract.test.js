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
