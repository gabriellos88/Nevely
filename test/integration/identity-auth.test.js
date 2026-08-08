const assert = require('node:assert/strict');
const { test } = require('node:test');
const request = require('supertest');
const { createRuntime } = require('../../server');
const safeLog = require('../../lib/safe-log');
const { hashToken } = require('../../lib/account-email');
const { encryptSecret, totp } = require('../../lib/totp');
const { resetDatabase } = require('../helpers/database');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const quietLog = {
  info() {},
  warn() {},
  error(event, error) {
    safeLog.error(event, error);
  }
};

function registrationPayload(username, email) {
  return {
    username,
    email,
    password: 'SyntheticPassword123!',
    birthDate: '1990-06-15',
    gender: 'non-binary',
    countryCode: 'ch'
  };
}

function tokenFromBody(body) {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  assert.ok(match, 'outbox body contains a single-use link');
  return match[1];
}

test('N1 email tokens, session revocation and Google identity contracts', {
  skip: hasDatabase ? false : 'DATABASE_URL is unavailable outside the disposable CI database'
}, async (t) => {
  const db = require('../../db');
  await resetDatabase(db);
  const googleIdentities = new Map([
    ['google-new', {
      subject: 'google-subject-new',
      email: 'google-new@example.test',
      name: 'Google New',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-delete-original', {
      subject: 'google-subject-delete-reuse',
      email: 'google-delete-reuse@example.test',
      name: 'Google Delete Reuse',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-delete-reuse', {
      subject: 'google-subject-delete-reuse',
      email: 'google-delete-reuse@example.test',
      name: 'Google Delete Reuse',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-legacy-deleted', {
      subject: 'google-subject-legacy-deleted',
      email: 'google-legacy-reuse@example.test',
      name: 'Google Legacy Reuse',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-profile-required', {
      subject: 'google-subject-profile-required',
      email: 'google-profile-required@example.test',
      name: 'Profile Required',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-profile-invalid', {
      subject: 'google-subject-profile-invalid',
      email: 'google-profile-invalid@example.test',
      name: 'Profile Invalid',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-duplicate-email', {
      subject: 'google-subject-duplicate',
      email: 'email-member@example.test',
      name: 'Duplicate',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-banned', {
      subject: 'google-subject-banned',
      email: 'google-banned@example.test',
      name: 'Banned',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-link', {
      subject: 'google-subject-link',
      email: 'email-member-new@example.test',
      name: 'Linked Member',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-admin', {
      subject: 'google-subject-admin',
      email: 'google-admin@example.test',
      name: 'Google Admin',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-admin-reauth', {
      subject: 'google-subject-admin',
      email: 'google-admin@example.test',
      name: 'Google Admin',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }],
    ['google-other-reauth', {
      subject: 'google-subject-other',
      email: 'google-other@example.test',
      name: 'Google Other',
      picture: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }]
  ]);
  const totpEncryptionKey = 'identity-integration-totp-key-32-characters';
  const runtime = createRuntime({
    db,
    closeDatabaseOnShutdown: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'identity-integration-secret-32-characters',
      ADMIN_TOTP_ENCRYPTION_KEY: totpEncryptionKey,
      GOOGLE_CLIENT_ID: 'synthetic-google-client-id',
      EMAIL_DELIVERY_MODE: 'disabled'
    },
    googleVerifier: async (credential) => {
      const identity = googleIdentities.get(credential);
      if (!identity) throw new Error('Google credential validation failed');
      return identity;
    },
    log: quietLog
  });
  t.after(async () => {
    await runtime.shutdown();
    await db.close();
  });

  await request(runtime.app)
    .post('/register')
    .set('Accept', 'application/json')
    .send({
      username: 'underage',
      email: 'underage@example.test',
      password: 'SyntheticPassword123!',
      birthDate: '2015-01-01',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(400);

  const account = request.agent(runtime.app);
  const normalRegistrationPage = await account.get('/register').expect(200);
  assert.match(normalRegistrationPage.text, /name="email"/);
  assert.match(normalRegistrationPage.text, /name="password"/);
  const googleProfilePage = await account.get('/register?google=profile-required').expect(200);
  assert.match(googleProfilePage.text, /name="username"/);
  assert.match(googleProfilePage.text, /name="birthDate"/);
  assert.doesNotMatch(googleProfilePage.text, /name="email"/);
  assert.doesNotMatch(googleProfilePage.text, /name="password"/);
  assert.match(googleProfilePage.text, /Just a few details left/);

  const missingGoogleProfile = await account
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.40')
    .send({ credential: 'google-profile-required' })
    .expect(422);
  assert.equal(missingGoogleProfile.body.code, 'GOOGLE_PROFILE_REQUIRED');
  assert.match(missingGoogleProfile.body.error, /then continue with Google/);
  assert.doesNotMatch(missingGoogleProfile.body.error, /enter.*email/i);

  const invalidGoogleProfile = await account
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.41')
    .send({
      credential: 'google-profile-invalid',
      profileCompletion: '1',
      username: 'invalid_google_profile',
      birthDate: '2015-01-01',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(422);
  assert.equal(invalidGoogleProfile.body.code, 'GOOGLE_PROFILE_INVALID');
  assert.match(invalidGoogleProfile.body.error, /at least 18/);

  const registration = await account
    .post('/register')
    .set('Accept', 'application/json')
    .send(registrationPayload('email_member', 'email-member@example.test'))
    .expect(201);
  assert.match(registration.body.user.publicId, /^nvy_[a-f0-9]{12}$/);
  assert.equal(Object.hasOwn(registration.body.user, 'internalId'), false);
  assert.equal(Object.hasOwn(registration.body.user, 'id'), false);
  assert.match(
    registration.body.user.profileImageUrl,
    /^\/vendor\/dicebear-presets-10\.2\.0\/(astra|nova|lyra|vega|sol|mira|orion|elara)\.svg$/
  );
  const pendingChat = await account.get('/chat').expect(302);
  assert.equal(pendingChat.headers.location, '/verify-email/pending');
  await account.get('/api/account').expect(403);
  await account.get('/api/conversations').expect(403);
  const pendingVerification = await account.get('/verify-email/pending').expect(200);
  assert.match(pendingVerification.text, /finish setting up your account/);

  const verificationOutbox = (await db.query(
    `SELECT eo.text_body, at.token_hash
     FROM email_outbox eo
     JOIN account_tokens at ON at.id = eo.account_token_id
     WHERE eo.purpose = 'verify_email' AND eo.recipient = $1`,
    ['email-member@example.test']
  )).rows[0];
  const verificationToken = tokenFromBody(verificationOutbox.text_body);
  assert.equal(verificationOutbox.text_body.includes(verificationOutbox.token_hash), false);
  assert.equal(verificationOutbox.token_hash, hashToken(verificationToken));

  await account
    .post('/verify-email')
    .set('Accept', 'application/json')
    .send({ token: verificationToken })
    .expect(200);
  assert.equal(
    (await account.get('/api/auth/me').expect(200)).body.user.emailVerified,
    true
  );
  await account.get('/chat').expect(200);
  await account
    .post('/verify-email')
    .set('Accept', 'application/json')
    .send({ token: verificationToken })
    .expect(400);

  const genericKnown = await request(runtime.app)
    .post('/forgot-password')
    .set('Accept', 'application/json')
    .send({ email: 'email-member@example.test' })
    .expect(202);
  const genericUnknown = await request(runtime.app)
    .post('/forgot-password')
    .set('Accept', 'application/json')
    .send({ email: 'missing@example.test' })
    .expect(202);
  assert.deepEqual(genericKnown.body, genericUnknown.body);

  const resetOutbox = (await db.query(
    `SELECT text_body FROM email_outbox
     WHERE purpose = 'password_reset' AND recipient = $1
     ORDER BY created_at DESC LIMIT 1`,
    ['email-member@example.test']
  )).rows[0];
  const resetToken = tokenFromBody(resetOutbox.text_body);
  const secondSession = request.agent(runtime.app);
  await secondSession
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'email-member@example.test', password: 'SyntheticPassword123!' })
    .expect(200);
  await request(runtime.app)
    .post('/reset-password')
    .set('Accept', 'application/json')
    .send({ token: resetToken, password: 'ChangedPassword123!' })
    .expect(200);
  assert.equal((await account.get('/api/auth/me').expect(200)).body.user, null);
  assert.equal((await secondSession.get('/api/auth/me').expect(200)).body.user, null);
  await request(runtime.app)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'email-member@example.test', password: 'SyntheticPassword123!' })
    .expect(401);
  await request(runtime.app)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'email-member@example.test', password: 'ChangedPassword123!' })
    .expect(200);

  await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .send({
      credential: 'google-duplicate-email',
      username: 'google_duplicate',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(409);

  const changedAccount = request.agent(runtime.app);
  await changedAccount
    .post('/login')
    .set('Accept', 'application/json')
    .send({ email: 'email-member@example.test', password: 'ChangedPassword123!' })
    .expect(200);
  await changedAccount
    .post('/api/account/email-change')
    .set('Accept', 'application/json')
    .send({
      email: 'email-member-new@example.test',
      password: 'ChangedPassword123!'
    })
    .expect(202);
  const emailChangeOutbox = (await db.query(
    `SELECT text_body FROM email_outbox
     WHERE purpose = 'email_change' AND recipient = $1
     ORDER BY created_at DESC LIMIT 1`,
    ['email-member-new@example.test']
  )).rows[0];
  const emailChangeToken = tokenFromBody(emailChangeOutbox.text_body);
  const emailChangeConfirmation = await request(runtime.app)
    .post('/confirm-email-change')
    .set('Accept', 'application/json')
    .send({ token: emailChangeToken })
    .expect(200);
  assert.equal(emailChangeConfirmation.body.redirect, '/login?email-changed=1');
  assert.equal((await changedAccount.get('/api/auth/me').expect(200)).body.user, null);
  await request(runtime.app)
    .post('/login')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.42')
    .send({ email: 'email-member@example.test', password: 'ChangedPassword123!' })
    .expect(401);
  await request(runtime.app)
    .post('/login')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.42')
    .send({ email: 'email-member-new@example.test', password: 'ChangedPassword123!' })
    .expect(200);
  assert.equal(
    Number((await db.query(
      `SELECT COUNT(*) AS count FROM email_outbox
       WHERE purpose = 'email_change_notice' AND recipient = $1`,
      ['email-member@example.test']
    )).rows[0].count),
    1
  );

  const linkedAccount = request.agent(runtime.app);
  await linkedAccount
    .post('/login')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.43')
    .send({ email: 'email-member-new@example.test', password: 'ChangedPassword123!' })
    .expect(200);
  let linkedMethods = (await linkedAccount.get('/api/account').expect(200)).body.user;
  assert.equal(linkedMethods.hasPassword, true);
  assert.equal(linkedMethods.hasGoogle, false);
  await linkedAccount
    .post('/api/account/identities/google')
    .send({ credential: 'google-revoked' })
    .expect(401);
  await linkedAccount
    .post('/api/account/identities/google')
    .send({ credential: 'google-link' })
    .expect(201);
  linkedMethods = (await linkedAccount.get('/api/account').expect(200)).body.user;
  assert.equal(linkedMethods.hasPassword, true);
  assert.equal(linkedMethods.hasGoogle, true);
  await linkedAccount
    .delete('/api/account/identities/google')
    .send({ password: 'wrong-password' })
    .expect(401);
  const unlinkedGoogle = await linkedAccount
    .delete('/api/account/identities/google')
    .send({ password: 'ChangedPassword123!' })
    .expect(200);
  assert.deepEqual(unlinkedGoogle.body.user, {
    email: 'email-member-new@example.test',
    hasGoogle: false,
    hasPassword: true
  });
  linkedMethods = (await linkedAccount.get('/api/account').expect(200)).body.user;
  assert.equal(linkedMethods.hasPassword, true);
  assert.equal(linkedMethods.hasGoogle, false);

  await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.44')
    .send({ credential: 'google-revoked' })
    .expect(401);
  await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.44')
    .send({})
    .expect(401);

  const google = request.agent(runtime.app);
  const googleRegistration = await google
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.44')
    .send({
      credential: 'google-new',
      username: 'google_new',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(201);
  assert.equal(googleRegistration.body.user.emailVerified, true);
  const googleMethods = (await google.get('/api/account').expect(200)).body.user;
  assert.equal(googleMethods.hasPassword, false);
  assert.equal(googleMethods.hasGoogle, true);
  assert.match(
    googleMethods.profile_image_url,
    /^\/vendor\/dicebear-presets-10\.2\.0\/(astra|nova|lyra|vega|sol|mira|orion|elara)\.svg$/
  );
  await google
    .delete('/api/account/identities/google')
    .send({})
    .expect(409);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const setup = await google
      .post('/api/account/password/setup')
      .set('Accept', 'application/json')
      .set('X-Forwarded-For', '198.51.100.46')
      .send({})
      .expect(202);
    assert.match(setup.body.message, /Check your inbox/);
  }
  const googleSetupOutbox = await db.query(
    `SELECT text_body FROM email_outbox
     WHERE purpose = 'password_setup' AND recipient = $1
     ORDER BY created_at DESC`,
    ['google-new@example.test']
  );
  assert.equal(googleSetupOutbox.rowCount, 3);
  assert.match(googleSetupOutbox.rows[0].text_body, /Add a Nevely password/);
  assert.match(googleSetupOutbox.rows[0].text_body, /Google will remain connected/);
  const googleSetupToken = tokenFromBody(googleSetupOutbox.rows[0].text_body);
  await request(runtime.app)
    .post('/add-password')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.47')
    .send({ token: googleSetupToken, password: 'GooglePassword123!' })
    .expect(200);
  assert.equal((await google.get('/api/auth/me').expect(200)).body.user, null);
  const googleWithPassword = request.agent(runtime.app);
  await googleWithPassword
    .post('/login')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.48')
    .send({ email: 'google-new@example.test', password: 'GooglePassword123!' })
    .expect(200);
  const googleWithBothMethods = (await googleWithPassword.get('/api/account').expect(200)).body.user;
  assert.equal(googleWithBothMethods.hasPassword, true);
  assert.equal(googleWithBothMethods.hasGoogle, true);
  await googleWithPassword
    .post('/api/account/password/setup')
    .set('X-Forwarded-For', '198.51.100.49')
    .send({})
    .expect(409);

  const deletedGoogle = request.agent(runtime.app);
  await deletedGoogle
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.50')
    .send({
      credential: 'google-delete-original',
      username: 'google_delete_reuse',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(201);
  const deletedGoogleUser = (await db.query(
    `SELECT id FROM users WHERE email = 'google-delete-reuse@example.test' AND deleted_at IS NULL`
  )).rows[0];
  await deletedGoogle
    .delete('/api/account')
    .send({ confirmation: 'DELETE' })
    .expect(204);
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) AS count FROM account_identities WHERE user_id = $1',
    [deletedGoogleUser.id]
  )).rows[0].count), 0);
  const reusedGoogle = await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.51')
    .send({
      credential: 'google-delete-reuse',
      username: 'google_delete_reuse',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(201);
  assert.equal(reusedGoogle.body.user.email, 'google-delete-reuse@example.test');
  const legacyDeleted = await db.query(
    `INSERT INTO users
       (username, email, password_hash, public_id, display_name, deleted_at)
     VALUES ('deleted_legacy_google', 'deleted-legacy@deleted.nevely.invalid', NULL,
             'nvy_cccccccccccc', 'Deleted user', NOW())
     RETURNING id`
  );
  await db.query(
    `INSERT INTO account_identities (user_id, provider, provider_subject, provider_email)
     VALUES ($1, 'google', 'google-subject-legacy-deleted', 'google-legacy-reuse@example.test')`,
    [legacyDeleted.rows[0].id]
  );
  await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.52')
    .send({
      credential: 'google-legacy-deleted',
      username: 'google_legacy_reuse',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(201);
  await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.44')
    .send({
      credential: 'google-new',
      username: 'google_new_again',
      birthDate: '1990-06-15',
      gender: 'non-binary',
      countryCode: 'ch'
    })
    .expect(409);

  const bannedUser = await db.query(
    `INSERT INTO users
       (username, email, password_hash, public_id, display_alias, display_name,
        birth_date, gender, country, country_code, profile_completed_at, email_verified_at)
     VALUES ('google_banned', 'google-banned@example.test', NULL,
             'nvy_aaaaaaaaaaaa', 'Nevely#aaaaaa', 'Google Banned',
             '1990-06-15', 'non-binary', 'Switzerland', 'ch', NOW(), NOW())
     RETURNING id`
  );
  await db.query(
    `INSERT INTO account_identities (user_id, provider, provider_subject, provider_email)
     VALUES ($1, 'google', 'google-subject-banned', 'google-banned@example.test')`,
    [bannedUser.rows[0].id]
  );
  await db.query(
    `INSERT INTO bans (user_id, type, reason) VALUES ($1, 'permanent', 'synthetic')`,
    [bannedUser.rows[0].id]
  );
  await request(runtime.app)
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.44')
    .send({ credential: 'google-banned' })
    .expect(403);

  const adminTotpSecret = 'JBSWY3DPEHPK3PXP';
  const googleAdmin = await db.query(
    `INSERT INTO users
       (username, email, password_hash, public_id, display_alias, display_name,
        birth_date, gender, country, country_code, profile_completed_at,
        email_verified_at, role, admin_totp_secret, admin_2fa_enabled_at)
     VALUES ('google_admin', 'google-admin@example.test', NULL,
             'nvy_bbbbbbbbbbbb', 'Nevely#bbbbbb', 'Google Admin',
             '1990-06-15', 'non-binary', 'Switzerland', 'ch', NOW(), NOW(),
             'admin', $1, NOW())
     RETURNING id`,
    [encryptSecret(adminTotpSecret, totpEncryptionKey)]
  );
  await db.query(
    `INSERT INTO account_identities (user_id, provider, provider_subject, provider_email)
     VALUES ($1, 'google', 'google-subject-admin', 'google-admin@example.test')`,
    [googleAdmin.rows[0].id]
  );
  const adminAgent = request.agent(runtime.app);
  const adminGoogleLogin = await adminAgent
    .post('/auth/google')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.45')
    .send({ credential: 'google-admin' })
    .expect(202);
  assert.equal(adminGoogleLogin.body.twoFactorRequired, true);
  assert.equal((await adminAgent.get('/api/auth/me').expect(200)).body.user, null);
  const adminChallenge = await adminAgent
    .post('/login/2fa')
    .set('Accept', 'application/json')
    .set('X-Forwarded-For', '198.51.100.45')
    .send({ code: totp(adminTotpSecret) })
    .expect(200);
  assert.equal(adminChallenge.body.user.role, 'admin');
  const googleAdminPage = await adminAgent.get('/admin').expect(200);
  assert.doesNotMatch(googleAdminPage.text, /name="password"/);
  assert.match(googleAdminPage.text, /data-callback="handleAdminGoogleReauth"/);
  await adminAgent
    .post('/api/admin/reauth')
    .send({ password: 'ArbitraryPassword123!', code: totp(adminTotpSecret) })
    .expect(401);
  await adminAgent
    .post('/api/admin/reauth')
    .send({ credential: 'google-other-reauth', code: totp(adminTotpSecret) })
    .expect(401);
  await adminAgent
    .post('/api/admin/reauth')
    .send({ credential: 'google-admin-reauth', code: totp(adminTotpSecret) })
    .expect(204);
});
