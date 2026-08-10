const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const view = fs.readFileSync(path.join(root, 'views', 'admin.ejs'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

test('admin account lifecycle copy distinguishes retained and purged tombstones without internal IDs or mojibake', () => {
  assert.match(client, /Deleted \\u00b7 retained until/);
  assert.match(client, /personal data removed on/);
  assert.match(client, /Scheduled data removal/);
  assert.equal(client.includes('â€”'), false);
  assert.equal(client.includes('—'), false);
  assert.equal(view.includes('â€”'), false);
  assert.equal(view.includes('UUID'), false);
});

test('network bans use one compact keyboard-native disclosure and no third creation form', () => {
  assert.match(view, /<details class="admin-network-disclosure"/);
  assert.match(view, /Create network ban/);
  assert.match(view, /Pending network reviews/);
  assert.match(view, /Advanced: enter CIDR manually/);
  assert.equal(view.includes('networkBanCreateForm'), false);
  assert.equal(client.includes("adminApi('/api/admin/network-bans'"), false);
  assert.match(client, /Approve and create ban/);
  assert.match(styles, /@media \(max-height: 760px\)/);
  assert.match(styles, /admin-network-disclosure > summary:focus-visible/);
});

test('network ban rows distinguish account-derived and manual targets and expose minimized details', () => {
  assert.match(client, /ban\.target_label/);
  assert.match(client, /adminNetworkDetail/);
  assert.match(client, /Network ban details/);
  assert.match(client, /Network reference/);
  assert.match(client, /Source Public ID/);
  assert.match(client, /Linked account ban/);
  assert.match(client, /Privacy reviewer/);
  assert.match(client, /Revocation reason/);
  assert.equal(client.includes('networkFingerprint'), false);
  assert.equal(client.includes('CIDR raw'), false);
});
