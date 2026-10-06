# Final integration and release-readiness report

Independent final audit on 2026-10-06, against original [MASTER-SPEC.md](MASTER-SPEC.md) and specialist candidate `72c9231`. The [fresh requirement ledger](MASTER-STATUS.md) is authoritative for verification status. The [specialist report](SPECIALIST-IMPLEMENTATION-REPORT.md) and [earlier handoff](SPECIALIST-HANDOFF-STATUS.md) are retained as historical evidence, not proof.

**Recommendation: ready for PR review of this local integrated candidate; not cleared for production release.** No push, merge, deployment, production database query/migration or production data change occurred.

## 1. Implementation and integration summary

The intended final branch already contained the entire specialist candidate when inspected. `/private/tmp/consilium-final-integration` was on `feature/consilium-platform-upgrade` at `72c9231`, identical to the clean `/Users/zanie/The-Consilium-upgrade` worktree on `feature/consilium-upgrade-six-workstreams`. Reusing this final tree preserved ancestry and avoided duplicate cherry-picks. The dirty original checkout was not reset, stashed, checked out or modified.

Read every specialist status file, MASTER-SPEC, schema, new migrations, implementation report, shared route/editor/rendering/role/cache/analytics paths, marker inventory, untracked files and commit history. All six workstreams are present. New application code remains within the upgrade and publication safety boundaries; no six-workstream reimplementation or redesign.

Independently reproduced and repaired:

1. **Silent table truncation:** public renderer discarded rows after 500 and cells after 100. Unit red probe and real 501-row/101-column writer/public workflow now preserve all content.
2. **Concurrent review/submission:** eight requests could commit multiple approvals/submissions and duplicate notifications. Atomic source-state/revision predicates now allow one successful transition; losing requests return structured conflicts or existing invalid-status errors.
3. **Stale open editor:** a second tab could overwrite a newer save. The UI carries the fetched/saved revision; API checks it and still rechecks the authorized row atomically. Conflict retains unsaved text rather than silently reloading it away.
4. **Scheduled trash/purge races:** a due snapshot could publish a subsequently trashed article, and automatic expiry could strand managed assets with no cleanup eligibility. Current revision/trash state is rechecked; deletion and queue eligibility commit together. Queue failure rolls deletion back; restored snapshot is skipped. Save/delete paths acquire canonical image locks before article-row writes.
5. **Storage failure after permanent deletion:** cleanup is queued before the best-effort removal, leaving a collectible retry record if Storage is unavailable.
6. **Legacy subscriber whitespace:** PostgreSQL space-only trim did not match JS trimming tabs/newlines/NBSP/BOM. Revised the unreleased migration/function/index and route lookup. Historical collisions still fail preflight without rewriting/deleting subscribers.
7. **Off-screen settings controls:** closed mobile drawer left duplicate desktop fields and keyboard targets. Closed drawer unmounts; visible fields have names; mobile settings trap focus, close on Escape, and return focus to the opener.
8. **Analytics vs editorial revisions:** Prisma view-counter/derived-score writes advanced Article.updatedAt, creating false save/review conflicts and false dateModified updates. Parameterized atomic metric writes now preserve editorial revisions. The complete browser suite initially exposed an unpublish conflict; it was investigated and repaired, not labelled pre-existing.
9. **Reduced-motion invisible content:** server motion markup hydrated as plain divs and retained opacity:0. Bounding-box visibility tests missed this. Stable motion markup now reveals content immediately without animation under reduced motion. New ancestor-opacity/title/body/card and hydration checks prove it.
10. **Misleading legacy debate ratio:** lifetime votes were divided by period article views, labelled as a percentage of site views. Original `68b26e8` code confirms its provenance. Period filtering and the label now agree: votes per 100 article views in the selected period, not a reader-conversion percentage.
11. **False green offline integration:** live/data/profile/read-through suites could return early or conditionally skip on missing prerequisites. They now fail setup/collection for missing services, required logins or fixtures. Production env files are not loaded by the DB suites. A deliberate offline probe exits 1 before exercising cases.
12. **Desktop editor clipping:** the non-shrinking document plus metadata sidebar exceeded the content pane, placing the headline behind the navigation and metadata beyond the viewport. The document now flexes within the pane. Actual headline/format-field bounds are asserted at 375/768/1280/1440, rather than relying on the page-level scrollbar alone.
13. **Autosave acknowledgement lost on navigation:** the final full suite exposed a successful new-draft save whose “Saved” feedback disappeared on the edit-page remount. The fetched persisted revision now initializes its acknowledgement; edits hide it. The existing autosave test still requires feedback and now also requires a 201 response, matching draft data, real API readback and reload persistence. The 120-pass/1-fail run and DB persistence probe are retained.
14. **Typing lost during slow draft creation:** holding the first POST while entering newer text reproduced the edit-page navigation replacing that text with its first snapshot. Navigation now waits for the latest typed snapshot to persist. The new browser case holds/releases the real creation request, verifies UI/API persistence, forces subsequent 503 saves, confirms unsaved text and DB state are retained, then retries/reloads successfully.

No tests were deleted/newly skipped, no DB guard bypassed, no production configuration invented. Tag rename/restrict protection, migration replay and actual non-owner RLS tests were strengthened. A full shuffled two-deputy browser fixture was added because the specialist report overstated existing coverage.

## 2. Article editor and public rich content

Kept native Tiptap 3 JSON in Article.content and the common sanitized public renderer. Realistic three-column Google Docs HTML contains headings, paragraphs, bold/italic, links, ordered/unordered lists, header rows and multiple cells; save/reload/submission/editorial edits/public output preserve the structure. Unsupported/malicious markup is stripped; plain-text paste remains usable. Every exposed formatting control has interaction coverage, including undo/redo, links, alignment, colours, spacing, separators, footnotes, tables and print.

Tables support insertion, editable cells/inline marks/Tab, row/column insertion/removal, headers, deletion, optional caption/source/URL/note and focusable mobile horizontal scrolling. Huge-table public output retains all rows/cells. Figures support meaningful alt or decorative semantics, independent caption/credit/source/URL/note, dimensions/layout, replacement and deletion. Failed replacement preserves the original; cancellation and retry are covered. Multiple figures, very long metadata, missing optional fields, portrait/wide charts and malformed URLs are tested. Upload validates actual signature/decoding/type/size/dimensions, not just extension.

The complete writer/editor/public workflow includes repeated save/reload, submission, editorial cell editing, future scheduling, explicit publication, public DOM/image checks, replacement/deletion and republishing. The writer assigns Analysis plus two topics; the editor verifies the format, removes one topic and adds another; public output retains Analysis and the two final topic links. The actual due scheduler is independently exercised on the safe DB. Public screenshots at 375/768/1440 use reduced motion, validate real opacity, and wait for the dismissed cookie overlay to unmount; normal-motion mixed-team screenshots wait for scroll-triggered animations to settle.

## 3. Formats, tags, filtering and search

Existing Category FK supplies one primary News/Opinion/Analysis format; Interviews and old URLs remain. Canonical topic identity has SQL/JS Unicode normalization parity and concurrent uniqueness. Historical IDs/slugs are preserved. Renaming a related tag retains its URL/relationships; in-use deletion fails. Normal 1–3 guidance remains, with existing UI/server hard caps. No fixed excessive taxonomy added.

Repeated tag URL parameters mean **topic OR, combined with format AND**. Pagination, sort/reset, selected state, individual removal, clear-all, refresh, zero results and no duplicate articles are tested at three widths. Search finds titles/excerpts, authors and topics with distinct bounded results, partial matching, debounce/cancel, keyboard/mobile, empty/no results and friendly failure/retry. It intentionally does not load/index every full body. Direct SQL changes bypass application invalidation; product route mutations are the certified path.

## 4. Team and Growth profiles

The new randomly inserted, account-linked fixture has one chief, two deputies, three editors, two writers and two Growth members. Browser checks verify chief → deputies → Editorial Team → Writers → Growth & Comms at 375/768/1440 and desktop deputy alignment. Removing the second deputy leaves the first centred. Empty sections/order fallbacks and legitimate legacy leadership remain tested.

All 41 opt-in team lifecycle cases run, including account grant, photo/profile create/edit/reload, unique profile, legacy adoption/linking, role refresh, suspension/restoration and forged role/team/identity rejection. Manual Growth create/edit/reload/public placement was also inspected. Linked sections derive from account role, not an arbitrary self-selected title.

## 5. Newsletter, LinkedIn and sharing

Subscriber persistence and normalization/concurrent dedupe are real DB/API checks, including legacy non-space whitespace. Invalid input, repeats, double click/loading, network/DB failure and retry produce friendly feedback without subscriber or internal error leakage. Existing HMAC unsubscribe remains; no newsletter provider or opt-in policy invented. Actual external delivery was disabled and is unverified.

All publication LinkedIn instances read one validated SiteSetting through existing ADMIN/GROWTH Subscribers management. Invalid/unset values hide public links. **The real publication LinkedIn URL remains required from the owner.** No external destination was fabricated or visited as an acceptance substitute.

Share controls produce canonical Copy/LinkedIn/X/Facebook/email URLs and compatible native share with clipboard fallback/cancellation. Browser tests capture generated destinations instead of posting externally. Real device share sheets and external sends remain unverified. Confirm `https://theconsilium.co.uk` is the intended release origin.

## 6. Analytics

Extended existing track route, ArticleView/SiteView and ADMIN/GROWTH dashboard. View dedupe is 30 minutes. Active time requires visibility, focus and interaction within 60 seconds; heartbeat is 30 seconds, hidden/blur/idle pause, resume never adds inactive catch-up. Server accepts monotonic elapsed-bounded time capped at 7200 seconds. Engaged read means **300 active seconds in one visit**; the five-minute-reader metric can aggregate consented visits in the selected period.

Returning means an earlier UTC-day visit within 90 days among consented readers only. Random persistent identifier is consent-gated, fixed 90-day expiry, keyed-hashed server-side, no account/IP linkage or fingerprinting; decline/withdrawal clears/unlinks it. UI labels approximate measurements and the consented denominator. Failure does not break reading. New DB tests verify both view and score updates leave editorial revisions unchanged; existing lifetime comment rankings remain lifetime metrics, not unique-person conversion.

## 7. Database and safety

Owned Postgres 16 cluster: `/tmp/consilium-final-integration-pg-20261006`, loopback port **55520**, DB **consilium**. Setup/seeds and all application/test commands used the existing canonical guard through `scripts/platform-check.ts`; Next/DB/Storage used explicit synthetic local settings. No hosted Supabase or production application was exercised.

| New migration | Purpose and findings | Applied where |
|---|---|---|
| 20261006153514_discovery_topic_identity.sql | Immutable canonical identity; blank/collision refusal; unique expression/reverse join indexes; tag FK RESTRICT. No historical IDs/slugs/rows rewritten. | Owned local DB plus disposable uniquely named local migration DBs. |
| 20261006160355_managed_article_images.sql | Additive owned-object registry; unique path/URL, uploader/grace indexes, RLS/default-deny. Legacy objects unchanged. | Same local-only scope. |
| 20261006161413_normalized_subscriber_email.sql | Revised unreleased canonical trim function and unique expression index; collision refusal. Index rebuild is transactional; no subscriber rewrite/deletion. | Same local-only scope, including revised DDL on port 55520. |
| 20261006161505_article_active_engagement.sql | Additive visit table; article FK, activeSeconds 0–7200 check, article/date/reader indexes, RLS/default-deny. Cascade removes telemetry only. | Same local-only scope. |

Prisma registry/session/restrict/index changes match actual catalog inspection. Metadata stays in content JSON. All four migrations replay twice on empty fixtures; populated canonical collisions refuse without deleting rows. A temporary non-owner role with realistic grants cannot read seeded owner rows or insert into either new server-only table. Existing local Storage schema and 20261001 team-user-link migration were applied only as test infrastructure.

Guards reject hosted Supabase unconditionally and known production project refs even through supported proxy/pooler forms; explicit non-local test opt-in is not used here. Config, worker, fixtures, seeds, shell entry points and harness retain checks before connection/destructive setup. The actual target PID/data directory/port were inspected. Env-file external credentials were blanked; email/OAuth/FRED and Next telemetry disabled. Rate-limit bypass is confined to the guarded functional harness; limiter unit tests remain.

Rollback requires application/job rollback first. Restore previous tag FK before removing canonical/reverse indexes/function. Keep asset registry receipts until object retention/cleanup is resolved. Stop engagement writers/retention before dropping its additive table; original view tables remain. For subscriber rollback drop `subscribers_normalized_email_key`, then the new identity function after dependency removal; addresses are unchanged. No rollback was applied. **Full historical migration replay/production drift, collisions and PostgreSQL 16+ JSON compatibility require operator review before release.** No production migration applied.

## 8. New/strengthened test evidence

- Seven I browser cases: concurrent review, concurrent writer submission, huge table persistence/mobile scrolling, random full team plus one-deputy/reduced-motion rendering, stale editor with a real readership event, slow creation/newer typing/503 recovery, desktop/mobile settings focus.
- Five real DB scheduler cases: due publication once; trashed due snapshot; expired managed image queued; queue failure rolls back deletion; restored expiry snapshot skipped.
- Image Storage failure remains collectible; canonical locks inspected for consistent save/delete order.
- Four newsletter legacy-whitespace cases and revised canonical lookup/index.
- DB tag rename preserves ID/slug/three joins and resolves correctly after rename.
- Migration replay, preserved historical collision rows and actual seeded non-owner RLS denial.
- Analytics view/derived score preserve revisions; historical debate votes excluded from selected period.
- Reduced-motion public ancestors assert opacity 1 and collect hydration diagnostics; team cards assert real opacity. DOM element visibility alone is not accepted as visual proof.
- Missing-server probe deliberately fails; no offline green result counted as live evidence.

## 9. Complete automated verification

Node **22.23.3**, Next **16.2.2**, Prisma **7**, Postgres **16**, repository Playwright Chromium and local fake Storage at **55620**. App is a production build served at **3220**. Shared fixture-mutating tests run serially; no production credentials/server substitute.

Actual command prefix below: `/tmp/consilium-final-check.sh` (exports Node22 PATH, TEST_DATABASE_URL, PGDATA/PGPORT, PLATFORM_TEST_PORT/Storage port, then runs `npx ts-node -P tsconfig.seed.json scripts/platform-check.ts`). Logs retain that guard banner.

| Actual command after prefix | Final result | Evidence |
|---|---|---|
| npm run typecheck | Exit 0; no TypeScript errors | typecheck.log |
| npm run lint | Exit 0; no lint errors/warnings | lint.log |
| npm run test:unit | 47 files; 646 passed, 7 expected failures (653) | unit.log |
| npx vitest run tests/integration --reporter=verbose | 27 files; 363 passed, 18 explicit skips (381) | integration.log |
| npm test -- --reporter=verbose | 74 files; 1009 passed, 7 expected failures, 18 explicit skips (1034) | all.log |
| env E2E_TEAM_PROFILE=1 npx playwright test --workers=1 | 122 passed; includes 41 team cases and auth setup | playwright.log |
| env E2E_TEAM_PROFILE=1 npx playwright test tests/e2e/upgrade-rich-content.spec.ts --workers=1 | 8 passed; strengthened format/topic lifecycle and actual editor bounds | rich-journey-final.log |
| npx playwright test tests/e2e/upgrade-final-integration.spec.ts tests/e2e/editorial.spec.ts --grep 'slow draft\|autosaves a draft' --workers=1 | 6 passed; delayed creation/newer typing/503/retry and strengthened original autosave, plus auth setup | autosave-recovery-final.log |
| npm run build | Exit 0; compiled, typechecked and route/static output emitted | build.log |
| env SMOKE_BASE_URL=http://localhost:3220 npm run smoke | 8 unauthenticated checks passed; authenticated smoke section not supplied a cookie (roles covered by live/API/E2E suites) | smoke.log |
| git diff --check | Exit 0 | final repository verification |

Optional audits: `npm run audit:types` succeeds at 98.47%. `npm run audit:dead` returns nonzero with 3 unused-file, 7 unused-export and 12 unused-type findings plus a config hint. Reviewed; harness/auth setup are invoked externally and remaining exports/types do not identify a conflicting implementation. `npm run audit:dup` exits 0: 29 clones, 498 duplicated lines/0.86%. Mostly analogous routes/presentation; no second role/editor/rendering/analytics system or duplicate new migration. No unrelated refactoring to silence tools.

The seven existing moderation `it.fails` cases are byte-identical to `68b26e8` (SHA-1 `ef22181812245c9dba02e5f3e0ad403ead46e4d9`). Eighteen explicit API skips remain; some authenticated/comment/upload paths have other coverage, password-reset gaps remain. No new skip/removal. Functional HTTP rate-limit cases intentionally return under the existing audit flag, with unit limiter coverage retained.

Failure history is retained, not erased: initial large-table/concurrency/scheduler/whitespace/stale-editor/settings probes failed; an intermediate full Playwright run had 120 pass/1 unpublish failure; a later 121-pass run preceded the stronger visual check and is not the final visual acceptance. Reduced-motion opacity and period reporting then failed with stronger tests and were repaired. Fixture mistakes (wrong direct Response status accessor/transaction mock/transient hidden streaming DOM locator and a test variable shadowing document) were corrected separately and not reported as product bugs. An earlier run made while rebuilding had green early-return HTTP cases; its logs are explicitly offline/not accepted. The final live suites fail setup if prerequisites disappear.

## 10. Browser QA performed

Playwright actually interacts with all toolbar/table/figure controls, writer/editor/public lifecycle, warm cache mutations, title/author/topic search, filter combinations/clear/refresh, team tiers/Growth profiles and authorization, newsletter failure/retry, shares/clipboard fallback, analytics visibility/consent/failure/access, public internal/RSC crawl, image loading, footnotes/touch/keyboard and editorial views. Discovery/editor/table/figure/public/team/analytics checks include **375, 768 and 1440px**; settings focus is specifically 375/768. Chromium responsive emulation is not physical-device/cross-browser certification.

Separate native Chrome/CUA interactions: home/category/archive navigation; 375px Bank of England filter/apply/clear and author search; team modal/Escape/focus at tablet/desktop; writer sign-in, actual HTML paste of headings/marks/links/lists/three-column table, row/column editing, table metadata, Analysis/topic assignment, save/reload; corrected 375px settings Shift-Tab/Escape/focus return and 768px table controls; repaired 1280px desktop headline/metadata containment; Growth sign-in/create/edit/reload/public card/full bio; authorized active-reading metrics and expanded daily table at all three widths; newsletter invalid/valid/repeat and public copy/share controls. Local disposable fixtures only.

Native extension file upload was blocked by its file-URL permission; that permission was not expanded. Real Playwright file chooser/decoder/upload/replacement/deletion flow passed. Manual console checks found no app hydration/React error; two captured errors originated from the unrelated Zotero Chrome extension. The application logs include intentional missing email/FRED provider warnings, negative-test responses and navigation-aborted article requests (ECONNRESET); no blanket claim of completely silent raw logs. Automated crawl/image assertions pass. Screenshot inspection found and drove the reduced-motion repair.

## 11. Remaining release risks and blocked checks

- Real LinkedIn publication value still required; production canonical origin must be confirmed.
- No production migration/drift/collision preflight, real Supabase bucket/RLS/service-role/CDN or deployment upload-limit acceptance. Local Storage wire emulator cannot prove those.
- No external email/OAuth delivery, deployed authenticated cron execution, real social posting or physical-device native sharing; no Firefox/WebKit.
- Analytics is approximate/consent-limited. Existing lifetime rankings are not unique-reader measures. Daily image GC caps 20 objects, expiry purge 100 articles/run and retention 5000 visits/run; high-volume backlog requires operator attention.
- Editor UI revision guard is active; backward-compatible API callers omitting expectedUpdatedAt have only in-request CAS, not protection against a long-held client snapshot.
- Publication side effects remain existing best-effort delivery; no new durable outbox introduced. Serial shared fixture runs are certified; parallel workers against the same mutable DB are not.
- Seven known moderation failures and eighteen explicit API skips remain documented; PR approval should acknowledge their scope.

These do not prevent review of a tested local candidate, but do prevent declaring the entire production release independently verified.

## 12. Repository and handoff

Final branch: `feature/consilium-platform-upgrade`. Final code/evidence is committed locally after the above checks; inspect `git log -1` for its audit commit. Ancestry retains 72c9231, 11d9540, d1ce38c, 92a118f, fefab8f, 44183b6, 6594343, 58d79a8, 68b26e8 and pinned foundation d1dab80. No merge/cherry-pick was added or omitted.

Original dirty checkout remains at 68b26e8 with modified search API/archive/search/archivePagination/articleTags and untracked docs/testing, discoveryQueries and supabase temp files. Specialist checkout remains clean at 72c9231. Final tree is clean after the audit commit; generated auth/build/browser artifacts remain ignored.

Owned app/Storage/Postgres services are stopped at handoff; their local data, helper and evidence remain. No unrelated service stopped. The owner controls PR publication, merge, deployment and production migration separately. **No push, merge to main, deployment or production change was performed.**
