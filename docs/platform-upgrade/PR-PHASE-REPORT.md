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

CodeRabbit initially skipped review because 168 eligible files exceeded its 100-file plan limit. Its green status is a skip, not an approval. No substantive automated review comments were present at that stage. Manual review covers schema/migrations, authorization, stale-write/CAS and lifecycle transitions, paste/public sanitation, managed storage cleanup, newsletter persistence, analytics consent, cron authentication, test guards and Actions orchestration. Final hosted status must be checked against the exact pushed head. No substantive automated review has been produced so far.

Dependency audit reports advisories in dependencies already present on main. The added decoding path was narrowly updated to sharp 0.35.5 before final certification. A package override makes Next image optimization use that same patched decoder instead of retaining a nested 0.34.5 copy. The package-lock changes are limited to sharp and its binary/colour/semver dependencies. See the [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) and [libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj). Other inherited dependency advisories need separate security triage; passing functional tests does not clear dependency security. In particular main and this branch both pin Next 16.2.2 and next-auth 4.24.13, with critical/high advisories reported by npm audit. A broad framework/authentication upgrade is outside this PR repair scope and remains a release blocker pending security disposition. No blanket npm audit fix was run.

## Production boundary and prerequisites

No production data, migrations, environment variables, Supabase configuration, Storage policies, cron configuration or Vercel production settings were changed. No deployment command was issued and no merge to main was performed. The existing GitHub/Vercel integration automatically built a preview on branch push; that is not production acceptance.

Before release: configure the real publication LinkedIn URL; inspect production schema/migration drift and topic/subscriber collisions; accept real Supabase Storage/RLS/CDN behavior; verify hosted authenticated cron jobs; accept real email/provider delivery; certify physical-device sharing and relevant browser behavior. Four upgrade migrations are additive and have only been exercised locally. **No production migration has been executed.**

## Defects discovered during reconciliation verification

The inherited two-tab scenario exposed a genuine integration defect: the deliberate Keep my version action cleared main's fingerprint but retained the upgrade's stale timestamp. It now fetches a fresh, uncached revision and fingerprint, keeps both guards for the ensuing write and adopts the current server publication state. A third concurrent mutation can still refuse the save. Timestamp ARTICLE_CHANGED and fingerprint ARTICLE_CONFLICT responses share the existing recovery controls; publication-confirmation conflicts retain their distinct handling. The browser regression asserts both guards remain in the deliberate save.

Restore main's table tooltip titles and footnote handlers for single/double/triple clicks. Retain caption/credit input placeholders and render already-prefixed legacy credits without a duplicated label. A dedicated rendering regression preserves that compatibility. Tests supply meaningful alt text before publication rather than bypass the new validation.

The old testing-mode hydration test assumed analytics IDs were persisted without consent. It now verifies no persistent identifiers, four ephemeral document-load identities, identity-pinned requests, deduplicated heartbeat counts and matching database views. Upload tests verify returned opaque URLs, owner namespace, stored bytes and complete storage key snapshots for rejected requests; original filename searches would no longer detect storage side effects. Team order is asserted after the streamed roster settles, retaining the exact ordering/count assertion. Publication scenarios explicitly stage Published and confirm the real UI.

The WebKit footnote preparation scrolls its marker into view before asserting viewport-triggered animation; visibility and popover geometry assertions remain intact. Analytics request observation tolerates an unavailable unload-beacon body while primary request and stored identity/count assertions remain strict.

No test was removed, converted to a skip or made to ignore unknown browser/network errors. Negative revision scenarios assert the exact expected HTTP 409 console resources; all other errors remain failures.

## Parallel remote work and final repairs

The remote branch acquired `fa52ded4b3699c1885f29e5acbf5fe61df726050` while local reconciliation repairs were being verified. The owner explicitly authorized reconciling that work and continuing. Merge `bccfe85` retains its ancestry and useful repairs: CSP-compatible direct data-URL decoding, editor stacking, WebKit hex-input handling, guarded suite selection and the dedicated upgrade CI job. Conflicting application/test contracts were reconciled against actual verification, without a force push.

A failed stale list action now explicitly GETs the authorized current article row; a background route refresh did not reliably replace the stale row in the reproduced browser scenario. Known 403/404 responses remove an inaccessible row, and other read failures remain visible. No mutation is automatically retried.

Canonical topic aliases exposed a genuine save fingerprint defect: POST used the submitted label while GET used the stored canonical label, causing the next guarded PUT to reject unchanged content. Save responses now fingerprint the resolved stored tag names inside the transaction. A real HTTP integration regression covers canonical casing, subsequent guarded writes and deliberate external changes.

The final full run passed its unit/integration, public/editorial, workflow and team-profile phases, then exposed an upgrade harness dependency: direct API requests lacked the identity header required after earlier workflow tests advanced seeded accounts' testing revisions. The narrow test-only repair pins the current session identity when each authenticated context is created. It does not silently refresh after revocation. A new regression creates its own account at a positive revision, proves the old pin is rejected after a second revision increment with stored content unchanged, then proves a fresh context can save. All upgrade journeys were rerun with all six seeded account revisions incremented before authentication in the attested disposable database. No revision was reset and no security guard was weakened.

## Final local certification

Final executable candidate: `e7edcc44c3bb41bc7027c01d454675075a46c9c2`. The late LinkedIn settings repair applies main's existing outcome-audit wrapper. Two outcome assertions failed before repair; afterward all 13 focused publication-link/audit unit cases passed. Real verified Growth success and Writer denial were checked against PostgreSQL audit rows: initiator, effective persona, session, method, path and actual outcome, without payloads. Denial changes no setting. Testing-disabled ordinary requests delegate directly to the unchanged handler with no testing lookup.

Hosted run [37704126869](https://github.com/Zanie567/The-Consilium/actions/runs/37704126869) then exposed a genuine list-state race. Feature returned revision `…14.169Z`, pin returned `…14.305Z`, then an older feature route snapshot replaced the pin state. The control reverted from Unpin to Pin to category and unpublish submitted `…14.169Z`; the server correctly refused it with ARTICLE_CHANGED. [The sanitized failure manifest](evidence/pr-phase/hosted-stale-refresh-reproduction.json) records the actual request sequence without session material. The list now retains newer acknowledged rows when older snapshots arrive, while accepting newer server rows and removals. A deterministic component regression fails before repair and passes after it, checking the pin state, latest outgoing guard, newer props and removal. The browser journey additionally waits for each saved feature/pin state. No guard, test or assertion was removed or weakened.

Aggregate certification at `06862a2e8d4415d83eecad3f981148b5c63151d3`: **942 unit + 543 integration = 1,485 passes**, 132 files, zero failures/expected failures/skips/todo; 25 revision cases included. The final executable candidate differs only by one positive visible saved-state assertion in `upgrade-revisions.spec.ts`. Application, unit/integration test, schema, dependency, service, workflow and configuration trees are identical; the [evidence manifest](evidence/pr-phase/local-certification.json) records their matching tree IDs. The complete 36-case upgrade project, typecheck, lint, isolated production build and eight smoke checks passed on the final code head. The next documentation commit changes no executable code.

| Check | Passing evidence after the list-state repair |
| --- | --- |
| Unit | 942 passed, 97 files |
| Integration | 543 passed, 35 files, 0 skipped |
| Aggregate | 1,485 passed, 0 failed/expected/skipped/todo |
| Revision/concurrency | 25 passed within integration |
| Focused editorial/scope/lifecycle/upgrade browser selection | 66 passed, identical application source |
| Final complete upgrade project | 36 passed, including visible saved-state acknowledgements |
| Typecheck and lint | Passed on final executable candidate |
| Production build | Passed on final executable candidate in isolated stack |
| Smoke | Eight unauthenticated checks passed on final executable candidate |

Earlier broad browser evidence (87 public/editorial, 530 workflow, 49 team/onboarding/profile) and advanced-identity reproduction remain scoped historical results. They are not represented as freshly rerun on changed list code. The affected component and endpoint paths were retested locally as above, and the full hosted census must independently pass on the exact final head.

Owned evidence: `test-results/next-e2e-3238-79026` (66 focused browser checks), `test-results/next-e2e-3239-80767` (final aggregate) and `test-results/next-e2e-3240-82025` (final upgrade run). Each owns disposable PostgreSQL, local fake Storage, captured email and OAuth off. Cleanup attestations confirm database removal and owned service termination. Raw session/outbox/trace artifacts are excluded from committed evidence.

## Hosted CI boundary

The earlier GitHub Actions run [37643286926](https://github.com/Zanie567/The-Consilium/actions/runs/37643286926) on remote `fa52ded` passed Typecheck/test/build and failed public/data-layer, roles/profiles/testing and upgrade jobs. Actual logs were inspected; they do not certify the repaired head. The final candidate requires all four named hosted CI jobs to pass on its exact latest commit. Hosted results and final review disposition will be attached to PR #117 after observation, avoiding a documentation-only push that would invalidate the successful check head.

CodeRabbit's file-limit skip (180 eligible files at the last request) and inherited dependency security debt remain explicitly disclosed. Human approval is required; neither local nor hosted functional certification clears production rollout.

Hosted maintenance notices are nonblocking for the observed passing jobs: inherited Actions versions are forced onto [Node 24](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/), and [ubuntu-latest will change](https://github.com/actions/runner-images/issues/14748). Action/runtime and runner image maintenance belong in a separate follow-up.

## Final hosted cache-harness repair

The subsequent hosted run [37706310851](https://github.com/Zanie567/The-Consilium/actions/runs/37706310851), head `62ce010`, passed verify (942 unit tests), public/mobile (all 1,485 Vitest tests and 67 browser checks) and all 36 upgrade checks. The long role/profile census completed **598 passed, one failed**. Its only failure was the restored publication-cache fixture POST receiving TESTING_IDENTITY_CHANGED after preceding workflows advanced the seeded account's testing revision. The independent Playwright request fixture bypassed the browser identity interceptor. This is a test-harness ordering defect; the guard correctly refused the unpinned request.

`662dfc1719f9ea0fc4444607e43a501cd3708ad6` changes only `tests/e2e/publication-cache.spec.ts`: use the existing fresh pinned context for direct API fixture mutations and close it after fixture-only cleanup. Pins remain stale after later revocation; no account revision is reset, guard disabled, cache assertion removed or expected error ignored. The exact post-workflow condition was reproduced by incrementing all six owned seeded account revisions before authentication. **All 11 lifecycle project checks passed**, including cache create/edit/unpublish/republish/trash/restore visibility, publication transitions, scheduling, illegal-transition refusal and comments. Typecheck/lint passed. Evidence: `test-results/next-e2e-3241-86252` plus the temporary config's corresponding selected browser results; cleanup attested.

Application, unit/integration, schema, dependency, service/workflow/configuration sources are identical to the already-certified code; matching tree IDs are recorded in the manifest. Earlier 1,485 local aggregate, 66 focused browser, 36 final upgrade, build/smoke and 25 revision results remain applicable within their explicit source boundaries. The final full hosted run must independently pass on the new exact head. No production operation or merge was performed.
