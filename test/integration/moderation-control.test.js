const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { createModerationControlChannel } = require('../../lib/moderation-control');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (hasDatabase) await require('../../db').close();
});

function waitFor(check, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (check()) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for moderation control notification'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

test('PostgreSQL moderation control disconnects a user on every listening replica without relaying content', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const user = (await db.query(
    `INSERT INTO users (username, email, password_hash, public_id, display_name)
     VALUES ('control_target', 'control-target@example.test', 'synthetic', 'nvy_111111111111', 'Control target')
     RETURNING id`
  )).rows[0];
  await db.query(
    `INSERT INTO account_bans (user_id, type, reason, ends_at, created_by)
     VALUES ($1, 'temporary', 'Cross replica moderation decision', NOW() + INTERVAL '1 hour', $1)`,
    [user.id]
  );
  const replicaOneEvents = [];
  const replicaTwoEvents = [];
  const replicaOne = createModerationControlChannel({
    db,
    chat: { async terminateUser(userId, payload, event) { replicaOneEvents.push({ userId, payload, event }); } }
  });
  const replicaTwo = createModerationControlChannel({
    db,
    chat: { async terminateUser(userId, payload, event) { replicaTwoEvents.push({ userId, payload, event }); } }
  });
  t.after(async () => {
    await replicaOne.stop();
    await replicaTwo.stop();
  });
  assert.equal(await replicaOne.start(), true);
  assert.equal(await replicaTwo.start(), true);
  await replicaOne.publishUserTermination(Number(user.id), 'account-banned');
  await waitFor(() => replicaTwoEvents.length === 1);
  const delivered = replicaTwoEvents[0];
  assert.equal(delivered.userId, Number(user.id));
  assert.equal(delivered.event, 'account-banned');
  assert.equal(delivered.payload.reason, 'Cross replica moderation decision');
  assert.equal(Object.hasOwn(delivered.payload, 'network'), false);
  assert.equal(Object.hasOwn(delivered.payload, 'body'), false);
});

test('PostgreSQL moderation control disconnects a guest on every replica without relaying profile or reason', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const actor = (await db.query(
    `INSERT INTO users (username, email, password_hash, public_id, display_name, role)
     VALUES ('guest_control_admin', 'guest-control-admin@example.test', 'synthetic',
             'nvy_222222222222', 'Guest Control Admin', 'admin') RETURNING id`
  )).rows[0];
  const guest = (await db.query(
    `INSERT INTO guest_principals
       (public_id, display_alias, name, gender, age, country, country_code, avatar_id)
     VALUES ('gst_c0ffee000002', 'gst_CONTROL002', 'Private Guest', 'any', 28, 'Switzerland', 'ch', 'astra') RETURNING id`
  )).rows[0];
  await db.query(
    `INSERT INTO guest_bans (guest_id, reason, ends_at, created_by)
     VALUES ($1, 'Guest restriction decision', NOW() + INTERVAL '1 hour', $2)`,
    [guest.id, actor.id]
  );
  const replicaTwoEvents = [];
  const replicaOne = createModerationControlChannel({ db, chat: { async terminateGuest() {} } });
  const replicaTwo = createModerationControlChannel({
    db,
    chat: { async terminateGuest(guestId, payload, event) { replicaTwoEvents.push({ guestId, payload, event }); } }
  });
  t.after(async () => {
    await replicaOne.stop();
    await replicaTwo.stop();
  });
  assert.equal(await replicaOne.start(), true);
  assert.equal(await replicaTwo.start(), true);
  await replicaOne.publishGuestTermination(guest.id);
  await waitFor(() => replicaTwoEvents.length === 1);
  const delivered = replicaTwoEvents[0];
  assert.equal(delivered.guestId, guest.id);
  assert.equal(delivered.event, 'guest-restricted');
  assert.notEqual(delivered.payload.endsAt, null);
  assert.equal(Object.hasOwn(delivered.payload, 'reason'), false);
  assert.equal(Object.hasOwn(delivered.payload, 'name'), false);
  assert.equal(Object.hasOwn(delivered.payload, 'body'), false);
});
