const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createModerationControlChannel } = require('../../lib/moderation-control');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

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
     VALUES ('control_target', 'control-target@example.test', 'synthetic', 'nvy_11111111111111111111', 'Control target')
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
    await db.close();
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
