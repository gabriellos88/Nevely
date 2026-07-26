# Release health and draining

## Health endpoints

- `GET /health/live` proves that the Node.js process can serve HTTP. It does
  not query dependencies and remains live while the process is draining.
- `GET /health/ready` returns HTTP 200 only while the release accepts work and
  PostgreSQL answers a bounded `SELECT 1`. It returns HTTP 503 during startup,
  dependency failure, draining and shutdown.

Responses contain only a fixed status string. They do not expose database
hosts, timestamps, revisions, environment IDs, users or session data.

Railway uses `/health/ready` as its deployment healthcheck through
`railway.json`. Railway's deployment healthcheck is a release gate, not a
continuous uptime monitor; external monitoring can poll both endpoints later.

## Deployment timing

The committed Railway configuration uses:

- 30 seconds of deployment overlap;
- 35 seconds from `SIGTERM` to Railway's forced `SIGKILL`;
- a 25-second application grace period through `SHUTDOWN_GRACE_MS`.
- `node server.js` as the direct start command so Railway signals the Node
  process rather than an `npm` wrapper.

The ten-second margin is reserved for Socket.IO, HTTP and PostgreSQL pool
closure. Keep `SHUTDOWN_GRACE_MS` lower than Railway's `drainingSeconds`.

## SIGTERM sequence

On `SIGTERM` or `SIGINT`, the old release:

1. changes readiness to HTTP 503;
2. stops accepting new HTTP connections and new random/direct matches;
3. removes queued match requests;
4. sends connected clients a generic release notice with the remaining grace
   time;
5. allows existing conversations to continue and persist messages until they
   finish or the deadline expires;
6. marks remaining conversations ended, closes Socket.IO and HTTP, then closes
   the PostgreSQL pool.

Application logs use fixed event names and optional sanitized error type/code.
Raw error messages, stack traces, requests, identifiers, email addresses,
tokens, chat text and topics are not written.

## Acceptance

Automated tests must prove:

- liveness is independent from PostgreSQL;
- readiness fails without PostgreSQL, on query failure and while draining;
- a new match is rejected after draining begins;
- connected clients receive the generic notice;
- active conversation persistence completes before shutdown resolves;
- shutdown is idempotent and bounded.

Staging must also confirm that Railway reads the committed healthcheck,
overlap and draining configuration and that an actual redeploy completes
without an unannounced disconnect.

## Staging acceptance evidence

Acceptance was completed on 2026-07-26 against commit `ef1d5eb` in
[pull request #1](https://github.com/gabriellos88/Nevely/pull/1):

- [GitHub Actions run 30199356921](https://github.com/gabriellos88/Nevely/actions/runs/30199356921)
  and its required
  [`Migrations and tests` job](https://github.com/gabriellos88/Nevely/actions/runs/30199356921/job/89786509757)
  succeeded before Railway deployed the revision.
- Railway deployment `b1c2e172-cb9a-4399-adfc-eedea4ca25f3`
  became active with the committed healthcheck, 30-second overlap,
  35-second draining window and direct Node start command.
- The privacy-safe `npm run smoke:staging:drain` verifier connected two
  synthetic guest clients, established one active conversation and confirmed
  a message had a PostgreSQL-generated identifier without printing the
  identifier, socket IDs, profile data, message text or topics.
- With those clients still connected, an authenticated Railway dashboard
  action redeployed the exact same revision as deployment
  `4754958d-fa5a-4fc9-9cdb-2dd1b40c774d`.
- The new process emitted `server.listening` at
  `2026-07-26T11:04:52.064Z`. The old process emitted `server.draining` at
  `2026-07-26T11:05:26.262Z`, after the configured overlap, then emitted
  `server.stopped` at `2026-07-26T11:05:51.478Z`. Its 25.216-second
  application drain completed within Railway's 35-second limit, and Railway
  marked the old deployment `Completed` rather than `Crashed`.
- Both connected clients received the generic `release-draining` payload
  before disconnection. A new match request sent through the draining socket
  received the same generic rejection. Both clients then observed the
  application `server-shutdown` event and clean Socket.IO disconnect.
- A post-drill aggregate query, executed only through the authenticated
  Railway console, confirmed that a recent guest conversation with a
  persisted message was marked ended. It returned only a fixed pass message,
  with no row data, identifiers or chat content.
- The new release returned `GET /health/ready` HTTP 200 with the fixed
  `{"status":"ready"}` body and retained
  `X-Robots-Tag: noindex, nofollow`. The old process's observed
  `server.draining` event is emitted immediately after its lifecycle changes
  from `ready`; the automated endpoint test proves that this state returns
  HTTP 503 while liveness remains HTTP 200.
- Railway logs contained only fixed application lifecycle events and no
  `server.shutdown_failed` event. Redeploy authorization stayed behind the
  provider dashboard; the public health endpoints exposed no environment,
  database, session or user data.

The real negative-path drill was also retained. With the earlier
`startCommand: npm start`, Railway signalled the `npm` wrapper, logged
`npm error signal SIGTERM`, did not receive application
`server.draining`/`server.stopped` events and labelled the replaced deployment
as crashed. Commit `ef1d5eb` changed the command to `node server.js` and added
a release assertion that rejects wrapper-based start commands. The first
smoke-verifier run also failed closed on PostgreSQL's string representation of
`BIGINT`, printing only a fixed stage and error type; the corrected verifier
normalizes the synthetic value without logging it.

Together the successful and negative drills cover liveness/readiness,
authorization, overlap, real SIGTERM handling, user notification, rejection
of new work, persistence, bounded shutdown, privacy-safe observability and
recovery from a failed release configuration.
