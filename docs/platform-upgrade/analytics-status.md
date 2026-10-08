> Historical specialist handoff. The independent final audit and any corrections/verification limits are in [MASTER-STATUS.md](MASTER-STATUS.md) and [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md). This file's completion labels are not final integration proof.

# Analytics workstream status

Updated 2026-10-06. **VERIFIED COMPLETE** — local acceptance and final regression verified.

Authority: [MASTER-SPEC.md](MASTER-SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md). Sequential integration: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). Worktree `/Users/zanie/The-Consilium-upgrade`, branch `feature/consilium-upgrade-six-workstreams`, foundation `68b26e8`. No production actions.

## Implemented contract

The canonical `/api/analytics/track` remains the collector. ArticleView/SiteView retain existing view storage and 30-minute deduplication; advisory transactions prevent concurrent double increments. The legacy view endpoint forwards session-aware requests to the same collector and deliberately makes old empty-body requests a deprecated no-op, avoiding duplicate writes. The current public page uses only the canonical route. Referrers store origins only; events are bounded to 4KB/session128/article100 characters, rate limited, and obvious bot/crawler/preview user agents dropped. Invalid/private/deleted articles do not count. Collector failures always return benign success and never block rendering.

Foundation `ArticleEngagementSession` contract is additive: unique visit ID, article FK, startedAt/lastSeenAt, monotonic activeSeconds, first engagedAt, optional consented keyed reader hash and earlier-day return flag. No account linkage, IP storage, browser fingerprint or second dashboard. Time fields/indexes/check constraints/RLS migration `20261006161505_article_active_engagement.sql` applied only on guarded local Postgres and tested on fresh empty schema. Public Data API access has no RLS policy.

**Exact definition:** visible AND focused AND interaction within 60 seconds. Interaction includes pointer, key, scroll or touch. Hidden/blur/idle pauses; activity/focus resumes with no inactive catch-up. 30-second cumulative heartbeat, plus visibility/pagehide flush; server bounds each increment by elapsed interval and cumulative wall time, visit cap two hours, duplicate/out-of-order payloads cannot add time twice. Engagement qualifies once per visit at **300 active seconds**, as Foundation specifies. Average active seconds uses measured sessions, separate from existing scroll-position/estimated read-through gamification. Five-minute readers additionally accumulate 300 seconds across consented visits within the selected period; unconsented sessions cannot identify returning/unique people. Timing remains an approximate conservative signal, not precise attention measurement.

Returning readership uses a random browser ID only after consent, fixed 90-day expiry (not sliding), keyed server hash, seen on an earlier UTC day in preceding 90 days. No consent means an in-memory session identifier only. Decline removes legacy/current persistent identifier and unlinks the current session on the next flush. Storage denial fails safely. Consent/cross-tab changes handled; existing signup/reading-position functions retained. Privacy notice describes actual behaviour. Daily authenticated retention deletes at most 5000 expired sessions; approximate 90-day retention may require more frequent operator cleanup at larger scale.

Existing Engagement tab now shows measured visits, engaged reads, five-minute readers, average active seconds, consented returns, top ten articles by active time and bounded UTC daily performance. Audience's old rotating-hash return inference is replaced by consented-reader aggregates; empty denominators show no percentage. ADMIN/GROWTH permissions preserved. SQL author/category column names corrected to actual Prisma camelCase columns. No document bodies are fetched for new metrics.

## Actual evidence

- Targeted timing/identity/real-database tests **18/18**; cleanup route auth/failure **6/6**; isolated migration/preflight **3/3** (combined **27/27**). Concurrent views, monotonic heartbeat, elapsed clamp, threshold once/session, cumulative reader threshold, returning day, consent withdrawal/expiry, retention, malformed/bot/oversized events and failure covered.
- Chromium: heartbeat/hidden pause/consent persistence+withdrawal/503 article readability and existing dashboard/writer denial cases passed in combined Growth/Analytics suite; four authentication cases also passed. Widths 375/768/1440 checked. Final integrated run passed the five-minute labels and complete analytics baseline.
- Full Vitest: **72 files, 988 passed, 7 existing expected failures, 18 existing skips** (1013 total); no new unexpected failure. Known content-filter expected failures/explicit API skips remain unchanged, detailed in foundation VERIFICATION.
- Whole-repository typecheck/lint and production build pass. Local logs `/tmp/consilium-upgrade-analytics-tests.log`, `/tmp/consilium-upgrade-full-tests.log`, `/tmp/consilium-upgrade-growth-analytics-browser.log`.

## Release/configuration limits

No production migration or cron execution performed. Apply reviewed migration and existing CRON_SECRET before deployment; repository-only daily cron config added. Existing old metrics cannot be backfilled into active time. Reader hashes remain probabilistic device/browser readership, not exact people; consented subset is explicitly labelled. Browser bot detection is pragmatic, not an anti-fraud system.

## Final integrated evidence

See [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md) for the final combined verification, migration applications, configuration requirements and Git milestones. Final Vitest: **72 files; 996 passed, 7 existing expected failures, 18 existing skips**. Full integrated Playwright: **115/115 passed**, including the opt-in team project. No tests were removed or newly skipped. These states describe the local candidate, not a production rollout.
