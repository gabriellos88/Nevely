# Automated test baseline

## Local coverage

The repository provides:

- structural UI, privacy-safety and release-configuration checks;
- unit tests for sanitized logging, environment isolation, health endpoints,
  guest profile validation and storage;
- two-client Socket.IO tests for guest matching, message delivery, cooldown,
  disconnect, draining and persistence-before-shutdown;
- PostgreSQL integration tests for the exact migration set, registration,
  login, logout/session destruction, profile validation, all current admin
  authorization gates, admin action outcomes and every current destructive
  route's authentication, confirmation and ownership boundaries;
- PostgreSQL account Socket.IO tests for matching, persisted messages, unread
  counts, read receipts, cooldown, disconnect and ban notification;
- Chromium tests for guest-passport focus/validation, persistence,
  cleared-storage recovery and focus/ARIA behavior for the responsive
  Messages, Friends and Notifications drawers.

Playwright screenshots, traces and videos are disabled so CI does not retain
browser sessions or user-visible data. Test records use synthetic values only.

## Commands

```sh
npm run check
npm run test:unit
npm run test:integration
npm run test:socket
npm run test:browser
```

`npm run test:server` combines the first three server suites.

When `DATABASE_URL` is absent locally, PostgreSQL suites are explicitly
reported as skipped. When `CI=true`, a missing database fails the suite. The
GitHub workflow supplies a disposable Postgres service and applies migrations
before running the tests.

On Windows, the Playwright-managed child web server can remain open after the
tests complete. The equivalent local browser proof can be run against a
separately started test server:

```powershell
$env:APP_ENV='test'
$env:NODE_ENV='test'
$env:PORT='3210'
$env:ROBOTS_INDEXING='disabled'
$env:SESSION_SECRET='browser-test-session-secret'
$env:SHUTDOWN_GRACE_MS='1000'
node server.js
```

Then, in a second PowerShell terminal:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3210'
npx.cmd playwright test test/browser/guest-passport.spec.js
```

The required completion evidence remains the unmodified `npm run test:browser`
command in GitHub's Linux runner.

## Deliberately deferred contracts

The following contracts are outside the explicit initial scope of N0.6 and
remain owned by their roadmap items:

- the controlled retention worker is N2.2;
- cursor pagination is N2.4;
- complete server-side ban/session revocation is N1.3/N4.2.

The test runner records retention and pagination as TODO contracts rather than
pretending those features exist. Their vertical implementation must replace
the TODO contracts with passing tests.

## N0.6 completion gate

Do not check N0.6 until:

1. the PostgreSQL suites pass in GitHub CI;
2. the Chromium suite passes in the same workflow;
3. the required `Migrations and tests` GitHub check remains enforced on
   `main`;
4. the successful run URL and reviewed commit are recorded below.

## Acceptance evidence

- Local static/privacy/release checks: passed on 2026-07-27.
- Local unit tests: 8 passed on 2026-07-27.
- Local guest Socket.IO tests: 3 passed on 2026-07-27.
- Local Chromium guest-passport tests: 2 passed on 2026-07-27.
- Reviewed commit:
  [`da824a675f3785528ad588e3a2db2f83cfcffdd4`](https://github.com/gabriellos88/Nevely/pull/1/commits/da824a675f3785528ad588e3a2db2f83cfcffdd4)
  on pull request
  [#1](https://github.com/gabriellos88/Nevely/pull/1).
- GitHub Actions run
  [`30279777122`](https://github.com/gabriellos88/Nevely/actions/runs/30279777122)
  passed on 2026-07-27 in 1m 07s.
- Its required `Migrations and tests` job passed in 1m 02s, including
  migrations on disposable PostgreSQL, server/integration tests and the full
  Chromium suite.
- The `main` rule still requires `Migrations and tests` before merge, as
  confirmed during acceptance review.
- The run uploaded no artifacts, preserving the policy against retaining
  browser traces, screenshots or user-visible data.
