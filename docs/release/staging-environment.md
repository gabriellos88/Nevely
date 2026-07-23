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
5. complete the browser smoke suite against `PUBLIC_ORIGIN`;
6. send the verification-email test only to
   `delivered+staging@resend.dev` and confirm the Resend event;
7. confirm no production database rows, sessions or analytics events changed.

N0.3 remains incomplete until the environment exists and this gate has been
executed successfully. Repository configuration alone is not proof of
isolation.
