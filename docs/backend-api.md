# Nevely backend reference

All JSON endpoints except health and authentication require a valid account session. Admin endpoints also require `users.role = 'admin'`.

## Express routes

### Authentication

- `GET /register`, `POST /register`: registration page and account creation.
- `GET /login`, `POST /login`: login page and session creation.
- `POST /logout`: destroys the current session.
- `GET /api/auth/me`: returns the current session user or `null`.

Planned: password reset email, email verification and Google sign-in.

### Account and profiles

- `GET /api/account`: private account details.
- `PATCH /api/account`: update display name, email, age, gender, country and temporary image URL.
- `DELETE /api/account`: anonymize existing messages and delete the account. Body confirmation: `DELETE`.
- `POST /api/account/avatar`: reserved endpoint; returns `501` until object storage is configured.
- `GET /api/users/:id/profile`: public profile plus friendship/block state.
- `GET /api/blocks`, `PUT /api/blocks/:id`, `DELETE /api/blocks/:id`: block-list management.

### Conversations

- `GET /api/conversations`: active and retained conversation history.
- `GET /api/conversations/:id/messages`: read a retained or saved conversation.
- `DELETE /api/conversations/:id`: delete a conversation for both participants. Body confirmation: `DELETE FOR EVERYONE`.
- `GET /api/saved-chats`: saved chats and the current plan limit.
- `PUT /api/conversations/:id/saved`, `DELETE /api/conversations/:id/saved`: save or unsave a chat.

Unsaved conversations are deleted after 30 days. Saved chats do not expire automatically. Limits are 2 for free accounts and 10 for premium accounts.

### Friends and inbox

- `GET /api/friends`, `DELETE /api/friends/:id`: list or remove friends.
- `GET /api/friend-requests`, `POST /api/friend-requests`: list or create requests.
- `PATCH /api/friend-requests/:id`: accept or decline a request.
- `GET /api/chat-requests`: list pending direct-chat requests.
- `GET /api/notifications`: list notifications.
- `PATCH /api/notifications/:id/read`: mark a notification as read.

### Operations

- `GET /api/database-health`: PostgreSQL status.
- `GET /admin`: minimal users, reports and plan-price view.
- `POST /api/admin/users/:id/ban`: temporary or permanent ban.
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
- `chat-error`: general realtime error.

## Safety and future work

The server enforces text length and a per-socket rate limit. `BANNED_WORDS` can hold a comma-separated fallback list. Perspective API or an equivalent multilingual moderation provider is planned but not enabled. Photo/audio WebRTC, payment processing, email flows and production avatar storage are also planned.

## Database migrations

Run `npm run db:migrate` with `DATABASE_URL` configured. The runner records applied SQL files in `schema_migrations`, removes an accidental UTF-8 BOM and applies each new migration in its own transaction.
