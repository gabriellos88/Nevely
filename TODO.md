# Nevely product TODO

This list tracks features that are missing or intentionally partial. Completed UI work is listed only when a server, storage, moderation or production dependency is still outstanding.

## Identity, profiles and onboarding

- [x] Add a server-session Guest ID, immutable passport fields, one allowed name change and preset-avatar updates without creating anonymous database users.
- [ ] Connect session-backed guest identities to the future authentication/claim-account flow. The browser copy still lives in `localStorage`; a cleared browser or expired server session requires a new/synchronized guest identity.
- [x] Use server-session guest name, age, gender and country in matching profiles while keeping the DiceBear preset local and self-hosted.
- [ ] Implement a random guest-name option (for example AdjectiveWord000) alongside the existing manual name entry.
- [ ] Add production image storage, validation, resizing, abuse scanning and deletion for registered-user avatar uploads. The current API deliberately returns `501` because storage is not configured.
- [ ] Replace the current profile-image URL test field after managed upload storage exists.

## Matching and chat

- [ ] Add moderated community topic suggestions/autocomplete. Keep free-text topics available; normalize moderation and matching case-insensitively on the server.
- [x] Add a server-authoritative matching-queue timeout with a 5–30 second range and an unlimited setting.
- [ ] Decide whether the separate 120-second guest conversation duration should become configurable; it remains server-controlled and is not the matching waiting-time slider.
- [ ] Evaluate the future age-range radar/slider while preserving the current discrete-range payload contract.
- [ ] Add WebRTC as a premium feature to unlock 1:1 pictures/audio conversations.
- [ ] Add premium photo messaging after upload storage, consent controls, content moderation and retention policies are defined.
- [ ] Add automated end-to-end coverage for guest matching, account matching, drawer navigation, unread counts and read receipts with two concurrent clients.

## Accounts, premium and notifications

- [ ] Convert the guest create-account reminder from a synthetic client-only notification into a persisted system-notification type. It now behaves as one unread client notification and remembers its read state locally, but remains excluded from registered-user server counts.
- [x] Move the Plans capability surface into the Account settings panel and retire the standalone route.
- [x] Describe Premium only through benefits implemented today: 10 saved chats instead of 2, plus advanced matching filters.
- [ ] Implement payment checkout, subscription lifecycle, entitlement reconciliation and billing webhooks. The current plan price and Premium UI are product scaffolding, not a complete billing system.
- [ ] Add an admin dashboard option to generate promo codes for free premium access for a set duration or for discounts.
- [x] Replace profile settings with the validated Astra Account, Privacy and Plans tab structure.
- [x] Replace the native account-deletion `prompt()` with an explicit Astra confirmation modal inside the Privacy tab.
- [x] Add the Astra `/support` page with FAQ and a dedicated contact area.
- [ ] Activate and verify the provisional Zoho mailbox `support@nevely.com` before launch; the UI already uses it as the centralized Support contact.
- [ ] Define whether a guest passport should be removed, migrated or retained after sign-in on the same browser.

## Safety and administration

- [ ] Expand the minimal admin panel into an operational moderation workspace: search/filtering, pagination, report evidence, user history, role management, audit log and safer confirmations.
- [ ] Add a maintenance mode option in the admin panel to prevent access to the site or its use during maintenance, with a notification option for X minutes before the maintenance window.
- [ ] Add a dedicated guest-abuse strategy beyond temporary socket identifiers, including privacy-reviewed rate limits and ban signals.
- [ ] Add moderation queues and policy enforcement for future community topics and uploaded media before either feature launches.
- [ ] Add automated authorization tests for every admin endpoint and destructive moderation action.

## Quality and platform

- [ ] Re-enable Blog routing and navigation when its editorial scope is ready; the templates, placeholder post and localized copy are intentionally preserved.
- [ ] Add browser tests for the guest passport focus trap, validation, same-`localStorage` navigation, cleared-storage fallback and preset-only avatar settings.
- [ ] Audit keyboard, screen-reader, contrast, reduced-motion and mobile drawer-swipe behavior across every Phase 5 page.
- [ ] Self-host Inter if the production Content Security Policy or privacy requirements prohibit the current Google Fonts request.
- [ ] Replace temporary in-memory sessions in environments where `DATABASE_URL` is missing; production must use the configured persistent session store.
