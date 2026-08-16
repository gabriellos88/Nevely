# Nevely product roadmap

This file is the product and engineering source of truth for unfinished work. Items are ordered by dependency, operational risk and user impact rather than by discovery date.

## Working rules

- Complete `NOW` in order before starting `NEXT`, except for an isolated production hotfix.
- Merge outstanding UI work from the previous project before editing overlapping chat files (`views/chat.ejs`, `public/js/chat-client.js`, `public/css/style.css`).
- Deliver one vertical change per branch/PR: migration, backend, UI, tests, rollout notes and rollback strategy belong together.
- Use additive, backward-compatible database migrations. Remove old schema only in a later deploy after the new code is live.
- A checkbox is complete only when acceptance tests, authorization checks, observability and user-facing error states are included.
- Keep application UI consistent with the local Astra specification. Dashboard tables and widgets use application styling, not marketing gradients or card-hover effects.
- Write UI copy for the person using the product: lead with the action or outcome, use plain language, and keep API codes, session/database mechanics and other implementation details in developer documentation and logs.
- Never log or send passwords, raw verification tokens, emails, guest/account identifiers, chat content, topics, report details or other user-provided sensitive data to analytics.

---

## NOW — launch blockers and foundations

### N0. Release safety and test baseline

- [x] **N0.1 — Reconcile the active UI work.** The Astra UI on `main` is the reconciled source of truth; the retired workspace contains no remaining source or patch. Evidence and the repeatable structural acceptance check are documented in [`docs/release/ui-source-of-truth.md`](docs/release/ui-source-of-truth.md).
- [x] **N0.2 — Add continuous integration.** The least-privilege GitHub workflow, local equivalent, successful disposable-Postgres/Chromium run, required `main` branch gate and controlled cancelled-check drill are documented in [`docs/release/continuous-integration.md`](docs/release/continuous-integration.md).
- [x] **N0.3 — Add a staging environment.** The isolated Railway/Postgres/Resend environment, no-index/analytics-off checks, deployment error drills and final acceptance evidence are documented in [`docs/release/staging-environment.md`](docs/release/staging-environment.md).
- [x] **N0.4 — Add release health controls.**
  - Provide liveness and database-readiness endpoints.
  - Configure Railway healthcheck, deployment overlap and draining time.
  - Handle `SIGTERM`: reject new matches, notify connected clients, finish/persist active work and close HTTP/Socket.IO cleanly.
  - Repository implementation, automated lifecycle tests and the real staging redeploy evidence are documented in [`docs/release/health-and-draining.md`](docs/release/health-and-draining.md).
- [x] **N0.5 — Prove recovery.** Self-managed pgBackRest PITR to private Cloudflare R2, the guarded verifier, failure/capacity controls and the reviewed real Railway staging restore drill are documented in [`docs/release/database-recovery.md`](docs/release/database-recovery.md) and [`docs/release/recovery-drill-record.md`](docs/release/recovery-drill-record.md).
- [x] **N0.6 — Establish automated coverage (initial scope).**
  - Integration tests for migrations, registration, login, logout, profile validation.
  - Authorization tests for every admin endpoint and destructive action currently implemented.
  - Two-client Socket.IO tests for guest/account matching, messages, unread counts, read receipts, cooldowns and disconnects.
  - Browser tests for guest-passport focus management, validation, persisted identity, cleared-storage fallback and responsive drawers.
  - Current coverage and deliberately open contracts are recorded in [`docs/release/automated-test-baseline.md`](docs/release/automated-test-baseline.md).
  - **Deferred by design:** retention and ban tests are re-specified as explicit acceptance criteria of N2.2/N2.4 (retention, pagination) and N4.2 (ban enforcement) respectively. Session-revocation coverage is now delivered by N1.3.

### N1. Identity, registered profiles and authentication

- [x] **N1.1 — Replace short account Public IDs before growth.**
  - Introduce an opaque public identifier with at least 64–80 bits of randomness.
  - Backfill existing users, preserve uniqueness and stop exposing sequential database IDs.
  - Keep a separate shortened display alias if a compact UI label is desired.
- [x] **N1.2 — Fix registered-user onboarding.**
  - Collect the profile fields required for matching during registration or claim.
  - Store date/year of birth rather than a permanently stale numeric age, enforce the 18+ rule server-side and compute current age.
  - Validate gender and country against canonical allowed values.
  - Make birth data support-controlled or strongly protected; allow legitimate gender/country changes with audit and cooldown rather than unrestricted edits.
  - Migrate or repair existing accounts whose age, gender or country is missing.
- [x] **N1.3 — Keep Postgres-backed cookie sessions and harden them.**
  - Add CSRF protection to every state-changing HTTP route.
  - Rotate/regenerate sessions on authentication and privilege changes.
  - Invalidate all sessions after password changes, account deletion, role changes and bans.
  - Require production `DATABASE_URL` and `SESSION_SECRET`; never silently use the in-memory session store in production.
  - Add secure headers and a tested Content Security Policy.
- [x] **N1.4 — Implement email verification with Resend.**
  - Add purpose-scoped, single-use verification records with a hashed token, expiry, `used_at`, attempt metadata and revocation.
  - Send the raw token only in the email link from `Verify <noreply@notifications.nevely.app>`.
  - Use an outbox/worker with retries and idempotency instead of an untracked background promise.
  - Add verify, resend and expired/used-token flows with rate limits that do not reveal whether an email exists.
  - Block all registered product access until verification: an unverified
    password account may use only the verification waiting/resend flow and
    logout. Google-created accounts remain verified through the validated
    provider assertion.
- [x] **N1.5 — Implement Sign in with Google using Google Identity Services.**
  - Create separate production and staging OAuth web clients in a Google Cloud project owned by the private admin account; configure only exact authorized origins/redirects and keep credentials in environment secrets.
  - Replace the disabled placeholder with the official Google Identity Services button and request only authentication scopes (`openid`, `email`, `profile`).
  - Validate the ID token server-side, including signature, issuer, audience, expiry, nonce/CSRF protections and `email_verified`.
  - Store a unique Google provider subject (`sub`) in a dedicated account-identity record; never use the email address alone as the durable Google-account key.
  - Reuse the existing Postgres-backed Nevely session, ban checks and session-revocation rules after authentication; do not introduce a parallel JWT login session.
  - Define explicit and takeover-safe flows for new Google accounts, linking/unlinking an existing password account, passwordless accounts and guest claim/merge.
  - Do not request or retain Google access/refresh tokens unless a future feature genuinely needs a separate Google API authorization.
  - Test cancellation, replay, duplicate email/account conflicts, revoked access, banned accounts and staging/production configuration.
  - **Production acceptance (2026-07-30):** the separate production OAuth client, published consent screen, exact production origin, isolated sealed credentials, live Google login, verified email, admin TOTP challenge and dashboard access all passed.
- [x] **N1.6 — Add password-reset and verified email-change flows.** Reuse the token/outbox foundation, revoke active sessions after success and notify the previous address after an email change.
- [x] **N1.7 — Protect administrators.** Add re-authentication for high-risk actions, 2FA for admin accounts and server-side role checks that do not trust stale session role data.
- [x] **N1.8 — Correct the support address everywhere.** Replace `support@nevely.com` with the configured and verified `support@nevely.app`.
- [x] **N1.9 — Fix the Google onboarding form state.**
  - When Google is used from `/register` without a guest claim, the Google path must not require the email and password fields; Google supplies the verified email and authentication.
  - When Google is used from `/login` for an email that has no Nevely account, the profile-completion redirect must likewise request only the fields needed to create the profile before retrying Google.
  - Keep the normal email/password registration path explicit and unaffected, with provider-specific validation and accessible error copy.
  - Add acceptance coverage for both red and purple messages, including the absence of false email/password requirements.
- [x] **N1.10 — Make account authentication settings symmetrical and discoverable.**
  - For password/email accounts, make the email row actionable and open the Privacy tab with the existing verified change-email action focused or clearly exposed.
  - For Google-only accounts, allow an authenticated user to set a Nevely password through a verified, rate-limited flow; do not confuse this with changing the already verified Google email.
  - Preserve at least one usable sign-in method, require re-authentication for adding/removing methods, and keep email-account Google linking takeover-safe.
- [x] **N1.11 — Give registered profiles the same default-avatar baseline as guests.** Assign a preset from the existing local avatar set at account creation/claim and expose it consistently in Account settings; keep uploaded profile pictures as a separate storage feature.

Implementation and operations evidence for N1 is collected in [`docs/admin/identity-and-access.md`](docs/admin/identity-and-access.md). Database-backed identity contracts live in `test/integration/identity-auth.test.js`; unit, Socket.IO and guest-browser checks remain part of the release baseline.

**N1 status:** N1.1–N1.11 are complete. N1.9–N1.11 are isolated in their
own post-N3 branch and pull request; transactional-email visual polish was
reclassified as N9.6 because it is not an authentication correctness blocker.
Manual staging acceptance completed on 2026-08-03; pending-link expiry remains
covered by the disposable-Postgres integration suite rather than a one-hour
manual wait. The final acceptance pass also covers immediate Google unlink UI,
registered-profile Astra gender chips, two-letter country search and the dark
Support FAQ surface.

### N2. Database retention, query bounds and capacity

- [x] **N2.1 — Approve and document one retention matrix before changing deletion code.**
  - Unsaved conversations: hard-delete after 7 days from last activity, or when a registered user exceeds 50 unsaved conversations with messages.
  - Saved conversations: hard-delete after 12 months from last activity instead of retaining them forever.
  - Report evidence: retain a separate immutable snapshot for the moderation-policy period.
  - Ban/account/audit records: retain independently from ordinary chat content.
  - Notifications, sessions, requests and guest records: assign explicit expiry rules.
- [x] **N2.2 — Replace the in-process all-at-once cleanup with a controlled retention worker.**
  - Run one scheduled worker, delete in bounded batches and make repeated execution idempotent.
  - Cascade message receipts and related rows deliberately.
  - Record deleted-row counts, duration and failures.
  - Verify that autovacuum reclaims reusable space and monitor table/index bloat.
  - Implementation, policy and the staging runbook are in [`docs/operations/database-retention-and-capacity.md`](docs/operations/database-retention-and-capacity.md); disposable-Postgres acceptance passed in CI and the first staging cycle completed successfully.
- [x] **N2.3 — Monitor the 5 GB Postgres budget.**
  - Track database, table and index sizes.
  - Alert at 60%, 75% and 90%.
  - Add a dashboard/runbook for cleanup failures and unexpected growth.
  - Load-test estimated message volume before launch.
  - Aggregate sampling and 60%/75%/90% email alerts, the Railway staging disk dashboard and the rollback-only staging load test are accepted.
- [x] **N2.4 — Add mandatory server-side pagination to every potentially growing collection.**
  - Prefer cursor/keyset pagination over deep `OFFSET`.
  - Messages: `beforeMessageId`; conversations/users/reports: stable `(created_at, id)` cursors.
  - Validate a default page size of 20–50 and a hard maximum of 100.
  - Cover users, guests, bans, reports, messages, conversations, notifications, friends, requests and blocks.
  - All existing database-backed collections are bounded; the persistent guest collection remains owned by N3.1 because guests currently live only in expiring server sessions.
- [x] **N2.5 — Add indexes for the final query shapes.**
  - Case-insensitive username/email search.
  - Conversation/message cursors.
  - Active bans and report queues.
  - Confirm plans with representative `EXPLAIN (ANALYZE, BUFFERS)` data.
  - Indexes and the read-only `db:explain:n2` command are implemented; representative staging output is recorded in the operations runbook.

**N2 status:** merged into `main` on 2026-08-01 after the staging observation
window recorded 12 `retention.completed` events, no `retention.failed`, HTTP
200 readiness and approximately 0.45 MB of volume growth over 48 hours.

### N3. Persistent guest identity and account claim

- [x] **N3.1 — Add a minimal persistent guest principal without creating anonymous `users` rows.**
  - Store UUID, canonical passport fields, avatar preset, creation/last-seen timestamps, status and retention metadata.
  - Bind access to the server session; never authorize ownership from a browser-supplied UUID alone.
  - Preserve the full UUID internally and display a separate compact alias where needed.
  - Migration, API/session contract, 30-day expiry, admin cursor and tests are documented in [`docs/admin/guest-identity.md`](docs/admin/guest-identity.md).
- [x] **N3.2 — Attach guest ownership to product data.**
  - Add `guest_id` to conversation participants, reports and other guest-owned records.
  - Implement recent chat and saved chat ownership for guests with explicit limits.
  - Preserve current server-authoritative immutable passport fields, one allowed name change and preset-avatar updates.
  - Migration, authorization, limits, retention and tests are documented in [`docs/admin/guest-product-ownership.md`](docs/admin/guest-product-ownership.md).
- [x] **N3.3 — Implement transactional claim on account creation.**
  - Verify the email before finalizing ownership.
  - Attach eligible recent/saved conversations and profile data to the new user.
  - Mark the guest principal as claimed, regenerate the session and prevent replay/double claim.
- [x] **N3.4 — Keep login to an existing account separate from guest claim.**
  - Never merge, transfer or convert guest data when a guest logs in to an
    existing password or Google account.
  - Preserve a server-validated return reference so logout can restore the
    still-active guest as a distinct identity that may be claimed later.
  - Never authorize either return or claim from a browser-supplied UUID,
    username or avatar.
- [x] **N3.5 — Define post-claim behavior.** Tombstone the claimed guest for 30
  days, clear its browser/session copy after the verified transactional claim,
  and document recovery limits for cleared storage and expired sessions.
- [x] **N3.6 — Persist the guest create-account reminder as a system notification** so read state survives browser resets and migrates during claim.

**N3 status:** complete. Implementation and automated coverage are green, and
the email waiting/verification flow was accepted manually in staging on
2026-08-02. N1.9–N1.11 proceeded in a separate branch and pull request; the
deferred N1.12 transactional-email polish is now tracked unchanged as N9.6.

### N4. Safety, bans and the admin workspace

- [ ] **N4.1 — Replace the minimal admin page with an operational Astra workspace.**
  - Paginated/searchable Users, Guests, Reports, Bans and Audit sections.
  - Search registered users by username, email and public ID.
  - Show account/guest status, active ban, verification state, last-seen data and moderation history.
  - Use accessible tables, filters, confirmations and empty/loading/error states.
- [ ] **N4.2 — Make bans immediately enforceable.**
  - Store reason, start, expiry, type, creator and revocation metadata transactionally.
  - Invalidate all target sessions and force-disconnect every active Socket.IO connection server-side.
  - End the active conversation safely and notify the user of reason and exact expiry/permanent status.
  - Keep permanent bans separate from account deletion; do not erase permanently banned accounts automatically.
  - Add unban/revoke and prevent admins from banning/deleting themselves.
- [ ] **N4.3 — Stop automatically turning every permanent account ban into a permanent last-IP ban.**
  - Make network/device action separate, justified, time-bounded and privacy-reviewed.
  - Account for shared networks, VPNs and address reassignment.
- [ ] **N4.4 — Add guest-abuse controls.**
  - Rate-limit by authenticated account/guest principal plus privacy-reviewed network signals, not only socket ID.
  - Share limits across reconnects and replicas.
  - Add escalation, expiry and appeal/review paths.
- [ ] **N4.5 — Add report evidence and controlled conversation review.**
  - Store conversation ID and an immutable evidence window when a report is submitted.
  - Permit report-linked/recent review only with an explicit moderator reason.
  - Audit every conversation/evidence view; do not provide unrestricted permanent browsing of all chats.
- [ ] **N4.6 — Add an append-only admin audit log.** Record actor, target, action, reason, before/after state, request correlation ID and timestamp without copying sensitive message content unnecessarily.
- [ ] **N4.7 — Add safer role management.** Require re-authentication, 2FA and audit logging for grants/revocations; invalidate affected sessions.

### N5. Chat experience and abuse resistance

- [x] **N5.1 — Audit the anti-spam baseline before changing enforcement.**
  - Document principal and event limits, cross-replica persistence, reconnect behavior, feedback and privacy boundaries.
  - Keep message content, raw IPs and device fingerprints out of logs and audit metadata.
- [x] **N5.2 — Add progressive, distributed abuse controls.**
  - Normalize duplicate comparison server-side and use pseudonymous shared signal buckets.
  - Separate tolerant skip UX from queue churn/flood and stricter message enforcement.
  - Cover cross-replica, reconnect, concurrent rematch, flood and bypass behavior with PostgreSQL and Socket.IO tests.
- [x] **N5.3 — Refine the desktop chat workspace.**
  - Keep partner/status and composer fixed inside the conversation workspace; only messages scroll.
  - Keep Send attached to the message field and separate Next visually and spatially.
  - Use the topic slider for the strict phase, allow an explicit Unlimited preference, and otherwise relax server-side without leaving the queue.
  - Provide an explicit server-authoritative Cancel search action and prevent duplicate socket/principal queue entries.
  - Keep Report in the conversation menu, Next as the only rematch action and wait for authoritative Socket.IO results.
  - Cover loading, match, reconnect, error, report and end states with keyboard-visible focus and 44px targets.
  - Verify Playwright at `1366×768` and `768×1024` with captured screenshots.
- [x] **N5.3.1 — Separate search and conversation lifecycle surfaces.**
  - Render search directly in the Astra chat surface from server-authoritative topic/general states.
  - Keep only Next beside the joined message field and preserve the ended partner identity and Save action.
  - Hide empty Chat requests, gate Add friend from the server and keep the message list above the in-flow composer.
  - Verify Playwright at `1366×768`, `1366×640` and `768×1024`.
- [x] **N5.3.2 — Friendship, notifications and direct friend chat.**
  - [x] Friendship requests: transactional create, accept, decline and cancel with public IDs and post-commit realtime events.
  - [x] Friend list: server capabilities, accessible menus and idempotent removal.
  - [x] Notifications: persistent appearance, read and product dismissal with minimized payloads.
  - [x] Chat requests: persistent expiry, idempotent send/respond/cancel and distributed rate limits.
  - [x] Direct friend chat: server-owned conversation type, one conversation per acceptance and End without random rematch or skip usage.
  - [x] Require confirmation for friend removal/block, route friendship notifications to Friend requests and mirror its pending badge in the selector.
  - [x] Keep at most five direct conversations in Inbox, split active/recent, and expose server-derived Save/Unsave/Delete capabilities across Inbox, Recent and Saved.
  - [x] Raise the standard account saved-chat allowance to five while retaining guest and Premium policy server-side.
  - [x] Keep direct conversations active across disconnect/reconnect; end them only explicitly, by friendship removal or by block, with one PostgreSQL reservation per pair.
  - [x] Allow an active direct conversation to be parked for random matching and resumed from Inbox without consuming skip; bound ordinary visible message history to 200 while preserving saved and moderation-retained data.
  - [x] Separate confirmed End conversation, per-participant Remove from my history and distributed-cooldown Delete unsaved messages; preserve saved, report, evidence and moderation retention.
  - [x] Keep Save/Unsave individual and retain saved conversations in anonymized form when the partner identity is no longer product-visible.
  - [x] Persist chat-request notifications and include their server-counted pending total in the Messages badge.
  - [x] Route direct-chat notifications to Conversations, allow accepted-friend notifications to be dismissed and render only minimized public actor avatars with a safe fallback.
  - [x] Replace product-visible conversation/message serial keys, cursors and read receipts with opaque public IDs while retaining server-side transactional keys.
  - [x] Keep history profile cards presence-free, preserve avatar aspect ratio and move destructive End to the left of the composer.
  - [x] Make normalized duplicate-message enforcement tolerant of four repeats in 30 seconds while retaining the separate 12/10-second burst limit.
- [ ] **N5.4 — Refine the mobile chat workspace.**
  - Verify `390×844`, portrait/landscape transitions, on-screen keyboard and safe-area insets.
  - Stabilize the composer, drawers, modals, touch targets and message/command overflow.
- [x] **N5.5 — Remove the guest conversation duration limit.** Retain anti-abuse, retention, session, report and disconnect controls.

---

## NEXT — launch readiness, operations and discoverability

### N6. Maintenance mode and real-time scaling

- [ ] **N6.1 — Add persistent maintenance state** with `scheduled`, `draining` and `active` phases, start/deadline timestamps, public message and admin actor.
- [ ] **N6.2 — Add the admin maintenance controls.**
  - Preview and schedule a countdown.
  - Broadcast changes to online users.
  - Prevent new matches during draining, allow active chats until the deadline and then end them gracefully.
  - Keep admin, health and maintenance-status endpoints available while user routes return an appropriate maintenance response.
- [ ] **N6.3 — Make deploys read maintenance state from shared storage.** A replacement process must preserve the schedule/countdown and must never depend on the old process remaining alive.
- [ ] **N6.4 — Stay on one application replica until real-time state is distributed.**
  - Add a shared Socket.IO adapter/event bus.
  - Move matching queues, presence, timers, cooldowns and cross-instance notifications out of process memory.
  - Test reconnects and routing without assuming sticky sessions.
- [ ] **N6.5 — Treat maintenance as an exceptional tool, not the normal release process.** Backward-compatible migrations, readiness checks, overlap and graceful draining should allow routine deploys without planned downtime.

### N7. Google Search Console, SEO and Google Analytics

- [ ] **N7.1 — Prepare the public site for indexing.**
  - Define the canonical production origin `https://nevely.app` and redirect alternate hosts/protocols.
  - Add canonical URLs and appropriate titles/descriptions to public pages.
  - Add a stable, crawlable square Nevely favicon to the shared page head and `Organization` structured data on the homepage with the canonical logo URL.
  - Mark Nevely clearly as a beta on public and registration surfaces, explaining that features may change, remain limited or be temporarily unavailable and that registered users participate as beta testers.
  - Offer a feedback link that opens an email to `admin@nevely.app` with a prefilled questionnaire in the message body instead of storing a feedback form in the application.
  - Tell users that every feedback email is read and, when a response is needed, answered within one day.
  - Add `robots.txt` and a generated `sitemap.xml` containing only canonical public/indexable routes.
  - Add `noindex` to login, registration, chat, account, admin and other private/application surfaces; do not treat `robots.txt` as access control.
  - Validate status codes, 404 behavior and canonical consistency.
- [ ] **N7.2 — Integrate Google Search Console.**
  - Create a Domain property for `nevely.app` under the private admin Google account.
  - Verify ownership with the Google DNS TXT record in Cloudflare while keeping email DNS records DNS-only as required.
  - Submit `sitemap.xml`.
  - Review indexing, Page Experience/Core Web Vitals, security issues and manual actions after launch.
- [ ] **N7.3 — Create the GA4 property and production web data stream.**
  - Keep the Measurement ID in production configuration, not hard-coded across templates.
  - Start with the directly auditable Google tag on public marketing pages; introduce Google Tag Manager only if a real tag-management need appears.
  - Load analytics asynchronously and only in production.
- [ ] **N7.4 — Implement consent before analytics collection.**
  - Default `analytics_storage`, `ad_storage`, `ad_user_data` and `ad_personalization` to denied.
  - Add an Astra-compatible consent/preferences interface and allow later withdrawal/change.
  - Load/update GA4 only after the relevant choice and persist the choice with a versioned policy identifier.
  - Update the Privacy page and obtain a jurisdiction-appropriate privacy/legal review before enabling production collection.
- [ ] **N7.5 — Define a privacy-safe measurement plan.**
  - Initial scope: public marketing page views, navigation and coarse conversion events.
  - Never send emails, usernames, account/guest/public IDs, IP-derived custom data, chat text, topics, filters, search terms, report data or URL parameters containing user data.
  - Do not instrument admin pages or conversation content.
  - Disable advertising/personalization features unless they are deliberately approved later.
  - Exclude staging, development and known internal/admin traffic.
- [ ] **N7.6 — Validate the analytics implementation.**
  - Test granted, denied, withdrawn and absent-consent states.
  - Confirm events in GA4 DebugView/network requests without duplicate page views.
  - Add automated checks that no Google request fires before consent in the chosen mode.
  - Verify the Content Security Policy and measure tag performance impact.
- [ ] **N7.7 — Link the verified Search Console property to GA4** after both integrations are validated and access is assigned through role-based Google accounts rather than personal addresses.

### N8. Privacy Policy and Terms of Service

- [ ] **N8.1 — Audit the product against the current legal pages before rewriting them.**
  - Inventory the data and behavior that actually exist: guest/account profiles, cookies and sessions, chat storage, saved/recent chats, reports, moderation, bans, retention/deletion, support email and third-party processors.
  - Include Railway/Postgres, Cloudflare, Zoho Mail, Resend, Google authentication and consented GA4 where applicable.
  - Remove claims about unavailable or provisional features such as completed payments, unrestricted Premium capabilities, media messaging or guarantees the product does not provide.
- [ ] **N8.2 — Rewrite the Privacy Policy to match production data flows.**
  - Describe what is collected, why it is used, the applicable retention categories, recipients/processors, security practices, cookies/analytics choices and account/guest deletion behavior.
  - Explain Google sign-in data separately and state that authentication-only access uses the minimum requested profile fields.
  - Document user privacy choices and contact path through `support@nevely.app`.
  - Reflect the approved guest identity, moderation-evidence and analytics rules rather than copying planned behavior into the policy.
- [ ] **N8.3 — Rewrite the Terms of Service to match the actual product.**
  - Cover the 18+ requirement, guest and registered access, acceptable conduct, user content, reporting/moderation, suspension/ban, account deletion and service availability.
  - Describe saved-chat limits and currently implemented Premium benefits accurately; do not present payment or media features as available before launch.
  - Cover maintenance windows, termination, liability/disclaimers and governing-law/dispute language only after appropriate legal review.
- [ ] **N8.4 — Add versioning and release controls for legal documents.**
  - Publish version/effective dates and keep an internal change record.
  - Define when users receive notice or must re-accept a material update.
  - Keep public Privacy Policy and Terms links visible from the homepage, authentication surfaces and footer, including the Google OAuth production homepage requirements.
  - Block production enablement of Google authentication and GA4 until the corresponding disclosures, consent controls and public links are ready.
- [ ] **N8.5 — Obtain jurisdiction-appropriate legal review before public launch.** Review the final product, retention matrix, moderation access, Google integrations and target markets; treat the repository text as an implementation draft, not legal advice.
- [ ] **N8.6 — Verify policy accuracy as a release test.** Add a checklist to every feature that changes collected data, processors, retention, billing, moderation or user rights so Privacy Policy and Terms cannot silently drift from the product again.

### N9. Quality, accessibility and production operations

- [ ] **N9.1 — Audit keyboard, screen-reader, focus, contrast, reduced-motion and mobile drawer-swipe behavior** across all marketing and application pages.
- [ ] **N9.2 — Add structured logs, request correlation IDs and error monitoring** with redaction for credentials, tokens, session cookies, profile data and chat content.
- [ ] **N9.3 — Add service alerts and runbooks** for database saturation, cleanup failure, email-outbox backlog, elevated authentication failures and Socket.IO disconnect rates.
- [ ] **N9.4 — Self-host the approved production font** if CSP, performance or privacy requirements prohibit the current Google Fonts request.
- [ ] **N9.5 — Complete production avatar storage** with upload validation, resizing to a constrained square target (for example 150×150), quotas, abuse scanning, deletion and lifecycle retention; then remove the temporary profile-image URL field and the `501` API response. This is the upload portion of N1.11, not a replacement for the preset default avatar.
- [ ] **N9.6 — Polish transactional email templates.** Improve resend/verification/reset email layout, hierarchy and accessibility, and add the Nevely logo once the approved logo asset and hosting URL exist without exposing secrets or user data. This is the deferred N1.12 scope, preserved unchanged and moved after authentication correctness.

---

## LATER — product expansion after the foundations

### L1. Topics and discovery

- [ ] Add moderated community topic suggestions/autocomplete while preserving free-text topics and case-insensitive server normalization.
- [ ] Add topic moderation queues, policy enforcement and abuse tooling before community suggestions launch.
- [ ] Add an optional random guest-name generator such as `AdjectiveWord000`.

### L2. Premium and billing

- [ ] Implement payment checkout, subscription lifecycle, entitlement reconciliation, webhook idempotency, refunds/cancellations and billing audit before treating Premium as purchasable.
- [ ] Add promo-code generation only after the entitlement and billing foundation exists.
- [ ] Replace the current admin price-history scaffold with billing-provider-backed pricing once checkout is implemented.

### L3. Media and real-time features

- [ ] Add premium photo messaging only after managed storage, consent, moderation, reporting and retention are production-ready.
- [ ] Add 1:1 WebRTC pictures/audio only after signaling security, TURN capacity, abuse controls, consent and moderation policy are defined.

### L4. Editorial

- [ ] Re-enable Blog routing/navigation when editorial ownership, publishing workflow, metadata and content scope are ready. Preserve the existing templates and placeholder copy until then.

---

## Implemented baseline

- [x] Postgres-backed production sessions with secure cookie settings.
- [x] Server-session Guest ID and passport with immutable demographic fields, one allowed name change and local self-hosted avatar presets.
- [x] Server-authoritative guest profile data used during matching.
- [x] Basic account registration/login/logout with bcrypt password hashing and authentication rate limiting.
- [x] Conversation persistence, read receipts, recent/saved chat APIs for registered accounts and N2 retention metadata.
- [x] Basic message and skip cooldowns, block checks and fallback word moderation.
- [x] Minimal admin users/reports view with temporary/permanent ban scaffolding.
- [x] Account settings with Astra Account, Privacy and Plans tabs.
- [x] Explicit Astra account-deletion confirmation modal.
- [x] Plans capability moved into Account settings; standalone route retired.
- [x] Premium copy limited to implemented benefits: 10 saved chats instead of 2 and advanced matching filters.
- [x] Astra `/support` page with FAQ and contact area.
