const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('registered profile fields use shared Astra chips and two-letter country comboboxes', () => {
  const client = read('public/js/profile-fields.js');
  const authView = read('views/auth-stub.ejs');
  const completionView = read('views/profile-completion.ejs');
  const accountView = read('views/chat.ejs');

  assert.match(client, /query\.length < 2/);
  assert.match(client, /aria-activedescendant/);
  assert.match(client, /setGenderChoiceValue/);
  assert.match(authView, /data-gender-choices/);
  assert.match(authView, /data-country-combobox/);
  assert.match(completionView, /data-gender-choices/);
  assert.match(completionView, /data-country-combobox/);
  assert.match(accountView, /account-choice-list/);
  assert.match(accountView, /account-country-combobox/);
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
});
