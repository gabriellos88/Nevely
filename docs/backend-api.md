# Nevely backend reference

All JSON endpoints except health and authentication require either a valid
account session or, for the guest passport and conversation archive, a
session-bound guest principal. Admin endpoints require `users.role = 'admin'`.

## Express routes

### Authentication

- `GET /register`, `POST /register`: registration page and account creation;
  `?claim=1` is available only to an eligible server-session guest.
- `GET /login`, `POST /login`: login page and session creation. An existing
  account login never merges a current guest.
- `POST /logout`: destroys the account session, or restores the validated
  guest session saved as a return principal.
- `GET /api/auth/me`: returns the current session user or `null`.

Implemented in N1:

- `POST /verify-email` and `POST /api/auth/verification/resend`;
- `POST /forgot-password` and `POST /reset-password`;
- `POST /auth/google` using a server-validated Google ID token;
- `POST /login/2fa` for protected administrator login.

### Account and profiles

- `GET`, `POST`, `PATCH`, `DELETE /api/guest-profile`: create, restore, update
  or tombstone the persistent guest principal bound to the current server
  session. The response exposes only `gst_` + 12 lowercase hexadecimal
  characters; a browser-supplied UUID is never accepted as proof of ownership.
- `GET /api/account`: private account details.
- `PATCH /api/account`: update display name, canonical gender/country and
  temporary image URL. Birth date is support-controlled; email uses a separate
  verified flow.
- `POST /api/account/password`: change password and revoke every session.
- `POST /api/account/email-change`, `POST /confirm-email-change`: verify a new
  address, notify the old address and revoke every session.
- `POST /api/account/identities/google`,
  `DELETE /api/account/identities/google`: explicit linking and safe unlinking.
- `DELETE /api/account`: start the irreversible registered-account deletion
  lifecycle. The transaction sets `deleted_at` and `retention_until` exactly 30
  days later, revokes every session and preserves the canonical `nvy_...` ID
  until purge. Body confirmation: `DELETE`.
- `POST /api/account/avatar`: reserved endpoint; returns `501` until object storage is configured.
- `GET /api/users/:id/profile`: public profile plus friendship/block state;
  `:id` is the opaque `nvy_` + 12 lowercase hexadecimal public identifier.
  `context=history&conversationId=cnv_...` is accepted only after participant
  authorization and returns `presenceVisible: false` without an online field.
- `GET /api/blocks`, `PUT /api/blocks/:id`, `DELETE /api/blocks/:id`: block-list management. The list uses the shared `cursor` contract.

### Conversations

- `GET /api/conversations`: active and retained conversation history for the
  account or guest principal in the current session, paginated with `cursor`.
  Each row includes an opaque `cnv_...` public identifier and server-derived
  `canSave`, `canUnsave`, `canRemoveFromHistory` and
  `canDeleteUnsavedMessages` capabilities. Registered responses also include a
  `directInbox` capped at five total rows, grouped as `active` and `recent`,
  plus `pendingChatRequestCount` and the combined `messageBadgeCount`.
- `GET /api/conversations/:publicId/messages`: read a retained or saved
  conversation using its `cnv_...` ID. Messages expose only `msg_...` IDs;
  `beforeMessageId` is the oldest visible public message ID from the prior page.
- `PATCH /api/conversations/:publicId/read`: idempotently records a read boundary
  using only `upToMessageId: "msg_..."` after revalidating participation.
- `DELETE /api/conversations/:publicId/history`: for an ended conversation,
  hides it only from the current participant and removes only that participant's
  saved preference. Body confirmation: `REMOVE FROM MY HISTORY`. Repeated calls
  are idempotent and do not change messages, the other participant, reports,
  evidence or audit data.
- `POST /api/conversations/:publicId/delete-unsaved`: for an ended conversation,
  marks only server-deletable messages as deleted for both participants. Any
  conversation protected by either participant's save or an active report
  retention record is left untouched without revealing the reason. Body
  confirmation: `DELETE UNSAVED MESSAGES`; a distributed generic cooldown applies.
- `GET /api/saved-chats`: saved chats and the current account/guest limit.
  Save/Unsave is an individual preference. If a retained partner account or
  guest can no longer be shown, the saved row and its messages remain available
  with `partner_anonymized: true`, a neutral label, no partner public ID, photo
  or presence, and no partner-dependent capability. Historical message sender
  identity is minimized by the same rule.
- `PUT /api/conversations/:publicId/saved`, `DELETE /api/conversations/:publicId/saved`:
  save or unsave a chat using only its opaque public ID.

Ended unsaved conversations are deleted 7 days after last activity, or oldest first
when an account or guest exceeds the configured limit (50 by default) of
unsaved conversations with messages. Saved conversations are deleted 12 months
after last activity. Saved-chat limits are 2 for guests, 5 for standard
registered accounts and 10 for premium accounts. Reports retain a separate immutable 50-message
evidence window for 24 months. An active direct conversation remains listed and
readable even if its rolling `expires_at` timestamp is in the past; retention
becomes eligible only after an explicit end, friendship removal or block changes
its status from `active`.

### Friends and inbox

- `GET /api/friends`: list friends with public-ID keyset cursors and a
  server-derived `capabilities` object. The browser renders only capabilities
  whose value is exactly `true`; an active direct reservation instead exposes
  only `canOpenDirectChat` plus its opaque `cnv_...` conversation ID. It never supplies friendship or availability
  state back to the server.
- `DELETE /api/friends/:id`: remove both directed friendship rows atomically,
  cancel pending friend/chat requests for the pair and remain idempotent on
  retries. `PUT /api/blocks/:id` uses the same ordered account locks, removes
  the friendship and cancels pending requests in the same transaction. Both
  operations also end and release an active direct conversation for the pair.
- `GET /api/friend-requests`: list incoming requests. Use
  `?direction=outgoing` for requests created by the current account. Request
  IDs and keyset cursors contain only opaque `frq_...` public identifiers.
- `POST /api/friend-requests`: create a request. Creation locks both accounts in
  deterministic order and revalidates active account, email verification,
  blocks, friendship and reverse-pending state. Repeating the same pending
  request returns the same public ID without creating another notification.
- `PATCH /api/friend-requests/:id`: accept or decline an incoming request.
  Repeating the same terminal action is idempotent. Acceptance revalidates both
  accounts and blocks before creating both friendship directions atomically.
- `DELETE /api/friend-requests/:id`: cancel an outgoing pending request;
  repeated cancellation is idempotent.
- `GET /api/chat-requests`: list pending incoming direct-chat requests using
  opaque `crq_...` IDs and public-ID keyset cursors. Use
  `?direction=outgoing` for requests created by the current account. Expired
  requests are transitioned in PostgreSQL and omitted from both directions.
- `GET /api/notifications`: list non-dismissed product notifications using
  opaque `ntf_...` IDs and public-ID keyset cursors. Ban notifications are not
  returned; suspension state is authoritative server state. JSON `data` is
  minimized per notification type and can contain only validated public IDs or
  fixed actions. Friendship and direct-chat-request rows may include a minimized
  `actor` with public account ID, public display name and public profile image;
  deleted/unavailable actors return `null`. No presence or internal key is
  included. The client routes friendship rows to Friend requests and chat
  request rows to the Conversations inbox.
- `PATCH /api/notifications/:id/read`: idempotently mark an owned product
  notification as read.
- `DELETE /api/notifications/:id`: idempotently soft-dismiss an allowlisted
  product notification. The row remains in PostgreSQL; security, moderation and
  audit records cannot be deleted or dismissed through this endpoint. This
  includes dismissing `friend_accepted` product notifications.

Guest notifications use the same endpoints and are authorized by the current
guest principal session.

Every growing list in this section uses keyset `cursor` pagination. The default page size is 30 and `limit` is capped at 100. Responses include `page.hasMore` and `page.nextCursor`; malformed cursors return HTTP 400.

Friend-request mutations publish `friend-request-updated` only after the
database commit. Its minimized payload is `{ requestId, status }`, where
`requestId` is the opaque public request ID and status is one of the documented
friend-request states. Notification payloads use `requestPublicId` and public
principal IDs; numeric database keys are never sent to the browser.
Friend removal and block publish the minimized `friendship-updated`
invalidation only after commit. Its payload contains the other account’s
public ID and the generic status `removed` or `blocked`.
Notification read/dismiss mutations publish `notification-updated` after the
database write with only `{ notificationId, status }`. Account tabs refetch the
authoritative list; reconnect also reads the persisted state.
Chat-request send, response and cancellation lock the account pair and request
row, commit a compare-and-set terminal state, then publish only
`{ requestId, status }`. Same-direction sends and repeated matching terminal
actions are idempotent. Send, response and cancellation use separate
principal-scoped PostgreSQL rate windows shared by replicas; the client sees
only generic feedback and an optional `retryAfterSeconds`.
Acceptance reserves exactly one `direct` conversation in the same PostgreSQL
transaction as the request transition and stores that relation on the request.
Both accounts, friendship and blocks are revalidated while the ordered account
locks are held. A request remains pending if the local realtime route cannot
start safely; no presence detail is returned.

### Operations

- `GET /api/database-health`: PostgreSQL status.
- `GET /admin`: minimal users, reports and plan-price view.
- `GET /api/admin/guests`, `GET /api/admin/guests/:id`, `GET /api/admin/users`,
  `GET /api/admin/reports`, `GET /api/admin/bans`: keyset-paginated
  operational collections. Users support `state=active|banned|deleted`; guests
  support `status=active|banned|claimed|deleted|expired`. Both expose age,
  country, reliable last activity and the bounded recent-chat count where
  available. Deleted accounts still inside retention expose their retained
  administrative fields in Details; list responses omit retained email.
  Purged tombstones return explicit lifecycle metadata and no personal fields.
  Guest cursors use `(created_at, public_id)` and
  Details/moderation routes accept only the canonical `gst_...` ID (with a
  temporary server-side legacy resolver); UUIDs are never emitted.
- `GET /api/admin/database-capacity`: last 30 aggregate capacity samples and retention runs.
- `POST /api/admin/users/:id/ban`: temporary or permanent ban.
- `POST /api/admin/guests/:id/ban`: a `temporary` restriction requires `hours`; a
  `permanent` restriction creates a separate server-side, HMAC-pseudonymous device
  restriction linked to the guest ban. It never creates an IP/network ban.
- `PATCH /api/admin/guest-bans/:id/revoke`: revokes a guest restriction.
- `GET /api/admin/network-ban-privacy-approvals`: minimized pending-review
  queue. It returns a pseudonymous network reference, family/prefix, proposed
  duration and internal workflow ID, never a raw IP/CIDR.
- `POST /api/admin/network-ban-privacy-approvals`: Admin A requests a temporary
  network review. The default input is a canonical `nvy_...` account with an
  active account ban and a server-observed network signal no older than 24
  hours; its scope is IPv4 `/32` or IPv6 `/128`. Advanced manual CIDR is limited
  to IPv4 `/24` or narrower and IPv6 `/64` or narrower.
- `POST /api/admin/network-ban-privacy-approvals/:id/approve` and `.../:id/reject`:
  a distinct Admin B records the independent decision. Approval creates the
  network ban and consumes the review atomically; manual review requires the
  exact CIDR to be re-entered. Retry by the same reviewer is idempotent. The old
  `POST /api/admin/network-bans` third step returns `410` and cannot create a ban.
  Account, guest and network bans remain separate.
- `GET /api/admin/network-bans/:id`: admin-only minimized detail for a network
  restriction. It returns the pseudonymous `net_...` reference, account/manual
  origin, current source Public ID and linked account-ban state when applicable,
  family/prefix, requester, privacy reviewer, lifecycle and revocation metadata.
  It never returns the network HMAC, a raw IP/CIDR, a user database key or the
  privacy-approval identifier.
- `GET /suspension`: after valid credentials for a suspended account, the only
  browser mode is a support-oriented suspension page and logout. The retired
  appeal API is not registered. The login JSON response uses `ACCOUNT_SUSPENDED`
  with reason, start, expiry and type only after credential validation.
- `GET /guest-restricted`: generic Astra restriction page with a Support link;
  it does not disclose ban, device or network details.
- `DELETE /api/admin/users/:id`: invokes the same 30-day account lifecycle as
  self-delete; it never creates an IP/network ban.
- `PATCH /api/admin/reports/:id`: resolve or dismiss a report.
- `POST /api/admin/prices`: record a new premium price.

## Socket.IO events

### Client to server

- `find-partner`: starts continuous random matching with profile, interests and
  premium filters. Without interests the socket enters the general queue
  immediately. With interests, `waitingTimeSeconds` accepts 5–30 seconds for
  the initial shared-topic preference or `null` for an unlimited preference.
  A finite preference relaxes in place and keeps the socket queued; `null`
  remains in the shared-topic phase without imposing a maximum search duration.
  Filters, blocks, bans, authorization and rate limits remain active throughout.
  Starting random matching while a direct conversation is active parks its
  realtime pairing but leaves the persisted direct conversation active and does
  not consume a random skip.
- `cancel-search`: removes the current socket from matchmaking. Its optional
  acknowledgement contains only `{ ok, cancelled }` and no queue or presence data.
- `resume-direct-chat`: requests resumption of the authenticated account's
  active direct reservation using only the partner public ID. The server
  revalidates friendship, block, account and conversation state, applies a
  distributed cooldown and returns only `{ ok, resumed, retryAfterSeconds? }`.
  A waiting random search is cancelled only when the account explicitly uses
  this event; an active random conversation is never ended implicitly.
- `send-message`: sends one text message, maximum 1,000 characters.
  Unsaved/unreported conversation storage is progressively bounded to the most
  recent 200 messages. Saved or moderation-retained records are not pruned, but
  product history APIs expose at most the latest 200 messages.
- `messages-read`: records a read boundary for the socket's current active
  conversation. Both `conversationId` and `upToMessageId` are opaque public IDs;
  the server rejects IDs that do not match the socket's active pairing.
- `leave-chat`: leaves the active conversation, subject to skip cooldown. An
  optional Socket.IO acknowledgement returns `{ ok: true, ended }` only after
  the server transition completes, or `{ ok: false, retryAfterSeconds }` for a
  generic cooldown. The existing `skip-cooldown` event remains available for
  older clients; neither response discloses thresholds or abuse signals.
- `end-direct-chat`: ends only a server-owned `direct` conversation. It never
  enters random matchmaking or consumes the progressive skip counter. Repeated
  calls after the pair ended return `{ ok: true, ended: false }`. A random
  conversation cannot use this event to bypass Next/skip enforcement.
  The event requires the exact `END DIRECT CONVERSATION` confirmation value.
  It also resolves the authenticated account's persisted direct reservation
  when the partner is offline; the browser never supplies the conversation type.
- `report`: reports the active partner with optional `reason` and `details`.
  If a random partner leaves, the server may retain this capability only for
  the remaining connected socket until it starts another action or disconnects.
- `direct-chat-request`: requests a direct chat with a friend using only the
  friend’s public account ID. Its acknowledgement is `{ ok, requestId, status }`
  or generic `{ ok: false, error, retryAfterSeconds? }`.
  If the pair already has an active reservation, it returns the public
  conversation ID with `status: "active"` rather than treating that expected
  state as an error.
- `direct-chat-response`: accepts or declines an incoming request using its
  opaque public ID. Repeated matching terminal actions are idempotent. Accepting
  while the sender is offline creates the same persistent direct reservation;
  the accepting account receives a resumable conversation after commit.
- `direct-chat-cancel`: cancels an outgoing pending request; repeated
  cancellation is idempotent.

### Server to client

- `waiting`: user entered the matchmaking queue. Payload is the generic
  `{ status: "searching" }`; it contains no timeout, presence or matching criteria.
- `search-state`: authoritative search presentation state. Its entire payload is
  `{ phase: "topic-preference" }` or `{ phase: "general" }`. It does not expose
  queue size, online presence, partner identity, filters, anti-abuse signals or
  thresholds. Search does not normally emit a terminal timeout.
- `search-cancelled`: the server removed this socket from matchmaking, either
  after explicit cancellation or because another socket for the same principal
  replaced the search.
- `matched`: includes only the opaque `cnv_...` conversation ID, server-owned `conversationType`
  (`random` or `direct`), partner profile, shared interests, cooldown and the
  minimized `canAddFriend` authorization boolean. Its capability payload makes
  `canNext` and `canEnd` mutually exclusive. The browser rejects an unknown
  conversation type instead of inferring one.
- `receive-message`, `message-sent`, `message-error`: message lifecycle. Successful
  message events expose only the opaque `msg_...` identifier. Random messages
  require the paired socket. A direct message may instead carry its opaque
  conversation ID; the server revalidates participant, friendship, block, ban,
  direct type and active status in the persistence transaction before accepting it.
  The acknowledgement remains generic and never reports delivery or presence.
- `partner-left`, `skip-cooldown`: conversation lifecycle. `partner-left` retains
  the public conversation ID so an authorized participant can save the ended conversation.
  For a random conversation it may additionally carry the boolean `canReport`;
  it reveals no reason, presence detail or moderation signal.
  Guest conversations have no duration timeout.
  A direct pair can be parked when its participant explicitly starts random
  matching; this does not end the direct conversation or consume skip. The
  legacy `leave-chat` path cannot end a direct pair; clients must use the
  confirmed `end-direct-chat` event.
- `direct-chat-paused`: the direct partner disconnected. It exposes no presence
  precision or timeout; the PostgreSQL conversation remains active and can be
  restored only by an explicit Inbox action. Reconnecting never opens a direct
  conversation automatically. A unique ordered-pair reservation prevents a
  second active direct conversation, including concurrent and multi-tab accepts.
- `direct-messages-available`: generic reconnect signal for an active direct
  conversation with unread persisted messages. It contains no message, partner,
  presence, delivery or internal identifier; the client refreshes its Inbox.
- `message-error`: message delivery or temporary abuse/rate protection rejection. Its
  optional `retryAfterSeconds` is generic; it never identifies a duplicate, link,
  repeated-character, burst, or other server-side signal. The chat client temporarily
  disables message submission for that generic interval; the server remains authoritative.
  Browser sends use the Socket.IO acknowledgement for request-local success or failure,
  so concurrent responses cannot be attached to a different optimistic message. Clients
  without an acknowledgement continue to receive `message-sent` or `message-error`.
- `report-submitted`, `report-error`: report lifecycle. The browser shows
  success only after `report-submitted`; report reasons and details are never
  copied into application logs or audit metadata.
- `direct-chat-requested`, `direct-chat-request-sent`,
  `direct-chat-request-updated`, `direct-chat-error`: minimized direct-chat
request invalidations. The browser refetches persisted incoming and outgoing
  state; payloads do not include blocks, presence, internal IDs or limiter
  signals.
- `notification-created`: tells the client to refresh notifications. A newly
  created direct chat request also creates a persistent minimized
  `chat_request` notification after the same transaction commits.
- `account-banned`: closes the account session after moderation action.
- `guest-restricted`: closes a restricted guest principal session.
- `network-restricted`: closes only sockets matching an activated HMAC network
  scope. A conversation partner receives only `partner-left`.
- `chat-error`: general realtime error.

## Safety and future work

The server enforces text length and principal-scoped PostgreSQL message limits. Burst
limits are separate from N5.2 duplicate, link-flood and repeated-character windows.
The ordinary duplicate window allows four normalized copies in 30 seconds;
sustained repetition then receives a generic 8/30/120-second escalation while
the independent burst policy remains 12 messages per 10 seconds.
The latter use daily-rotated HMAC bucket keys derived from a shared deployment secret;
no message body, raw IP, device fingerprint, or derived bucket key is emitted to the
client, logs, or audit stream. Configure `MODERATION_MESSAGE_HMAC_KEY` (or the shared
`SESSION_SECRET`) consistently on every replica. `BANNED_WORDS` can hold a comma-separated fallback list. Perspective API or an equivalent multilingual moderation provider is planned but not enabled. Photo/audio WebRTC, payment processing, email flows and production avatar storage are also planned.

Destructive N5 social/product transitions are audited atomically only when they
change persisted state. The covered actions are friendship removal, block and
unblock, explicit direct-conversation End, per-principal history removal and
server-authorized deletion of unsaved messages. Audit metadata contains only
internal actor/target references, an internal conversation reference where
needed, boolean state or an aggregate deletion count, timestamp and correlation
ID. It never contains message bodies, public identifiers, raw network data,
device fingerprints or anti-abuse signals. Idempotent retries do not append a
second audit row.

## Database migrations

Run `npm run db:migrate` with `DATABASE_URL` configured. The runner records
applied SQL files in `schema_migrations` and applies every migration in its own
transaction. Migration 018 adds registered-account lifecycle columns and the
frozen dual-control network-review references. Historical `deleted_<id>`
tombstones are marked already purged with no invented future retention;
non-anonymized historical deletions receive `deleted_at + INTERVAL '30 days'`.
Migration 022 adds opaque chat-request IDs and persisted expiry. Migration 023
adds the nullable, unique request-to-direct-conversation reservation used by
new accepts. Migration 024 adds the unique ordered account-pair reservation;
it fails closed if legacy active direct data is malformed or duplicated and
does not terminate or rewrite those conversations. These additive migrations
remain readable by the previous server version. After an application rollback,
the next N5 request safely removes a stale reservation whose conversation was
already ended by that older version.
Migration 025 adds opaque conversation IDs and per-participant history
visibility. Migration 026 backfills and defaults opaque message IDs; serial
conversation/message keys remain server-only for locks, ordering and foreign
keys and are never accepted from or returned to product clients.
The rollout/rollback contract is documented in
[`docs/admin/account-deletion-lifecycle.md`](admin/account-deletion-lifecycle.md)
and [`docs/admin/network-ban-review.md`](admin/network-ban-review.md). Never
delete append-only audit records to perform a rollback.
