# N1.5 Google staging acceptance

Status: STAGING PASSED — PRODUCTION CLIENT PENDING

- Acceptance date: 2026-07-28
- Environment: Railway staging only
- Candidate commit:
  [`f2ff78d1939348653dc760682329da950e07293e`](https://github.com/gabriellos88/Nevely/commit/f2ff78d1939348653dc760682329da950e07293e)
- Pull request:
  [#2](https://github.com/gabriellos88/Nevely/pull/2)
- GitHub Actions run:
  [`30369309609`](https://github.com/gabriellos88/Nevely/actions/runs/30369309609)
  passed, including disposable PostgreSQL migrations, server/integration tests,
  Socket.IO tests and Chromium acceptance tests.

## Configuration evidence

- A dedicated Google OAuth Web client named `Nevely staging` is configured in
  the private administrative Google Cloud project.
- Its authorized JavaScript origin is the exact Railway staging origin.
- The Google Auth Platform audience remains External/Test and uses the
  designated staging test user.
- Railway staging has `GOOGLE_CLIENT_ID` configured. No client ID, secret,
  token, cookie or account identifier is recorded here.
- No production OAuth client or production environment was modified.

## Functional evidence

- The official Google Identity Services button renders on staging login and
  registration pages.
- A new passwordless Google account was created with the required synthetic
  username, birth date, gender and country profile.
- Logout followed by an existing-account Google login returned successfully to
  `/chat` on the candidate deployment.
- `/register?google=profile-required` displays the profile guidance used by the
  login-to-registration redirect.
- Account security shows Google as connected for the passwordless account,
  hides password-dependent forms and prevents unlinking the only sign-in
  method.
- The returned Nevely public identifier remained opaque and no numeric database
  identifier was exposed in the tested UI.
- The deployed readiness endpoint returned `{"status":"ready"}`.

## Automated security evidence

The accepted CI run covers:

- Google ID-token validation, nonce and replay rejection;
- duplicate-email, revoked/invalid credential and banned-account behavior;
- explicit linking/unlinking for a password account and safe passwordless
  unlink rejection;
- new and existing Google account sessions;
- Google administrator login requiring the TOTP challenge before a Nevely
  session exists;
- client routing for required registration profile, historical profile
  completion, administrator TOTP and administrator 2FA setup.

## Remaining production gate

N1.5 must remain unchecked until a separate production Google OAuth Web client
exists, authorizes only the exact production origin, and its public client ID
is configured only in the Railway production environment. Privacy, Terms and
the production-domain checks in the release runbook still apply before public
activation.
