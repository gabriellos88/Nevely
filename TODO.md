# Nevely product roadmap

This file is the product and engineering source of truth for unfinished work. Items are ordered by dependency, operational risk and user impact rather than by discovery date.

## Working rules

- Complete `NOW` in order before starting `NEXT`, except for an isolated production hotfix.
- Merge outstanding UI work from the previous project before editing overlapping chat files (`views/chat.ejs`, `public/js/chat-client.js`, `public/css/style.css`).
- Deliver one vertical change per branch/PR: migration, backend, UI, tests, rollout notes and rollback strategy belong together.
- Use additive, backward-compatible database migrations. Remove old schema only in a later deploy after the new code is live.
- A checkbox is complete only when acceptance tests, authorization checks, observability and user-facing error states are included.
- Keep application UI consistent with the local Astra specification. Dashboard tables and widgets use application styling, not marketing gradients or card-hover effects.
- Never log or send passwords, raw verification tokens, emails, guest/account identifiers, chat content, topics, report details or other user-provided sensitive data to analytics.

---

## NOW — launch blockers and foundations

### N0. Release safety and test baseline

- [x] **N0.1 — Reconcile the active UI work.** The Astra UI on `main` is the reconciled source of truth; the retired workspace contains no remaining source or patch. Evidence and the repeatable structural acceptance check are documented in [`docs/release/ui-source-of-truth.md`](docs/release/ui-source-of-truth.md).
- [ ] **N0.2 — Add continuous integration.** The least-privilege GitHub workflow and local equivalent are defined in [`docs/release/continuous-integration.md`](docs/release/continuous-integration.md). Remaining acceptance: a successful GitHub run and required `main` branch check.
- [ ] **N0.3 — Add a staging environment.** The isolation contract, no-index/analytics-off defaults and non-secret validator are defined in [`docs/release/staging-environment.md`](docs/release/staging-environment.md). Remaining acceptance: provision and prove the separate Railway/Postgres/Resend environment.
- [ ] **N0.4 — Add release health controls.**
  - Provide liveness and database-readiness endpoints.
  - Configure Railway healthcheck, deployment overlap and draining time.
  - Handle `SIGTERM`: reject new matches, notify connected clients, finish/persist active work and close HTTP/Socket.IO cleanly.
  - Repository implementation and automated lifecycle tests are documented in [`docs/release/health-and-draining.md`](docs/release/health-and-draining.md). Remaining acceptance: an actual staging redeploy using the committed Railway settings.
- [ ] **N0.5 — Prove recovery.** The guarded verifier, runbook and evidence template are in [`docs/release/database-recovery.md`](docs/release/database-recovery.md). Remaining acceptance: enable backups/PITR and complete a reviewed real restore drill.
- [ ] **N0.6 — Establish automated coverage (initial scope).**
  - Integration tests for migrations, registration, login, logout, profile validation.
  - Authorization tests for every admin endpoint and destructive action currently implemented.
  - Two-client Socket.IO tests for guest/account matching, messages, unread counts, read receipts, cooldowns and disconnects.
  - Browser tests for guest-passport focus management, validation, persisted identity, cleared-storage fallback and responsive drawers.
  - Current coverage and deliberately open contracts are recorded in [`docs/release/automated-test-baseline.md`](docs/release/automated-test-baseline.md).
  - **Deferred by design:** session-revocation, retention and ban tests are re-specified as explicit acceptance criteria of N1.3 (session revocation), N2.2/N2.4 (retention, pagination) and N4.2 (ban enforcement) respectively, and will be added there rather than blocking this checkbox indefinitely.

### N1. Identity, registered profiles and authentication

- [ ] **N1.1 — Replace short account Public IDs before growth.**
  - Introduce an opaque public identifier with at least 64–80 bits of randomness.
  - Backfill existing users, preserve uniqueness and stop exposing sequential database IDs.
  - Keep a separate shortened display alias if a compact UI label is desired.
- [ ] **N1.2 — Fix registered-user onboarding.**
  - Collect the profile fields required for matching during registration or claim.
  - Store date/year of birth rather than a permanently stale numeric age, enforce the 18+ rule server-side and compute current age.
  - Validate gender and country against canonical allowed values.
  - Make birth data support-controlled or strongly protected; allow legitimate gender/country changes with audit and cooldown rather than unrestricted edits.
  - Migrate or repair existing accounts whose age, gender or country is missing.
- [ ] **N1.3 — Keep Postgres-backed cookie sessions and harden them.**
  - Add CSRF protection to every state-changing HTTP route.
  - Rotate/regenerate sessions on authentication and privilege changes.
  - Invalidate all sessions after password changes, account deletion, role changes and bans.
  - Require production `DATABASE_URL` and `SESSION_SECRET`; never silently use the in-memory session store in production.
  - Add secure headers and a tested Content Security Policy.
- [ ] **N1.4 — Implement email verification with Resend.**
  - Add purpose-scoped, single-use verification records with a hashed token, expiry, `used_at`, attempt metadata and revocation.
  - Send the raw token only in the email link from `Verify <noreply@notifications.nevely.app>`.
  - Use an outbox/worker with retries and idempotency instead of an untracked background promise.
  - Add verify, resend and expired/used-token flows with rate limits that do not reveal whether an email exists.
  - Decide which registered features remain restricted until verification.
- [ ] **N1.5 — Implement Sign in with Google using Google Identity Services.**
  - Create separate production and staging OAuth web clients in a Google Cloud project owned by the private admin account; configure only exact authorized origins/redirects and keep credentials in environment secrets.
  - Replace the disabled placeholder with the official Google Identity Services button and request only authentication scopes (`openid`, `email`, `profile`).
  - Validate the ID token server-side, including signature, issuer, audience, expiry, nonce/CSRF protections and `email_verified`.
  - Store a unique Google provider subject (`sub`) in a dedicated account-identity record; never use the email address alone as the durable Google-account key.
  - Reuse the existing Postgres-backed Nevely session, ban checks and session-revocation rules after authentication; do not introduce a parallel JWT login session.
  - Define explicit and takeover-safe flows for new Google accounts, linking/unlinking an existing password account, passwordless accounts and guest claim/merge.
  - Do not request or retain Google access/refresh tokens unless a future feature genuinely needs a separate Google API authorization.
  - Test cancellation, replay, duplicate email/account conflicts, revoked access, banned accounts and staging/production configuration.
- [ ] **N1.6 — Add password-reset and verified email-change flows.** Reuse the token/outbox foundation, revoke active sessions after success and notify the previous address after an email change.
- [ ] **N1.7 — Protect administrators.** Add re-authentication for high-risk actions, 2FA for admin accounts and server-side role checks that do not trust stale session role data.
- [ ] **N1.8 — Correct the support address everywhere.** Replace `support@nevely.com` with the configured and verified `support@nevely.app`.

### N2. Database retention, query bounds and capacity

- [ ] **N2.1 — Approve and document one retention matrix before changing deletion code.**
  - Unsaved conversations: hard-delete after 30 days.
  - Saved conversations: define a visible maximum lifetime (proposed: 12 months from last activity) instead of retaining them forever.
  - Report evidence: retain a separate immutable snapshot for the moderation-policy period.
  - Ban/account/audit records: retain independently from ordinary chat content.
  - Notifications, sessions, requests and guest records: assign explicit expiry rules.
- [ ] **N2.2 — Replace the in-process all-at-once cleanup with a controlled retention worker.**
  - Run one scheduled worker, delete in bounded batches and make repeated execution idempotent.
  - Cascade message receipts and related rows deliberately.
  - Record deleted-row counts, duration and failures.
  - Verify that autovacuum reclaims reusable space and monitor table/index bloat.
- [ ] **N2.3 — Monitor the 5 GB Postgres budget.**
  - Track database, table and index sizes.
  - Alert at 60%, 75% and 90%.
  - Add a dashboard/runbook for cleanup failures and unexpected growth.
  - Load-test estimated message volume before launch.
- [ ] **N2.4 — Add mandatory server-side pagination to every potentially growing collection.**
  - Prefer cursor/keyset pagination over deep `OFFSET`.
  - Messages: `beforeMessageId`; conversations/users/reports: stable `(created_at, id)` cursors.
  - Validate a default page size of 20–50 and a hard maximum of 100.
  - Cover users, guests, bans, reports, messages, conversations, notifications, friends, requests and blocks.
- [ ] **N2.5 — Add indexes for the final query shapes.**
  - Case-insensitive username/email search.
  - Conversation/message cursors.
  - Active bans and report queues.
  - Confirm plans with representative `EXPLAIN (ANALYZE, BUFFERS)` data.

### N3. Persistent guest identity and account claim

- [ ] **N3.1 — Add a minimal persistent guest principal without creating anonymous `users` rows.**
  - Store UUID, canonical passport fields, avatar preset, creation/last-seen timestamps, status and retention metadata.
  - Bind access to the server session; never authorize ownership from a browser-supplied UUID alone.
  - Preserve the full UUID internally and display a separate compact alias where needed.
- [ ] **N3.2 — Attach guest ownership to product data.**
  - Add `guest_id` to conversation participants, reports and other guest-owned records.
  - Implement recent chat and saved chat ownership for guests with explicit limits.
  - Preserve current server-authoritative immutable passport fields, one allowed name change and preset-avatar updates.
- [ ] **N3.3 — Implement transactional claim on account creation.**
  - Verify the email before finalizing ownership.
  - Attach eligible recent/saved conversations and profile data to the new user.
  - Mark the guest principal as claimed, regenerate the session and prevent replay/double claim.
- [ ] **N3.4 — Implement explicit merge on login to an existing account.**
  - Ask for confirmation before attaching current guest data.
  - Define conflict, duplicate and saved-chat-limit behavior.
  - Do not merge a guest identity that the current server session cannot prove it owns.
- [ ] **N3.5 — Define post-claim behavior.** Remove or tombstone the guest passport, clear/synchronize its browser copy and document recovery after cleared storage or an expired session.
- [ ] **N3.6 — Persist the guest create-account reminder as a system notification** so read state survives browser resets and can migrate during claim.

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

### N5. Matching and chat correctness

- [ ] **N5.1 — Replace the current hard waiting timeout with two-phase topic matching.**
  - No selected topics: enter the general queue immediately without a topic countdown.
  - Selected topics: first require at least one normalized common topic.
  - At timeout, keep the user queued and relax only the common-topic requirement.
  - Keep premium filters, blocks, bans and safety rules active in both phases.
  - Preserve the unlimited option as an explicit strict-wait choice.
- [ ] **N5.2 — Expose one authoritative waiting state.**
  - Remove duplicate “Looking for up to …” messages.
  - Distinguish strict-topic and relaxed-general search in one visible status with one accessible live announcement.
  - Add cancellation and reconnection behavior.
- [ ] **N5.3 — Fix the chat viewport layout.**
  - Keep the partner/header panel and composer fixed within the chat workspace.
  - Make only the message list scrollable with `min-height: 0` and contained scroll anchoring.
  - Verify desktop, mobile viewport changes, on-screen keyboards and safe-area insets.
- [ ] **N5.4 — Strengthen cooldown and spam controls.**
  - Keep the existing message and skip limits but key them to account/guest identity.
  - Add burst and sustained limits with clear retry timing.
  - Cover reconnect and multi-tab bypasses in tests.
- [ ] **N5.5 — Decide whether the separate 120-second guest conversation duration remains fixed or becomes configurable.** Do not conflate it with topic waiting time.

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
- [ ] **N9.5 — Complete production avatar storage** with upload validation, resizing, quotas, abuse scanning, deletion and lifecycle retention; then remove the temporary profile-image URL field and the `501` API response.

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
- [x] Conversation persistence, read receipts, recent/saved chat APIs for registered accounts and 30-day expiry metadata.
- [x] Basic message and skip cooldowns, block checks and fallback word moderation.
- [x] Minimal admin users/reports view with temporary/permanent ban scaffolding.
- [x] Account settings with Astra Account, Privacy and Plans tabs.
- [x] Explicit Astra account-deletion confirmation modal.
- [x] Plans capability moved into Account settings; standalone route retired.
- [x] Premium copy limited to implemented benefits: 10 saved chats instead of 2 and advanced matching filters.
- [x] Astra `/support` page with FAQ and contact area.
