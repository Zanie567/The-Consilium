# Foundation verification ledger

Executed 2026-10-06 on `feature/consilium-platform-upgrade`, audit base `029eef3`. These results verify the foundation and current regression baseline. They do **not** satisfy the complete upgrade acceptance criteria in [MASTER-SPEC.md](MASTER-SPEC.md). Specialist features remain unimplemented.

## Environment and production boundaries

- Local Node 20.20.2, Next 16.2.2, Chromium via repository Playwright 1.60. Repository `.nvmrc` specifies Node 22; verification on Node 22 remains required before release.
- A new owned PostgreSQL 16 cluster at `/tmp/consilium-foundation-20261006-pg`, port 55490. Initial audit DB `consilium`; final repeatable verification DB `consilium_foundation_verified` created fresh in that cluster. The existing unrelated localhost:5433 cluster was not reset or changed.
- Canonical `assertSafeTestDatabaseHost`/`testDatabaseEnv` guards remained enabled. No hosted Supabase DB was used. A deliberate hosted URL was rejected by `platform-check` before its child command started; existing guard tests and two new shell refusal tests passed.
- Current schema/fixtures were installed using existing guarded Prisma generate/db push/seeds. Existing `tests/e2e/helpers/local-storage-schema.sql` and `supabase/migrations/20261001_team_member_user_link.sql` were applied only to the new local DBs. **No new schema or migration was created. No production migration was applied.** This does not verify replay of the historical migration directory.
- Guarded production-mode Next server at localhost:3197, local Storage wire-contract emulator at 127.0.0.1:55491. Build/server/test processes shared explicit local DB, synthetic local auth/cron keys, local Storage keys/origins, disabled external email/OAuth/FRED and disabled telemetry. Local env-file credentials were blanked before Next/dotenv could load them. Runtime isolation was checked.
- Functional server checks used the existing rate-limit-disable test switches; rate-limit unit coverage remains. Local Storage is not proof of real Supabase RLS, signed URLs, CDN or deployment upload limits. No production application/service was exercised.
- No push, merge, deploy, release workflow, production database query/mutation or production content change occurred.

## Actual baseline and final results

| Check | Audit baseline | Final foundation |
|---|---|---|
| Typecheck | Initial run failed with four TS2307 errors in stale `.next/types/validator.ts` referring to removed routes. Regenerating `.next` through baseline build resolved them; baseline source then passed. | `npm run typecheck`: exit 0, no TypeScript errors. |
| ESLint | Initial runs were terminated after scanning huge pre-existing generated E2E builds and archived browser-report bundles. Not a demonstrated source lint failure. | `npm run lint`: exit 0, no errors/warnings. Precise generated-artifact ignores added; authored source/tests remain checked. |
| Unit | 37 files; 576 passed, 7 existing expected failures (583 total). | 40 files; **587 passed, 7 existing expected failures** (594 total). |
| Integration | 17 files; 299 passed, 18 skipped (317). First offline run included live tests that returned early; it was not accepted as full execution evidence. Live baseline full suite also ran successfully. | 18 files; **306 passed, 18 existing explicit skips** (324 total), live isolated server/DB/Storage available. |
| Full Vitest | Live baseline: 54 files; 875 passed, 7 expected failures, 18 skipped (900 total). | **58 files; 893 passed, 7 expected failures, 18 skipped (918 total)**, 12.39s, serial files. |
| Playwright | 100 tests with team opt-in/workers=2: 93 passed, 1 failed, 6 not run. Team roster comparison observed another parallel test's newly created editor. Serial team rerun: 41 passed. | **101 passed**, workers=1, 3.5 minutes; default projects plus all opt-in team tests and new cache lifecycle. Chromium only. |
| Production build | Exit 0 after regenerated types; generated artifact scan produced CSS warnings. | `npm run build`: **exit 0**; compiled in 8.2s, build TypeScript completed, 87 static pages generated and route output emitted. |

The 7 expected failures are existing `it.fails` content-filter bug cases, unchanged. The 18 explicit integration skips are pre-existing password-reset token, authenticated comment/bookmark and upload cases in `api.test.ts`; some areas also have coverage in other live suites. None were added/removed to obtain green results. Tests with service-dependent early returns still exist; final DB/server/Storage readiness was verified, not inferred from a green count.

Build logs include existing auth-wrapper logging of Next's `DYNAMIC_SERVER_USAGE` during attempted prerendering of authenticated routes; those routes were emitted dynamic and the build exited successfully. The isolated runtime logs include intentional missing-FRED warnings and the negative team fixture's invalid `/team/x.png`. There was no Route Handler `updateTag` error after the fix. No blanket claim of an error-free server log is made.

## Failures investigated and resolved at the foundation boundary

1. Generated artifacts polluted lint/typecheck: excluded only generated `.next-e2e*` builds/configs and browser reports; rebuilt stale `.next` validators. Preserved pre-existing untracked artifacts, documentation and Supabase temp files.
2. Concurrent Playwright team fixtures changed roster assertions: run fixture-mutating suites serially on independently owned databases. Specialist streams each receive separate DB/app/Storage ports. This limitation remains; workers=2 is not certified.
3. A repeated live integration run initially had 297 passed, 2 failed, 18 skipped because reading-progress API audit added a fourth reader to the shared three-reader fixture. Seed upserts do not remove extra progress rows. The audit now creates and cleans its own synthetic article; final verification used a new owned DB. Subsequent full and standalone integration runs passed without reseeding.
4. Shell harnesses could mask resolver refusal by evaluating empty command substitution. Capture/check resolver status before eval; regressions prove both shell scripts exit before setup/build/server work. The canonical host policy is unchanged.
5. A standalone integration run observed 66 then 67 users across two count reads because a concurrent signup file created a row: 305 passed, 1 failed, 18 skipped. Vitest now executes files serially against its shared seeded DB. Final full and standalone integration runs passed; parallel specialist streams still use separate DBs.
6. Direct Tiptap images were blocked by CSP for the local HTTP Storage emulator. The existing image test flag now validates only credential-free HTTP loopback URLs, and a second TEST_HARNESS flag allows only that exact image origin in CSP. Production default CSP is unchanged. Six regressions check permitted local origin, missing flags, external hosts, credentials and invalid protocol; browser image load/reload was verified after rebuilding.

## New meaningful checks

- Three figure-render tests: multiple figures keep independent metadata; legacy images/empty labels retain behaviour; malicious metadata is escaped and unsafe URLs removed by final server sanitization.
- Seven create/restore cache-route tests: published/draft distinctions, post-write order, rollback/failure and unauthorized writer boundaries.
- Existing cache-helper tests now assert `revalidateTag('articles', { expire: 0 })`, including caught invalidation failure.
- Two shell-entrypoint refusal tests: failed resolver cannot start a downstream child.
- Six local Storage configuration tests: exact test origin permitted; default/hosted/invalid URL configurations retain production CSP and server image protections.
- One real Next warm-cache Playwright scenario: direct published create → edit → unpublish → republish → trash → restore, before the 30s TTL expires; each public category read follows the committed state. Cleanup deletes only its synthetic article.
- Existing writer/editor lifecycle, scheduling/review/comment, role scope, public rendering/search, team/profile/storage, responsive editorial, network/console and security regressions all ran in the final 101-test suite.

## Browser inspection

Interactive local Chromium inspection supplements the automated suite; this is foundation QA, not full feature QA. Results and representative screenshots are recorded under `evidence/`. The full feature-specific controls and Google Docs/table/figure publication regressions remain specialist acceptance work.

At 375, 768 and 1440 pixels, visited/scrolled home, News and Team and captured full-page screenshots after triggering existing scroll animations. All returned HTTP 200 with no page-wide horizontal overflow. Home/News had no captured browser errors. Team showed the known linked-chief placement discrepancy and the negative fixture's `/team/x.png` image 400; this is recorded, not presented as a passing complete team acceptance test.

Exercised existing search (`carbon`), then authenticated admin editor: typed title/body, clicked Bold, uploaded a valid synthetic PNG to the local article-images bucket, entered caption/credit, clicked Save draft, checked persisted JSON, reloaded and verified formatting/metadata plus a successfully loaded image. Editor had no captured page/console errors or overflow at all three widths. The synthetic draft was soft/hard-deleted through authenticated APIs. The short-lived save indicator resets on create→edit navigation, so persistence was checked directly rather than relying on its timing. No new metadata controls or full Google Docs/table/publication figure features were implemented.

Screenshots were visually inspected for mobile home, desktop Team and mobile/desktop editor. This supplements existing automated responsive/console/network coverage, and does not claim every upgrade toolbar/dialog/subscription interaction has been manually accepted.

The existing editor headline field clipped a long synthetic title vertically at 375px; recorded for Editor workstream responsive QA. The image fixture is a one-pixel PNG stretched by current figure styling; successful natural image dimensions were checked, not inferred from appearance. Metadata was checked in the DOM/persisted JSON; screenshots do not show the entire internal document scrolling region.

## Reproduction and remaining limits

From the integration checkout, with its isolated server/Storage already ready:

```sh
export TEST_DATABASE_URL=postgresql://postgres@localhost:55490/consilium_foundation_verified
export PLATFORM_TEST_PORT=3197
export PLATFORM_TEST_STORAGE_PORT=55491
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run typecheck
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run lint
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run test:unit
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npx vitest run tests/integration
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm test
E2E_TEAM_PROFILE=1 npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npx playwright test --workers=1
```

Build before starting the server with the same wrapper/environment. Follow [MASTER-STATUS.md](MASTER-STATUS.md) for safe setup and each specialist's isolated worktree/ports. Do not run browser fixture mutation concurrently with DB suites. Existing fixtures are not fully idempotent; use a new owned database if contaminated. No Firefox/WebKit, real Supabase, external email/LinkedIn, production build environment, deployment platform or production migration verification occurred. Specialist acceptance and Node 22 checks remain open.

Command logs are retained in `evidence/` for typecheck, lint, unit, integration, full Vitest, Playwright and build, with terminal color codes/trailing whitespace normalized and results preserved. They contain only isolated test output; they are not production evidence.
