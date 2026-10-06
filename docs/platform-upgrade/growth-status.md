# Growth workstream status

Updated 2026-10-06. **VERIFIED COMPLETE** — configurable implementation verified locally; real LinkedIn URL still required before release.

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

Subscriber unique email, real subscribe form/API, HMAC unsubscribe, Growth subscriber tooling, generic LinkedIn constant and existing X/Facebook/LinkedIn/copy shares.

## Remaining required work

Concurrent-safe normalized subscriptions/friendly states; configurable real LinkedIn via SiteSetting; all social instances; canonical shares and clipboard fallback/email/native share where appropriate.

## Exclusive ownership

NewsletterSignup, subscribe/unsubscribe, ShareButtons, new typed site-settings/social loader and Growth subscribers, tests.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change by default. SiteSetting publication_linkedin_url existing KV. Any case-insensitive historical subscriber reconciliation needs preflight/proposal; constants/seo/Footer/layout patches integrator-owned.

## Required evidence

Valid/invalid/duplicate/case/concurrent email, network/server/double-click states and unsubscribe preservation; missing/valid/unsafe LinkedIn; every share canonical encoded URL/clipboard denial; labelled mobile forms.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.

## Sequential implementation evidence (2026-10-06)

Worktree `/Users/zanie/The-Consilium-upgrade`, branch `feature/consilium-upgrade-six-workstreams`. Shared Footer/contact/article integration owned by the sequential integrator. No production writes or external messages.

Both publication LinkedIn links (footer and contact) now use the existing SiteSetting key `publication_linkedin_url`. Absent/invalid URL hides links. ADMIN/GROWTH can configure or clear it on the existing Subscribers screen; writer changes are denied server-side. HTTPS company/school page validation rejects generic root, impostor hosts, credentials, queries and unsafe schemes. Settings invalidate the dedicated cache tag immediately; browser verified both rendered links update and disappear after clearing. No real URL was invented: **publication owner must supply it in production before release**. Share endpoints/referrer classification are separate from publication links and remain legitimate.

Newsletter retains Subscriber and HMAC unsubscribe. Addresses trim/lowercase and validation caps 254 characters. A normalized-email advisory transaction and indexed lookup make concurrent requests idempotent, including legacy spelling. Additive expression unique index migration `20261006161413_normalized_subscriber_email.sql` preflights historical collisions without rewriting/deleting rows. Applied only to guarded local Postgres; deliberately colliding fresh fixture aborts safely. Form has labelled email field, keyboard submit, pending guard/disabled button, busy state, live success and friendly API/network retry errors. No provider added.

Article sharing now receives a canonical URL from the server: explicit secure publication origin or repository production domain; localhost/preview are rejected. Copy acknowledges success and provides a selectable manual URL on failure. LinkedIn/X/Facebook URLs encode the canonical link; email is a proper mailto; Web Share appears only where supported and handles rejection. Share controls have labels and mobile targets.

Evidence: **16/16** targeted Growth unit/real-DB cases (10 settings/share URL cases; 6 subscription cases, including six concurrent requests). Chromium **3/3 Growth feature scenarios** in the combined Growth/Analytics file passed: invalid email/network retry/repeat normalized signup at 375px; keyboard copy/canonical/clipboard-denied fallback/native/email/LinkedIn controls; settings permissions, validation, cache update and removal at both public locations. Four shared authentication setup cases passed. Typecheck, affected lint and production build passed for the combined milestone. Logs `/tmp/consilium-upgrade-team-growth.log`, `/tmp/consilium-upgrade-growth-analytics-browser.log`. Full regression and final browser runs are recorded in the integration ledger.

Configuration remaining: apply reviewed migration after checking historical subscribers; supply actual LinkedIn setting through existing admin/Growth surface. These production actions were not performed. Existing unsubscribe tests remain in regression; unsubscribe implementation unchanged.
