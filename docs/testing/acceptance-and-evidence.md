# Acceptance and evidence

Branch: `feat/public-appointments-testing-mode`. Automated fixtures used guarded local databases/storage. Independently approved hosted testing used only Supabase `zrieajoqosgzyesfatta` and Vercel `consilium-testing`. Production was inspected read-only; no production deployment, migration, backfill, permission change or account simulation occurred. Existing unrelated workflow-audit work and the subsequent committed hosted-bucket reproducibility change were preserved. Instructions: [appointments-and-testing-mode.md](./appointments-and-testing-mode.md).

## Acceptance table

“Verified” means observed in the recorded checks; hosted claims are explicitly scoped below. “Implemented” alone does not claim hosted verification. Suite abbreviations refer to `tests/e2e/` unless specified.

| Requirement | State | Evidence / practical limit |
|---|---|---|
| Original Alexander account/card/title/order/ownership/media | Verified read-only | Connected production project `scllbuwkcqtmfogsgalt`: user `cmnnnylyo000004l7b74992hb`, card `cmnkzhmgr00050pits5oquv7g`, ADMIN, Editor-in-Chief, order 1, active/unbanned. Final photo/description hashes match the initial snapshot; [read-only final evidence](./evidence/appointments-mode/production-read-only-final.json). No writes. |
| Permission-independent section, ordering, single leading chief | Implemented; verified locally | `team-hierarchy`, `team-profile-accounts`, `team-profile-db`, `team-profile-lifecycle`, `team-profile`: ADMIN/WRITER/EDITOR/GROWTH transitions retain ID/owner/title/tier/order; leading variant, first card, section membership and exact occurrence asserted. Local chief fixture represents the production appointment; screenshot is **not** a production login. |
| Explicit public appointment changes | Verified | Admin title/tier/order mutation changes placement; partial updates preserve absent appointment fields. Name editing cannot grant placement. |
| Public author appointment labels | Implemented; verified locally | Assigned title survives ADMIN/WRITER/EDITOR/GROWTH permissions; unappointed ADMIN is Contributor; explicit title/visibility changes affect the label. Actual author-page browser regression passed. Account name cannot confer leadership. |
| Administrator with assigned card can edit biography/photo | Verified | Accessible Team Profile, read-only Editor-in-Chief label, same card after biography save and intentional photo upload/replace/remove; local original photo restored through the authorized admin endpoint. ADMIN without appointment has no creation form and cannot auto-create. |
| Ownership, duplicate prevention and legacy linking | Verified | Unique database index; concurrent creation, adopted email card, name-only refusal, ambiguous email refusal, forged ownership/placement inputs, unrelated cards retained. |
| Suspension, ban and public visibility | Verified | Banned/inactive owner and hidden cards excluded; permission-only changes do not hide an appointment. |
| Separate initiating/effective identities; no privilege leakage | Verified | Real signed NextAuth identity retained; central session resolution plus proxy form pin. `testing-sessions`, `testing-mode`, ordinary/simulator role tests deny writer/editor/growth escalation. |
| Allowed verified personas, denied ineligible administrators | Verified | Tests refuse anonymous, ordinary, unverified, inactive, banned and demoted initiators; wrong-role/unverified/inactive/banned personas; arbitrary IDs/roles, wrong/missing Origin, forged, expired and revoked capabilities. |
| Entry/switch/exit/expiry/refresh/history/multiple tabs | Verified in development and production | Shared session across tabs; BroadcastChannel refresh, page identity checks and 409 on stale forms. No real account/card/password changes. Concurrency test leaves one usable capability. |
| Same writer/editor workflow handlers and ownership | Verified | The same workflow specs run as ordinary logins and simulator personas. Explicit parity tests compare validation, IDs, persistence, own/other writer records, assigned/unassigned editor scope and denials. |
| Isolated database/storage/mail/notifications | Verified locally and hosted | Local PostgreSQL/storage/JSONL capture; hosted restricted database role, dedicated Supabase storage and private `testing_email_outbox`. Hosted final journey captured 8 emails and 8 notifications. No production resource substitution. |
| Hosted interactive workspace | Implemented; representative journeys verified | `https://consilium-testing.vercel.app/admin/testing`, Supabase `zrieajoqosgzyesfatta`. Ordinary and simulated writer/editor/growth, real media/profile uploads, public articles, stale-form denial and unchanged ADMIN chief passed. Hosted expiry/job-clock/failure matrix and every toolbar control were not repeated remotely; covered locally. |
| Test publication on public pages; no production distribution | Verified locally | Normal publication/scheduler handlers render local public article. Isolation keeps test records/files out of production public listings, analytics, leaderboards, mail and indexes. No production-side test publication attempted. |
| Writer metadata, rich text, drafts/autosave/submission | Verified | `wf-formatting`, `wf-lifecycle`, `wf-failures`, `wf-upload`, `wf-controls`: actual UI inputs, real TipTap, persisted JSON, reload, review preview, publication. |
| Every implemented formatting/media control | Verified with confirmed public house style | Bold/italic/underline/strike, headings via typing shortcuts, lists/indent, links, quotes/code, undo/redo, alignment, colours/highlight, all spacing options, figure/caption/credit, tables/add/delete, footnotes/edit/remove, paste, counts, theme. Draft retains formatting. At the owner’s explicit confirmation, public rendering keeps the existing house style: alignment, colour and spacing remain in draft/review content, while semantic formatting and media survive publication. No heading/font-size toolbar exists. |
| Profile save/reload/upload/replace/remove; rejected files | Verified | Normal member, assigned ADMIN and simulated persona; actual local storage client, invalid bytes/oversize, missing bucket/storage/database failure, old photo retained and newly orphaned upload cleaned. |
| Editor review, feedback, revisions, comments and scope | Verified | Internal note, required feedback, return/revision/resubmit, anchored comment/reply/resolve/reopen/reload; assigned Opinion editor and unassigned global editor compared to ordinary logins. |
| Publication/scheduling within actual permissions | Verified | Real global editor can publish/schedule; writer/growth cannot. Local deterministic due-time fixture + authenticated scheduler job, public/private transitions and persisted status; no live cron wait. |
| Growth UI and parity | Verified | All six analytics tabs, four periods, writer sorts, subscriber matching/no-match and CSV download, engagement/activity, profile; identical ordinary/persona access and editorial/admin denials. |
| Failure resilience and useful errors | Verified | Slow/failed saves/uploads, 400/401/403/409/500, revoked/expired sessions, duplicate clicks, concurrent save/edit, preserved last saved content, failed publish remains private, Back preserves editor when save fails. |
| Audit without secrets | Verified | Initiator/persona/session lifecycle plus mutation path/method/outcome; failed and denied actions included. No passwords/cookies/bodies/file bytes in audit. |
| Repeatable scoped fixtures and concurrent runs | Verified | Guarded TEST_DATABASE_URL source, local-only services and base URL checks, per-DB advisory lease, generated record IDs/prefix cleanup, transactional conflict-refusing persona seed. Two repeated real seed invocations preserve IDs, passwords and every public card; mismatched markers change no persona. Existing safeguards not weakened. |
| Fresh/upgrade migration, deterministic reviewed backfill | Verified locally | Two additive migration integration tests: populated previous schema and empty previous schema, repeat SQL, original identity/media/ownership/order preservation, uniqueness and session RLS. Fresh Prisma DB setup also ran. Backfill preview/ambiguity/idempotence unit checks; production preview requires only legacy Lucas tier snapshot, no Alexander update. |
| Deployment health and read-only smoke | Implemented; verified locally and hosted | Missing schema/buckets/storage configuration fails visibly. Local pages and hosted authorized health API passed, no schema/storage gaps; hosted no-index headers/robots passed. Production schema/application release and its post-deploy smoke remain outside this run. |
| CI automatic profile/mode/critical role suites | Implemented; role job verified remotely | CI uses local PostgreSQL/storage/captured mail, retries 0. Run `37238109672`: critical roles/profile/mode job **353 passed**; verify job passed; public job exposed the documented navigation interruption now corrected and passing locally. Latest source status is in PR checks and [final CI evidence](./evidence/final-ci.json). |

## Control checklist and inventory

[coverage-inventory.md](./coverage-inventory.md) records expected behavior and named tests per implemented control. [control-inventory.json](./control-inventory.json) inventories page routes, imported controls, conditional/dynamic control families, native dialogs and source guards. It is an inspection census: candidate label matches are **not** proof of browser coverage. Rendered role snapshots are in `docs/testing/evidence/controls/chromium/{writer,editor,growth,admin,reader}.json` from `wf-roles`.

| Journey/control group | Expected behavior | Automated coverage | Observed result |
|---|---|---|---|
| Writer dashboard/articles/drafts/sidebar | Own records and role menu, denied admin/review/publish | `wf-roles`, `wf-lifecycle`, `testing-mode` | Passing ordinary and simulated Chromium |
| Metadata, rich text and every toolbar dropdown | Persist title/category/tags/excerpt/body; no lost edits | `wf-formatting`, `wf-controls`, `wf-upload` | Passing ordinary/simulated Chromium and ordinary WebKit |
| Save/autosave/reload/preview/public | Correct status and retained formatting/media | `wf-formatting`, `wf-lifecycle`, `wf-failures` | Passing; the owner confirmed public presentation normalization, with semantic formatting/media retained |
| Feedback, anchored comments, revision/resubmit | Feedback/comment persistence; writer resubmission visible to editor | `wf-lifecycle`, `editor-scope`, `publication-lifecycle` | Passing |
| Editor document settings and review decisions | Actual allowed author/slug/status/edit/publish/schedule controls | `wf-controls`, `wf-lifecycle`, `testing-mode` | Passing; Review button used rather than assumed Actions menu |
| Correction/feature/pin/commendation | Persist, reload, show public correction | `wf-controls` | Passing |
| Profile and all photo controls | Stable card/ownership/appointment, old data survives failure | `team-profile`, `testing-mode`, integration storage/DB | Passing |
| Growth tabs/period/sorts/subscribers/export | Existing permissions and actual CSV result | `testing-mode`, `wf-roles` | Passing ordinary and simulated Chromium |
| Testing banner/persona buttons/Exit | Server identity, no elevated persona privileges, shared tabs | `testing-mode`, `testing-sessions` | All seven mode journeys passed in final development and production runs |

Real OS print-dialog output is **not tested** (`window.print` invocation is tested). Notification persistence and captured mail are verified; clicking every notification bell item is not part of the passing selection. Unrelated legacy/admin/reader controls listed in the source census without matching recorded test evidence remain **not tested** by this change.

## Commands and counts

These selections overlap; do not add their counts together. Earlier failed runs remain documented below, with their causes and subsequent passing checks.

| Final check | Result | Evidence |
|---|---|---|
| Unit/integration, standalone and real-server development | 69 files; 956 passed, 7 pre-existing expected failures, 18 pre-existing skips; 0 unexpected failures | `evidence/vitest-final.json`; `next-e2e-3342-4991/vitest.json` |
| Development profile and testing-mode browser suites | 55 passed; 0 failed/skipped; retries 0 | `next-e2e-3342-4991` |
| Production ADMIN chief photo round-trip and mode journeys | 14 passed; 0 failed/skipped; retries 0 | `next-e2e-3340-8129` |
| Ordinary/simulator Chromium and WebKit role menus | 18 passed; 0 failed/skipped; retries 0 | `next-e2e-3340-84570` |
| Rich text, editor controls, revisions and publication | All pictured and named journey checks passed; selection overall 152 passed/1 transport failure, subsequently corrected and verified above | `next-e2e-3340-72395` |
| Typecheck, lint, production build with testing disabled | Passed | Final typecheck/lint exit 0; `disabled-build-9220/build.log` |
| Local schema/storage gate and read-only page smoke | Healthy, no gaps; 4/4 HTTP 200 | `evidence/appointments-mode/local-readiness-smoke-final.json` |
| Hosted isolated workspace / GitHub CI / production post-deploy smoke | Blocked / not executed / not executed | No production deployment performed |

Commands below ran from the repository root. Local PostgreSQL was provisioned with `PGPORT=55435 PGDATA=/tmp/consilium-appointments-pg PGSOCK=/tmp npm run test:setup-db`. Separate browser/dev databases were created with `/opt/homebrew/opt/postgresql@16/bin/createdb -h localhost -p 55435 -U postgres <name>`, then initialized with `TEST_DATABASE_URL=postgresql://postgres@localhost:55435/<name> USE_EXISTING_DB=1 npm run test:setup-db`. Setup never read production credentials as its target.

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm test -- --reporter=default --reporter=json --outputFile=/Users/zanie/The-Consilium/docs/testing/evidence/vitest-final.json
npm run typecheck
npm run lint
```

Final unit/integration output: **69 files passed; 956 passed, 7 expected failures, 18 skipped, 0 unexpected failures** (981 cases). The seven expected failures are pre-existing content-filter cases, not newly hidden regressions. The eighteen pre-existing explicitly skipped API cases require dedicated live auth/storage/reset fixtures. Also, some legacy live tests return without assertions when no server runs; this standalone count is not live HTTP evidence. A separate `RUN_VITEST=1` development run reached the real server (`api.test`, `api-audit`, calendar) and local storage. New profile/session/migration checks run without skips.

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3340 FAKE_STORAGE_PORT=55423 EMAIL_CAPTURE_FILE=/tmp/consilium-appointments-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- --project=wf-chromium --project=simulator-chromium --project=editor --project=lifecycle --project=team-profile --project=testing-mode --workers=1
```

`test-results/next-e2e-3340-44439`: **236 passed, 0 failed, 0 skipped, retries 0**. Launcher readiness, isolated production build and real app startup passed. This selection includes ordinary and simulated writer/editor success and denied actions, failure resilience, scope/publication lifecycle, profile/masthead and mode parity. Later banner/history/observer changes were followed by focused checks, below.

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3340 FAKE_STORAGE_PORT=55423 EMAIL_CAPTURE_FILE=/tmp/consilium-appointments-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/wf-formatting.spec.ts tests/e2e/wf-lifecycle.spec.ts tests/e2e/wf-controls.spec.ts --project=wf-webkit --workers=1
```

`test-results/next-e2e-3340-1009`: **23 passed, 0 failed, 0 skipped, retries 0** (six auth setup + seventeen workflow tests), including all formatting controls, persisted/reloaded media, review preview, revisions, scheduling, publication and document settings. Earlier `93149` had **60 passed, 2 failed, 5 not run**: publication refresh overlapped immediate navigation, and the banner observer caused a WebKit loop error. Both root causes were fixed and their failing checks passed in `1009`; no error suppression or retry was added.

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm run test:build-disabled
DIRECT_URL=postgresql://postgres@localhost:55435/consilium_appointments_dev_final NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55425 SUPABASE_SERVICE_ROLE_KEY=local-service-key SMOKE_BASE_URL=http://localhost:3342 npm run check:deployment
```

Testing-disabled production build: **passed**, `test-results/disabled-build-11943/build.log` (subsequent final builds recorded below). Read-only local smoke: **healthy, no gaps**; `/`, `/team`, `/api/team`, `/editorial/login` all **200**. Production smoke remains pending separate deployment.

Development `31713`: **55 passed, 0 failed, 0 skipped, retries 0**; its real-server Vitest run passed all **68 files, 947 passing, 7 expected fail, 18 skipped**, including live API/calendar/storage checks. Two additional CSS/attribute security regression checks were subsequently added; public rendering retains the owner-confirmed house style.

Production `21911`: **235 passed, 1 failed, 0 skipped**, retries 0. The editor denied-page test exhausted its deadline waiting for unrelated notification traffic to become idle; actual denied responses were prompt. The check now waits for the actual redirected URL or access-denied content, preserving all permission assertions. Final production/WebKit follow-up results appear below. Earlier full follow-up `10063`: **226 passed, 4 failed, 6 not run**, retries 0. Root causes: an early history reload closed the production RSC connection (limited the guard to development, retaining production's hydrated identity checks); the refresh waiter relied on a request-header representation unavailable in Chromium (now waits for the real `_rsc` response URL); one menu traversal timed out while concurrent cold development compilation saturated the machine. These failures were retained and final browser runs were serialized. Development `9528` had **48 passed, 1 failed, 6 not run** because distinct retained accounts shared a display name; uniqueness now asserts card IDs and unchanged exact fixture appearances. Development `12332` had **48 passed, 2 failed, 5 not run**, plus a cold calendar unit/live timeout: anonymous focus redirection interrupted sign-up, and a cold growth compilation exceeded its request deadline. Anonymous pages now let the normal auth flow choose its destination; the cold calendar check retains all permission/content assertions with a 15-second development compile budget. No retry or console-error suppression was introduced.

Additional follow-ups retained without retries: `35164` 235 passed/1 menu-idle timeout; `60107` 137 passed/16 failed (incorrect hydration selector plus a scheduling refresh race); `63493` 133 passed/10 failed/10 not run (entry readiness and WebKit navigation cancellation); `67237` and `69290` each 149 passed/4 failed (WebKit menu hard-navigation cancellations). The selector now observes real banner hydration, scheduling reload awaits the server-derived status prop, authenticated sidebar prefetch is disabled, and menu journeys exercise actual Link controls. Console-error assertions remain enabled. The final confirmed-house-style selection is recorded below.

A concurrent unit follow-up had 68 passing files/1 failed storage startup hook, 946 passed/7 expected failures/28 skipped. The real local storage process exceeded its ten-second startup deadline while the production build and type/lint checks were concurrent. Its JSON is retained as `evidence/vitest-concurrent-storage-startup-failure.json`; final checks run serially with unchanged assertions.

Confirmed-house-style final journey selection:

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3340 FAKE_STORAGE_PORT=55423 EMAIL_CAPTURE_FILE=/tmp/consilium-appointments-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/wf-roles.spec.ts tests/e2e/wf-formatting.spec.ts tests/e2e/wf-lifecycle.spec.ts tests/e2e/wf-controls.spec.ts --project=wf-chromium --project=simulator-chromium --project=wf-webkit --workers=1
```

`72395`: **152 passed, 1 failed, 0 skipped, retries 0**. All ordinary/simulated rich-text, editor-control and revision/publication checks passed, as did all WebKit role menus with zero collected application console errors. One auxiliary Node HTTP request in the ordinary growth menu failed with `ECONNRESET`; its dashboard was rendered and subsequent requests/server remained healthy. The menu check now consumes its HTTP response through the same authenticated browser transport before clicking the real Link. Its HTTP 200, exact URL, heading and console assertions are unchanged. This transport correction is verified by the focused menu selection below; no test retries were added.

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3340 FAKE_STORAGE_PORT=55423 EMAIL_CAPTURE_FILE=/tmp/consilium-appointments-outbox.jsonl SKIP_DB_SETUP=1 E2E_INVENTORY_DIR=/Users/zanie/The-Consilium/docs/testing/evidence/controls npm run test:e2e -- tests/e2e/wf-roles.spec.ts --grep 'every menu entry opens' --project=wf-chromium --project=simulator-chromium --project=wf-webkit --workers=1
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_dev_final E2E_APP_PORT=3342 FAKE_STORAGE_PORT=55425 EMAIL_CAPTURE_FILE=/tmp/consilium-dev-final-outbox.jsonl TEST_WORKSPACE_DEV=1 RUN_VITEST=1 SKIP_DB_SETUP=1 npm run test:e2e -- --project=team-profile --project=testing-mode --workers=1
```

The serial final unit/integration command above passed: **69 files, 956 passing cases, 7 pre-existing expected failures, 18 pre-existing skips, 0 unexpected failures**; the formerly timed-out real storage suite passed all ten checks with unchanged assertions.

Focused menu run `78518`: **16 passed, 2 failed, 0 skipped, retries 0**. The two failures exhausted the 30-second budget while traversing/recording 12–18 screens (one on the final Your Readers page); later inspection distinguished the separate trace-export budget below; the ordinary growth transport correction passed. One timed-out trace was truncated during teardown and is not used as passing evidence. The multi-screen test now has a 120-second aggregate budget, while each HTTP read, action and expectation remains bounded at ten seconds. Final focused results follow this correction.

Focused run `80705`: **17 passed, 1 failed, 0 skipped, retries 0**. The simulator editor completed all HTTP/URL/heading/console assertions and then exceeded Playwright's separate **project** 30-second trace-export limit. Installed `workerProcessEntry.js` creates its final tracing slot from `project.timeout`, independently of `test.setTimeout`. The two trace-on simulator projects now have a 120-second project budget; complete snapshots/network traces and ten-second control/HTTP assertions are retained. `wf-roles` also releases its database pool and deletes only its tracked generated administrator IDs after the file, preserving other runs.

Final focused menus `84570`: **18 passed, 0 failed, 0 skipped, retries 0**. Every ordinary/simulated role menu passed Chromium/WebKit HTTP 200, exact route, heading/editor readiness and collected application console checks. All four passing simulator menu trace ZIPs were integrity-validated; paths are in `evidence/appointments-mode/validated-menu-traces.json`. The recorded control inventory was refreshed from this passing run.

Development `85499`: live regression **69 files/956 passed/7 expected failures/18 pre-existing skips**, then browser **48 passed/1 failed/6 not run**, retries 0. The entry/history test stalled alongside a two-minute dashboard request and a 2.6-minute Turbopack filesystem-cache flush/compaction, then its navigation aborted at the test deadline. Isolated development now disables persistent Turbopack filesystem caching (fresh run directories never reuse it); ordinary development keeps Next's default. Mode tests additionally await the current persona's canonical route, hydrated enabled controls and measured banner before the next action, rather than treating an SSR label as navigation completion. The subsequent final run records actual results below.

Final development `4991`: **55 browser passed, 0 failed, 0 skipped, retries 0**; real-server regression **69 files/956 passed/7 pre-existing expected failures/18 pre-existing skips/0 unexpected failures**. The entry/history/multiple-tabs test passed in 10.7 seconds; expiry/replay, Origin/target denial, writer ownership/validation, editor assignment boundaries, growth UI parity and persona photo failures all passed. The ADMIN chief photo upload/replace/remove/restore test passed with unchanged account role, original card ID/ownership/appointment/order and no captured console errors. Chief screenshots were subsequently refreshed from final production run `8129`.

A read-only smoke invocation immediately after this run passed schema/storage readiness but correctly failed its HTTP phase because the launcher had already stopped the server. It is not counted as a passing page smoke; final smoke runs against a persistent workspace below.

Final production mode/chief selection:

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3340 FAKE_STORAGE_PORT=55423 EMAIL_CAPTURE_FILE=/tmp/consilium-appointments-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/team-profile.spec.ts tests/e2e/testing-mode.spec.ts --grep 'the ADMIN owner edits|testing-mode' --project=team-profile --project=testing-mode --workers=1
```

`8129`: **14 passed, 0 failed, 0 skipped, retries 0** (six authentication setup, seven mode journeys and the ADMIN chief biography/photo round-trip). All seven mode trace ZIPs passed integrity validation; paths are in `evidence/appointments-mode/validated-mode-traces.json`. The preceding selection `7172` had **13 passed, 1 failed, 1 not run**: the broad case-insensitive `ADMIN owner` filter also selected a serial duplicate-ownership test whose prerequisite writer-card creation was omitted. The correctly unowned writer was allowed to link, contrary to that test's prerequisite-dependent expected conflict. The precise selection above fixes the selection error without changing assertions. The next scoped fixture reset removed that test card; a final read-only query confirmed its absence.

Final `npm run typecheck` and `npm run lint` both exited **0**. A preceding typecheck found one new photo helper array typed as `number[]` rather than a three-number tuple; the explicit tuple annotation fixed it. `TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm run test:build-disabled` passed; final log `test-results/disabled-build-9220/build.log`. Build logs include Next's `DYNAMIC_SERVER_USAGE` messages during static probing of authenticated pages; inspected output marks these routes dynamic and completes successfully. The final mode server log contains no unexpected error/500 entries; controlled failure cases retain their expected assertions and useful error messages.

The independently authenticated local workspace was then left running with:

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_dev_final E2E_APP_PORT=3342 FAKE_STORAGE_PORT=55425 EMAIL_CAPTURE_FILE=/tmp/consilium-dev-final-outbox.jsonl TEST_WORKSPACE_DEV=1 SKIP_DB_SETUP=1 npm run testing:workspace
DIRECT_URL=postgresql://postgres@localhost:55435/consilium_appointments_dev_final NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55425 SUPABASE_SERVICE_ROLE_KEY=local-service-key SMOKE_BASE_URL=http://localhost:3342 npm run check:deployment
```

Final smoke: **exit 0, healthy true, gaps empty; `/`, `/team`, `/api/team`, `/editorial/login` each HTTP 200**. Local review entry: `http://localhost:3342/admin/testing`; storage `http://127.0.0.1:55425`; mail `/tmp/consilium-dev-final-outbox.jsonl`; logs `test-results/next-e2e-3342-10206/server.log`. Sign in independently with the fixture administrator documented in the operating guide. This is an ephemeral local workspace, not a hosted deployment. Its database lease correctly prevents a concurrent fixture run from resetting its records.

## Screenshots and traces

Artifacts are retained locally under ignored `test-results/` and `docs/testing/evidence/`; CI uploads its own artifacts. They are generated evidence, not committed application assets.

- Leading assigned ADMIN chief: [viewport](./evidence/appointments-mode/admin-owned-leading-chief.png) and [card crop](./evidence/appointments-mode/admin-owned-chief-card.png). The account is a local fixture, not Alexander's production login.
- Ordinary journey: [saved draft](./evidence/appointments-mode/wf-chromium-writer-saved-draft.png), [editor review](./evidence/appointments-mode/wf-chromium-editor-submitted-review.png), [published revision](./evidence/appointments-mode/wf-chromium-public-revised-article.png), [formatting/media](./evidence/appointments-mode/wf-chromium-public-formatting-media.png).
- Simulator journey: [saved draft](./evidence/appointments-mode/simulator-chromium-writer-saved-draft.png), [editor review](./evidence/appointments-mode/simulator-chromium-editor-submitted-review.png), [published revision](./evidence/appointments-mode/simulator-chromium-public-revised-article.png), [formatting/media](./evidence/appointments-mode/simulator-chromium-public-formatting-media.png). [Provenance](./evidence/appointments-mode/provenance.json) identifies each source run. Screenshot provenance identifies the independently passing journey checks.
- Passing simulator workflows retain `trace.zip`; open with `npx playwright show-trace <path>`. They show real UI actions/network responses, not manufactured workflow success.
- Server/build logs and the exact Playwright JSON report are retained per run. Intentional controlled failure requests are distinguishable from unexpected application/console errors. Public external ticker throttling is unrelated to the isolated publication handlers; it is not used as journey success evidence.

Production's original row, ownership and photo/description presence were independently read-verified. The newly implemented ADMIN masthead cannot be shown on production until the additive schema and code are separately deployed. Hosted simulator verification uses a dedicated fixture administrator, not Alexander's production identity.


## Continuation: hosted provisioning and CI (4 October 2026)

- Reviewable stacked draft [PR #112](https://github.com/Zanie567/The-Consilium/pull/112) contains feature changes over the saved prerequisite branch. The unrelated workflow edits are preserved; PR #111 remains separate and must be reconciled before merging to main.
- First [GitHub CI run 37233952681](https://github.com/Zanie567/The-Consilium/actions/runs/37233952681): verification job passed. Browser phases: main **82 pass / 2 fail**, workflow **291 pass / 1 fail**, profiles **42 pass / 0 fail**; **415 pass / 3 fail / 0 flaky** overall. Raw report/trace artifacts were downloaded to `/tmp/consilium-ci-37233952681-artifacts`. CI is not claimed green.
- Investigated the stalled-save WebKit trace: editor remained `Saving...` beyond the deadline with typed content intact. `apiRequest` now enforces its deadline independently of transport cancellation, including stalled response bodies. A focused unit test covers a transport that ignores abort, with no automatic retry. Development browser follow-up (`next-e2e-3347-30340`): **9 pass / 0 fail** (six ordinary login setup checks plus ordinary Chromium/WebKit and simulated-writer stalled-save recovery). Existing assertions and zero retries remain.
- The footnote trace's one-pixel page-height difference matches the implemented navbar border changing from 2px to 1px after scroll. The test now waits for that real layout change before measuring the marker; its exact no-layout-shift assertions remain. Rapid-navigation WebKit fetch errors remain under investigation rather than filtered from console collection.
- Focused hosted/configuration/mail/timeout unit run: **5 files / 67 pass / 0 fail**. Typecheck and lint passed after the new changes. The full production browser/live-integration follow-up is running in independent local resources (`next-e2e-3348-32815`), not the interactive review database.
- User-approved hosted Supabase `zrieajoqosgzyesfatta`: fresh 37-table application schema, private captured-email table, six verified personas, two realistic review records, real editor assignment and explicit generic admin-owned chief card. Zero public tables without RLS. Storage API verified **200**, buckets `avatars` and `article-images`. Database connected successfully as its restricted app role with strict certificate/hostname verification. `check:deployment` **healthy true / gaps []**, and production build with hosted configuration **pass**.
- Vercel project `consilium-testing` and private mirror repository were created. Deployment `dpl_B8jgnjEYNf9hT3wSaqXjoYMbm37D` reached READY from mirror commit `6859d08`, serving `https://consilium-testing.vercel.app`. Test-only credential transfer was explicitly approved; 16 variables were saved there only, five as secrets. Hosted journey results follow; production remains untouched.
- The first fixture-plan attempt failed on the wrong `description` column and rolled back atomically; corrected to actual `bio`, then applied successfully. The initial strict TLS probe failed without the vendor CA; the CA was downloaded from the test project's Database Settings, and strict TLS then passed. No insecure TLS fallback was introduced. Vercel connector creation lacked permission; the authenticated dashboard created only the separate test project.

- Follow-up full standalone Vitest: **70 files / 983 pass / 7 existing expected fail / 18 existing skip / 0 unexpected fail**. First standalone attempt exposed a storage fixture hook whose 10-second limit was shorter than its existing 20-second startup loop. The fixture now launches ts-node directly, checks early process exit/HTTP readiness and has a bounded 30-second setup deadline. Focused storage follow-up: **10 pass / 0 fail**. It does not relax any storage/ownership assertions.
- Hosted-focused follow-up before the bucket reproducibility addition: **5 files / 68 pass / 0 fail**. Production-browser `next-e2e-3348-32815`: main **83 pass / 1 fail**, workflow **292 pass / 0 fail**, profiles **42 pass / 0 fail**; **417 pass / 1 fail / 0 flaky**. All seven footnote controls passed both engines. The failed navigation test replaced documents during hydration/prefetch and swallowed click failures. It now completes each document/client transition, checks the target and Back URL, preserves both error assertions, and has a 90-second aggregate budget for twelve navigations. No console errors were filtered and no retries added. Its first cold-development follow-up had **1 pass / 1 timeout** at the old 30-second aggregate budget. Final full public production selection passed **32 / 0 fail** in Chromium/WebKit (`next-e2e-3349-52641`).


## Final continuation checks

The additional committed hosted-bucket reproducibility change (`b32872f`) was inspected and preserved. The operator plan now also refuses conflicting chief ownership and retains insert/read-only mail-sink grants on repetition. Reapplying the guarded setup to the verified test project preserved six users/credentials (checksum `21cbd9980b97ef7ad32c454417550833`) and its one ADMIN chief card (checksum `2021eae99c1a62e38f5c87bcba2b67b7`). No production migration was applied.

Exact commands and recorded outcomes:

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm test
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser RUN_VITEST=1 E2E_APP_PORT=3348 FAKE_STORAGE_PORT=55428 EMAIL_CAPTURE_FILE=/tmp/consilium-continuation-prod-outbox.jsonl npm run test:e2e
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3349 FAKE_STORAGE_PORT=55429 EMAIL_CAPTURE_FILE=/tmp/consilium-navigation-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/public.spec.ts --project=public --project=public-webkit --workers=1
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3350 FAKE_STORAGE_PORT=55430 EMAIL_CAPTURE_FILE=/tmp/consilium-role-denial-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/wf-roles.spec.ts --grep 'sensitive endpoints refuse' --project=wf-chromium --project=wf-webkit --project=simulator-chromium --workers=1
HOSTED_TEST_ENV_FILE=/tmp/consilium-hosted-testing-plan/environment.private.json HOSTED_TEST_SECRETS_FILE=/tmp/consilium-hosted-workspace.private.json HOSTED_TEST_EVIDENCE_DIRECTORY=/Users/zanie/The-Consilium/docs/testing/evidence/hosted-verified npx ts-node -P tsconfig.seed.json scripts/verify-hosted-testing.ts
npm run typecheck
npm run lint
```

- Latest standalone Vitest: **70 files, 986 passing cases, 7 existing expected failures, 18 existing skips, 0 unexpected failures** (`/tmp/consilium-latest-vitest.log`). Live-server follow-up: **70 files, 982 passing cases, 7 expected failures, 18 skips, 0 unexpected failures** (snapshot before later configuration/bucket cases). Both production browser builds passed. Latest typecheck/lint passed.
- Strengthened denied-role suite: **57 pass / 0 fail**, including six ordinary logins and 51 role checks across ordinary Chromium/WebKit and simulator Chromium. It now uses the implemented `GET /api/admin/users` and accepts only 401/403; a nonexistent POST/405 no longer counts as permission evidence.
- CI run [37238109672](https://github.com/Zanie567/The-Consilium/actions/runs/37238109672): critical job **353 pass / 0 fail**, verify job passed, public/mobile job **64 pass / 1 fail** at the subsequently corrected navigation check. New source is submitted for the full gate; consult PR checks and the final CI evidence JSON for that run rather than counting the earlier run as green.
- A direct Playwright invocation lacking isolated-service attestations was refused before execution, confirming the guards remain active. Supported follow-ups used `scripts/run-e2e.sh`; no hosted URL was allowed through the automated harness.
- Hosted final smoke: **10 verification groups pass / 0 fail**, real ordinary/simulated writer → editor return → revision/resubmission → publication, category/ownership denial, growth, bio/photo upload/reload/removal, stale form/exit, ADMIN card/credential preservation and no collected application console/page errors. **8 captured emails / 8 notification rows**, only test recipients. [Result and public URLs](./evidence/hosted-verified/result.json). Four earlier smoke-script attempts stopped on probe mistakes (unimplemented endpoint/method, public-body selector, and create-versus-update HTTP status); actual handlers were inspected and assertions corrected, without retries or fabricated success. Generated records were preserved for review.

Hosted screenshots: [leading ADMIN chief](./evidence/hosted-verified/admin-owned-leading-chief.png), [ordinary draft](./evidence/hosted-verified/ordinary-writer-draft.png), [ordinary review](./evidence/hosted-verified/ordinary-editor-review.png), [ordinary publication](./evidence/hosted-verified/ordinary-public-article.png), [simulated draft](./evidence/hosted-verified/simulated-writer-draft.png), [simulated review](./evidence/hosted-verified/simulated-editor-review.png), [simulated publication](./evidence/hosted-verified/simulated-public-article.png), [simulated profile/photo](./evidence/hosted-verified/simulated-team-profile.png), [simulated growth](./evidence/hosted-verified/simulated-growth.png). These use dedicated test identities, not production accounts. Local complete workflow trace links remain above.

Remaining limits: production release/backfill/post-deployment smoke were intentionally not performed; PR #111 and the saved prerequisite changes require release reconciliation; Firefox/real Safari are not verified; the full failure/scheduling/control matrix is local, with representative hosted parity. Secrets stay in protected operator files/Vercel Secret storage and are absent from Git, evidence and URLs.


## Final audit follow-up

The public author page still mapped every ADMIN to Editor-in-Chief. That blanket permission-derived label has been removed. It now reads the unique owned, active public appointment and the real account’s suspension/ban flags; no visible appointment yields Contributor. Website-role changes cannot alter the label. Public author lookup no longer selects website permissions or email for display. Six focused unit cases and the real author-page regression cover role changes, explicit title changes, hidden appointments and unappointed administrators. The role changes use a separate Mira fixture; Alexander’s production permissions are never changed.

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm test
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3351 FAKE_STORAGE_PORT=55431 EMAIL_CAPTURE_FILE=/tmp/consilium-author-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/team-profile.spec.ts --project=team-profile --workers=1
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_appointments_browser E2E_APP_PORT=3352 FAKE_STORAGE_PORT=55432 EMAIL_CAPTURE_FILE=/tmp/consilium-public-final-outbox.jsonl SKIP_DB_SETUP=1 npm run test:e2e -- tests/e2e/public.spec.ts --project=public --project=public-webkit --workers=1
npx ts-node -P tsconfig.seed.json scripts/build-workflow-inventory.ts
npm run typecheck
npm run lint
```

- Latest full standalone: **70 files / 992 pass / 7 existing expected fail / 18 existing skip / 0 unexpected fail** (`/tmp/consilium-author-vitest.log`). Focused appointment unit selection **47 pass**. Production-build profile selection **38 pass / 0 fail** (`next-e2e-3351-59011`); final public selection **32 pass / 0 fail** (`next-e2e-3352-60369`); typecheck/lint passed. Source control census regenerated.
- CI `37239866629` exposed one further test-locator fault (**64 pass / 1 fail** in public/mobile): the raw nth-anchor selected an inactive, inert hero slide after Back. The downloaded trace showed all category navigations succeed, then a click on the noninteractive Small Sample anchor without any article navigation. The test now selects accessible links and hovers to pause the carousel using its actual implemented behavior, before reading/clicking the target. Assertions remain strict; no retry, timer override, forced click or console suppression. New source is submitted for the full CI gate; current evidence is in `evidence/final-ci.json`.
- Read-only HTTPS WebKit smoke on the redeployed test origin: **4 pages pass / 0 fail / no collected errors**, including both actual published journey articles, loaded image pixels, house-style normalization and one leading ADMIN chief. [Evidence](./evidence/hosted-verified/webkit-public-smoke.json). This is WebKit automation, not a claim of real Safari or every hosted workflow control.
- The publication project’s automatic feature preview remains **blocked**: deployment `dpl_HacWRuV8AbuW4otc8s1VUxJ3tBDR` failed visibly because its Preview environment lacks `NEXTAUTH_SECRET`. Its build/type compilation completed before the explicit configuration guard failed. No production/project preview credentials were added or substituted. The approved separate test project built and deployed successfully. This external Vercel status is distinguished from application CI and the isolated hosted workspace.
