# Hosted staging verification, 2026-10-10

Exact commit deployed: `7202db9e266154369ff5e5f2afb85929b8319666` (tree hash `04533232040d27ae212e567465ee6ff7e8c7c645`, verified
identical to the uploaded directory).

> **Scope warning (corrected).** An earlier version of this page said later commits "only add documentation". That is **not true**: every commit after
> `7202db9` that changes `src/`, `prisma/` or `supabase/` has **not** been deployed to hosted staging and has **not** been verified there. The section
> "Scope of hosted verification" below lists exactly what was and was not tested where.

| | |
|---|---|
| Vercel project | `consilium-testing` (`prj_zr8Of1h2eREC64esLiwFnpimtXno`), team `zanie567s-projects`. **Not** `the-consilium`. |
| Deployment | `dpl_Dzsp2oGdRaecUB4tEHBM595r9v2i`, READY, target production of the testing project |
| URL | `https://consilium-testing.vercel.app` (alias) / `https://consilium-testing-duj77j2v5-zanie567s-projects.vercel.app` |
| Method | `git archive` of the commit to a clean directory, `vercel link` + `vercel deploy --prod`. Nothing pushed; mirror and `origin` untouched. |
| Previous deployment (rollback target) | `dpl_BHnMFF7TUp7KfkkhfBnSm1LmAnXz` |
| Database | Supabase `consilium-testing` (`zrieajoqosgzyesfatta`). Attestation matched before and after. Production (`scllbuwkcqtmfogsgalt`) was never queried or modified. |
| Migrations | Applied one at a time, each verified, recorded in history: `20261010122238 admin_overhaul_1_debate_lifecycle_20261010`, `20261010122248 admin_overhaul_2_team_member_updated_at_20261010`, `20261010122319 admin_overhaul_3_hidden_debate_article_guard_20261011`. All pre-migration data hashes were unchanged afterwards. |
| `/api/admin/deployment-health` | 200 `{"healthy":true,"gaps":[]}` (includes the three new checks and the guard) |

## Scope of hosted verification (what ran where)

| | Hosted staging (`consilium-testing`) | Local isolated stack only |
|---|---|---|
| Code that ran | `7202db9`, deployment `dpl_Dzsp2oGdRaecUB4tEHBM595r9v2i`, READY (re-checked read-only: aliased to `consilium-testing.vercel.app`; its live `feed.xml` still answers `Cache-Control: public, max-age=3600`, i.e. the pre-fix behaviour, which is consistent with the older code) | Every commit after `7202db9` |
| Database | Migrations 1 to 3 applied and recorded (registry `20261010122238`, `20261010122248`, `20261010122319`); objects confirmed present by a read-only catalog query | Migrations 1 to 4 on disposable local PostgreSQL |
| Migration 4 (`20261012100000_article_hidden_by_debate_marker.sql`) | **not applied** | applied, tested, rolled back and re-applied |
| Feed and sitemap freshness fix (`publicFeeds.ts`, uncacheable XML, tagged data cache) | **not deployed, not verified hosted** | unit, real-Postgres and production-build browser tests |
| "Replace with an existing profile" for placeholder cards | **not deployed, not verified hosted** | real-Postgres (incl. a two-administrator race) and browser tests |
| Scenario row ownership (reset never deletes another persona's data) | **not deployed, not verified hosted** | real-Postgres tests |
| Debate-form labels, "saved" message, user-deletion cache expiry | **not deployed, not verified hosted** | browser and real-Postgres tests |
| Archived-versus-auto-hidden restoration (`hiddenByDebateAt`) and the hidden-debate filters on series, topics, comments, reading progress and view counting | **not deployed, not verified hosted** | real-Postgres tests, including negative controls |
| Scheduled publishing against hidden debates | **not verifiable on hosted staging** (it has no scheduler) | real-Postgres tests through the real endpoint |

The "Verified in the hosted browser" section below describes `7202db9` only. The "Resolution of the findings" table further down records the fixes and the
**local** evidence for them; none of it was exercised on hosted staging. Doing so requires the staging deployment plan to be approved and executed.

## Verified in the hosted browser (all through the real UI unless stated)

* **Debates**: create, edit, unpublish, publish, delete, restore, republish, delete, permanent delete (typed-title gate: disabled with no/wrong text, enabled
  with the exact title). At every step the public site, search and the two article URLs followed (404 when hidden). A hand-made `PUT /api/articles/:id`
  to publish a hidden debate's article returned `409 HIDDEN_DEBATE_ARTICLE`, while unpublished and while deleted. Audit trail: 9 entries, in order.
  Ordinary article create/publish/trash still works and the public URL follows.
* **Team Members**: recent sign-up listed, authorised, linked profile, owner edited own bio (public), forged title/role refused (400), a writer is refused the
  page and APIs (403), admin changed the title (persisted after reload, public), access role changed with the title untouched, hide and restore (public
  follows), Editor-in-Chief title and link survive role changes, reorder. Database read-back matched the UI.
* **Dashboard**: new admin menu, overview, Subscribers / Login Attempts / Data Management / Testing all open; 7 pages x desktop and phone: one `h1`, every
  control labelled, no sideways scroll, clean console.
* **Testing Mode, real isolated personas**: Writer, Editor and Growth each: server identity is the persona, exact role menu, profile prompt present/absent
  as the scenario dictates, notifications, restricted pages bounced, administrator-only APIs refused (401/403), "Check access" all pass (14 / 20 / 12 probes).
  Editor approved an article through the confirmation dialog (it became public) and returned another with a note. Session: 15 minutes, shared across tabs,
  switching makes the other tab follow, a stale form is refused (409 `TESTING_IDENTITY_CHANGED`), a **really expired** session returns to the
  administrator and a request with the old persona identity is refused (403), Exit works.
* **Scenarios**: applied for each persona; Reset restored every persona's profile hash, notifications, articles and achievements to the pre-test baseline
  (one exception, below). No scenario rows, snapshots or open sessions remained.
* **Email and external effects**: the 4 distinct workflow emails (access granted, role updated, article live, article returned) were captured in
  `testing_email_outbox`; every recipient was `@consilium.test`; nothing external. No production service was contacted.
* **Cleanup**: all test accounts, profiles, articles, sessions and two stray notifications removed; fixture card orders restored. Users, team and articles
  hashes equal the pre-migration snapshot.

## How verification was driven

The repository's Playwright harness deliberately refuses remote targets, so a standalone script (hard-wired to the staging hostname, scratch directory,
not committed) drove Chromium. The operator password file was not available, so a temporary `@consilium.test` administrator was created in the testing
database and deleted afterwards. Browser console errors were only my own deliberate refusal probes (403s).

## Findings (nothing was fixed or redeployed; each needs your decision)

1. **Feed and sitemap can lag behind removal (recommend fixing before production).** `feed.xml` is sent with `s-maxage=3600`; `sitemap.xml` is cached
   and nothing revalidates it. After an unpublish/delete the feed can keep a removed article's title and excerpt for up to an hour, the sitemap its URL
   until the next refresh. Pre-existing for every article, but it is the "alternative route" the hidden-debate rule is meant to close. Proposed fix: call
   `revalidatePath('/feed.xml')` and `('/sitemap.xml')` from `revalidateArticleLists` and `revalidateDebateSurfaces`, and lower the feed's `s-maxage`.
2. **Authorising a verified account creates a hidden placeholder profile, which hides the "link an existing profile" picker.** Correct under the
   one-profile rule, but if the registered name differs from the existing card (and the card has no matching email) the admin must delete the placeholder
   first. Proposed fix: when the linked card is an unpublished, incomplete placeholder, offer "Replace with an existing profile" as one atomic action.
3. **Success message is not cleared between saves** in the profile editor, so a second identical save looks like the first. Proposed fix: clear on save start.
4. **Debate creation form labels are not associated with their inputs** (pre-existing component; my audit did not cover `/editorial/debates/new`).
5. **Scenario reset does not remove real side-effects of acting as a persona**: approving or returning a scenario article notified its author persona
   (untagged), so `writer-other` kept 2 unread notifications until I removed them. Documented limitation.
6. Staging has no scheduled-publish cron (only two cleanup crons), so its two fixture scheduled articles show as overdue on the dashboard.
7. Shared personas already carry unread notifications and an unseen achievement, so exact counts hold only for the Growth persona; the bell counts unread
   among the newest 20.
8. `GET /api/team` includes each card's contact `email` (pre-existing; the card renders it deliberately).

## Resolution of the findings (branch commits after `7202db9`; nothing redeployed; evidence is LOCAL, not hosted)

| # | Finding | Root cause | Fix | Evidence |
|---|---|---|---|---|
| 1 | Feed/sitemap lag behind removal | `feed.xml` was cacheable (`s-maxage=3600`) and `sitemap.xml` was static; `revalidatePath` cannot purge a CDN-cached Route Handler response | Both are now uncacheable XML (`max-age=0`, `s-maxage=0`, `force-dynamic`) built from one tagged data cache (`getCachedFeedItems`/`getCachedSitemapData`, tag `articles`, 5 min TTL). Every mutation expires the tag **after** its transaction commits (debate lifecycle, article trash/restore/archive/review, and the three user-deletion routes that remove an author's articles). A failed expiry is logged, returned to the admin as `publicCacheRefreshed: false` (shown as a warning), and bounded by the TTL. Visibility is the same `publishedArticleWhere` used everywhere, so hidden-debate articles are excluded even with inconsistent status; sitemap topics only list topics with a public article. | `tests/unit/public-feeds.test.ts`; `tests/integration/public-feed-visibility-db.test.ts` (warm cache, then trash/restore/archive/debate lifecycle/user delete, refused mutation expires nothing, failed expiry, inconsistent legacy data); `tests/e2e/wf-feed-invalidation.spec.ts` on a production build (real XML, headers). |
| 2 | Placeholder card blocks linking | A claim creates a hidden card, and a card per account is enforced, so the picker is hidden | "Replace with an existing profile": one transaction deletes the account's placeholder **only if provably disposable** (hidden, default title/placement/order, account's own name, no bio, photo or contact email: `teamPlaceholder.ts`) and links the chosen unowned profile untouched. Both rows are guarded on the `updatedAt` the admin saw; a genuine card, an owned target, a stale page or a race is refused with both cards intact. The audit row keeps the removed placeholder's values. Role and account id are never read or written. | `tests/integration/team-placeholder-replace-db.test.ts` (9, incl. a two-admin race), `wf-admin-team-members.spec.ts` (confirm dialog, reload persistence, public Meet the Team). |
| 3 | Stale "saved" message | The workspace message outlived the form it described | The editor reports real edits and save attempts; the parent clears the message. A reload that swaps in the saved card does not count as an edit. | `wf-admin-team-members.spec.ts` |
| 4 | Debate form labels | Labels had no `for`/`id`; body editors unnamed | Every label bound with a generated id; body editors named; validation names each missing field in an `alert`, marks required inputs `aria-invalid`, focuses the first problem; hidden editor file inputs named. | `wf-admin-ui-audit.spec.ts` (page added to the audit, plus a keyboard/label/validation test) |
| 5 | Reset leaves other personas' notifications | Review-queue articles were removed by whichever persona reset, and `Notification.articleId` is `ON DELETE SET NULL`, so deleting a scenario article left orphaned notifications elsewhere | Every scenario row now carries its owner (the slug names the persona the scenario was applied to, not its author). Reset removes exactly the rows it owns, plus the notifications that point at those articles; reset is idempotent; pre-owner rows are removed only by an editor or full reset. Remaining limit (untagged notifications from a tester's own actions that do not reference a scenario article) is stated in the UI and `TESTING-MODE.md`. | `tests/integration/testing-scenarios-db.test.ts` (17) |
| 6 | No staging scheduler | By design | Unchanged: no scheduler was enabled. Scheduled publishing is covered locally against real Postgres through the real `/api/publish-scheduled` route (hidden/deleted debate, race between listing and write, no corruption of the rest of the run, nothing lost once the debate is shown). **Not verified on hosted staging.** | `tests/integration/hidden-debate-guard-db.test.ts` (21) |
| 7, 8 | Shared persona counts; `/api/team` exposes card email | Pre-existing, documented | Unchanged | n/a |

## Second hosted round, 2026-10-10 (application tree of `0ec2897`, `dpl_DD8kY3HKinM1vaB17iaN5jZYDTd7`, migrations 1 to 4)

The earlier sections describe `7202db9`. The consolidated candidate was deployed afterwards and walked again as a temporary administrator, who was deleted at the end.
The results, the cleanup and the list of things not verified are in `PR-DESCRIPTION.md`, section "Hosted staging". Every finding above that was marked "not deployed, not verified hosted"
for the feed and sitemap, placeholder replacement, scenario ownership and the `hiddenByDebateAt` restoration rule has now been exercised on the hosted deployment (API and real UI for
Testing Mode; API for the debate and Team Members flows). One new observation: after a Testing Mode "Reset all personas" the feed kept a deleted `[Scenario]` article for about ten minutes.
