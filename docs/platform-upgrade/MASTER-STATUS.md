# Final integration master status

Independent audit: 2026-10-06. Authority: [MASTER-SPEC.md](MASTER-SPEC.md), repository, executed tests and observable local application. This fresh ledger supersedes [SPECIALIST-HANDOFF-STATUS.md](SPECIALIST-HANDOFF-STATUS.md) and [SPECIALIST-IMPLEMENTATION-REPORT.md](SPECIALIST-IMPLEMENTATION-REPORT.md). Earlier checkboxes are not proof.

## Candidate and evidence boundary

Final branch `feature/consilium-platform-upgrade`, worktree `/private/tmp/consilium-final-integration`. On inspection this branch already contained `72c9231` and all specialist ancestry; the clean specialist tree `/Users/zanie/The-Consilium-upgrade` had the identical commit. No merge/cherry-pick was needed. Original `/Users/zanie/The-Consilium` remains on `feature/consilium-upgrade-implementation` at `68b26e8`, with its unrelated dirty Discovery work preserved.

The specification's foundation-only assignment is historical; the subsequent owner instruction authorizes final integration without waiving product requirements. VERIFIED COMPLETE below means proven on the guarded local candidate, not production/provider acceptance. IMPLEMENTED BUT NOT FULLY VERIFIED and BLOCKED identify material limits. No remaining tested local feature is classified MISSING or REGRESSION. Repaired regressions are in the report; conditional/future requirements retain their original scope.

Evidence keys reference actual suites:

- D: `tests/e2e/upgrade-discovery.spec.ts`; integration `discovery.test.ts`, `discovery-search-route.test.ts`; unit discovery/tag tests.
- R: `tests/e2e/upgrade-rich-content.spec.ts`; unit rich-editor/figure-render/figure-metadata tests and realistic `google-docs-economics.html`.
- F: integration article-image-storage/upload route suites and image-reference unit tests.
- T: `team-profile.spec.ts`, `team-profile-lifecycle.spec.ts`; team hierarchy/account/database/storage suites.
- G: `upgrade-growth-analytics.spec.ts`; integration growth-subscribe and unit growth-settings.
- A: integration analytics-engagement/analytics-display-period, unit active-reading/analytics identity/route tests; G.
- C: publication-cache/publication-lifecycle E2E and article route/revalidation suites.
- I: `upgrade-final-integration.spec.ts`; integration scheduled-publication/upgrade-migrations.

Actual commands/results, browser interactions, defects, DB applications and release limits: [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md). Logs/screenshots: [evidence/final-integration/README.md](evidence/final-integration/README.md).

## Fresh original-specification checklist

Related acceptance criteria share a row only when the same evidence covers them.

| Original requirement | Classification | Independent evidence and limit |
|---|---|---|
| Audit framework/routing, ORM/schema, auth, storage, editor/rendering, publication, caching, tests | VERIFIED COMPLETE | Next 16.2.2 installed docs and all shared paths inspected; six status files/report/migrations read; integrated user journeys executed. |
| Reconstruct all workstreams and conflicting/shared files | VERIFIED COMPLETE | Commit graph contains Discovery 58d79a8, editor/figures 6594343, Team 44183b6, Growth fefab8f, Analytics 92a118f, d1ce38c/11d9540 corrections. No workstream omitted. |
| Dedicated final branch; unrelated work preserved | VERIFIED COMPLETE | Existing isolated final worktree reused; original dirty paths and specialist checkout untouched. |
| No push/merge/deploy/production access or mutation | VERIFIED COMPLETE | Only local Git and guarded loopback services; no hosted query, project link, release or deployment command. |
| One primary News/Opinion/Analysis format; extensible Category model; existing URLs | VERIFIED COMPLETE | Category FK retained; R assignment/public output; legacy Interviews/category URLs kept. |
| Topic names/slugs canonical across case/whitespace/Unicode, without excessive taxonomy | VERIFIED COMPLETE | D real DB concurrent resolution and SQL/JS parity. Example subjects are not forced seeds. |
| Rename keeps relationships/URLs; deletion protects in-use tags | VERIFIED COMPLETE | D rename preserves ID/slug and three article relations; resolver reuses renamed tag; FK delete rejects. |
| Normal 1–3 tag guidance, curated 5–10 topic intent | VERIFIED COMPLETE | Editor guidance/free topic assignment; existing UI cap 10/server 25 retained. Examples are illustrative. |
| Clean Home/News/Opinion/Analysis navigation and topic discovery links | VERIFIED COMPLETE | Public category tests and manual home/archive/search; no new excessive top-level taxonomy. |
| Multi-topic OR combined with format AND; no duplicate articles | VERIFIED COMPLETE | D shared predicate, DB assertions and browser cases at 375/768/1440. |
| Selected state, individual removal, clear-all, keyboard/mobile, growing list | VERIFIED COMPLETE | D interaction-based selection/unselect/clear at three widths; named controls and bounded topic options. |
| URL reload/share state, pagination/sorting/reset and zero results | VERIFIED COMPLETE | D browser page/reset/refresh assertions and nonmatching/unknown topic predicates. |
| Search titles/excerpts/authors/topics, partial matches and distinct results | VERIFIED COMPLETE | D structured API/UI; manual Bank of England query and Eleanor Hughes author result. Excerpt scope; no full-body search index claimed. |
| Search empty/whitespace/no results, bounds/pagination and deduplication | VERIFIED COMPLETE | D query/token/page tests; 15 article/8 author/8 topic caps. |
| Search loading/error/retry, keyboard/mobile, debounce/cancel stale requests | VERIFIED COMPLETE | D failure/retry/keyboard case and request control tests; no query per raw keystroke. |
| One content format/editor/public contract, legacy compatibility | VERIFIED COMPLETE | Native Tiptap JSON in Article.content; R repeated JSON equality and shared sanitized rendering; legacy HTML/plain text preserved. |
| Paragraph/headings, bold/italic/underline/strike, links, blockquotes, ordered/unordered lists | VERIFIED COMPLETE | R every-toolbar-control case, realistic paste and full publication lifecycle; semantic public DOM. |
| Separators/alignment, undo/redo, colour/highlight/reset, spacing, footnote and print | VERIFIED COMPLETE | R exhaustive toolbar interactions plus retained public footnote keyboard/touch tests. |
| Formatting survives save/autosave/reload/submit/review/edit/schedule/publish/republish | VERIFIED COMPLETE | R writer-to-editor repeated save/reload lifecycle, named Status/date/Schedule/Publish controls and scheduled UK date reload; C existing lifecycle; I due scheduling test. Native Chrome independently scheduled, reloaded, published and unpublished the disposable pasted-table article. Existing autosave case verifies 201, API readback, reload and visible acknowledgement. |
| Google Docs semantic conversion and irrelevant style/class/tracking stripping | VERIFIED COMPLETE | R realistic fixture headings/marks/links/lists/table; native manual HTML paste and reload. |
| Malformed/malicious HTML, scripts/events/javascript/embeds stripped; plain-text fallback | VERIFIED COMPLETE | R paste/render/sanitizer negatives and plain-text/cancellation browser case; input cap 2MB/ten embedded images. |
| Mandatory three-column Docs table, header/bold/link/multiple rows | VERIFIED COMPLETE | R 4 rows/3 headers, linked ONS cell after save/reload, submit, editorial cell edit and public rendering. |
| Table create/edit cells/marks/Tab, add/delete rows/columns, headers/delete table | VERIFIED COMPLETE | R native controls; manual row/column insertion, cell focus and metadata. |
| Table caption/source/source URL/note optional and safe | VERIFIED COMPLETE | R persisted native attrs/public renderer; manual four-field entry and reload; no empty labels. |
| Huge/wide/mobile tables preserve content and contain horizontal scroll | VERIFIED COMPLETE | I 501-row table plus separate 101-column table paste-save-reload-publish and keyboard scrolling at 375; R 12-column layout. Silent renderer truncation repaired. |
| Structured figures: alt/decorative/caption/credit/source/URL/note | VERIFIED COMPLETE | R upload/full lifecycle and independent multiple figures; unit metadata validation and attachment. |
| Meaningful alt before submit/schedule/publish; filename not automatic alt | VERIFIED COMPLETE | Article/review validation negatives and R/F; decorative public alt empty. |
| Figure replacement/delete/failure/cancel/retry/missing metadata | VERIFIED COMPLETE | R original retained on failed replacement, retry/reload/deletion/republish; metadata-only unit case emits no broken img. |
| Upload actual MIME/signature/decode/size/dimensions and duplicate/invalid actions | VERIFIED COMPLETE | F real decoder/route tests; R browser uploads. Article limit 4MB; extension alone not trusted. |
| Ownership/orphans/shared reference safety/abandoned uploads | VERIFIED COMPLETE | F aliases/JSON/locks/grace tests; I deletion queue atomicity and failed Storage retry. No shared object deleted. |
| Preserve published URLs and actual storage permissions/CDN | IMPLEMENTED BUT NOT FULLY VERIFIED | No legacy rewrite/bucket-policy change; wire emulator passes. Real Supabase RLS/signing/CDN/provider limits untested. |
| Dependable external-chart-image path | VERIFIED COMPLETE | R synthetic PNG with alt/caption/source/note; no new custom chart builder/unsupported embeds. |
| Standard/wide/portrait layout, aspect ratio/dimensions/mobile fallback | VERIFIED COMPLETE | R three-width layout/natural-image checks and explicit dimensions. |
| Chief centred, two deputies next, exact Editorial Team/Writers/Growth headings | VERIFIED COMPLETE | I shuffled account-linked full fixture checks order/alignment at 1440 and all tiers at 375/768; settled screenshots. |
| One deputy centred, deterministic order and empty-section behaviour | VERIFIED COMPLETE | I removes own second deputy and checks centring; hierarchy unit shuffle/empty cases. |
| Growth create/edit/reload own photo/bio and one public profile | VERIFIED COMPLETE | T signup/grant/profile and uniqueness/storage tests; manual Growth edit/reload/public placement. |
| No impersonation/other-profile edit/team reassignment/self-appointed chief/deputy/role | VERIFIED COMPLETE | T forged bodies/IDs/role mutation negatives; role-derived placement/server authorization. |
| Preserve admin/leadership and writer/editor self-service/legacy linking | VERIFIED COMPLETE | All 41 opt-in T cases retained: linking, role changes, suspension, JWT refresh and restoration. |
| Growth without profile can find creation flow; hide empty groups | VERIFIED COMPLETE | T empty/create form and hierarchy tests; no dead Growth heading. |
| Team mobile/tablet/desktop, crop, names/roles, no pyramid gaps/overflow | VERIFIED COMPLETE | I 375/768/1440 mixed-tier fixture; T responsive cases; manual team modal/Escape/focus. |
| Single configurable validated LinkedIn setting; all instances/mobile/labels | VERIFIED COMPLETE | G SiteSetting update invalidates footer/contact; invalid/unset hidden; writer mutation rejects. |
| Actual publication LinkedIn page value | BLOCKED | Real value absent; owner must supply publication_linkedin_url. No fabricated destination or ownership claim. |
| Newsletter real Subscriber persistence and existing infrastructure | VERIFIED COMPLETE | G DB/API/mobile row assertions; existing HMAC unsubscribe preserved; no provider invented. |
| Newsletter invalid/case/whitespace/legacy duplicates/concurrency | VERIFIED COMPLETE | G concurrent dedupe plus tabs/newline/NBSP/BOM legacy cases; canonical SQL identity now matches JS trim. |
| Newsletter repeat click/loading/slow/failure/retry; friendly non-leaking messages | VERIFIED COMPLETE | G aborted API/retry, double-click/loading and DB failure; subscriber list permission-gated. |
| Preserve unsubscribe/confirmation/double-opt-in if existing | VERIFIED COMPLETE | Existing HMAC/unsubscribe tests retained; no new opt-in policy. |
| Real external mail/newsletter delivery | IMPLEMENTED BUT NOT FULLY VERIFIED | Provider credentials disabled; no external sending; storage/API/UI proven only. |
| Canonical copy link/success/clipboard denial/manual fallback | VERIFIED COMPLETE | G keyboard copy/fallback and original public tests; manual copy interaction. |
| Encoded LinkedIn/X/Facebook/email and compatible native share/cancel | VERIFIED COMPLETE | G captures destinations and simulated native sharing/failure. No external posts made. |
| Actual physical-device native share/network outcomes | IMPLEMENTED BUT NOT FULLY VERIFIED | Chromium simulations/hrefs only; no iOS/Android sheet or external social/email outcome. |
| Canonical sharing excludes local/preview when origin available | VERIFIED COMPLETE | G origin tests use https://theconsilium.co.uk fallback; owner must confirm intended release hostname. |
| Reuse analytics architecture and existing dashboard | VERIFIED COMPLETE | Existing track route/ArticleView/SiteView extended; one clock/identity utility; shared files/duplicate audit inspected. |
| Views deduped, private/deleted/bot/invalid dropped, failure nonblocking | VERIFIED COMPLETE | A real DB concurrency/referrer/input/failure tests; G reading continues when endpoint fails. |
| Active time visible/focused/recent interaction; hidden/blur/idle pause/resume | VERIFIED COMPLETE | A clock tests and G browser heartbeat/visibility persistence; no inactive catch-up. |
| Engaged read approximately five active minutes; monotonic/clamped events | VERIFIED COMPLETE | A 300 seconds per visit; elapsed bound and 7200-second cap; stale/duplicate events tested. |
| Returning definition/privacy/consent/expiry/withdrawal/no fingerprint | VERIFIED COMPLETE | A earlier UTC-day visit within 90 days among consented readers; keyed hash, fixed expiry/unlink; no IP/account linkage. |
| Request/retention bounds and approximate metric labels | VERIFIED COMPLETE | 30s heartbeat, 60s idle, retention batch 5000; G denominator labels. Reporting DB regression excludes historical debate votes from period ratio; UI labels votes per 100 article views, not reader conversion. |
| Later author/tag/format comparisons possible | VERIFIED COMPLETE | Engagement FK connects existing article relations; specification puts comparison UI in later scope. |
| ADMIN/GROWTH analytics; ordinary writer/public denied | VERIFIED COMPLETE | G admin dashboard/writer denial and API RBAC; manual Growth authorized dashboard. |
| Publish/edit/unpublish/republish/trash/restore cache invalidation | VERIFIED COMPLETE | C warmed real Next caches before 30s TTL; D topic cache lifecycle; post-commit invalidation. |
| Format/tag/title/slug/author invalidate home/archive/category/article/author/tag/search | VERIFIED COMPLETE | Central revalidation helper/C route tests; bounded search is no-store; D published-topic changes. |
| Team role/profile/settings/LinkedIn public updates | VERIFIED COMPLETE | Force-dynamic team plus T role/profile refresh; G footer/contact setting updates. |
| Complete create/save/submit/review/edit/schedule/publish/unpublish/republish/delete/restore | VERIFIED COMPLETE | R/C existing lifecycle retained; I simultaneous submission/review and writer-after-submit rejection. |
| Due publication/notifications once, trashed snapshot rejected, purge/restore safety | VERIFIED COMPLETE | I real DB due/repeat notification count, stale-trash CAS, atomic purge/asset queue and rollback on queue failure. External delivery unverified. |
| Stale editor tabs do not overwrite newer save; reading does not cause false conflicts | VERIFIED COMPLETE | I two tabs: 200 then 409; unsaved text retained; DB preserves first save. A view/score writes preserve editorial updatedAt; full unpublish lifecycle passes. Older API clients may omit optional revision token. |
| Keyboard/named controls/form labels/semantic tables/alt/focus/modals/Escape | VERIFIED COMPLETE | R/T/G keyboard suites; I mobile settings trap/return at 375/768; format/cover/topic/Status/Author labels added and closed duplicate drawer removed. R addresses Status and Author by accessible name; native Chrome scheduling also checked. |
| Changed contrast/heading hierarchy/focus visibility and reduced motion | VERIFIED COMPLETE | Existing contrast/footnote/modal tests; reduced-motion article body/title and team cards now assert actual ancestor opacity 1 and no hydration diagnostics. Invisible-content hydration defect repaired; no whole-site accessibility certification claimed. |
| Approximately 375/768/1440 responsive inspection, no overflow | VERIFIED COMPLETE | D/R/I/G viewport checks and manual archive/search/team/editor; multiple figures, long captions/URLs and wide tables tested. R actual headline/format-field bounds also checked at 1280; non-shrinking desktop document clipping repaired. |
| Async upload/profile/article/tag/newsletter/analytics failures and double submits | VERIFIED COMPLETE | R/F/T/G/D negative cases; I CAS/stale revision and held POST/newer typing/503/retry/reload checks; image cleanup retry test. Creation navigation waits for the latest typed snapshot, preventing lost text. |
| Minimal additive schema/constraints/indexes/no accidental published-content cascade | VERIFIED COMPLETE | Four DDL files/catalog inspected; tag RESTRICT, engagement cascades telemetry only; original author FK preserved. |
| Empty/colliding/populated migration tests, replay and rollback guidance | VERIFIED COMPLETE | I four DDL files replayed twice in disposable local DBs; historical collisions refused without rewrites; report rollback steps. |
| Production migration drift/collision/application safety | BLOCKED | No production introspection permitted/performed; operator must verify actual schema/Postgres capability and collisions before release. |
| Changed mutations authorized server-side, scope preserved, HTML/URLs sanitized | VERIFIED COMPLETE | Article/review/profile/settings/upload/analytics guards inspected; retained RBAC/category/XSS tests and malicious R fixtures. |
| New tables default-deny browser RLS | VERIFIED COMPLETE | I non-owner temporary role with grants cannot see seeded owner rows or insert assets/engagement. Actual Supabase role deployment unverified. |
| Tests cannot silently use production Supabase; safeguards remain | VERIFIED COMPLETE | Canonical DB/host/base-URL guards in config/workers/fixtures/shell/harness; hosted URL/shell refusal regressions pass. |
| Complete applicable typecheck/lint/unit/integration/Playwright/build | VERIFIED COMPLETE | Actual final commands/results in report/logs. Missing server/login/fixtures now fail setup; offline green run discarded. |
| Investigate failures without deleting/skipping coverage | VERIFIED COMPLETE | Seven it.fails file SHA-1 equals 68b26e8; eighteen explicit skips unchanged. New failure probes led to fixes, no weakened assertions. |
| Actual interaction QA, console/hydration/network/images/loading/errors | VERIFIED COMPLETE | Manual flows plus public/network crawl and feature exception assertions; intentional negative responses/provider/aborted-request warnings recorded. |
| Physical devices/cross-browser/provider and manual file upload QA | IMPLEMENTED BUT NOT FULLY VERIFIED | Chromium only. Extension file-URL permission blocked manual upload; automated upload lifecycle passes. No production/provider or Firefox/WebKit acceptance. |
| Performance bounded selectors/indexes/analytics/images; no N+1/full-body cards | VERIFIED COMPLETE | Discovery selects metadata/relations with bounds; indexes verified; code audit found no competing role/editor/analytics implementation. |
| SEO titles/excerpts/canonical/author/social/tag indexing; filter duplicate indexing | VERIFIED COMPLETE | Existing metadata/public tests; central helpers; filtered combinations noindex/follow and unfiltered canonical. |
| Production/high-volume load performance | IMPLEMENTED BUT NOT FULLY VERIFIED | Local concurrent crawl passes; GC 20 objects/day, purge 100/run and retention 5000/run can backlog. |
| Final master evidence/reviewable candidate; no production release | VERIFIED COMPLETE | Fresh audit ledger/report and local committed fixes/evidence; owner controls PR publication/deployment separately. |

## Specialist reconciliation

| Status file inspected | Independent conclusion |
|---|---|
| discovery-status.md | D passes; rename/FK safety additionally verified. |
| editor-status.md | R passes; I repaired silent table truncation, stale save, closed-drawer accessibility, desktop clipping and autosave navigation/typing loss. |
| figures-status.md | R/F pass; scheduled/permanent cleanup queue holes repaired; real Supabase remains unverified. |
| team-status.md | T passes; earlier claimed full shuffled two-deputy browser fixture was absent. I now supplies it and one-deputy centring. |
| growth-status.md | G passes; legacy non-space whitespace duplicate defect repaired; real LinkedIn value blocked. |
| analytics-status.md | A/G pass; precise local metric/privacy/permission evidence; production scheduling/load/device limits retained. |

## Release judgement

**Ready for PR review; not cleared for production release.** Owner/operator prerequisites: real LinkedIn value, canonical origin confirmation, historical schema/collision preflight, real Storage/RLS/service credentials/CDN, deployed authenticated scheduled-publish/GC/retention jobs, provider delivery and browser/device acceptance. No production operation occurred.
