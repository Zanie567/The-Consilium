# Pre-merge hardening report — 2026-10-07

This follow-up supersedes the CI, caller-revision and skipped-test limitations in the 2026-10-06 integration report. That report and its evidence remain historical. Scope: CI orchestration, existing-article concurrency contracts, and feasible skipped API tests. No platform redesign, dependency change or new migration.

## 1. Repository and safety

Verified `/Users/zanie/The-Consilium` is the older, dirty foundation checkout at `68b26e8` on `feature/consilium-upgrade-implementation`. Left its tracked edits and untracked work untouched. Verified the clean integrated worktree `/private/tmp/consilium-final-integration` is `feature/consilium-platform-upgrade` at starting commit **07b1105**, descended from 312f624 and 72c9231. Read the authoritative specification/status/report and final-integration evidence before editing.

Local commits: **8bfe128** (CI), **bfae063** (revision protection), followed by `test: restore feasible skipped integration coverage` (bookmark repair, restored API tests, status and evidence; the commit containing this report). Final numeric HEAD and clean status are reported in the handoff. Historical upgrade commits remain intact.

Guarded Postgres **16.15**: `/tmp/consilium-hardening-pg-20261007`, localhost **55521**, database `consilium`. Next production server: **3221**; local Storage: **55621**; Node **22.23.3**, Next **16.2.2**. Actual database identity is in `database-identity.log`. Existing safety policy, resolver, worker guards, schema and migrations are unchanged. No hosted Supabase, production query/data change/migration, push, merge or deployment. Owned services are stopped after verification; test data is retained locally.

## 2. CI repair and clean-runner review

Previous `verify` job ran aggregate Vitest without services. The database job ran live HTTP tests before the application existed; Storage pointed at `example.supabase.co`, team-profile opt-in was absent, browser URL/configuration was incomplete and CI defaulted to two workers. `test:integration` selected only one file.

Repair: service-free unit job installs dependencies (Prisma generation in postinstall), runs `next typegen`, typecheck, lint and `test:unit`. A matrix supplies independent **integration** and **browser** jobs, each with health-checked PostgreSQL 16 and an explicit guarded loopback URL. `test:integration` now collects the entire integration directory. Browser workers are **1** in config and command.

Both service jobs use `platform-check.ts` and `run-platform-suite.ts`: reject occupied app/Storage ports; verify/setup/seed the safe database and four existing additive migrations; apply local Storage bucket schema and team migration; production build; start Storage and validate its inspection endpoint; start the application and require HTTP 200 with an article array; only then run tests. Child/setup/build failures and bounded readiness failure reject the job. Unexpected service exit aborts the active test command. Cleanup targets owned process groups; failure prints service log tails. PostgreSQL is supplied/cleaned by Actions. No production secrets are referenced.

The wrapper supplies identical build/runtime/test values: BASE_URL and E2E_BASE_URL, E2E_PORT, NEXTAUTH_URL, NEXT_PUBLIC_SITE_URL, loopback Supabase URL/keys, local image flags, synthetic auth/cron secrets, disabled external email/OAuth/FRED/telemetry and the established functional rate-limit flag. The browser runner sets E2E_TEAM_PROFILE=1. Guarded URL variables cannot fall back to env-file credentials. Hosted Supabase refusal remains unconditional.

Final clean-runner walkthrough: checkout → Node 22 → npm ci/codegen; services job already has healthy Postgres; install psql and Chromium as appropriate; guarded setup/migrations/seed; build; Storage readiness; app readiness; suite. Each matrix job has its own runner/database. Unit needs none of those services. Browser targets the explicitly started local app, not Playwright's optional fallback server. Shared fixture tests stay serial. YAML parses and every script/DDL reference exists. An occupied-port probe exits **1 before setup** rather than reusing another server.

Locally reproduced npm ci, removal of generated build/type artifacts from the check's path (preserved in an owned temporary backup), next typegen → static/unit checks, and the shared runner with USE_EXISTING_DB=1 for the complete sequence. After shutting down all owned services, the exact minimal CI unit environment (env -i, only Node PATH/local URL guards/TEST_HARNESS/telemetry/CI flags) also passes 646 unit cases plus seven expected failures; no wrapper-supplied auth/provider secret or running service is needed. Local macOS/Postgres is a close equivalent to CI's Ubuntu/container environment. **Hosted GitHub Actions was not run or observed; its green result remains a merge gate.**

## 3. Existing-article mutation inventory and contracts

Searched API PUT/PATCH/DELETE, all first-party request sites, Prisma update/updateMany/delete/deleteMany, raw article UPDATE and server-action directives. No article-mutating server action exists. Revision comparisons happen after applicable auth/category checks; database write predicates retain/recheck revisions and lifecycle state. Tokens come from the displayed resource, never a pre-action GET used to defeat stale detection. No conflict automatically retries over newer content.

Evidence: **V** = 22 real HTTP/PostgreSQL revision tests in `article-revisions.test.ts`; **B** = seven browser cases in `upgrade-revisions.spec.ts`; **E** = retained stale-editor case in `upgrade-final-integration.spec.ts`; **R** = 36 focused existing save/review/schedule/cache route cases, plus full regression.

| Caller | Mutation | Previous protection | Current protection / success revision | Stale conflict | Evidence |
|---|---|---|---|---|---|
| useArticleEditorController | PUT save/autosave/submit/schedule/publish/unpublish; POST creation then PUT latest snapshot | Loaded expectedUpdatedAt + atomic revision/state predicates | Preserved; successful save response advances revision | 409, unsaved text retained | V/B/E/R; rich-content full journey |
| ArticlesList.publishArticle | PUT publish/unpublish | In-request CAS, omitted loaded token | Sends displayed updatedAt; stores returned revision/status/dates | 409, friendly message and refreshed list; no retry | V/B, DB row unchanged under both stale actions |
| SeriesManager.assignArticle | PUT seriesId/seriesOrder | In-request CAS only | Sends loaded option revision; full reload obtains refreshed placement/revision | 409, explicit fresh-copy feedback; manual reload before action | V/B, stale placement leaves newer row intact |
| ReviewPanel.act | PATCH approve/schedule/return/unpublish/correct | Status machine + in-request CAS/atomic notification | Loaded expectedUpdatedAt layered on existing guards; stores response revision | 409 ARTICLE_CHANGED for stale page; existing transition/race conflicts retained | V all five happy/stale actions; B approve/return/schedule/unpublish; one approval/notification under concurrency |
| CalendarView.handleDrop | PATCH scheduled date | In-request scheduledAt/state CAS | Loaded revision plus updatedAt predicate; router refresh supplies new loaded revision | 409, optimistic move rolled back | V/B real drag/reload/reschedule |
| CommendationEditor in ReviewPanel | PATCH commendation | No revision predicate | Loaded revision + CAS; returned revision updates shared review state | 409, input retained | V/B commendation followed by return using new revision |
| ArticlesList / ReviewPanel feature and pin controls | POST/DELETE placement flags | Unconditional writes | x-article-revision from loaded row/shared review state; CAS and returned updatedAt | 409; list refreshes, review asks reload | V POST/DELETE happy/stale; B header/revision propagation |
| ArticlesList.deleteArticle / DraftsSection.handleDelete | DELETE to trash | Fresh permission read followed by unconditional soft delete | Loaded x-article-revision + atomic revision/author/category/trash predicates | 409; article stays live and newer fields remain | V/R, full lifecycle regression |

Feature selection remains a global single-slot operation: selecting the current target intentionally clears another article's feature flag without that other article's client token. A transaction-scoped advisory lock, using the existing repository lock pattern, serializes simultaneous selections before target row locks. Only actually featured other rows are cleared, avoiding revision churn on every unfeatured article. Three rounds of four concurrent valid choices each return 200 and retain exactly one featured row. A first hardening version lacked this global serialization; the retained red test observed four featured rows. It was repaired before final certification. This is a hardening-pass failure, not pre-existing debt.

Deliberate token exceptions: TrashList restore/permanent-delete are explicit lifecycle actions on the current trashed resource. They cannot overwrite content fields; existing transactional authorization, trash-state predicates, hard-delete revision/deletion snapshot checks, atomic audit/image-queue behavior and restore-race protection remain. Admin account deletion (`/api/admin/delete-user`, `/api/admin/users/[userId]`) is an explicitly confirmed account-level cascade, not an article edit; existing self/admin/leadership guards remain. Notes and article-comment append/resolve operations mutate separate resources, not the Article row. Series creation edits a separate Series resource. Article POST creates a new resource with no prior revision. Scheduler publication/purge uses existing server-side state/revision predicates; raw readership/engagement increments intentionally leave editorial updatedAt untouched. No client article token is appropriate for those operations. Legacy external API callers may still omit the optional token; they retain server CAS but not long-open-page protection. Every current first-party editor/state/metadata/trash caller supplies its loaded token.

## 4. Restored skipped coverage

**18 previous explicit integration skips → 0 remaining skips.** All audit cases are feasible locally. Expanded boundaries produce 22 active cases in place of the 18 placeholders; no test removal, new skip, only marker, moderation-policy change or relaxed assertion.

| Area | Old skips | Enabled current cases |
|---|---:|---|
| Password reset | 5 | Valid 8-char password; valid 128-char maximum; 7-char rejection; 129-char rejection; expired token; already-used token. Actual password hash/token consumption or preservation asserted with disposable users/tokens. Old 200-character/no-maximum expectation replaced, not validation weakened. |
| Authenticated READER comments | 6 | Clean comment; 3-char minimum success; 2-char failure; 1000-char maximum success; 1001-char failure; whitespace-only failure; prohibited slur failure; script-tag input stored/read back as sanitized plain text. Real seeded reader session; owned published article; final DB storage/count asserted. |
| Upload / bucket | 4 | Real decoded JPEG returns **201**, local bytes and registry receipt verified; HTML named .jpg rejected; truncated JPEG decoder rejected; **4 MiB + 1** rejected; authenticated invalid bucket returns controlled 400. No larger limit or auth bypass. Local Storage exercises real client wire/decoder behavior, not real provider RLS/CDN acceptance. |
| Bookmarks | 3 | Toggle on persisted; toggle off removed with an independent precondition fixture; nonexistent article returns **404**, no bookmark. Route now validates article existence and handles deletion/FK race with controlled 404 instead of raw 500. |

No remaining skip requires a justification. Real Supabase acceptance remains an unexecuted release requirement, not a falsely certified local-provider result. Existing functional HTTP rate-limit cases still return under the established audit flag; their unit limiter coverage remains. That unchanged limitation is distinct from explicit skips.

## 5. Known expected failures and debt

The seven moderation `it.fails` cases and `src/lib/content-filter.ts` are byte-identical to starting commit 07b1105; the previous report also records their foundation provenance. Their separator/repetition/phrase/academic-quotation defects remain disclosed and out of scope. Seven expected failures, **zero new unexpected failures** in final certification. Dependency/lockfile unchanged; npm ci reported the existing 47 advisories (1 low, 13 moderate, 29 high, 4 critical). This pass did not triage or remediate that separate dependency debt. Existing provider/outbox/high-volume/cross-browser limitations in the historical report remain; no new production acceptance is claimed.

## 6. Exact verification

Local command prefix **H** is `/tmp/consilium-hardening-check.sh`, exporting Node22/Postgres16 PATH, TEST_DATABASE_URL=postgresql://postgres@localhost:55521/consilium, PGPORT=55521, PGDATA=/tmp/consilium-hardening-pg-20261007, PLATFORM_TEST_PORT=3221 and PLATFORM_TEST_STORAGE_PORT=55621, then executing `npx ts-node -P tsconfig.seed.json scripts/platform-check.ts` in the integrated worktree. Equivalent reusable wrapper instructions are in the evidence README.

| Actual command | Final result |
|---|---|
| H npm ci | Exit 0, Prisma client generated; lockfile unchanged |
| H npx next typegen | Exit 0; regenerated absent route type artifacts without app/DB services |
| H npm run typecheck | Exit 0, no errors |
| H npm run lint | Exit 0, no warnings/errors |
| H npm run test:unit | **47 files, 646 passed + 7 expected failures (653)** |
| H npx vitest run tests/integration/review-route.test.ts tests/integration/scheduling-routes.test.ts tests/integration/article-save-route.test.ts tests/integration/publication-cache-routes.test.ts | **4 files, 36 passed** |
| H npx vitest run tests/integration/article-revisions.test.ts --reporter=verbose | **1 file, 22 passed**, including real concurrent feature/approval final state |
| H npx vitest run tests/integration/article-revisions.test.ts tests/integration/api.test.ts --reporter=verbose | Earlier focused gate **110 passed** (21 revisions + 89 API before the added global-feature case); complete final gate below includes all 22 |
| H env E2E_TEAM_PROFILE=1 npx playwright test tests/e2e/upgrade-revisions.spec.ts --workers=1 | **11 passed** (4 auth setups + 7 interaction cases), before the added global-feature SQL repair; final complete suite repeats them against the corrected build |
| env USE_EXISTING_DB=1 H npx ts-node -P tsconfig.seed.json scripts/run-platform-suite.ts all | **Exit 0**, guarded setup/seed/DDL, production build, healthy Storage/app, complete integration, aggregate and browser commands below |
| Runner: npm run build | Exit 0, production compile/typecheck/route generation |
| Runner: npm run test:integration | **28 files, 407 passed, 0 skips** |
| Runner: npm test | **75 files, 1053 passed + 7 expected failures (1060), 0 skips** |
| Runner: E2E_TEAM_PROFILE=1 npx playwright test --workers=1 | **129 passed**, includes all 41 opt-in team cases and 7 new browser cases |
| H env SMOKE_BASE_URL=http://localhost:3221 npm run smoke | **8 unauthenticated checks passed**; standalone authenticated section not supplied a cookie/role (covered by live/API/E2E suites) |
| YAML parse/reference inventory; bash -n scripts/setup-test-db.sh; git diff --check | Exit 0 |
| H npx ts-node -P tsconfig.seed.json scripts/run-platform-suite.ts integration with occupied owned app port | Expected **exit 1 before setup**, no other server reused |

Earlier complete run: 406 integration passes, 1052 aggregate passes plus seven expected failures, 128 browser passes before calendar coverage/global-feature correction. Retained as intermediate evidence, not final certification. An additional browser rerun was interrupted for the feature-race investigation and is not counted. Initial browser failures were strict locator ambiguity (route announcer) and an incorrect existing Post button name; fixed without changing product behavior/assertions. The earlier-build bookmark 500 is retained as a red contract probe. A standalone smoke attempt after runner cleanup correctly refused the stopped server; it is retained as offline/not accepted. The smoke was repeated only after restarting the same guarded app and confirming readiness, with eight unauthenticated checks passing. All logs are under [evidence/hardening](evidence/hardening/README.md); historic screenshots were restored and new captures copied into this directory.

## 7. Actual browser QA

Playwright drove article list publish → feature → pin → unpublish with returned-revision propagation, stale publish and unpublish with list reconciliation, series stale assignment → explicit reload → assignment, review stale approval and intact DB/notification state, commendation → return with the new revision, review approve → unpublish, UI scheduling with persisted UK time, calendar stale drag/rollback → reload → successful reschedule, and public bookmark on/off/reload plus comment/reload. The retained two-tab editor stale-save case and rich editor save/submit/edit/schedule/publish/reopen/upload/replace/delete journeys run in the complete suite.

Affected cases collect console/page errors; list additionally rejects unexpected API 5xx and public bookmark/comment rejects API >=400. Expected revision conflicts (409) and deliberately injected negative-test responses are asserted, not treated as unexplained errors. Console collector retains its existing resource/extension/aborted-navigation filtering; no new app exception/hydration error found. Full certified public/internal/RSC/image crawl remains green. Responsive editor/table/figure/public/team cases include 375/768/1440 widths. No separate native Chrome session, physical device or cross-browser acceptance was performed in this pass.

## 8. Remaining PR and merge gates

Before PR opening/review: **no remaining local blocker in this task's scope**. Candidate is locally committed and clean. Review should inspect the concurrency/lifecycle exceptions and preserved debt disclosures.

Before merge: **hosted GitHub Actions must pass on the PR**; this task explicitly forbids pushing and therefore cannot observe it. Normal code/security review, including existing dependency/moderation debt disposition, remains the owner's process. No hosted-green or merge approval claim.

## 9. Release-only prerequisites — not executed

Supply/validate the real publication LinkedIn SiteSetting and confirm canonical production origin. Operator reviews actual historical schema/migration drift, canonical-topic/subscriber collisions and PostgreSQL compatibility before applying the four previously documented additive migrations. Verify real Storage buckets/permissions/RLS/service-role/CDN/signed-URL/upload limits; local emulator is not that evidence. Configure/test authenticated scheduled-publication, image GC and engagement-retention jobs; confirm email/OAuth/provider delivery as applicable. Native share/device and broader browser acceptance remain unverified. Existing best-effort publication side effects and GC/purge/retention backlog limits remain disclosed. No production command is authorized or performed here.

## 10. Recommendation

READY FOR PR REVIEW, NOT READY TO MERGE
