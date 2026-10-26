# Vercel Hobby resources: storage and CPU (25 October 2026)

Why The Consilium used up Vercel's Hobby allowances, what was changed in the repository
(branch `perf/vercel-hobby-resource-optimisation`), and what still needs the owner in the
Vercel dashboard. Every figure is either measured (stated how) or labelled an estimate.

## 1. Baseline (25 October 2026)

| | The Consilium | Consilium Testing | Source |
|---|---|---|---|
| Functions Storage | 8.95 GB | 1.12 GB | Vercel Usage page (owner) |
| Fluid Active CPU (30 days) | 2 h 42 min | 18 min 31 s | Vercel Usage page (owner) |
| Retained deployments | 359 (299 READY, 39 ERROR, 21 CANCELED) | 33 (32 READY production, 1 ERROR) | `GET /v6/deployments`, all pages |
| Retention policy | 30 days for every type; keep 10 production | same | `GET /v9/projects/{id}` `deploymentExpiration` |
| Function region | `dub1` (vercel.json) | project default `iad1` | deployment `regions` |
| Function bundles per deployment | 6 | | local `vercel build` |

Deployments by day peaked at 89 on 23 October and 46 on 5 October. 72 branches produced
deployments; 66 of them were merged or closed, yet 162 branches still exist on GitHub.

The hourly CPU and invocation metrics (`vercel metrics`) need Observability Plus (Pro only), Web
Analytics' query API returned 404, and Hobby keeps runtime logs for one hour. Per-route CPU in
production could therefore not be read; the CPU figures below are local measurements.

## 2. What fills Functions Storage

Vercel's docs: "Functions Storage | Vercel Function bundles stored in each region where Vercel
deploys them"; Deployment Storage is build output and static assets. Both are measured in
GB-months (the daily maximum per project, summed over the billing period). Only successful
deployments carry function bundles.

Measured with `vercel build` locally (macOS arm64; Linux sizes differ slightly) and zipping each
bundle's traced files:

| Bundle | Raw | Zipped |
|---|---|---|
| API routes (one grouped function) | 44.2 MB | 17.0 MB |
| Pages | 14.4 MB | 4.3 MB |
| Cron routes | 9.7 MB | 3.2 MB |
| Static/ISR pages | 9.7 MB | 3.1 MB |
| Metadata routes (sitemap, feed, icons) | 9.6 MB | 3.3 MB |
| Proxy | 7.6 MB | 2.5 MB |
| **Per deployment** | **95.2 MB** | **33.4 MB** |

299 READY deployments × ~30 MB ≈ 9.0 GB against the dashboard's 8.95 GB; Consilium Testing's
32 × ~35 MB ≈ 1.1 GB against 1.12 GB. **Functions Storage is the number of retained successful
deployments times ~30 MB.** Deployment count is the main lever, bundle size the second.

Inside the bundles: Prisma's generated client (5.2 MB, the base64 query-compiler module Prisma 7
loads at run time) is in all six; `@img/sharp-wasm32` (9.4 MB), sharp's WebAssembly fallback,
was traced into the upload function next to the native libvips it actually uses.

## 3. Why there were so many deployments

- Every push to every branch built a preview. Agents and people pushed iterative CI and test
  fixes to open PRs, often many times an hour.
- 91 of 294 preview deployments (31%) changed only tests, docs, CI workflows or Supabase SQL,
  none of which Vercel serves. Replaying all 294 through the new Ignored Build Step skips 79
  (27%) when only the branch's previous deployment is compared, and 95 (32%) if the
  first-deployment comparison with `main` also works (see §5: it did not on Vercel's builder).
- Retention was the Hobby default, 30 days for everything, so a busy fortnight stayed stored for a
  month.

Classification now (`scripts/ops/vercel-deployment-inventory.mjs`, read-only), The Consilium:
10 PROTECTED (current production, the next 4 production deployments as rollback targets, newest previews of the open PRs,
Vercel's 3 newest), 9 REVIEW (older previews of open PRs), and 342 SAFE candidates: 222 previews
of branches without an open PR, 60 superseded production deployments, 60 ERROR/CANCELED builds.
Consilium Testing: 5 PROTECTED, 1 REVIEW, 27 SAFE (superseded production, last built 14 October).

Four deployments are older than 30 days. Three are only hours past the limit (Vercel marks expired
deployments "within 48 hours"); the fourth (10 June, a merged `claude/...` branch) is unexplained.
Merged branches do not protect previews (Vercel exempts only the newest preview of a branch whose
PR is still open), so deleting the 150-odd merged branches is tidiness, not a storage fix.

## 4. Where the CPU goes

Local production build (`next start`, seeded throwaway database, CPU time of the server process
over 60 warm requests; Apple Silicon, so read the numbers as relative):

| Request | CPU per request |
|---|---|
| Public file through the proxy (`/favicon-navy-32.png`) | 1.2 ms (0.5 ms once it skips the proxy) |
| Cached static page (`/privacy`) | 2.8 ms |
| `POST /api/publish-scheduled`, nothing due | 2.0 ms |
| Category page | 5.8 ms |
| Archive / author page | 7.7 / 9.0 ms |
| Article / home page | 11.5 / 12.2 ms |
| `/api/ticker/macro` (cache miss, providers) | 26.5 ms |
| Proxy module cold load | 81 ms → **65 ms** (Prisma no longer loaded) |

One busy production hour (17:10 to 18:05 UTC, about 960 log records; that hour held 37 of the
last 30 days' 176 reading sessions, so it is not typical) split as: 504 proxy runs, 441 function
runs, 15 image requests. Of the function runs, page renders dominated: tag 56, category 54,
article 49, author 48, home 34, login 29, archive 10. Every public content route is dynamic
(rendered per request); `/about`, `/privacy` and the other static pages were rebuilt about once a
minute while visited (21 background rebuilds in that hour), because the footer's LinkedIn link
was cached for 60 seconds and a route revalidates as often as its shortest cache.

The proxy ran on every request except `/_next/static`, `/_next/image` and `/favicon.ico`,
including `robots.txt`, icons and team photos. `getToken()` is not the cost: with no session
cookie it returns before any decryption. The cost was the per-invocation overhead and the
cold start, which constructed a Prisma client because `src/proxy.ts` imported the testing-mode
module statically.

## 5. Changes in this branch

| Change | Effect (measured locally) |
|---|---|
| `outputFileTracingExcludes` drops `@img/sharp-wasm32` from `/api/upload`; `verify-sharp-trace.mjs` now fails if it returns | −9.4 MB raw / −3.6 MB zipped per deployment (33.4 → 29.7 MB, −11%) |
| Proxy loads `src/lib/testingMode.ts` only when `TESTING_MODE_ENABLED=1` | cold load 81 → 65 ms CPU; Prisma not loaded in production proxies |
| Proxy matcher skips single public asset files at the root and in `brand/`, `og/`, `team/` | one fewer billed invocation per such request (≈1% of proxy runs in the sample hour) |
| Footer LinkedIn cache 60 s → 1 h (saving the setting still expires its tag at once) | static pages rebuild at most hourly instead of each minute |
| `scripts/verify-build-budget.mjs` in CI | fails a build whose prerendered pages would rebuild more often than hourly |
| `vercel.json` `ignoreCommand` → `scripts/vercel-ignore-build.mjs` | 27–32% fewer preview builds (October replay); production always builds |
| `scripts/ops/vercel-deployment-inventory.mjs` | read-only cleanup inventory (never deletes) |

The proxy matcher, lazy loading and the security behaviour they must not change are pinned in
`tests/unit/proxy-security-contract.test.ts` (sign-in redirects, 401s, banned readers, CSRF,
attestation stripping, testing gate, matcher near-misses such as `/api/x.png` and `%2F` paths).

### Ignored Build Step rules

Production (and any non-preview deployment) always builds. A preview is skipped when its commit
message contains `[skip preview]`/`[no preview]`, or when every file changed since the branch's
last successful deployment (on a first deployment, since it left `main`) is under `docs/`,
`tests/`, `.github/`, `supabase/`, `scripts/{backup,ci,db,diagnostics,perf}/`, a root `*.md`, or a
dev-only config file. `[preview]` forces a build. Anything uncertain builds. To get a preview of
a skipped commit: push a commit with `[preview]` in its message, or use Redeploy in the dashboard
and untick "Use project's Ignore Build Step". Skipped deployments appear as CANCELED (no
functions, no build output stored).

Verified on Vercel (PR #180): the script runs on the builder; a tip commit carrying the skip
token was CANCELED before building; a branch's first deployment built, but the comparison with
`main` failed there ("cannot tell what changed"), so first deployments currently always build.
The likely cause is that Vercel's clone has no fetchable `origin`; not confirmed.

## 6. Dashboard settings for the owner (not changed by this branch)

Settings > Deployment Retention, both projects (choose the nearest option the dashboard offers):

| Type | Now | Recommended | Why |
|---|---|---|---|
| Pre-production (previews) | 30 days | 7 days | the newest preview of every open PR is kept regardless |
| Production | 30 days | 14 days | Vercel always keeps the 3 newest production deployments; Hobby Instant Rollback only reaches the previous one |
| Errored | 30 days | 7 days | no functions stored; logs useful for a week |
| Canceled | 30 days | 1 day | skipped builds land here |

Estimated steady state at October's pace (≈200–215 previews and 65 production deployments per
30 days after the ignore step): about 47 previews + 30 production retained × 29.7 MB ≈ **2.3 GB**.
Without the retention change, the same pace keeps ≈ 7.9 GB, so the retention change is required.

Also worth considering: a Vercel Firewall rule or the managed AI-bot ruleset if crawlers turn out
to dominate page renders (this could not be measured on Hobby), and pausing Consilium Testing's
Git deployments while it is unused (its mirror last deployed on 14 October).

## 7. Cleanup plan (needs explicit approval; nothing has been deleted)

1. Re-run the inventory (it reads live state) for each project:
   `node scripts/ops/vercel-deployment-inventory.mjs --project the-consilium --scope zanie567s-projects --repo Zanie567/The-Consilium --out <dir>`
   (Consilium Testing: `--project consilium-testing --repo Zanie567/The-Consilium-Testing`).
2. Review `<dir>/inventory.json`. PROTECTED and REVIEW rows are never in the removal list.
3. Uncomment and run the lines in `<dir>/remove-candidates.sh` you approve, oldest first. Expected:
   ~282 READY candidates ≈ 8.4 GB for The Consilium, 27 ≈ 0.95 GB for Consilium Testing.
4. Deleted deployments can be restored from Settings > Security > Recently Deleted during
   Vercel's recovery period. Whether storage stops counting immediately is not documented;
   expect the GB-month figure to fall over the following days.

## 8. Scheduled publishing: change deferred, with evidence

Supabase Cron calls `/api/publish-scheduled` 288 times a day (288 rows in `scheduler_invocations`
in the last 24 hours, none with an article due). A database-side "anything due?" check before the
HTTP call would need a production migration to `invoke_publish_scheduled()`, a new outcome in the
`scheduler_invocations` CHECK constraint, and a change to the health contract (idle rows must not
break the `requests_failing` streak; a periodic real call would still be needed to detect a broken
secret before an article is due). The idle call costs about 2 ms of CPU warm (§4), on the order
of a minute a month even allowing for slower Vercel CPUs, plus one proxy run each. Cold starts
could add more, but they cannot be measured on Hobby. The CPU saving does not justify changing
the publishing path; it stays as it is. If cold starts are ever shown to matter, the design above
is the starting point.

## 9. Follow-ups not in this branch

- Cache public category and tag pages (ISR): about a quarter of page renders in the sample hour,
  and they use no request-time APIs. Not done here because the root layout reads the session in
  testing mode, which an ISR route cannot do. It needs a testing-mode-safe design and the E2E
  suite.
- Home and article pages read the session and cookies for reader features; caching them means
  moving those to the client first.
- The proxy bundle still contains Prisma (the tracer follows the lazy import); removing it would
  need a build-time condition and saves ~1.7 MB zipped per deployment.
