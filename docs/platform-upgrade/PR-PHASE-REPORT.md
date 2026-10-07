# PR phase and main reconciliation

PR [#117](https://github.com/Zanie567/The-Consilium/pull/117), base `main`, head `feature/consilium-platform-upgrade`.

## Evidence boundary

The initially verified and pushed candidate was `a80cc2255325052ef20cd5b98f6e836e461a64b4`, clean in `/private/tmp/consilium-final-integration`. Its original local certification remains historical evidence only: 646 unit passes plus seven expected moderation failures, 407 integration passes with no skips, 1,053 aggregate passes, 129 Playwright passes, 22 revision/concurrency cases, typecheck/lint/build and eight unauthenticated smoke checks.

GitHub reported merge conflicts against `main` at `8aed86bc06612527dc0fdbcbc53472afc7ace553`; no pull_request Actions run could start while conflicted. The owner explicitly authorized reconciling main and fully recertifying. The unrelated dirty checkout `/Users/zanie/The-Consilium` was not inspected or modified.

## Reconciliation contract

Preserve main's onboarding, trusted public appointments, account/editorial security, publication confirmation, durable draft recovery, testing audit capabilities and attested disposable test runner. Combine the upgrade's timestamp/CAS protections with main's content fingerprints and authorization checks. Managed figures, tables, canonical topics, sharing, newsletter and consent-aware analytics remain within the intended upgrade.

The owner explicitly chose **main's public house style**: published content keeps semantic formatting and uses publication presentation. Stored editor formatting remains editable; arbitrary public inline CSS is removed. The dedicated house-style tests are retained. Growth placement uses an admin-managed public appointment; account roles do not appoint public tiers.

Preserve main's hydration-safe reduced-motion rendering and persistent accessible upload errors. Keep mobile dialog focus trapping above the inherited pinned editor toolbar. Audit the new managed-image discard endpoint under main's testing identity wrapper. Preserve main's Next image-abort postinstall backport.

The supported test entry points now delegate to main's run-owned, attested local stack. Apply the four additive upgrade migrations only to guarded disposable databases. CI runs the upgrade project alongside all existing main projects; no tests are skipped or assertions weakened. Oversized image tests assert main's HTTP 413 contract, and publication tests send explicit confirmation. Historical screenshots are retained; new screenshots go to run-owned output directories.

Main already repaired the seven historical moderation cases in its own merged PR. This reconciliation preserves those changes; no new moderation rewrite was made during this phase.

## Review status

CodeRabbit initially skipped review because 168 eligible files exceeded its 100-file plan limit. Its green status is a skip, not an approval. No substantive automated review comments were present at that stage. Manual review covers schema/migrations, authorization, stale-write/CAS and lifecycle transitions, paste/public sanitation, managed storage cleanup, newsletter persistence, analytics consent, cron authentication, test guards and Actions orchestration. Hosted status and final certification are pending reconciliation.

Dependency audit reports advisories in dependencies already present on main. The added decoding path warrants a narrow update to sharp 0.35.5 before final certification. A package override makes Next image optimization use that same patched decoder instead of retaining a nested 0.34.5 copy. The package-lock changes are limited to sharp and its binary/colour/semver dependencies. See the [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) and [libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj). Other inherited dependency advisories need separate security triage; passing functional tests does not clear dependency security. In particular main and this branch both pin Next 16.2.2 and next-auth 4.24.13, with critical/high advisories reported by npm audit. A broad framework/authentication upgrade is outside this PR repair scope and remains a release blocker pending security disposition. No blanket npm audit fix was run.

## Production boundary and prerequisites

No production data, migrations, environment variables, Supabase configuration, Storage policies, cron configuration or Vercel production settings were changed. No deployment command was issued and no merge to main was performed. The existing GitHub/Vercel integration automatically built a preview on branch push; that is not production acceptance.

Before release: configure the real publication LinkedIn URL; inspect production schema/migration drift and topic/subscriber collisions; accept real Supabase Storage/RLS/CDN behavior; verify hosted authenticated cron jobs; accept real email/provider delivery; certify physical-device sharing and relevant browser behavior. Four upgrade migrations are additive and have only been exercised locally. **No production migration has been executed.**

## Certification and hosted CI

Pending full certification of the reconciled committed candidate, followed by safe normal push and hosted Actions verification. Original candidate results must not be represented as certification of changed code.
