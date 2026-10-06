> Historical snapshot of `IMPLEMENTATION-REPORT.md` from specialist commit `72c9231`. Claims below are retained as handoff evidence, not independent acceptance. Current conclusions: [MASTER-STATUS.md](MASTER-STATUS.md) and [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md).

# Platform upgrade implementation report

Updated 2026-10-06. All six workstreams: **VERIFIED COMPLETE for the guarded local candidate**. Production release/configuration is separate and was not performed. Historical foundation evidence remains in [VERIFICATION.md](VERIFICATION.md). Per-workstream evidence is linked in [MASTER-STATUS.md](MASTER-STATUS.md).

## 1. Implementation summary

Implemented Discovery, rich editor/Google Docs/tables, figures/public rendering, team hierarchy/profile permissions, Growth integrations and active-reading analytics. Reused foundation Category/Tag relationships, native Tiptap 3 JSON strings, Supabase Storage, account-linked profiles, SiteSetting, Subscriber and the existing analytics collector/dashboard. No unrelated redesign, competing content model, authentication role or newsletter provider was introduced.

## 2. Article editor

Every exposed formatting control was exercised: paragraphs, headings 2/3/4, bold, italic, underline, strike, links/add/remove, blockquote, code block, pull quote, ordered/unordered lists, indent/outdent, undo/redo, separator, four alignments, text colour/custom/reset, highlight/custom/reset, line spacing, footnote and print. Toolbar active states and keyboard activation now work with Tiptap 3.

Realistic Google Docs HTML becomes semantic paragraphs/headings/emphasis/links/lists/tables; unsafe scripts/events/URLs and unnecessary styles/classes/tracking attributes are removed. HTML input is bounded to 2MB and ten embedded images. Plain-text paste keeps native behaviour; asynchronous image paste cancels safely if the document changes.

Native tables support insertion, editable cells, Tab navigation, headers, row/column insertion/removal, deletion and inline formatting. Caption/source/source URL/note persist in native attrs. Empty public tables disappear; wide tables scroll in a contained, keyboard-focusable region. Public output preserves supported headings, marks, lists, links, blockquotes and separators.

Figures support alt/decorative semantics, captions, credits, source labels/URLs, notes, dimensions/layout and replacement/deletion. Meaningful structured figures need alt before submission/schedule/publication; filenames are not used as alt. Optional metadata-only figures do not emit broken images or empty labels. Actual decoding, MIME signatures, size/dimension limits and owned storage paths protect uploads. Failed replacement preserves the original; cancellation/retry and duplicate actions were exercised.

Lifecycle tested: writer paste/edit/save/reload repeatedly → submit → editor review/edit/save → future schedule → explicit local publish → public output → replace/delete → republish. The production scheduler was not executed.

## 3. Categories, tags and search

News/Opinion/Analysis use the existing Category FK; Interviews/legacy URLs remain. Topic identities use Unicode NFKC, case/whitespace/punctuation/separator normalization with browser/Postgres parity. Existing IDs/slugs stay stable; unrelated legacy slug collisions receive a deterministic suffix. Advisory locks and the canonical unique index prevent concurrent duplicates. In-use topic deletion is restricted. Editors get 1–3 guidance, while existing exceptional caps remain ten in UI/25 server.

Repeated `tag` URL parameters support topic OR combined with format AND. Selection/removal, clear-all, zero results, stable pagination/page reset, refresh and mobile keyboard flows work without duplicate articles. Tag pages show bounded public results and link to the paginated archive.

Search supports partial article title/excerpt/format, author and topic queries; structured results are capped at 15 articles and eight authors/topics. Query length/tokens/page bounds, rate limiting and metadata-only selection avoid unbounded body queries. Debounce, stale-request cancellation, loading, empty/no-results, keyboard submit, mobile and friendly failure/retry are covered. Search is no-store; topic options reuse the `articles` cache tag with 30-second lifetime. Real publication/edit/unpublish/trash/restore paths invalidate warmed caches.

## 4. Team

Desktop shows the chief centred above up to two deputies, then Editorial Team, Writers and Growth & Comms. Mobile/tablet stack gracefully; empty sections disappear. Deterministic role/title/order/name/id sorting is independent of insertion order. Additional deputies and documented legacy leadership exceptions remain visible under the foundation policy.

Growth users can create/reload/edit their own image/bio profile and appear publicly. Existing unique account association and server guards prevent duplicate active profiles, impersonation, self-appointed leadership and team/role escalation. Writer/editor/admin and legacy linking behaviours survive. Role changes, suspension, JWT refresh and restoration were exercised through existing server permissions.

## 5. Newsletter, LinkedIn and sharing

All publication LinkedIn instances use validated `SiteSetting.publication_linkedin_url`, managed by ADMIN/GROWTH in the existing Subscribers surface. Unset/invalid values hide public links. **The actual publication LinkedIn URL is unknown and must be supplied by the owner**; no URL was invented. Share destinations are separate from the publication profile setting.

Existing Subscriber/HMAC-unsubscribe infrastructure remains. Emails trim/lowercase; transaction locks plus canonical lookup/index prevent concurrent/case/whitespace duplicates. Invalid input, duplicate submission, loading/double click, database/network failure and retry use friendly feedback without raw database errors.

Sharing uses canonical publication URLs, Copy Link feedback/manual selection fallback, safe encoded LinkedIn/X/Facebook links, email and native Web Share where supported. Local/preview hosts never replace an available production origin. Keyboard, accessible labels, denied clipboard, native cancellation/failure and small screens were tested.

## 6. Analytics

Extended `/api/analytics/track`, ArticleView/SiteView and the existing dashboard; no second analytics architecture. Views retain 30-minute deduplication, with concurrent writes serialized. Events are bounded/rate limited, referrers reduced to origins, obvious bots excluded, and invalid/private/deleted articles ignored. Analytics failures never block reading.

Active time counts only while visible, focused and interacted with within the last 60 seconds. Blur/hidden/idle pauses; resume does not add inactive catch-up. Cumulative heartbeats run every 30 seconds, with visibility/pagehide flushes. Server elapsed-time clamps, monotonic updates and a two-hour visit cap constrain duplicates/stale events. An engaged read is **300 active seconds in one visit**. Five-minute readers may accumulate 300 seconds across consented visits in the selected period. These are conservative approximate signals, not precise attention measurements.

A random persistent reader identifier is created only after consent, expires after a fixed 90 days and is keyed-hashed server-side. No account linkage, IP storage or fingerprinting was added. Without consent only an ephemeral in-memory visit exists. Withdrawal removes persistent identifiers and unlinks the current visit on the next flush. Returning readership means an earlier UTC-day visit within 90 days, among consented readers only. The privacy notice and denominator labels reflect these limits.

Existing Engagement/Audience tabs show measured visits, engaged reads, five-minute readers, average active seconds, consented returns, top articles and bounded daily performance. ADMIN/GROWTH permissions remain. Daily retention is bounded to 5,000 expired rows; high-volume deployments may need more frequent cleanup.

## 7. Database changes and applications

| Migration | Change | Application |
|---|---|---|
| `20261006153514_discovery_topic_identity.sql` | Immutable canonical identity function/index; blank/collision preflight; reverse join index; restrictive in-use tag FK | Guarded isolated local DB and ephemeral migration-test DBs only |
| `20261006160355_managed_article_images.sql` | New owned-object registry, unique URL/path, uploader/grace timestamp indexes, RLS without public write policies | Same local-only scope |
| `20261006161413_normalized_subscriber_email.sql` | Canonical subscriber expression index; historical collision preflight | Same local-only scope |
| `20261006161505_article_active_engagement.sql` | Engagement sessions, FK, monotonic-range check, unique session/indexes and RLS without public policies | Same local-only scope |

Prisma adds the image registry/engagement models and reverse topic index/restrict relation. Metadata remains in Article.content JSON. Local test setup explicitly applies SQL after guarded db push, so non-Prisma expression/check/RLS constraints are actually tested. Empty-schema DDL and populated collision preflight tests pass without rewriting historical rows. Existing local Storage schema/team-link migration was also applied as test infrastructure. No production migrations, CLI link/push, introspection or data changes occurred.

The image registry was justified because immediate autosave deletion breaks Undo and abandoned uploads need recoverable receipts. New owned objects are reserved before upload; ordinary edits use a 30-day grace. Saves/cleanup share canonical advisory locks. Permanent cleanup checks every draft/trash/cover/content reference. JSON is decoded in PostgreSQL using its [JSON predicate/path functions](https://www.postgresql.org/docs/16/functions-json.html), and escaped/encoded/query/normalised aliases retain their object. Filename matching is deliberately conservative: a foreign URL with the same globally unique filename can delay deletion. No full article bodies return to the application. Daily GC has a 20-object limit, 40-second batch-start deadline and transaction timeout.

Rollback requires application rollback before removing new constraints/tables. Restore the previous tag FK before dropping identity indexes/function; no historical data rewrite needs reversal. Preserve asset registry information until stored objects have a cleanup/retention plan. Disable engagement writes/cron before dropping the additive session table; original view tables remain. Subscriber index removal restores previous uniqueness semantics without changing addresses. Operators must review historical migration drift/collisions before applying any DDL.

## 8. Tests added and extended

- Discovery unit/database/search-route suites prove canonical Unicode/slug identity, legacy conflict handling, concurrency, relational integrity, bounded OR/combined filtering and safe search errors/metadata.
- Rich-editor/figure suites and the realistic three-column Google Docs fixture prove sanitization, semantic marks, table headers/spans/links/metadata, empty/malformed content and renderer parity.
- Upload/storage integration tests prove actual image validation, ownership, cancellation/failure, reference locks/grace, all URL/JSON variants and last-reference deletion.
- Team hierarchy/account/database and opt-in browser tests prove shuffled ordering, real Growth signup/profile lifecycle, uniqueness, linking and prohibited escalation.
- Growth settings/subscribe tests prove validated single-source links, safe sharing origin, concurrent normalized subscriptions and friendly failure.
- Active-reading/identity/engagement/cleanup tests prove pause/resume, elapsed clamps, thresholds, deduplication, consent expiry/withdrawal, permissions, bot/input/failure handling and retention.
- Migration tests create/drop uniquely named guarded local databases to prove empty DDL, SQL/JS identity parity, RLS and preflight preservation.
- New `upgrade-discovery`, `upgrade-rich-content`, `upgrade-growth-analytics` browser specs add 14 feature cases; existing team/publication/cache/editorial suites were retained/extended.

## 9. Complete verification

Node **22.23.3**, fresh isolated Postgres **16**, local fake Storage and a production Next **16.2.2** build were used. No arbitrary or remote server was tested.

| Check | Actual result |
|---|---|
| Whole-repository `npm test` | **72 files passed; 996 passed, 7 expected failures, 18 skipped (1,021 total)** |
| Whole-repository typecheck | Passed |
| Whole-repository ESLint | Passed |
| Production build | Passed |
| Full Playwright with opt-in team project, one worker | **115/115 passed**; includes 41 team cases and shared auth setup |
| Post-storage-fix rich-content/publication/cache browser regression | **18/18 passed** against the rebuilt final app (Discovery, rich-content, publication lifecycle/cache and auth setup) |
| `git diff --check` | Passed |

The seven existing `it.fails` content-filter regressions and eighteen existing explicit API skips are unchanged; no tests were deleted/newly skipped. They remain baseline limitations described in VERIFICATION. Functional test rate limits are disabled in the guarded harness; original rate-limit unit coverage remains. Email/OAuth/FRED external credentials were blanked; missing-provider warnings are expected, not live delivery evidence. Server logs also recorded aborted article-update requests (`ECONNRESET`) during browser navigation; the save/reload/publication assertions passed and these are not claimed as a completely silent server log.

The first full 74-case default browser run had one Discovery fixture failure because direct SQL inserts bypassed an already-warmed topic cache. The fixture now invalidates through a real owned article update; the full 115-case rerun passed. Actual publication cache lifecycle already passed. No product workaround or disabled assertion was used.

Logs: `/tmp/consilium-upgrade-full-tests-final.log`, `consilium-upgrade-typecheck-final.log`, `consilium-upgrade-lint-final.log`, `consilium-upgrade-build-final.log`, `consilium-upgrade-all-browser-final.log` and `consilium-upgrade-browser-postfix.log`, all under `/tmp`.

## 10. Actual browser QA

Native Chromium interactions covered archive single/multiple selection, clear/unselect, combined formats/pages/refresh, title/author/topic/no-results/failure search; the complete editor/table/figure lifecycle and every toolbar control; newsletter/share/settings; analytics pause/consent/failure/dashboard permission; Growth/profile lifecycle and random-order hierarchy.

Responsive assertions ran at **375, 768 and 1440px**. They include very wide/portrait/standard images, multiple figures, long caption/source URL, metadata-only figure, twelve-column tables, surrounding headings/lists and no whole-page overflow. Exceptions/failed relevant API responses were collected by feature scenarios. Deliberately simulated failures were expected and recoverable.

Interactive agent-browser archive filtering/clear, keyboard article editing/long headline and analytics navigation were inspected. Screenshots `/tmp/consilium-discovery-qa.png`, `consilium-editor-{375,768,desktop}.png` and `consilium-analytics-{375,768,desktop}.png` were viewed. Editor title wrapping/toolbar/table containment and analytics layout were checked visually. Manual console checks were clear; dashboard API network responses were 200. This does not claim real Supabase CDN/RLS, native device sharing, external mail delivery or production browser QA.

## 11. Remaining risks and release requirements

The locally implemented acceptance flows are verified. Release still requires owner configuration/review: real LinkedIn URL; additive migrations and historical collision/drift preflight; production Storage bucket/RLS/service-secret validation and PostgreSQL 16+ JSON-function compatibility; canonical origin confirmation; CRON_SECRET and the two authenticated cron schedules. Repository cron configuration is committed but was not deployed.

Storage emulator cannot prove production Supabase permissions/CDN behaviour. Analytics is approximate and consented-reader counts are partial; retention/GC are bounded and may accumulate backlog at high scale. Existing unrelated expected failures/skips remain. Foundation notes about revision conflict/scheduler races and historical migration drift are not erased by this work. Schedule acceptance used a future schedule followed by explicit local publication. No external sending/publishing or production smoke testing occurred.

## 12. Git and production boundary

Branch: `feature/consilium-upgrade-six-workstreams`; worktree `/Users/zanie/The-Consilium-upgrade`; base `68b26e8`, containing pinned foundation `d1dab80b8eb72f986c2b8a2f0fffdb4722f0f19a`.

Milestones:

- `58d79a8` — canonical topics, URL filters and bounded search.
- `6594343` — Docs/table lifecycle and safe managed figures.
- `44183b6` — deterministic chief/deputy hierarchy.
- `fefab8f` — configurable links, newsletter and article sharing.
- `92a118f` — consented active reading and existing analytics portal.
- `d1ce38c` — migration boundaries, topic cache lifecycle and editor recovery.

- `11d9540` — reference-safe JSON/URL alias cleanup and warm-cache browser fixture isolation.

The following documentation-only commit contains this report. The isolated tracked tree is committed clean at handoff. The original checkout's pre-existing Discovery changes and untracked documentation/Supabase temp files were not modified. **Nothing was pushed, merged, deployed, migrated in production or changed in production data.**

Owned local app/Storage/Postgres services were stopped after final verification. Test DB files, logs and screenshots remain under their owned `/tmp` paths. Reproduction environment: `/tmp/consilium-upgrade-env.sh`; run checks through `scripts/platform-check.ts` after restarting those same local services. No unrelated services were stopped.
