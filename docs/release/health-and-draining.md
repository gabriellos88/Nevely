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
