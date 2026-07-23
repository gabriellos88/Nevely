# Continuous integration gate

The GitHub Actions workflow at `.github/workflows/ci.yml` is the required
pre-merge and `main` branch test gate.

## What it proves

The job:

1. checks out the exact revision under test;
2. installs only dependencies pinned by `package-lock.json`;
3. starts a disposable PostgreSQL 17 service and applies every migration;
4. runs structural and privacy-safety checks;
5. runs the server unit/integration suite;
6. installs an isolated Chromium build and runs browser acceptance tests.

The job has read-only repository permission, a 25-minute timeout and no
production or staging secrets. Its database password and session secret are
test-only literals scoped to the ephemeral runner.

## Repository setting still required

In GitHub, protect `main` and require the `Migrations and tests` check before
merge. Do not configure Railway to deploy a commit until this required check
has succeeded.

## Local equivalent

With a disposable PostgreSQL database available through `DATABASE_URL`:

```sh
npm ci
npm run db:migrate
npm run check
npm run test:server
npx playwright install chromium
npm run test:browser
```

N0.2 is complete only after every referenced script exists, the local
equivalent passes and the workflow succeeds on GitHub.
