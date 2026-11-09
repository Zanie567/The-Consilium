# Vercel Active CPU: diagnosis and fixes (8 November 2026)

Why The Consilium used up the Hobby plan's 4 hours of Fluid Active CPU, what branch
`perf/vercel-cpu-optimisation-2026-11` changes, and what can only be measured after it is deployed.
Every figure is labelled as measured (with its source) or estimated. Follows
[vercel-hobby-resources.md](vercel-hobby-resources.md) (PR #180), whose changes are kept.

## 1. Evidence

Production was serving normally when this was written (7 November 23:22 UTC: `/` 200, functions in
`dub1`). The 402s seen at 13:55 GMT that day were not reproduced; the request below is the only
production traffic this work generated, apart from read-only metric queries.

Unlike in October, Vercel's metrics API now answers on Hobby (`vercel metrics`, 30-day history):
per-route Active CPU, invocations, cold/hot start type, prefetch flag, cache result and bot
category. All numbers in this section come from it (production only), except where stated.

**30 days to 7 November**: functions 132.5 min + proxy 51.6 min = **3 h 04 min** (the dashboard's
3 h 56 min covers a different window). **Last 7 days**: 51.5 min, i.e. ~3 h 40 min per 30 days: the
current pace alone reaches the limit. Active CPU per invocation is billed in 10 ms steps (p50 values
are exact multiples of 10), so invocation count matters as much as code speed.

| Last 7 days | Active CPU | Share | Invocations | Avg |
|---|---:|---:|---:|---:|
| **Proxy (all requests it matched)** | 949 s | 30.7% | ~24,000 | ~40 ms |
| `/` homepage HTML | 486 s | 15.7% | 629 | 773 ms |
| `/articles/[slug]` | 336 s | 10.9% | 2,551 | 132 ms |
| `/category/[slug]` | 156 s | 5.1% | 2,241 | 70 ms |
| `/api/analytics/track` | 115 s | 3.7% | 2,037 | 56 ms |
| `/api/publish-scheduled` | 110 s | 3.6% | 1,894 | 58 ms |
| `/api/auth/[...nextauth]` (99% `/session`) | 93 s | 3.0% | 2,017 | 46 ms |
| `/tag/[slug]` | 87 s | 2.8% | 1,105 | 78 ms |
| `/author/[slug]` | 65 s | 2.1% | 662 | 98 ms |
| `/api/ticker/markets` + `/macro` | 61 s | 2.0% | 551 | 110 ms |
| `/index` (homepage RSC) | 44 s | 1.4% | 694 | 64 ms |
| static-page refreshes (`*.segments/_tree.segment`, about, privacy, ...) | ~70 s | ~2.3% | ~300 | ~230 ms |
| everything else (editorial, profile, other APIs) | ~520 s | ~17% | | |
| **Total** | **3,089 s** | | | |

What explains it:

- **Cold starts.** Over 7 days, cold invocations were 45% of all function CPU (981 of 2,185 s).
  For the homepage, article, category and tag routes: 563 cold starts (8% of invocations) cost
  637 s (57% of their CPU), 1.13 s each, against 65 ms for a warm render. A low-traffic site keeps
  starting instances. A local profile of a cold render: about a quarter Prisma's query-compiler
  WebAssembly start-up, about 40% Node module loading and app code.
- **Prefetches.** 14,305 of 37,921 requests (38%) were Next.js link prefetches, and every
  public content page was rendered per request (`ƒ`), so each prefetch was a full render. Articles:
  2,107 prefetch renders against ~480 visits; category pages: 2,096 against ~190.
- **The proxy ran for every page request**, including prefetches and CDN-cacheable pages (it runs
  before the cache). 78% of its CPU (707 of 910 s in the top 100 paths) was on page paths, where for
  an anonymous request it does nothing: `getToken` returns null without a cookie, and the
  retired-address lookup (Prisma) ran for every `/articles/<slug>` request although only two
  retired addresses exist. Its p99 of 663 ms is cold starts, some loading Prisma.
- **The homepage** is the most common entry page, so 42% of its renders were cold (1.4 s each).
- **Bots are not the cause.** Verified crawlers made ~800 requests a week. "Unknown" bot traffic
  (7,744) was mostly Supabase's own scheduler (`pg_net`, 1,943), one headless scraper (`Lightpanda`,
  650) and ~470 probes for missing pages, which the static 404 page answers.

### Diagnosis

| Status | Finding |
|---|---|
| CONFIRMED | Per-request rendering of public pages (prefetches included) plus the cold starts it causes: ~38% of CPU |
| CONFIRMED | Proxy invocations on anonymous page requests: ~24% of CPU (78% of the proxy's 30.7%) |
| CONFIRMED | Static pages rebuilt hourly by the footer cache: ~2% |
| STRONGLY SUSPECTED | Session refetches (`/api/auth/session` on every page load and tab focus, anonymous included): most of the 3% |
| POSSIBLE | Analytics heartbeats (3.7%) and ticker cache misses (2%) could be cheaper; not changed (accuracy and freshness rules) |
| RULED OUT | Bots and crawlers as a main cause; the scheduler as a main cause (3.6%, and changing it needs a migration, see §5); duplicated schedules (none) |

## 2. Changes

| Change | Why | Files |
|---|---|---|
| Proxy matcher: always for `/api`, `/admin`, `/editorial`, `/dashboard` and the retired `/articles/draft-<digits>` addresses; for every other page only when a NextAuth session cookie is present | Anonymous page views and prefetches no longer start the proxy. Signed-in readers keep the ban redirect; every API keeps its 401s, CSRF check and attestation stripping | `src/proxy.ts` |
| Article, category, tag pages and the homepage served from the CDN (ISR, 1 h lifetime, rendered on first request, never at build) | A prefetch or visit of a cached page runs no function and no proxy | `src/app/articles/[slug]`, `category/[slug]`, `tag/[slug]`, `(home)/home-section/[category]`, `src/components/home/HomeView.tsx` |
| Homepage tabs: `next.config.ts` rewrites `/` to `/home-section/_` and `/?category=<slug>` to `/home-section/<slug>` | A page that reads `searchParams` is rendered per request; a path parameter can be cached. The URL in the browser is unchanged | `next.config.ts` |
| `revalidateArticleLists()` also expires every CDN-cached page (`revalidatePath('/', 'layout')`, immediate) | All 17 existing call sites (publish, withdraw, trash, restore, corrections, scheduled publishing, user changes) now refresh the cached pages too. Article pages read the database directly, so the tag alone would not reach them | `src/lib/revalidateArticles.ts` |
| Profile saves (account, team profile, account deletion) and photo credits refresh the cached pages | Bylines and credits appear on cached pages; these writes had no invalidation because the pages used to be per-request | `api/profile/account`, `api/team-profile`, `api/editorial/articles/[id]/cover-metadata` |
| Comments box and debate vote personalise in the browser | A cached page is identical for everyone. Comments read the client session already loaded by `AuthProvider`; the debate panel asks `/api/debates/active` (which already returned the viewer's vote) and holds voting until it answers. No active debate exists today, so that request is not made | `CommentSection.tsx`, `DebatePanel.tsx` |
| Footer LinkedIn cache 1 h → 1 day; glossary cache 5 min → 1 h | A page refreshes as often as its shortest cache; both are expired at once when edited | `growthSettings.ts`, `glossary/data.ts` |
| Database failures are no longer stored as cacheable output | The tag page turned any error into a 404; the footer link and glossary cached a failure as "none". Cached, these would have lasted hours. Errors now reach the retryable error page, and a failed background refresh keeps the last good copy | `tag/[slug]`, `growthSettings.ts`, `glossary/data.ts`, `HomeView.tsx` |
| Testing mode: the root layout runs `requireTestingWorkspace()` | The proxy no longer sees anonymous page views, so its workspace gate is repeated where every page renders | `src/app/layout.tsx` |
| Testing mode: cached routes are rewritten to per-request twins (`src/app/testing-dynamic`, 404 outside testing mode) | In testing mode the root layout reads the session (banner, persona identity), which a cached route cannot do at request time (`DYNAMIC_SERVER_USAGE`). Segment config must be a literal, so the switch is a build-time rewrite in `next.config.ts`; each twin re-exports the production page code | `next.config.ts`, `src/app/testing-dynamic/**` |

Not changed: author and archive pages (they read `?category=`/filters; candidates for the same
rewrite), `/opinion-debate`, `/team`, all API routes and their rate limits, analytics, the ticker's
freshness rules, newsletter code, every schedule.

## 3. Measurements

### Local benchmark (same machine, data and workload; before = `main` 289a1ffd)

Method: `next start` of each production build against a throwaway seeded Postgres 16 (13 published
articles), local-only settings, no production keys. CPU = user+sys of the server process tree
(`ps`), warm = mean of 40 sequential requests after 5 warm-ups, cold = first request after a fresh
start (boot excluded). Apple Silicon: read the numbers as relative. Script:
`scripts/perf/cpu-bench.py` (usage in its header).

| Request | Warm CPU before → after (ms) | Cold CPU before → after (ms) |
|---|---|---|
| Homepage HTML | 11.5 → 1.8 | 590 → 20 |
| Homepage prefetch (RSC) | 3.5 → 2.3 | 140 → 20 |
| Article HTML | 15.0 → 1.3 | 830 → 20 |
| Article prefetch | 3.0 → 1.8 | 550 → 10 |
| Category HTML | 9.3 → 1.5 | 510 → 10 |
| Tag HTML | 9.0 → 1.3 | 570 → 20 |
| Author / archive / team (unchanged, per request) | 10.8 / 9.0 / 12.0 → 12.8 / 11.0 / 7.0 | 680 / 640 / 510 → 610 / 600 / 490 |
| `POST /api/publish-scheduled`, nothing due | 2.0 → 2.3 | 480 → 450 |

"After" for cached pages is Node serving its own ISR cache; on Vercel those requests are answered
by the CDN and run **no function and no proxy at all**. Wall time per request fell from 15–19 ms
to ~11 ms for the cached pages. No latency regression was observed on the unchanged routes
(differences are within run-to-run noise).

The browser suite always runs in testing mode, so it exercises the per-request twins (the same
page code), not the CDN-cached path. The cached path was checked by hand on a production-mode
build, as follows, and is pinned by `tests/unit/public-page-caching.test.ts`.

Correctness checks on the same build: a cached 404 for a scheduled article became the article on
the next request after `/api/publish-scheduled` published it, and it appeared at once on the
homepage, its tab and its category page (all warm before); signed-in and anonymous responses were
byte-identical for every cached page; `/?category=opinion` served the Opinion tab with the URL
unchanged.

### Expected production effect (estimate, at last week's traffic)

| Item | Last 7 days | Expected after | Basis |
|---|---:|---:|---|
| Proxy on page paths | ~737 s | 75–220 s | only signed-in page requests remain; their share is unknown (10–30% assumed) |
| Homepage, article, category, tag renders | 1,109 s | 280–685 s | at most 1,023 refreshes a week (replay of last week's hourly traffic with a 1 h lifetime, vs 7,220 renders); 200–560 of them cold at 1.13 s, the rest warm |
| Static page refreshes | ~70 s | ~5 s | daily instead of hourly |
| Remaining dynamic pages | | +0–100 s | fewer requests keep their instances warm, so more cold starts |
| **Total** | **3,089 s/week** | **~1,640–2,190 s/week** | **−29% to −47%; ~117–156 min per 30 days against 240** |

The range is wide because the number of cold starts after the change cannot be measured locally.
Do not quote a percentage until §4 has been run on production.

## 4. To measure after deployment

Run a week after the deployment (and once a day in the first days), compare with §1:

```sh
vercel metrics vercel.middleware_invocation.count --since 7d -p the-consilium --scope zanie567s-projects --prod
vercel metrics vercel.middleware_invocation.function_cpu_time_ms -a sum --since 7d -p the-consilium --scope zanie567s-projects --prod
vercel metrics vercel.function_invocation.function_cpu_time_ms -a sum --group-by route --since 7d -l 30 -p the-consilium --scope zanie567s-projects --prod
vercel metrics vercel.function_invocation.count --group-by function_start_type --since 7d -p the-consilium --scope zanie567s-projects --prod
vercel metrics vercel.request.count --group-by cache_result --since 7d -p the-consilium --scope zanie567s-projects --prod
```

Expect: proxy invocations down by roughly three quarters; `/home-section/[category]`, article,
category and tag invocations a small fraction of their requests; `cache_result` HIT up. Also check on
the preview first (needs the deployment-protection bypass): `curl -sI <preview>/category/news` twice
shows `x-vercel-cache: HIT` the second time, and `/?category=news` shows the News tab.

## 5. Recommendations not implemented

1. **Session refetches** (~3%): `SessionProvider` fetches `/api/auth/session` on every full page
   load and every tab focus, for anonymous readers too. Fixing it means changing how sign-in state
   reaches the browser; it needs its own change with the session E2E suite.
2. **Author and archive pages** (~3%): the same rewrite technique as the homepage tabs.
3. **Scheduler** (3.6%): unchanged. The idle call is cheap when warm (2 ms) but usually starts a
   cold instance (p50 20 ms, p90 117 ms, avg 58 ms on Vercel). The database-side "anything due?"
   pre-check in vercel-hobby-resources.md §8 needs a production migration and owner approval.
4. **Vercel Firewall** (free on Hobby): a custom rule denying obvious exploit probes (`*.php`,
   `/wp-*`, `/.env`) and a rate limit on `/api/analytics/track` would trim little now; not needed
   for the CPU limit. Do not block AI crawlers wholesale (some are discovery). Not changed.
5. **Cache lifetime**: if production shows on-demand invalidation is reliable for a few weeks,
   raising `PUBLIC_PAGE_REVALIDATE_SECONDS` (and the literals) from 1 h to 1 day would cut the
   remaining refreshes by about 70% more (replay: 305 instead of 1,023 a week).

## 6. Rollout and rollback

1. Merge after review and a green CI (the full browser suite runs there).
2. Production deploys from `main`. No database, schedule, secret or setting changes are needed.
3. Watch for a day: homepage tabs, publish/withdraw an article (both should show at once), a signed-in
   reader's comments box, `vercel metrics` (§4), and runtime errors.
4. Rollback: Vercel Instant Rollback to the previous production deployment, or revert the merge
   commit. Nothing is stored that the old code cannot read. After a rollback the CDN copies made by
   this version are discarded with its deployment.
