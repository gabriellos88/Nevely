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
- `DELETE /api/account`: anonymize existing messages and delete the account. Body confirmation: `DELETE`.
- `POST /api/account/avatar`: reserved endpoint; returns `501` until object storage is configured.
- `GET /api/users/:id/profile`: public profile plus friendship/block state;
  `:id` is the opaque `nvy_` + 12 lowercase hexadecimal public identifier.
- `GET /api/blocks`, `PUT /api/blocks/:id`, `DELETE /api/blocks/:id`: block-list management. The list uses the shared `cursor` contract.

### Conversations

- `GET /api/conversations`: active and retained conversation history for the
  account or guest principal in the current session, paginated with `cursor`.
- `GET /api/conversations/:id/messages`: read a retained or saved conversation, newest page first with `beforeMessageId` for older messages.
- `DELETE /api/conversations/:id`: delete a conversation for both participants. Body confirmation: `DELETE FOR EVERYONE`.
- `GET /api/saved-chats`: saved chats and the current account/guest limit.
- `PUT /api/conversations/:id/saved`, `DELETE /api/conversations/:id/saved`: save or unsave a chat.

Unsaved conversations are deleted 7 days after last activity, or oldest first
when an account or guest exceeds the configured limit (50 by default) of
unsaved conversations with messages. Saved conversations are deleted 12 months
after last activity. Saved-chat limits are 2 for guests and free accounts, and
10 for premium accounts. Reports retain a separate immutable 50-message
evidence window for 24 months.

### Friends and inbox

- `GET /api/friends`, `DELETE /api/friends/:id`: list or remove friends.
- `GET /api/friend-requests`, `POST /api/friend-requests`: list or create requests.
- `PATCH /api/friend-requests/:id`: accept or decline a request.
- `GET /api/chat-requests`: list pending direct-chat requests.
- `GET /api/notifications`: list notifications.
- `PATCH /api/notifications/:id/read`: mark a notification as read.

Guest notifications use the same endpoints and are authorized by the current
guest principal session.

Every growing list in this section uses keyset `cursor` pagination. The default page size is 30 and `limit` is capped at 100. Responses include `page.hasMore` and `page.nextCursor`; malformed cursors return HTTP 400.

### Operations

- `GET /api/database-health`: PostgreSQL status.
- `GET /admin`: minimal users, reports and plan-price view.
- `GET /api/admin/guests`, `GET /api/admin/guests/:id`, `GET /api/admin/users`,
  `GET /api/admin/reports`, `GET /api/admin/bans`: keyset-paginated
  operational collections. Guest cursors use `(created_at, public_id)` and
  Details/moderation routes accept only the canonical `gst_...` ID (with a
  temporary server-side legacy resolver); UUIDs are never emitted.
- `GET /api/admin/database-capacity`: last 30 aggregate capacity samples and retention runs.
- `POST /api/admin/users/:id/ban`: temporary or permanent ban.
- `POST /api/admin/guests/:id/ban`: a `temporary` restriction requires `hours`; a
  `permanent` restriction creates a separate server-side, HMAC-pseudonymous device
  restriction linked to the guest ban. It never creates an IP/network ban.
- `PATCH /api/admin/guest-bans/:id/revoke`: revokes a guest restriction.
- `GET /suspension`, `POST /api/suspension/appeals`: after valid credentials for a
  suspended account, the only available mode is suspension detail, one idempotent
  pending appeal per account ban, and logout. The login JSON response uses
  `ACCOUNT_SUSPENDED` with reason, start, expiry and type only after credential validation.
- `DELETE /api/admin/users/:id`: permanent ban, IP ban when available and account anonymization.
- `PATCH /api/admin/reports/:id`: resolve or dismiss a report.
- `POST /api/admin/prices`: record a new premium price.

## Socket.IO events

### Client to server

- `find-partner`: starts random matching with profile, interests and premium filters.
- `send-message`: sends one text message, maximum 1,000 characters.
- `leave-chat`: leaves the active conversation, subject to skip cooldown.
- `report`: reports the active partner with optional `reason` and `details`.
- `direct-chat-request`: requests a direct chat with a friend.
- `direct-chat-response`: accepts or declines a direct-chat request.

### Server to client

- `waiting`: user entered the matchmaking queue.
- `matched`: includes conversation id, partner profile, shared interests and cooldown.
- `receive-message`, `message-sent`, `message-error`: message lifecycle.
- `partner-left`, `guest-time-expired`, `skip-cooldown`: conversation lifecycle.
- `report-submitted`, `report-error`: report lifecycle.
- `direct-chat-requested`, `direct-chat-request-sent`, `direct-chat-error`: direct-chat lifecycle.
- `notification-created`: tells the client to refresh notifications.
- `account-banned`: closes the account session after moderation action.
- `guest-restricted`: closes a restricted guest principal session.
- `chat-error`: general realtime error.

## Safety and future work

The server enforces text length and a per-socket rate limit. `BANNED_WORDS` can hold a comma-separated fallback list. Perspective API or an equivalent multilingual moderation provider is planned but not enabled. Photo/audio WebRTC, payment processing, email flows and production avatar storage are also planned.

## Database migrations

Run `npm run db:migrate` with `DATABASE_URL` configured. The runner records applied SQL files in `schema_migrations`, removes an accidental UTF-8 BOM and applies each new migration in its own transaction. Migrations 015–016 can be rolled back safely only by restoring the pre-migration schema/database backup or by a reviewed, explicit down migration after all permanent guest restrictions and pending suspension appeals have been resolved; do not delete audit records. N2 operations, rollback and verification are documented in [`docs/operations/database-retention-and-capacity.md`](operations/database-retention-and-capacity.md). Persistent guest identity, product ownership and the verified account-claim contract are documented in [`docs/admin/guest-identity.md`](admin/guest-identity.md), [`docs/admin/guest-product-ownership.md`](admin/guest-product-ownership.md) and [`docs/admin/guest-account-claims.md`](admin/guest-account-claims.md).
