# Network ban dual-control runbook

Network bans are temporary, explicit controls. They never result automatically
from an account or guest ban and never store or emit a raw IP/CIDR.

In the Bans table, an account-derived restriction is identified by its current
canonical source Public ID. A manual restriction is identified as
`Manual · net_<reference>`. The Details action exposes only the pseudonymous
reference, origin, linked account-ban state, family/prefix, dual-control actors,
reason, lifecycle and revocation metadata; the full HMAC and raw network value
remain unavailable to the browser.

## Request by Admin A

The default workflow accepts one canonical `nvy_...`. The server resolves it
to the internal account key, requires an active account ban, then reads only
the server-observed `last_ip` when `last_network_seen_at` is no older than 24
hours. It freezes an HMAC fingerprint with the narrowest host scope: IPv4 `/32`
or IPv6 `/128`. The browser cannot supply or override this address.

Advanced manual input accepts IPv4 `/24` through `/32` or IPv6 `/64` through
`/128`. The pending record stores the HMAC, family, prefix, proposed duration,
sanitized reason, requester and a 24-hour expiry. It stores no raw CIDR.

## Decision by Admin B

Admin B must be a distinct, active administrator with 2FA and a current
high-risk re-authentication window. For manual scope, Admin B re-enters the
exact CIDR; the server compares its HMAC. Reject records a minimized decision.
Approve inserts `network_bans`, consumes the approval and writes both audit
events in the same transaction. The same reviewer retry returns the same ban.
Expired, rejected, self-reviewed, stale-signal or mismatched requests fail
without a ban.

The pending queue exposes only source account Public ID when applicable,
account-ban state, sanitized reason, duration, family/prefix, shortened HMAC
reference, requester Public ID and review expiry.

## Enforcement and incident response

Activation blocks subsequent HTTP and Socket.IO admission. A PostgreSQL control
notification carries only HMAC/family/prefix, allowing every replica to scan
its local sockets and disconnect matches. Active conversations close safely;
only the restricted socket receives `network-restricted`, while its partner
receives generic `partner-left`.

Production must require a dedicated `NETWORK_BAN_HMAC_KEY` and must expose Node
only through the single trusted application proxy configured by Nevely. Do not
paste IPs, CIDRs, fingerprints, cookies or message content into reasons,
screenshots, audit exports or incident tickets.

Rollback is application-first: revoke an incorrect ban with a reason, stop the
candidate deploy, and retain approval/audit rows. Do not reuse an approval or
convert it into another ban type. Schema down-migration is allowed only on a
PITR clone after proving no 018 review has been created.
