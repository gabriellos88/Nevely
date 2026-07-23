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
  authorization gates and destructive member-route authentication;
- PostgreSQL account Socket.IO tests for matching, persisted messages, unread
  counts, read receipts and ban notification;
- Chromium tests for guest-passport focus/validation, persistence,
  cleared-storage recovery and responsive drawer focus.

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

## Deliberately open acceptance

N0.6 currently depends on functionality scheduled later in the roadmap:

- the controlled retention worker is N2.2;
- cursor pagination is N2.4;
- complete server-side ban/session revocation is N1.3/N4.2.

The test runner records retention and pagination as TODO contracts rather than
pretending those features exist. Their vertical implementation must replace
the TODO contracts with passing tests.

N0.6 is not complete until:

1. the PostgreSQL suites pass in GitHub CI;
2. the required GitHub check is enabled;
3. the future retention, pagination and complete ban-revocation contracts are
   implemented, or the roadmap acceptance criterion is explicitly re-scoped.
