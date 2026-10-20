# Front-end performance: measured before and after

Branch `feat/trading-challenge`. Baseline: `main` at `3841f64`. After: `59e0807` plus the
chart-label follow-up (which changes no measured output).

## What changed and why

| Change | Problem it fixes | Evidence |
|---|---|---|
| `AnimateIn` / `StaggerContainer` render with CSS keyframes instead of framer-motion; `RevealOnScroll` keeps scroll reveals below the fold | Headings, article headlines and the homepage hero were sent at `opacity: 0` and only appeared after the JS bundle downloaded and hydrated | LCP −9% to −44% (applied throttling, below); no `opacity:0` in server HTML (`tests/unit/trading-challenge-render.test.tsx`) |
| framer-motion removed from the site chrome and the home/article components (navbar, theme toggle, tooltip, cookie banner, sign-up prompt, newsletter, category tabs, reading-progress bars, share buttons) | ~43 KB gzip of framer-motion was in every page's initial JavaScript | Initial JS −17% to −18% on every route (below) |
| `useScrolled` keeps only the boolean | Navbar re-rendered on every scroll frame although only `scrolled` was read | Code inspection; no metric claimed |
| EB Garamond loaded only by the editor | Two preloaded font files on every public page, used only in the editorial editor | Fonts transferred 178 KB → 86 KB per page |
| Testing-mode controls code-split | Testing-only code and the admin nav map shipped to every visitor | Included in the initial-JS figures |
| Trading page: one composited chart wipe, `content-visibility: auto` on long below-the-fold sections | First version spent ~0.5 s in style/paint animating 28 SVG candles (Lighthouse main-thread breakdown) | Measured during development: TBT 395 → 225 ms, LCP 2.74 → 2.18 s (applied throttling, consecutive runs; not interleaved, so indicative only) |

Not changed: server rendering, caching, revalidation, database queries and the
analytics path (owned by open PRs #150/#151), image configuration and allowlists,
security headers other than the one `frame-src` addition.

## Method

- **Builds:** `next build` + `next start` of each commit via `scripts/perf/serve-local.sh`,
  against the same local seeded test database (12 published fixture articles, Unsplash
  covers), with every production service disabled. Production has no published articles
  yet and Vercel Preview has no database, so neither gives a like-for-like comparison of
  content pages.
- **Lighthouse 12.8.2**, mobile preset (Moto G Power viewport, 4× CPU slowdown,
  ~1.6 Mbps / 150 ms RTT), performance category only, analytics endpoints blocked.
  `scripts/perf/lighthouse-routes.mjs`, **5 runs per route, medians reported**.
- **Interleaved:** before and after runs alternate per run (A,B,B,A,…) so both builds
  see the same machine conditions. This matters: the machine was shared with other
  heavy work during measurement (load average 11–17), and separate batches drifted by
  ~0.2 s in FCP.
- **Two throttling methods.** *Applied* (`--throttling devtools`) slows the network and
  CPU during a real load; *simulated* (Lighthouse default) replays an unthrottled
  localhost load through a model. Simulated mode understates this change: on localhost
  all JavaScript has loaded before the headline's first animation frame, so the model
  assumes the headline depends on that JavaScript. Applied throttling shows the real
  effect, so it is the primary result.
- **Initial JavaScript:** `scripts/perf/initial-js.mjs` sums every `/_next/static` script
  referenced by each route's HTML (gzip -9). Deterministic.
- Tables are generated from the JSON in `evidence/` by `scripts/perf/report-table.mjs`.

## Results: applied throttling (primary)

| Route | LCP before | LCP after | Δ | FCP before | FCP after | TBT before | TBT after | CLS after | Score before → after | Runs |
|---|---|---|---|---|---|---|---|---|---|---|
| Home | 5.38 s | 3.91 s | −27% | 2.55 s | 2.24 s | 289 ms | 397 ms | 0.000 | 67 → 74 | 5/5 |
| /about | 5.05 s | 2.82 s | −44% | 2.09 s | 2.31 s | 346 ms | 362 ms | 0.000 | 70 → 84 | 5/5 |
| /category/news | 4.96 s | 2.89 s | −42% | 2.42 s | 1.97 s | 477 ms | 118 ms | 0.000 | 64 → 93 | 5/5 |
| /category/analysis | 5.33 s | 3.84 s | −28% | 2.00 s | 2.03 s | 122 ms | 329 ms | 0.000 | 76 → 80 | 5/5 |
| /opinion-debate | 4.71 s | 3.37 s | −28% | 2.07 s | 2.43 s | 81 ms | 257 ms | 0.000 | 81 → 79 | 5/5 |
| Article | 3.51 s | 3.19 s | −9% | 2.48 s | 2.17 s | 330 ms | 213 ms | 0.000 | 72 → 87 | 5/5 |
| /trading-challenge | – | 3.05 s | new | – | 2.25 s | – | 514 ms | 0.000 | – → 78 | 0/5 |

## Results: simulated throttling

| Route | LCP before | LCP after | Δ | FCP before | FCP after | TBT before | TBT after | CLS after | Score before → after | Runs |
|---|---|---|---|---|---|---|---|---|---|---|
| Home | 4.14 s | 3.88 s | −6% | 1.22 s | 1.23 s | 80 ms | 40 ms | 0.000 | 86 → 87 | 5/5 |
| /about | 4.19 s | 3.48 s | −17% | 1.08 s | 1.10 s | 139 ms | 151 ms | 0.000 | 84 → 88 | 5/5 |
| /category/news | 3.92 s | 2.94 s | −25% | 1.07 s | 1.08 s | 31 ms | 96 ms | 0.000 | 87 → 94 | 5/5 |
| /category/analysis | 4.27 s | 3.65 s | −14% | 1.22 s | 1.22 s | 61 ms | 44 ms | 0.000 | 84 → 90 | 5/5 |
| /opinion-debate | 4.34 s | 3.61 s | −17% | 1.22 s | 1.22 s | 159 ms | 47 ms | 0.000 | 83 → 90 | 5/5 |
| Article | 3.95 s | 3.49 s | −12% | 1.24 s | 1.25 s | 22 ms | 67 ms | 0.000 | 88 → 91 | 5/5 |
| /trading-challenge | – | 3.69 s | new | – | 1.25 s | – | 250 ms | 0.000 | – → 85 | 0/5 |

## Results: bytes (deterministic)

| Route | Initial JS before (gzip) | after | Δ | Fonts transferred before | after |
|---|---|---|---|---|---|
| Home | 278 KB | 232 KB | −17% | 178 KB | 86 KB |
| /about | 253 KB | 207 KB | −18% | 178 KB | 86 KB |
| /category/news | 264 KB | 218 KB | −17% | 178 KB | 86 KB |
| /category/analysis | 264 KB | 218 KB | −17% | 178 KB | 86 KB |
| /opinion-debate | 256 KB | 210 KB | −18% | 178 KB | 86 KB |
| Article | 284 KB | 237 KB | −17% | 178 KB | 86 KB |
| /trading-challenge | – | 211 KB | new | – | 86 KB |

## What the numbers do and do not show

- **Demonstrated:** LCP is lower on every measured route under both methods; initial
  JavaScript is 46–47 KB (gzip) smaller everywhere; font transfer is halved; CLS stays 0.
- **Not demonstrated:** a TBT/INP change. TBT moved in both directions between paired
  runs (single runs ranged 8–600 ms on the shared machine), so no claim is made either
  way. Less JavaScript should help responsiveness on slow phones; real-user data is
  needed to show it.
- **Synthetic only.** These are lab measurements of local builds, not field data. Vercel
  network/CDN latency, real devices and production content will differ.
- **Install banner as LCP.** With Lighthouse's Android user agent, the LCP element on
  Home, News and Analysis is often the app-install banner's text, which mounts after
  hydration. Real Android visitors see the same. Changing when the banner appears is a
  product decision, so it was left alone; it is the obvious next LCP candidate.
- **Article page** gains least because its LCP is the cover image, not text.

## Refinement pass: motion and design (scroll chart, podium, medals)

A second round redesigned the Trading Challenge page's motion and graphics. It was
measured against the previous PR head (`be16de9`) with the same method: local
production builds, the same seeded database, Lighthouse 12.8.2 mobile preset, applied
throttling, interleaved runs. The machine was quiet this time (load average ~3).

**What the new motion costs.** All of it is CSS: no new script, no animation library.
The chart reveal moves two clip layers and two counter layers with `translate` and
`transform`, which the compositor runs. Lighthouse's *Avoid non-composited
animations* audit finds nothing on either build.

| Route | LCP before | LCP after | Δ | FCP before | FCP after | TBT before | TBT after | CLS after | Score before → after | Runs |
|---|---|---|---|---|---|---|---|---|---|---|
| /trading-challenge | 2.03 s | 2.05 s | +1% | 1.79 s | 1.87 s | 11 ms | 24 ms | 0.000 | 98 → 98 | 9/9 |
| Home | 3.41 s | 3.38 s | −1% | 1.79 s | 1.80 s | 8 ms | 9 ms | 0.000 | 90 → 91 | 5/5 |
| /about | 1.85 s | 1.86 s | +0% | 1.74 s | 1.78 s | 6 ms | 4 ms | 0.000 | 99 → 98 | 5/5 |

| Route | Initial JS before (gzip) | after |
|---|---|---|
| /trading-challenge | 211.0 KB | 211.4 KB (+0.4 KB: the copy-address button) |
| Home | 232.4 KB | 232.4 KB |
| /about | 206.9 KB | 206.9 KB |

- **No regression shown.** Medians are within run-to-run noise on all three routes.
  The LCP element on the trading page is still the hero paragraph, which this pass
  did not change; the chart's draw-in does not delay it.
- **An intermittent stall, not caused by the page.** Some runs paint first at ~3.7 s
  instead of ~1.8 s. It happened on both builds and on routes this pass did not touch
  (Home and About "before" in the first batch). In the 9-pair Trading batch it landed
  on two "after" runs. Eight further standalone runs of the new build had FCP
  1.81–1.91 s with no stall. Every sample is in the evidence files.
- The first 5-run Trading batch read +13% LCP for the same reason (two stalled runs
  of five); the 9-pair rerun supersedes it. Both are kept in `evidence/refinement/`.
- TBT stays in the tens of milliseconds on both builds; no claim either way.

After these runs, one value changed: the desktop scroll distance for the chart
(`--trading-scroll-end`, 200 → 150 px on screens shorter than 860 px). It is a custom
property inside a media query and adds no work, so the runs were not repeated for it.

Evidence: `evidence/refinement/` (`lh-devtools-*` for the 3-route batch,
`lh-devtools-trading-9-*` for the 9-pair rerun, `initial-js-*`).

## Monitoring recommendation (not enabled)

Current state: Speed Insights is **not installed** (no `@vercel/speed-insights` package or
script in the app), so there is no real-user performance data today. Vercel Speed Insights
would give real-user LCP/INP/CLS per route. It adds a small
client script and sends performance beacons to Vercel, and on the Hobby plan it has a
limited free data allowance (check the dashboard before enabling; additional usage is
billed on paid plans). Recommendation: enable it for the production project only after
(1) confirming the plan and cost in the Vercel dashboard, (2) deciding whether it falls
under the existing cookie-consent notice (Speed Insights uses no cookies and no
cross-site identifiers, but the privacy policy should list it as a processor), and (3)
adding `@vercel/speed-insights` to the root layout. No monitoring was enabled in this PR.

## Reproduce

```bash
# 1. Local seeded database (once)
createdb -h 127.0.0.1 -p <port> -U postgres consilium
USE_EXISTING_DB=1 TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/consilium bash scripts/setup-test-db.sh

# 2. Serve each build (one checkout per commit, or rebuild between)
PERF_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/consilium PERF_PORT=3310 PERF_DIST_DIR=.next-perf-base bash scripts/perf/serve-local.sh   # main
PERF_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/consilium PERF_PORT=3311 PERF_DIST_DIR=.next-perf-after bash scripts/perf/serve-local.sh  # branch

# 3. Measure, interleaved (Lighthouse installed outside the project)
LIGHTHOUSE_BIN=/path/to/lighthouse node scripts/perf/lighthouse-routes.mjs \
  --base http://localhost:3310 --compare http://localhost:3311 --runs 5 --throttling devtools \
  --out before.json --compare-out after.json / /about /category/news /category/analysis /opinion-debate /articles/<slug>
node scripts/perf/initial-js.mjs --base http://localhost:3311 --out initial-js.json / /about
node scripts/perf/report-table.mjs before.json after.json
```
