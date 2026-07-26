# Staging environment

N0.3 requires an isolated Railway environment that can prove a release before
production without touching real users or production data.

## Railway topology

Create an isolated environment named `staging` in the existing Railway
project. It must contain:

- a backend service deployed from an explicitly selected release revision;
- its own PostgreSQL service and volume;
- its own generated Railway domain or a non-production custom hostname;
- environment-scoped variables and sealed secrets.

Reference the staging Postgres service with Railway's reference-variable
syntax instead of copying a production connection string. Never clone or
restore production user data into staging; use synthetic fixtures only.

Record the production Railway environment ID in the non-secret
`PRODUCTION_RAILWAY_ENVIRONMENT_ID` staging variable. The validator compares it
with Railway's own `RAILWAY_ENVIRONMENT_ID` and fails if they are equal.

## Required staging variables

Configure:

```text
APP_ENV=staging
NODE_ENV=production
PUBLIC_ORIGIN=https://<staging-host>
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<staging-only sealed secret>
PRODUCTION_RAILWAY_ENVIRONMENT_ID=<production environment ID>
EMAIL_DELIVERY_MODE=test
RESEND_API_KEY=<staging-only sealed key>
RESEND_FROM=Nevely Staging <noreply@notifications.nevely.app>
RESEND_TEST_RECIPIENT=delivered+staging@resend.dev
ANALYTICS_MODE=disabled
ROBOTS_INDEXING=disabled
```

Do not reuse the production session secret or Resend API key. Until the
analytics implementation has its own separate non-production property,
staging analytics remains disabled. Staging must also emit a no-index policy.

## Deployment gate

Before promoting the same revision to production:

1. require the GitHub CI check for the revision;
2. deploy it to staging;
3. run `npm run check:env:staging` inside that Railway service;
4. apply migrations and confirm `/health/ready` returns HTTP 200;
5. set `PLAYWRIGHT_BASE_URL` to `PUBLIC_ORIGIN` on the test runner and complete
   the browser suite without starting a local server;
6. run `npm run smoke:staging:email`; it can send only a synthetic message to
   `delivered+staging@resend.dev`. Confirm the accepted event in Resend without
   copying provider identifiers into logs or evidence;
7. confirm no production database rows, sessions or analytics events changed.

N0.3 remains incomplete until the environment exists and this gate has been
executed successfully. Repository configuration alone is not proof of
isolation.

## Acceptance evidence

Acceptance was completed on 2026-07-26 against commit `e65098c` in
[pull request #1](https://github.com/gabriellos88/Nevely/pull/1):

- Railway environment `staging` was created as an empty environment, not as a
  production clone. Its environment ID is
  `b92ec81d-b925-4634-b630-faa2a845688c`; production remains
  `0b327859-ca72-43cf-892a-8d69f1f352c4`.
- The staging backend is service
  `b2a16a76-5617-487e-9f95-a410b870f81c`. Its PostgreSQL service is
  `ed9a1a40-65ae-4274-a70e-512d4ef9571b` with a newly provisioned volume
  `da59ec48-95ac-4ebd-8c2d-a03ed8890086`. `DATABASE_URL` is a Railway
  reference to that staging service; no production database was cloned,
  restored or imported.
- Staging has its own generated domain,
  `https://nevely-staging-staging.up.railway.app`, sealed session secret and
  sealed Resend key. The Resend key has sending-only permission restricted to
  `notifications.nevely.app`; delivery is forced to the provider's synthetic
  staging recipient.
- [GitHub Actions run 30199025631](https://github.com/gabriellos88/Nevely/actions/runs/30199025631)
  and its required
  [`Migrations and tests` job](https://github.com/gabriellos88/Nevely/actions/runs/30199025631/job/89785657229)
  succeeded before Railway activated the revision.
- Railway deployment
  `7a88fadb-69cb-46a3-80fa-c1a36a353884` became active. Its deploy log shows
  `npm run db:migrate`, all three migrations already applied, the application
  start command and the fixed `server.listening` event. `GET /health/ready`
  returned HTTP 200 with `{"status":"ready"}` and
  `X-Robots-Tag: noindex, nofollow`.
- `npm run check:env:staging` passed inside the running Railway container
  without printing configuration values. This verifies the non-production
  hostname, distinct Railway environment IDs, test-only email mode, fixed
  synthetic recipient, analytics disabled and indexing disabled.
- The remote Playwright suite ran with
  `PLAYWRIGHT_BASE_URL=https://nevely-staging-staging.up.railway.app` and
  passed all three tests in 10.5 seconds. It verified live/readiness responses,
  `robots.txt`, the no-index response header, no Google Analytics requests and
  the guest/browser acceptance flows without retaining screenshots, videos or
  traces.
- `npm run smoke:staging:email` was accepted from the Railway container
  without printing provider or configuration identifiers. Resend showed the
  synthetic `Nevely staging delivery smoke` event as `delivered`.
- The public service exposes only the application and fixed health responses.
  Railway variables and console remained behind the authenticated provider
  dashboard, and secrets remained masked. No production service, database,
  session configuration, email key or analytics property was edited or used
  during the staging drill.

Two real negative paths were retained as evidence:

- The first deployment failed closed during initialization because
  `overlapSeconds` and `drainingSeconds` were strings. Railway did not start
  the build. Commit `5cb1834` corrected the schema types and strengthened the
  release validator to reject the invalid representation.
- The first remote browser run exposed a country-catalog loading race. Commit
  `e65098c` fixed the user-facing state and added a deterministic delayed-load
  regression test before the successful final deploy.

Together these checks cover the successful path, provider authorization
boundary, privacy-safe observability, isolation from production and observable
recovery from deployment and browser acceptance failures.
