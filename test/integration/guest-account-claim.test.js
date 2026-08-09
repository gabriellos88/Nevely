const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = { info() {}, warn() {}, error() {} };

function guestPayload(name) {
  return {
    name,
    age: 28,
    gender: 'non-binary',
    country: { code: 'ch' },
    avatarId: 'astra'
  };
}

function registrationPayload(username, email, extra = {}) {
  return {
    username,
    email,
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch',
    ...extra
  };
}

function tokenFromBody(body) {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  assert.ok(match, 'verification outbox body contains a single-use token');
  return match[1];
}

test('guest account claims are session-authorized, verified, transactional and non-repeatable', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'guest-account-claim-integration-secret'
    },
    googleVerifier: async (credential) => ({
      subject: `google-${credential}`,
      email: `${credential}@example.test`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      name: 'Google Profile',
      picture: 'https://example.test/google-profile.png'
    }),
    log: quietLog
  });
  t.after(async () => {
    await runtime.shutdown();
    await db.close();
  });

  const guest = request.agent(runtime.app);
  const createdGuest = await guest.post('/api/guest-profile').send(guestPayload('Claimable Guest')).expect(201);
  const guestPublicId = createdGuest.body.guest.publicId;
  const guestId = (await db.query('SELECT id FROM guest_principals WHERE public_id = $1', [guestPublicId])).rows[0].id;

  const loginPage = await guest.get('/login').expect(200);
  assert.match(loginPage.text, /New here\? Create an account/);
  assert.match(loginPage.text, /Claim your current guest account/);
  assert.match(loginPage.text, /Claimable Guest/);
  assert.match(loginPage.text, /\/register\?claim=1/);
  const registerPage = await guest.get('/register?claim=1').expect(200);
  assert.match(registerPage.text, /chats and profile will move to your new account once it’s verified/i);
  assert.match(registerPage.text, /name="username"/);
  assert.doesNotMatch(registerPage.text, /name="birthDate"/);
  assert.doesNotMatch(registerPage.text, /name="gender"/);
  assert.doesNotMatch(registerPage.text, /name="countryCode"/);
  const anonymousLoginPage = await request(runtime.app).get('/login').expect(200);
  assert.doesNotMatch(anonymousLoginPage.text, /Claim your current guest account/);

  const conversation = (await db.query(
    `INSERT INTO conversations (type) VALUES ('random') RETURNING id`
  )).rows[0];
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, guest_id, socket_id, display_name)
     VALUES ($1, $2, 'claim-guest-socket', 'Claimable Guest')`,
    [conversation.id, guestId]
  );
  const message = (await db.query(
    `INSERT INTO messages
       (conversation_id, sender_guest_id, sender_socket_id, sender_display_name, body)
     VALUES ($1, $2, 'claim-guest-socket', 'Claimable Guest', 'Guest history')
     RETURNING id`,
    [conversation.id, guestId]
  )).rows[0];
  await db.query(
    `INSERT INTO saved_chats (guest_id, conversation_id) VALUES ($1, $2)`,
    [guestId, conversation.id]
  );
  await db.query(
    `INSERT INTO message_receipts (message_id, guest_id, delivered_at)
     VALUES ($1, $2, NOW())`,
    [message.id, guestId]
  );

  const unauthorized = request.agent(runtime.app);
  const unauthorizedRegistration = await unauthorized
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('claim_intruder', 'claim-intruder@example.test', {
      claim: '1',
      guestId
    }))
    .expect(201);
  assert.equal(unauthorizedRegistration.body.guestClaimPending, false);
  assert.equal(
    Number((await db.query('SELECT COUNT(*) AS count FROM guest_account_claims')).rows[0].count),
    0
  );

  const registration = await guest
    .post('/register')
    .set('Accept', 'application/json')
    .send({
      email: 'claimed-member@example.test',
      password: 'SyntheticPassword123!',
      username: 'claimed_member',
      claim: '1'
    })
    .expect(201);
  assert.equal(registration.body.guestClaimPending, true);
  const pendingClaimChat = await guest.get('/chat').expect(302);
  assert.equal(pendingClaimChat.headers.location, '/verify-email/pending');
  await guest.get('/api/conversations').expect(403);

  const pending = (await db.query(
    `SELECT claim.status, claim.guest_id, guest.status AS guest_status
     FROM guest_account_claims claim
     JOIN guest_principals guest ON guest.id = claim.guest_id
     WHERE claim.guest_id = $1`,
    [guestId]
  )).rows[0];
  assert.equal(pending.status, 'pending');
  assert.equal(pending.guest_status, 'active');
  assert.equal(
    (await db.query('SELECT guest_id FROM conversation_participants WHERE conversation_id = $1', [conversation.id])).rows[0].guest_id,
    guestId
  );

  const outbox = (await db.query(
    `SELECT text_body FROM email_outbox
     WHERE purpose = 'verify_email' AND recipient = $1
     ORDER BY created_at DESC LIMIT 1`,
    ['claimed-member@example.test']
  )).rows[0];
  const verificationToken = tokenFromBody(outbox.text_body);
  const verification = await guest
    .post('/verify-email')
    .set('Accept', 'application/json')
    .send({ token: verificationToken })
    .expect(200);
  assert.equal(verification.body.guestClaimed, true);

  const userId = Number((await db.query(
    'SELECT id FROM users WHERE email = $1',
    ['claimed-member@example.test']
  )).rows[0].id);
  const claimedUser = (await db.query(
    `SELECT username, display_name, birth_date, age, gender, country_code, profile_image_url
     FROM users WHERE id = $1`,
    [userId]
  )).rows[0];
  assert.equal(claimedUser.username, 'claimed_member');
  assert.equal(claimedUser.display_name, 'Claimable Guest');
  assert.equal(claimedUser.birth_date, null);
  assert.equal(Number(claimedUser.age), 28);
  assert.equal(claimedUser.gender, 'non-binary');
  assert.equal(claimedUser.country_code, 'ch');
  assert.equal(claimedUser.profile_image_url, '/vendor/dicebear-presets-10.2.0/astra.svg');
  const claimed = (await db.query(
    `SELECT claim.status, claim.claimed_at, guest.status AS guest_status, guest.claimed_by_user_id
     FROM guest_account_claims claim
     JOIN guest_principals guest ON guest.id = claim.guest_id
     WHERE claim.guest_id = $1`,
    [guestId]
  )).rows[0];
  assert.equal(claimed.status, 'claimed');
  assert.notEqual(claimed.claimed_at, null);
  assert.equal(claimed.guest_status, 'claimed');
  assert.equal(Number(claimed.claimed_by_user_id), userId);
  assert.deepEqual(
    (await db.query(
      'SELECT user_id, guest_id FROM conversation_participants WHERE conversation_id = $1',
      [conversation.id]
    )).rows[0],
    { user_id: String(userId), guest_id: null }
  );
  assert.deepEqual(
    (await db.query('SELECT user_id, guest_id FROM saved_chats WHERE conversation_id = $1', [conversation.id])).rows[0],
    { user_id: String(userId), guest_id: null }
  );
  assert.deepEqual(
    (await db.query('SELECT user_id, guest_id FROM message_receipts WHERE message_id = $1', [message.id])).rows[0],
    { user_id: String(userId), guest_id: null }
  );
  assert.deepEqual(
    (await db.query('SELECT sender_user_id, sender_guest_id FROM messages WHERE id = $1', [message.id])).rows[0],
    { sender_user_id: null, sender_guest_id: guestId }
  );
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE user_id = $1 AND guest_id IS NULL AND type = 'guest_account_claim'`,
      [userId]
    )).rows[0].count),
    1
  );
  await guest.post('/verify-email').set('Accept', 'application/json').send({ token: verificationToken }).expect(400);
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM guest_account_claims WHERE guest_id = $1',
      [guestId]
    )).rows[0].count),
    1
  );

  const googleGuest = request.agent(runtime.app);
  await googleGuest.post('/api/guest-profile').send(guestPayload('Google Claim Guest')).expect(201);
  const googleClaim = await googleGuest
    .post('/auth/google')
    .set('Accept', 'application/json')
    .send({ credential: 'google-claim', claim: '1', username: 'google_claim_member' })
    .expect(201);
  assert.equal(googleClaim.body.guestClaimed, true);
  const googleClaimedUser = (await db.query(
    `SELECT username, display_name, birth_date, age, gender, country_code, profile_image_url
     FROM users WHERE email = $1`,
    ['google-claim@example.test']
  )).rows[0];
  assert.equal(googleClaimedUser.username, 'google_claim_member');
  assert.equal(googleClaimedUser.display_name, 'Google Claim Guest');
  assert.equal(googleClaimedUser.birth_date, null);
  assert.equal(Number(googleClaimedUser.age), 28);
  assert.equal(googleClaimedUser.gender, 'non-binary');
  assert.equal(googleClaimedUser.country_code, 'ch');
  assert.equal(googleClaimedUser.profile_image_url, '/vendor/dicebear-presets-10.2.0/astra.svg');

  const existing = request.agent(runtime.app);
  await existing
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('existing_member', 'existing-member@example.test'))
    .expect(201);
  const separateGuest = request.agent(runtime.app);
  const separateGuestProfile = await separateGuest
    .post('/api/guest-profile')
    .send(guestPayload('Separate Guest'))
    .expect(201);
  await separateGuest
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'existing-member@example.test', password: 'SyntheticPassword123!' })
    .expect(200);
  const restored = await separateGuest.post('/logout').set('Accept', 'application/json').expect(200);
  assert.equal(restored.body.guestRestored, true);
  const recoveredGuest = await separateGuest.get('/api/guest-profile').expect(200);
  assert.equal(recoveredGuest.body.guest.publicId, separateGuestProfile.body.guest.publicId);
  const separateGuestId = (await db.query(
    'SELECT id FROM guest_principals WHERE public_id = $1', [separateGuestProfile.body.guest.publicId]
  )).rows[0].id;
  assert.equal(
    Number((await db.query(
      'SELECT COUNT(*) AS count FROM guest_account_claims WHERE guest_id = $1',
      [separateGuestId]
    )).rows[0].count),
    0
  );
});
