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

## Required repository setting

The classic branch-protection rule for `main` requires:

- a pull request before merging;
- the `Migrations and tests` status check from GitHub Actions;
- the branch to be up to date before merging;
- no bypass of the rule.

Force pushes and branch deletion remain disabled. Do not configure Railway to
deploy a commit until this required check has succeeded.

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

## Acceptance evidence

Acceptance was completed on 2026-07-26 against commit `0f0d82a` in
[pull request #1](https://github.com/gabriellos88/Nevely/pull/1):

- The local equivalent passed before publication.
- [GitHub Actions run 30028859077](https://github.com/gabriellos88/Nevely/actions/runs/30028859077)
  completed the locked install, all migrations on disposable PostgreSQL,
  structural/privacy checks, server integration tests, isolated Chromium
  install and browser acceptance tests. The final
  [`Migrations and tests` job](https://github.com/gabriellos88/Nevely/actions/runs/30028859077/job/89734436312)
  succeeded in 1 minute 18 seconds.
- The persisted `main` branch-protection rule requires
  `Migrations and tests`, requires the branch to be current, and prevents rule
  bypass. GitHub showed the check as `Required`.
- For the negative-path drill, the workflow was cancelled while the job was
  active. The
  [cancelled job](https://github.com/gabriellos88/Nevely/actions/runs/30028859077/job/89734365164)
  ended after 17 seconds; the pull request showed one cancelled required check
  and disabled `Merge pull request`.
- A subsequent full rerun succeeded. The pull request then showed
  `All checks have passed`, no base-branch conflict and an enabled merge
  control.

This proves the acceptance path, repository authorization boundary,
observable success/failure states and recovery from a non-successful check.
The workflow retains read-only repository permission, receives no production
or staging secrets, uses synthetic test records and uploads no user data,
screenshots or traces.
