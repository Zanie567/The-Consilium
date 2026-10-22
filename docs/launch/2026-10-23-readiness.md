# The Consilium: launch readiness for Friday 23 October 2026 (refreshed 22 October)

**Recommendation: NO-GO as of 22 October 21:30 BST, for production.** The code is ready for review, but the confirmed exposures are still live until #155 is deployed and its SQL applied. Code readiness and production readiness are separated in the GO criteria below.

Two confirmed security defects are still live in production:
- the public Data API and Storage exposures;
- critical advisories in the deployed Next.js 16.2.2.

Fixes for both are ready for review, but none is merged, deployed or applied. Several operational gates also remain open, including a fresh verified backup.

This supersedes the 18 October assessment in draft #151. Its two largest blockers have changed since then:
- the corrections schema is now applied;
- the policy defect has a tested fix.

Every statement below was re-checked on 22 October unless marked as historical.

Baseline: `origin/main` at `59c2015` (#152, #153 and #154 merged), which is the deployed production commit (Vercel
deployment created 22 October 10:41 BST). Production inspection was read-only: catalog queries, aggregate counts,
advisors, workflow status and ordinary public HTTP requests. No article content, personal data or credentials
were read. Nothing was written, migrated, deployed, merged, restored or rotated.

## Pull requests from this review

| PR | Scope | State |
|---|---|---|
| **#155** `security/public-access-hardening` | Data API/Storage migration `20261018002859` + guarded operator scripts; public JSON article API projection | CI green; mergeable. SQL **not applied** (needs approval + backup) |
| **#156** `security/data-api-permissions-audit` (stacked on #155) | Function/sequence default privileges, bucket declaration, full-rebuild permission inventory, 30 October change | CI green (after one WebKit re-run). Merge after #155, then retarget to `main`. SQL after #155's |
| **#157** `deps/runtime-security-advisories` | Next 16.4.2, next-auth 4.24.15, sanitize-html 2.18.1, Tiptap 3.31.4, resend 6.12.4; read-after-write restored; error-boundary `retry` | Ready for review once CI on `67bff04` is green |
| **#158** `launch/readiness-consolidated` (this branch) | #150 in full plus #151's non-security fixes, rebased on `main`; this report | CI green. Moves functions to `dub1` on deploy |

## Gates

| Area | Status on 22 October | Evidence | Needed for GO |
|---|---|---|---|
| **Data API / Storage exposure** | **Open (confirmed).** The anon key can read the full text of the 2 trashed articles and every team card (including inactive). Any Supabase Auth user can upload any file to `article-images`. Anyone can list `article-images`. | Catalog + local Supabase stack reproduction (PostgREST/Storage over HTTP); preflight of the fix returns all `ok` on production | Owner approval → backup → merge #155 → run `docs/launch/POLICY-ROLLOUT.md` |
| **Public JSON article API** | **Open (confirmed from source).** `GET /api/articles` and `/api/articles/[id]` return `editorNote`, `editorialCommendation`, `engagementScore`, `scheduledAt` to visitors | Real-DB integration test fails on `main`, passes on #155 | Deploy #155 |
| **Runtime dependencies** | **Open in production; fix ready (#157).** Applicable to production today: Proxy bypasses (limited by our server-side permission checks), RSC DoS, cache poisoning, sanitize-html bypasses on public article HTML, editor paste XSS. Not applicable here: `next/og` RCE (not used), Server Action/rewrite SSRF (none). Likely not applicable on Vercel: the Image Optimizer RCE | Fresh `npm audit`. The upgrade's one behaviour change (Next 16.3+ writes cache invalidation after responding) is **fixed** in #157: mutations await the write, so lists, feed and sitemap are fresh on the next request | Merge + deploy #157 |
| **Corrections schema** | **Closed.** `20261017120000` applied 20 October; trigger enabled; registry 25 rows | Catalog | Do not reapply |
| **RLS coverage** | **OK.** 43/43 public tables have RLS. 35 INFO "no policy" notices are server-only tables by design. 1 WARN (search path), fixed by #155 | Advisors 22 Oct 15:55 UTC | — |
| **Scheduler** | **OK, not yet exercised with content.** `publish-scheduled` `*/5`, 288/288 successes in 24 h, 0 warnings; reconciler active; GitHub health checks green (01:39, 07:46, 13:56 UTC). **0 live articles; 4 scheduled, first due 23 Oct 08:00 UTC (09:00 BST)** | Aggregates + Actions | Editor watches 09:00–09:10 BST; manual fallback ready (runbook below) |
| **Email delivery** | **Unverified.** Code path tested with captured transport only. #151's fix (a rejected send now raises a warning) is on this branch | Isolated tests | A human confirms real receipt of a publication email |
| **DB failure handling** | **Fix ready.** On `main`, a database error renders as a 404 or a cached empty home page. This branch keeps failures retryable and uncached (#150) | Unit + real-DB tests | Deploy this branch |
| **Analytics persistence** | **Fix ready.** On `main`, staff time-series/top-articles queries use non-existent columns (`viewed_at`/`article_id`; production has `viewedAt`/`articleId`), so both endpoints fail. Tracking silently acknowledges failures | Production column list; tests | Deploy this branch |
| **Performance** | **Fix validated on preview.** Production functions run in **Washington (iad1)** and the database is in **Ireland (eu-west-1)** (`x-vercel-id: lhr1::iad1::…`). #158's preview answers from **`lhr1::dub1::…`**. Previews have no database, so the latency gain on database-backed pages (one transatlantic round-trip saved per query) is inferred, not measured; no production load test was run | Production headers; preview headers | Deploy #158; then confirm `::dub1::` and home-page TTFB in production |
| **Caches** | Personalised HTML `private, no-store`; lists cached 30 s with publish-time invalidation; feed 300 s. **Two Next 16.3+ invalidation defects found and fixed in #157:** (1) invalidation was written after the response, so mutations now await it; (2) tag expiry compared a wall-clock stamp against the monotonic clock, so invalidations were ignored while the clocks drifted (about 0.4 ms/min, or a whole sleep). A version-pinned patch takes the later clock. Withdrawn article **bodies** were never affected: article pages read the database uncached | Next's own modules; paired browser runs; `pmset` | After deploying #157, confirm the 09:00 scheduled articles appear in lists and the feed at once |
| **SEO / social** | **Partly.** #154 share card live (`/og/consilium-share-v2.png` 200, `summary_large_image`). **Canonical and `og:url` point at `https://theconsilium.co.uk`, which 307-redirects to `www`.** Sitemap 15 URLs; RSS 0 items (expected: nothing is live yet) | HTTP smoke 22 Oct | Owner decides canonical host (`SITE_URL`); check real previews after the first article goes live |
| **Backups / DR** | **Open.** Latest evidenced verified DB backup: 16 Oct; Storage copy: 15 Oct (41 objects; production now 59). Hosted recovery untested (#132) | Historical receipts; volume not mounted today | Fresh verified encrypted DB + Storage backup before launch and before any SQL rollout; owner accepts the #132 gap |
| **CI** | **`main` red; all four PRs green or finishing.** `main`'s `59c2015` failed `wf-trading-challenge.spec.ts:115` (WebKit, CI only; 15/15 locally). #156/#158 each failed one unrelated WebKit test and passed on re-run. Locally, a paired comparison found `wf-unified-profile.spec.ts:68` failing **identically on `main`**: a script cancelled by the next navigation, with the save verified. These are pre-existing WebKit test-timing issues, investigated and recorded, not regressions | Actions runs; traces | Accept as known flakes, or fix in a follow-up |
| **Real devices** | **Unverified.** Engine emulation only | — | Human smoke on iPhone Safari, Android Chrome, desktop Safari/Chrome |
| **Hosted load** | **Not demonstrated.** Local probes only (#150) | — | Owner accepts the envelope or tests an isolated hosted preview. **Never load-test production** |

## Dependency audit (fresh, 22 October)

`npm audit` on `main`: 46 findings (4 critical, 29 high, 12 moderate, 1 low). Classified by where the code runs:

- **Server runtime:**
  - `next` 16.2.2: critical and high. No 16.2.x release has the fixes. 16.4.2 does, and also ships the image-abort fix the repo had been backporting.
  - `next-auth` 4.24.13 / `@auth/core` 0.41.1: getToken DoS, OAuth check-cookie binding, email-normaliser bypass.
  - `sanitize-html` 2.17.4: URI-scheme, SVG and nesting bypasses in the sanitiser for public article HTML.
  - `resend`/`svix`/`uuid`, `ws` (Supabase realtime client, unused): low.
- **Browser (editor):** `prosemirror-view` <1.42.3 paste XSS; `@tiptap/core` attribute/markdown issues. Staff-only surface, but stored XSS there could act with an editor's session.
- **Build/test only, not deployed:**
  - prisma CLI and its dev server (hono, mysql2, valibot, deepmerge-ts, fast-uri);
  - vitest/vite, jsdom/undici;
  - eslint and plugins, jscpd/braces/micromatch, type-coverage, js-yaml, smol-toml;
  - postcss/source-map-js at build time.

**#157:** after it, `npm audit` reports only build/test tooling, plus `@auth/core@0.34.3`. That package is an optional *type-only* peer of next-auth v4: no next-auth JavaScript loads it (verified by searching its runtime files). `eslint-config-next` stays 16.2.2: 16.4.2 adds React Compiler lint rules that would need component refactors.

Verification on the branch:
- typecheck, lint and 1,819 unit tests pass;
- the image-abort diagnostic on 16.4.2: with the pre-fix code restored, every image after an aborted request times out; as installed, all return 200;
- a full isolated browser + real-DB run (results in the PR).

No `npm audit fix --force`, no major-version changes.

## Reconciling #150 and #151

- **#151's performance commit** is #150's first commit, patch-identical (`143c1d8` = `b498a64`).
- **#151 lacks #150's later commits:**
  - resilient optional home panels (a failing featured/categories read no longer takes down the home page);
  - stronger asynchronous consent-delivery tests;
  - the `dub1` region proposal;
  - the final evidence.
- **#151's security work** is superseded by #155:
  - #155 covers more: the list endpoint and Storage listing;
  - #155 tests against real Supabase roles and APIs. #151's database test used a hand-made schema and roles that CI's plain Postgres does not have.
- **#151's unique, still-valid fixes:**
  - scheduled-email warning;
  - analytics column names;
  - consistent reading-time estimates;
  - launch browser projects and spec;
  - load probe hook;
  - backup-guide updates.

**Recommendation:** close #150 and #151 as superseded once this branch has a PR; don't merge either.
- This branch already carries everything worth keeping from both, rebased on current `main`.
- Rebasing #151 would reintroduce the outdated migration and its fake-schema test.
- Merging #150 alone would miss #151's bug fixes.

Verified line by line (22 October): **every line #150 added** is present in #158. Every line #151 added is present in #158 or #155, except deliberate omissions:
- its 18 October report and evidence files (rewritten from fresh evidence; the originals remain on #151's branch);
- its migration, rollout doc, `[id]` projection and fake-schema test (superseded by #155's versions);
- earlier wordings that #150 later refined.

Nothing from #152, #153 or #154 is reverted. Every line `main` added to the files these PRs touch survives on this branch.

## Separate Supabase permissions audit

See `docs/security/DATA-API-PERMISSIONS.md`. In short:
- The 30 October change needs **no grants** here. Do **not** add a bulk re-grant.
- The remaining default exposure is functions (callable via `/rpc` by anon) and sequences. #156 closes it and adds a full-rebuild permission inventory to CI.

The old `consilium/security-permissions-fix` branch has no commits ahead of `main` and was not used.

## Freeze, launch day and incident runbook

The 18 October procedures in #151 remain valid, with these updates:

- **Freeze:** 22 October 18:00 BST to 23 October 18:00 BST. Security PRs are the exception, with owner approval, a fresh verified backup and the documented rollouts.
- **09:00 BST publication:** the editor checks the 4 scheduled articles are public by 09:05. If not, use the manual-only GitHub "Publish Scheduled Articles" workflow on `main` once, then verify exactly the intended articles, one notification each, and the email warning field. Don't invoke it repeatedly or change credentials.
- **Rollback:** Vercel Hobby Instant Rollback reaches only the immediately previous production deployment. It doesn't undo database policies (none are needed: the app doesn't depend on them). Never restore a database to fix a code problem.
- **Suspected exposure:** preserve evidence. The fix is the reviewed migration, not ad-hoc dashboard edits.

## Release sequence (each merge or SQL step needs owner approval)

1. **Before any merge that adds a migration:** confirm Supabase → Integrations → GitHub → "Deploy to production" is **OFF**. Merges have never applied migrations (the integration's branch record is unchanged since 16 October, and #144's migration waited for its manual rollout), but check anyway.
2. **#155:** merge and deploy. The site behaves the same before and after its SQL. Until the SQL runs, the Data API exposures remain exactly as today.
3. **Fresh verified encrypted backup**, then **#155's SQL** (`docs/launch/POLICY-ROLLOUT.md`: preflight → guarded apply → `migration repair` → verify).
4. **#157:** merge and deploy (independent of the SQL). Smoke-test images, an article, login and the editor.
5. **#158:** merge and deploy (moves functions to `dub1`), ideally after launch-morning publication, or before it if you want its database-error and analytics fixes live.
6. **#156:** retarget to `main` after #155 merges, merge, then its SQL (`docs/security/DATA-API-PERMISSIONS.md`). It isn't urgent: it closes future-default exposure, and no current exposure is known.
7. Close #150 and #151 as superseded.

**Combined verification (22 October, late evening):** all four merged together locally onto current `main`, with the machine kept awake (`caffeinate`):
- Typecheck, lint and unit tests pass.
- The Data API suite and both rollout rehearsals pass.
- Full isolated suite on Postgres 17: Vitest **2,644 passed**; Playwright **835 passed**, **1 failed**. The failure is `wf-unified-profile.spec.ts:138` on WebKit, also failed by #158's CI on unchanged Next 16.2.2.

Earlier failures in long local runs came from two Next 16.3+ cache-invalidation defects, both fixed in #157, made worse by this laptop sleeping (`pmset`: 19:27–19:34 and 21:35–21:55). The uncaught `ECONNRESET` log lines in long runs are pre-existing: `main`'s CI on 16.2.2 logged 5.

## GO criteria

**Code readiness (met when CI is green on the final heads):**
- [x] Security fixes implemented and tested against real Supabase roles and APIs (#155, #156).
- [x] Dependency fixes with read-after-write preserved and regressions fixed (#157).
- [x] #150/#151 reconciled without losing changes (#158).

**Production readiness (requires owner actions):**
- [ ] #155 deployed **and** its SQL applied and verified, after a fresh verified backup. *Until then the confirmed exposures are live: NO-GO.*
- [ ] #157 deployed (production reports Next 16.4.2), or the owner explicitly accepts the remaining 16.2.2 exposure for launch day with #157 merged straight after.
- [ ] Scheduler: a recent success within 10 minutes at 08:55 BST, and an editor watching the 09:00 publication of the four scheduled articles.
- [ ] Real-device smoke and one real publication-email receipt.
- [ ] Owner decisions: canonical host (apex vs `www`); acceptance of the hosted-recovery (#132) and hosted-load gaps.
