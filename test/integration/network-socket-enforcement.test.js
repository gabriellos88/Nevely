const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);

function eventFrom(socket, eventName, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), timeoutMs);
    socket.once(eventName, (payload) => { clearTimeout(timeout); resolve(payload); });
  });
}

function cookieFrom(response) {
  return (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}

async function registeredSession(baseUrl, username, address) {
  const email = `${username}@example.test`;
  const registration = await request(baseUrl).post('/register').set('Accept', 'application/json')
    .set('X-Forwarded-For', address).send({
      username, email, password: 'SyntheticPassword123!', birthDate: '1990-06-15',
      gender: 'non-binary', countryCode: 'ch'
    }).expect(201);
  const db = require('../../db');
  await db.query('UPDATE users SET email_verified_at = NOW() WHERE email = $1', [email]);
  const login = await request(baseUrl).post('/login').set('Accept', 'application/json')
    .set('X-Forwarded-For', address)
    .send({ email, password: 'SyntheticPassword123!' }).expect(200);
  return { cookie: cookieFrom(login), publicId: registration.body.user.publicId };
}

async function connectAt(baseUrl, session, address) {
  const socket = createClient(baseUrl, {
    autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Cookie: session.cookie, 'X-Forwarded-For': address }
  });
  const connected = eventFrom(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

test('approved account-derived network ban disconnects existing sockets while the innocent partner receives only generic closure', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'network-socket-integration-session-secret',
      NETWORK_BAN_HMAC_KEY: 'network-socket-integration-hmac-secret',
      SHUTDOWN_GRACE_MS: '1000'
    },
    log: { info() {}, warn() {}, error() {} }
  });
  const address = await runtime.start({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const affectedAddress = '203.0.113.77';
  const partnerAddress = '198.51.100.88';
  const affectedSession = await registeredSession(baseUrl, 'network_affected', affectedAddress);
  const partnerSession = await registeredSession(baseUrl, 'network_partner', partnerAddress);
  const affected = await connectAt(baseUrl, affectedSession, affectedAddress);
  const partner = await connectAt(baseUrl, partnerSession, partnerAddress);
  t.after(async () => {
    affected.disconnect(); partner.disconnect();
    await runtime.shutdown();
  });

  const actor = (await db.query(
    `INSERT INTO users (username, email, password_hash, public_id, display_name, role)
     VALUES ('network_actor', 'network-actor@example.test', 'hash', 'nvy_aaaaaaaaaaaa', 'Actor', 'admin')
     RETURNING id`
  )).rows[0];
  const reviewer = (await db.query(
    `INSERT INTO users (username, email, password_hash, public_id, display_name, role)
     VALUES ('network_reviewer', 'network-reviewer@example.test', 'hash', 'nvy_bbbbbbbbbbbb', 'Reviewer', 'admin')
     RETURNING id`
  )).rows[0];
  const source = (await db.query(
    `INSERT INTO users
       (username, email, password_hash, public_id, display_name, last_ip, last_network_seen_at)
     VALUES ('network_source', 'network-source@example.test', 'hash', 'nvy_cccccccccccc',
             'Source', $1, NOW()) RETURNING id, public_id`,
    [affectedAddress]
  )).rows[0];
  await db.query(
    `INSERT INTO account_bans (user_id, type, reason, ends_at, created_by)
     VALUES ($1, 'temporary', 'Source account restriction', NOW() + INTERVAL '2 hours', $2)`,
    [source.id, actor.id]
  );

  const firstMatch = eventFrom(affected, 'matched');
  const secondMatch = eventFrom(partner, 'matched');
  affected.emit('find-partner', { interests: ['safety'], waitingTimeSeconds: null });
  partner.emit('find-partner', { interests: ['safety'], waitingTimeSeconds: null });
  await Promise.all([firstMatch, secondMatch]);

  let partnerModerationLeak = false;
  for (const event of ['network-restricted', 'account-banned', 'guest-restricted']) {
    partner.once(event, () => { partnerModerationLeak = true; });
  }
  const affectedRestriction = eventFrom(affected, 'network-restricted');
  const partnerClosure = eventFrom(partner, 'partner-left');
  const approval = await runtime.moderation.requestNetworkBanPrivacyApproval({
    actorUserId: Number(actor.id), sourceType: 'account', publicId: source.public_id,
    hours: 2, reason: 'Independent review of a recent narrow network signal'
  });
  const outcome = await runtime.moderation.reviewNetworkBanPrivacyApproval({
    reviewerUserId: Number(reviewer.id), approvalId: approval.id, decision: 'approve',
    reason: 'The exact host scope and short duration are proportionate'
  });
  assert.equal(Number(outcome.ban.prefix_length), 32);
  assert.deepEqual(await affectedRestriction, {});
  assert.notEqual((await partnerClosure).conversationId, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(partnerModerationLeak, false);
  assert.equal(affected.connected, false);
  assert.equal(partner.connected, true);

  const blockedHttp = await request(baseUrl).post('/api/guest-profile')
    .set('X-Forwarded-For', affectedAddress).send({}).expect(403);
  assert.equal(blockedHttp.body.code, 'NETWORK_RESTRICTED');
  assert.equal(JSON.stringify(blockedHttp.body).includes(affectedAddress), false);
});
