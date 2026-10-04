# Automated user-workflow audit

This audit uses real Playwright clicks, typing, native prompts and file inputs against a
production-mode local build. The coverage inventory distinguishes test definitions,
source inspection and executed behaviour. A passing page-load check does not establish
that every action on that page works.

## Version and environment

- Final affected-workflow regression commit: `680c11b716c30a0596dbceab706ab3249910c576`.
- Full audit commit: `64ae87b64a3e39b7e5ad51cd9d470865d94c0f02`. The application code is identical at these two commits; the later commit strengthens tests only. The reporting commit adds documentation only.
- Initial audited commit: `c379afa7e161b2e540f9b8fa3a857cdd6b8cbb45`.
- Branch: `test/ui-workflow-audit-isolated`, based on `f6f67e2`.
- Checkout: `/private/tmp/consilium-workflow-isolated`. A separate checkout was necessary
  because another local process changed Team Profile code/schema and generated Prisma
  files while the original audit was running. Those contaminated results are not used
  to certify website behaviour. Two unrelated Team Profile wording changes slipped into the first snapshot; its test caught the mismatch. They were restored to the base wording before the final run, without altering the other checkout.
- macOS 27.0.1 arm64, Node 20.20.2, Next 16.2.2, React 19.2.4,
  Playwright 1.60.0, Prisma 7.6.0, PostgreSQL 16.15.
- Disposable PostgreSQL: `localhost:55434/consilium`, data directory
  `/tmp/consilium-workflow-isolated-pg`; app `http://localhost:3321`; local fake storage
  `http://127.0.0.1:55422`; email capture
  `/tmp/consilium-workflow-isolated-outbox.jsonl`.
- Desktop Chromium and WebKit, Pixel 7 Chromium and iPhone 14 WebKit emulation.
  Team Profile and the older editorial suites use desktop Chromium.
- The installed Next testing, environment, Link prefetch, custom tsconfig and cache
  invalidation documentation was read before relevant changes, as AGENTS.md requires.
- No push, merge, deployment, production credential edits or production migrations.
  This checkout contains no production `.env.local`. App and helpers inherit the same
  guarded TEST_DATABASE_URL; production storage/email/OAuth keys are explicitly blank
  or replaced. All schema setup and fixture mutations target the disposable database.

## Inventory and evidence definitions

[coverage-inventory.md](./coverage-inventory.md) maps roles, areas, stateful menus,
dialogs, expected behaviour and gaps to test files.
[control-inventory.json](./control-inventory.json) records 63 page routes and 647 JSX
control declarations, 163 dynamic control families and six native dialog calls,
including inherited layout controls, options, source handlers and disabled conditions.
479 declarations have no direct literal-label test reference; this is a conservative
inspection signal, not an exact count of untested behaviours. Data-dependent labels and
rows can have group coverage without a literal reference.

The JSON is a source census, not proof that conditional controls appeared in a browser.
Rendered initial portal page inventories are saved separately for Writer, Editor,
Admin, Growth and Reader on Chromium and WebKit. Reader access/refusal and profile actions are
browser-tested. Menus/dialogs opened by the workflow specs have trace evidence on
failure, but initial page snapshots do not enumerate unopened dialogs. Arbitrary
production rows and every combination of filters/table dimensions/palette colours
cannot be exhaustively enumerated by this finite fixture set.

## Changes and confirmed findings

| Finding | Evidence | Focused change / regression |
|---|---|---|
| Shell launcher continued after isolation generator refused its target | The actual run-e2e launcher regression failed before the fix: a later command executed after npx exited 42 | Check generator exit before eval; both launchers now fail before SQL/build/start/cleanup |
| Shared build manifests, saved sessions and generated Prisma files made concurrent audits unreliable | Earlier runs produced chunk/setup failures, wrong-database JWT access denials and schema/client validation errors | Unique per-run builds, tsconfig, sessions, logs/reports; separate worktree and dependency/generated-client copies |
| WebKit hydration failed on Editor/Admin article lists | Original failure traces show SSR `2 Nov, 22:23` versus hydrated `2 Nov at 22:23`, React 418 | Format numeric UK date parts with stable punctuation; schedule display unit tests and both-engine menu navigation |
| Review feature/pin toggles had no accessible name or pressed state | The browser could not find the real Featured button by accessible name | Add aria-label/aria-pressed; UI toggles, reload, database read-back, public correction test |
| Invalid Team Profile photo preview caused an extra CSP error before server validation | Original Chromium invalid-upload trace reports blob connect-src violation in addition to the expected 400 | Preview only recognised image signatures; leave authoritative rejection to the server; report file-read failure visibly; existing invalid-upload regression retained |
| Browsing polluted seeded analytics fixtures | Three-reader aggregate returned four on rerun | Private draft fixtures, exact hand-computed SQL assertions, fail setup if database unavailable; bounded Vitest concurrency |
| Repeated footnote test clicks entered the editor's double/triple-click path | Failure trace contains insert/edit prompts but no cancel/removal prompt | Model separate interactions, assert the native prompt, accept/cancel/remove; exact removal count retained |
| Same-tab reopen raced the editor router refresh in WebKit | Schedule returned 200; the subsequent goto was interrupted by refresh to the same edit URL | Reopen in a fresh browser tab and assert persisted settings |
| Publication used a Server-Action-only cache API from Route Handlers | Both-engine UI regression: Publish 200, warmed category omitted article; server logged updateTag rejection | revalidateTag(articles, { expire: 0 }); browser checks category/archive/home after publish AND unpublish; unit pins supported cache API and logged failures |

Successful saves require exact 201/200 responses and reopen persisted articles.
Public-list API failures can no longer masquerade as an article being private. Removed
broad console filters for ResizeObserver, aborted local requests and favicon errors;
only external font/image failures are exempt. Navigation errors are no longer swallowed
by the public transition test. Screenshots and traces are retained on a first local
failure, not only on CI retry.

Added UI tests for editor publication controls and settings, live links, corrections,
commendation, feature/pin, all spacing options, counts/theme, table removal, footnote
editing, conflict discard, failed Back-to-articles save/recovery and interrupted image
upload/retry/reopen. Existing representative formatting, lifecycle, mobile, role,
reader and article-trash suites are retained. Team Profile remains part of every full
run, after other uploads finish, with one worker.

## Renderer expectations

This audit does not change articleRender.ts. The existing
`tests/unit/article-render-formatting.test.ts` and inventory record the policy: publish
semantic tables, strikethrough and code; preserve highlight as the site's mark; apply
house typography instead of inline text colours, alignment, line spacing, font size
or family. Browser checks verify saved editor formatting and published house style.
Font size/family have no available toolbar control; dormant callbacks and pasted
attributes are code-inspection findings. This relies on the repository's recorded
policy and is not new owner confirmation in this conversation.

## Results

Initial isolated full run at `c379afa` (`next-e2e-3321-8387`):

| Phase | Passed | Failed | Not run / skipped |
|---|---:|---:|---:|
| Vitest | 910 ordinary passes + 7 expected failures | 0 unexpected | 18 existing skips |
| Main Playwright | 84 | 0 | 0 |
| Workflow Playwright | 203 | 3 test synchronization failures | 0 |
| Team Profile | 11 | 1 snapshot wording mismatch | 29 serial dependents not run |

Focused run `next-e2e-3321-11096` passed the four corrected prompt/settings tests
(two engines), plus six login setup tests. Its two new cache probes initially targeted
an unavailable draft-review Publish Now control; that test error was corrected to use
the actual editor Publish control. `next-e2e-3321-11839` then reproduced the real cache
defect in BOTH engines after successful Publish 200. No failing cache assertion was
relaxed. After the cache fix, `next-e2e-3321-12710` passed the category check but exposed
an Archive locator error: Archive link names include date/category/author. The regression
now checks the visible article heading on each layout. `next-e2e-3321-14315` passed on
WebKit; Chromium exceeded the 30s aggregate budget across nine public page loads. The
multi-step test now has 90s overall, retaining 10s action/assertion deadlines.

Full audit at `64ae87b` (`next-e2e-3321-15965`), with two workers and no retries:

| Phase | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Vitest (935 total) | 910 ordinary + 7 existing expected failures | 0 unexpected | 18 existing |
| Main Playwright (84) | 83 | 1 WebKit navigation error | 0 |
| Workflow Playwright (208) | 205 | 2 aggregate timeouts + 1 reopen synchronization error | 0 |
| Team Profile (41) | 41 | 0 | 0 |

The command correctly exited 1. Across browser phases there were 329 passing executions and four failures; setup is counted twice, and four `publication-lifecycle` executions are API-driven. Those figures must not be read as 329 distinct browser actions.

Both desktop engines passed the complete representative formatting article through creation, save/reopen, preview and publication; the eight-stage writer/editor feedback, revision, scheduling, publication/unpublication workflow; all article uploads; list publication/trash; both conflict recovery choices; failure/delay/session/in-flight/double-click scenarios except the Back-to-articles test's reopen race. Both mobile projects passed all five workflows each. Team Profile passed all 41 tests, including invalid uploads and role changes. Warmed category/archive/home publication and unpublication passed in both engines.

The remaining workflow failures were addressed in test code at `680c11b`: Back now asserts the completed list navigation and visible article row before opening a fresh tab; the complete Admin menu census and multi-mutation review scenario receive 90s aggregate budgets. Individual page navigation, actions and assertions remain bounded at 10s. Resource contention from other local browser/typecheck runs was observed during the full run; changing aggregate budgets is not evidence of production performance.

The permission audit also found a false-positive check: unsupported POST `/api/admin/users` returned 405, accepted by its broad assertion. The test now calls real POST `/api/editorial/users` and requires 403 for all non-Admin roles. Other sensitive endpoints require their handlers' exact 401/403 responses. These negative permission checks are API tests, separate from role-specific UI visibility and navigation.

Final focused run at `680c11b` (`next-e2e-3321-31884`), fresh isolated production build, one worker, no retries: **54 passed, one failed, zero skipped** in 4.1 minutes. All eight Writer/Editor/Admin/Growth menu-navigation cases, both review-control cases, both Back-to-articles recovery cases, both warmed public-cache cases, and all 34 exact negative permission cases passed, plus six authentication setups. The single failure is public WebKit navigation; its error assertion also captured a NextAuth session-fetch “Load failed” during rapid navigation. The launcher correctly exited 1. These affected workflows were rerun, not the entire suite at the latest test-only commit. Build, typecheck and lint pass for the tested application/tests. See [evidence-index.md](./evidence-index.md) and [verification-results.json](./verification-results.json) for per-spec outcomes, screenshots, traces and successful preview/published captures.

## Remaining gaps and environment limits

The inventory explicitly marks uncovered UI mutations in debates, series, glossary,
predictions, calendar, user ban/warn/delete, analytics date/filter controls, exports,
notifications, commissioning brief/cadence/banner dismissal, inline review comments,
password-reset email-link flow, newsletter/unsubscribe, reader avatar, comment replies
and reports, PDF export and external sharing. Page loads or API/unit checks do not
establish those browser behaviours. Calendar and predictions are intentionally Admin
only; seeded first-admin setup is unavailable; Writer slug/author/publication controls
are intentionally hidden. Real print/file chooser chrome, Google sign-in, delivery,
Supabase RLS/signed URLs/image transformations/CDN and real mobile Safari hardware are
outside the local stand-ins.

The existing API test file has 18 explicitly skipped cases: five password-reset,
six comments, four upload and three bookmark scenarios. Several are superseded by
active UI/API audit tests, but reset expiry/use, long comment constraints and invalid
bookmark ID remain gaps. Existing content-filter tests contain seven expected failures
(separator/repeated-character bypasses and an academic-quotation exception); those are
known defects, not successful behaviour. No new expected-failure or skip was added.

WebKit public navigation remains an open failure: rapid real navigation produces uncaught RSC-fetch errors containing “due to access control checks”, even while destination URLs and document responses succeed. The error assertion stays enabled; no skip or suppression was added. The full run recorded 54 such errors. A diagnostic repeated navigation over both HTTP and a local HTTPS proxy and recorded 65 and 67 errors respectively ([diagnostic results](./evidence/local-https-probe.json), [diagnostic source](./evidence/local-https-probe.cjs.txt)). That rules out the earlier suggestion that plain HTTP alone explains the problem. Its underlying framework/browser cause and deployed Safari impact remain unconfirmed; changing unrelated application code or swallowing errors would not be a supported fix.

A historical 1px WebKit footnote page-height difference did not recur in the final full run, but one successful run does not establish its elimination. All seven footnote tests passed on both engines; their assertions remain enabled. Real deployed HTTPS Safari and physical mobile devices were not exercised.

Native file inputs are supplied through Playwright `setInputFiles`; the operating-system chooser is not tested. Text-range selection uses DOM Range to select exact editor text before clicking formatting controls, and pasted images use a synthetic clipboard event. Print is verified by intercepting `window.print`, not by operating the system print dialog. Fixtures and the scheduler firing use database/API calls, but user creation/edit/save/review/publication/upload actions use the actual interface.

## Reproduction and artifacts

Use [README.md](./README.md)'s isolated setup/audit commands. Reports live under each
printed run ID. Failure traces can be opened with `npx playwright show-trace <trace.zip>`.
Large evidence is retained locally and ignored by git; the existing CI artifact step
uploads test-results and Playwright reports. No deployed environment or remote CI job was exercised. CI is configured to run the routine three-phase suite, including Team Profile; its Linux results and duration remain unverified locally. The launcher stopped its owned app and fake-storage processes; the disposable PostgreSQL cluster remains available for reproduction.

The final focused command was:

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55434/consilium \
  E2E_APP_PORT=3321 FAKE_STORAGE_PORT=55422 \
  EMAIL_CAPTURE_FILE=/tmp/consilium-workflow-isolated-outbox.jsonl \
  E2E_PHASE=final-regression npm run test:e2e -- --workers=1 \
  --project=public-webkit --project=wf-chromium --project=wf-webkit \
  --grep 'every menu entry|sensitive endpoints|review correction|Back to articles|publication and unpublication|view-transition'
```

A durable local copy of this report, inventories, all seven isolated browser-run result directories and HTML reports, and original pre-fix evidence is under `/Users/zanie/The-Consilium/docs/testing/evidence/audit-isolated-2026-10-04/`. Its relative links remain intact. This is an ignored artifact directory; it does not overwrite the other checkout's source changes. The committed implementation remains on `test/ui-workflow-audit-isolated` in the separate worktree.
