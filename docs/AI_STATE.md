# AI_STATE.md

Persistent state document for AI-assisted development sessions on The Consilium.
Updated at the end of each session. Read this before starting work.

---

## Latest Verification Report (2026-06-04, streak cadence and review fixes)

Follow-up on the same branch and PR (#72): added a writer-settable streak cadence
and fixed four review findings. All checks rerun green.

- `npx tsc --noEmit`: pass. `npm run build`: pass ("Compiled successfully").
  `npm test`: 193 passed, 7 expected-fail, 18 skipped. No regressions.
- Streak cadence: a new `writer_streaks.intervalWeeks` column (default 1) sets the
  maximum number of ISO weeks allowed between consecutive publication weeks. Trace:
  at intervalWeeks 1 the brief case is unchanged (weeks 1, 2, 3, gap, 5 give current
  1, longest 3); at intervalWeeks 2 a fortnightly writer (weeks 1, 3, 5, 7) gets
  current 4 and longest 4, where weekly cadence gives 1 and 1. Adjacency is
  round(gapMs / one week) constrained to [1, intervalWeeks], so it stays DST-safe.
  The cadence read and the recalculation upsert are guarded (the upsert uses
  select id) so a missing column degrades to weekly rather than breaking the cron.
- `ReadQualityBadge` shows "Not yet scored" for a null (unscored) score rather than
  a misleading "0.0".
- Both cron error responses now include `ranAt`, matching their success contract.
- Removed the duplicate "Latest" header: the two older reports below are now
  "Previous". The review finding named the performance-system header to rename, but
  that report is newer than the gamification one, and only one section can be the
  Latest, which is this 2026-06-04 follow-up.

ALTER TABLE SQL to run in Supabase before the cadence feature works:

```sql
ALTER TABLE public.writer_streaks
  ADD COLUMN IF NOT EXISTS "intervalWeeks" INTEGER NOT NULL DEFAULT 1;
```

---

## Previous Verification Report (2026-06-03, writer performance system)

Branch `claude/writer-performance-system`, built on the merged PR #71 (gamification).
This session implemented series completion (Part 5), the Growth writer-activity view
(Part 6) and the commissioning brief (Part 7), and aligned Parts 1 to 4 to this
brief's wording.

Checks run before opening the PR:

- `npx tsc --noEmit`: passed, exit code 0.
- `npm run build`: passed. "Compiled successfully", TypeScript checked, every route
  built including the new `/api/editorial/commissioning-brief`,
  `/api/editorial/growth/writer-activity` and `/editorial/growth/writer-activity`.
  The only warning is the pre-existing workspace-root inference notice (this worktree
  carries its own lockfile); it is unrelated to these changes. A `.env.local` with
  placeholder values was created only so the build could collect page data (auth.ts
  throws without NEXTAUTH_SECRET); it is gitignored and not committed.
- `npm test`: 193 passed, 7 expected-fail, 18 skipped. No regressions.

Required check-throughs (read, not run):

a. Streak weeks 1, 2, 3, a gap at 4, then 5 produce currentStreak = 1 and
   longestStreak = 3. streaks.ts groups publications by ISO week and walks the
   Mondays: the longest run is 3 (weeks 1-2-3) and resets at the week 3 to week 5
   gap; the current run counts back from the most recent week (5) and stops at once
   on the gap, so it is 1. (Logic unchanged from PR #71.)
b. first_publish cannot be inserted twice. awardFirstPublishAchievement does a
   fast-path findFirst on (userId, type) and returns if present, so a second publish
   by the same writer short-circuits before any insert or notification. Concurrent
   first publishes are additionally guarded by a Serializable transaction.
c. Series completion does not trigger for a one-article series.
   awardSeriesCompletionAchievement returns immediately when the series has fewer
   than SERIES_MIN_PARTS (2) non-deleted articles, before any insert.
d. The commissioning brief is editable only by ADMIN and GROWTH (PATCH is gated by
   getVerifiedSessionUser([ADMIN, GROWTH]) and returns 403 otherwise) and is shown to
   WRITER only on the dashboard (the rendered brief renders under isWriter; the
   editor renders under isAdmin or isGrowth; EDITOR sees neither).

Two deviations carried forward from PR #71 and deliberately NOT changed despite the
"align to wording" scope, because changing either would break Part 2D or the live DB:

1. Engagement weights stay 0.5 / 0.03 / 0.02, not 0.5 / 30 / 20. The literal 30 and
   20 produce scores up to roughly 5000, which breaks Part 2D's "gold above 40"
   threshold and the 0-100 "read quality" framing. Only 0.03 / 0.02 reproduce the
   original worked example of 40.8.
2. `Article.engagementScore` stays `Float?` (nullable), not `Float @default(0)`. The
   Supabase column was created nullable; a non-nullable Prisma type would throw when
   reading pre-existing NULL rows. The UI already treats null as 0.

---

## Previous Verification Report (2026-06-03, writer gamification)

Checks run before opening the PR:

- `npx tsc --noEmit`: passed, exit code 0.
- `npm run build`: passed. "Compiled successfully", 83/83 static pages generated, no
  ESLint errors. The only warning is the pre-existing Next.js workspace-root
  inference notice (caused by the worktree carrying its own lockfile); it is
  unrelated to these changes.
- Logic traced by reading the code (not by running a server):
  - Streak: publications in weeks 1, 2, 3, a gap at week 4, then week 5 produce
    currentStreak = 1 and longestStreak = 3, as required. The longest run resets
    at the 14-day gap; the current run counts back from the most recent week and
    stops at the first gap.
  - Engagement: a 10-view article with avg read depth 80, 2 bookmarks and 1
    comment yields 80*0.5 + 20*0.03 + 10*0.02 = 40.8.
  - First publish: a writer who already holds a first_publish achievement and
    publishes another article gets no duplicate (a findFirst on (userId, type)
    short-circuits before any insert or notification).
  - Series completion: when the series table exposes no part-count field, the
    code finds the series, logs a warning, and returns without crashing or
    guessing a total.

Two intentional deviations from the brief, both forced by contradictions in it:

1. Engagement weights are 0.5 / 0.03 / 0.02, not 0.5 / 30 / 20. The literal 30 and
   20 produce 840 for the brief's own worked example, far outside its stated
   "roughly 0-100" range; only 0.03 and 0.02 reproduce the worked answer of 40.8.
   The worked example plus the range are treated as authoritative. See
   ENGAGEMENT_WEIGHTS in src/lib/constants.ts.
2. Series completion cannot be awarded as specified because the Series model has
   no partCount / totalParts field. Per the brief, the code does not guess: it
   logs a warning and skips. Add a totalParts column to enable it.

Second audit pass (after a review request):

- Fixed a real bug. Streak week-adjacency used exact-millisecond equality, which
  undercounts a streak across a daylight-saving boundary in any non-UTC runtime
  (verified: a 3-week streak collapsed to 2 under America/New_York). It now
  compares the gap rounded to whole days, correct in UTC and DST runtimes alike.
- Re-validated the pure streak and engagement logic with date-fns in both UTC and
  America/New_York: the brief case (current 1, longest 3), an ISO 53-week year
  boundary, same-week dedupe, single, DST-spanning, and empty all pass; engagement
  reproduces 40.8 plus clamp and zero-view edges.
- Full suite: 193 passed, no regressions. `tsc` clean. ESLint clean on the new
  files (one pre-existing warning remains on an unrelated trophy-system line).
- Could not introspect the live database: the local `.env` DATABASE_URL is a
  placeholder (host is literally "[host]"), so neither the build nor a local run
  here connects to Supabase. Confirming the tables, columns and unique constraints
  exist in the real database is still a required pre-merge step.
- Scope note: first-publish/series milestones fire only from the scheduled-publish
  path per the brief. Articles published via the editor "Publish Now" action do not
  award milestones; wiring that path is a recommended follow-up.

Review pass (CodeRabbit on PR #71):

- first_publish is now race-safe under overlapping publish runs (GitHub Actions and
  Vercel cron can both hit publish-scheduled): a fast-path check plus a Serializable
  transaction (re-check, insert and notification together). referenceId stays as the
  article id so the achievements API can still join the title; the reviewer's
  suggested NULL/constant referenceId was not used (NULL is distinct in a Postgres
  unique so it would not dedupe, and a constant would drop the title link).
- New session routes (streak, achievements, mark-seen, commendation) log the error
  server-side and return a generic 500 instead of echoing err.message. Cron routes
  still return their message on purpose (secret-protected, aids Actions debugging).
- Cron secret check uses crypto.timingSafeEqual with a length guard; both cron routes
  set maxDuration = 60 (Vercel Hobby cap).
- Both new workflows echo the response body with if: always() so failures show it.
- Series-completion no longer does a per-publish DB lookup or warning; it warns once
  per process. The sequential engagement loop is kept (bounded by maxDuration);
  cursor batching is deferred until the article count warrants it.

---

## Recent Sessions

### 2026-08-15: Archive pagination — security + correctness review (`claude/article-page-pagination-55a555`)

Review pass over the archive pagination PR. Two files changed
(`src/app/archive/page.tsx`, new `src/lib/archivePagination.ts`) plus a new
unit test.

**What changed:**
- **Fixed a reachable 500 the PR had introduced.** Next resolves a repeated
  query parameter (`/archive?q=a&q=b`) to a `string[]`, but the page typed
  `searchParams` as all-strings, so the array reached Prisma's `contains` and
  threw. The PR's new `getArticleCount` had no `try/catch`, so the throw hit
  the error boundary: `/archive?q=a&q=b` and
  `/archive?category=opinion&category=news` both returned HTTP 500 to any
  anonymous visitor. Verified against a seeded local build — 500 before, 200
  after. `main` was unaffected (its single query caught the error), so this
  was a regression, not a pre-existing bug.
- **Escaped LIKE metacharacters in the search term.** Prisma compiles
  `contains` to `ILIKE ('%' || $n || '%')` with no ESCAPE clause, so `%` and
  `_` from the query string acted as wildcards: `?q=%` matched and counted
  every published article, and `?q=100%` could not find a literal percent
  sign. Escaping happens in `escapeLikePattern`; values still travel as bound
  parameters, so this was never SQL injection.
- **Capped and trimmed the search term** at 200 characters, mirroring the
  guard `src/app/api/search/route.ts` already applies to the other public
  search surface.
- **Restored degrade-to-200 on database failure.** Commit 3c29212 had removed
  the count's `try/catch` so an outage would not silently render "0 articles".
  That intent is kept, but a `null` sentinel and an explicit "we couldn't load
  the archive" banner replace the 500, matching the contract documented in
  `src/lib/prisma.ts` and the banner already used by the comments portal.
- **Split the three result states.** A failed article fetch could previously
  render "47 articles published", "No articles found", and a pagination bar at
  the same time. The nav is now also gated on there being articles to page.
- **`nulls: 'last'` on the `publishedAt` sort.** Postgres sorts NULLs first on
  DESC, so a PUBLISHED article with no `publishedAt` pinned itself to the top
  of page 1 with a blank date. Confirmed against the seeded DB.
- **Page-aware canonical + `noindex` for filtered and page-2+ URLs.** Metadata
  merges shallowly, so without an `alternates` here every archive URL inherited
  the root layout's canonical and declared itself a duplicate of the homepage.
- Extracted the pure query-string logic to `src/lib/archivePagination.ts` and
  added `tests/unit/archive-pagination.test.ts` (37 cases); `parsePageParam`
  now uses the `parseInt` idiom the paginated API routes already use, and
  rejects `Infinity`/oversized values rather than relying on the clamp.
- A11y: `aria-disabled` and a legible opacity on the disabled Prev/Next, plus
  `rel="prev"`/`rel="next"` and per-link labels.

**Schema changes:** None.

**New environment variables:** None.

**Architectural decisions:** Kept clamping out-of-range pages rather than
calling `notFound()`. `?page=999` names an out-of-range view of a resource that
exists, unlike the unknown slugs 95ef7fe made 404; the archive already responds
softly to an unmatched `?category=`, and the `noindex` on page 2+ handles the
duplicate-content concern. Did not add `unstable_cache` here: the natural cache
key includes the reader's free-text `q`, which would make the key space
attacker-controlled. Left the search form with no hidden `page` field — a GET
form rebuilds the query string from its own fields, so a new search already
resets to page 1; a hidden field would strand the reader on a stale page.

**Issues introduced:** None known. `npx tsc --noEmit`, `npx eslint`, `npm test`
(503 passing), and `npm run build` all clean; pagination verified end-to-end
against a seeded database at a reduced page size (3 pages, 12 articles, no
duplicates or drops, out-of-range clamped).

**Noted but out of scope (pre-existing, not fixed here):**
- `src/app/layout.tsx:82` sets a site-wide `alternates.canonical` of
  `SITE_URL`. Every page that does not override it — articles, categories,
  authors, tags — currently canonicalises itself to the homepage. The archive
  is fixed above; the rest of the site still needs it.
- `src/app/api/search/route.ts` passes unescaped `%`/`_` into `contains` in the
  same way the archive did.
- `src/components/ui/FootnotePopovers.tsx:136` has an unused
  `prefersReducedMotion` binding that fails `npm run lint` on `main` (lint is
  not part of CI).
- No index covers `(status, deletedAt, publishedAt DESC, id DESC)`, so the
  listing sorts on every request. Fine at the current article count.

### 2026-06-12: Scheduled date/time picker audit + label a11y fix (`claude/schedule-datetime-picker`)

Task asked for a scheduled date/time picker in the article editor metadata
panel. Reading first showed the picker already exists and is fully wired;
only one accessibility gap was real. One file changed:
`src/components/admin/article-editor/ArticleEditorMetadataPanel.tsx`.

**What was already there (do not re-implement):**
- A `datetime-local` input labelled "Publish At (UK time)" renders when
  status is SCHEDULED, bound to `editor.scheduledAt` with
  `actions.setScheduledAt`, with `min` = now + 1 minute in Europe/London
  via `getEditorialScheduleMinInput()`. Landed in "Harden scheduled
  article publishing" (1c8724b). The controller validates on save
  (SCHEDULED + empty scheduledAt aborts with an error).
- Gating is `!editor.isWriter`, which inside the editor is equivalent to
  `editor.canPublish`: GROWTH is redirected off the edit pages and only
  ADMIN/EDITOR/WRITER reach the component.

**What changed:**
- `FieldLabel` accepts an optional `htmlFor` prop; the scheduled input
  now has a `useId()`-based `id` and the Publish At label points at it.
  Previously the label was an unassociated sibling.
- `useId()` rather than a hardcoded id because the panel is mounted twice
  simultaneously (desktop sidebar + mobile settings sheet, both kept in
  the DOM and toggled via CSS), so a fixed id would be duplicated.

**Schema changes:** None.

**New environment variables:** None. (Worktree note: `npm run build`
page-data collection needs `NEXTAUTH_SECRET`; copying `.env` from the
main checkout into the worktree fixes it.)

**Architectural decisions:** Did not re-implement the picker, move it, or
change its gating; the existing implementation already met the spec apart
from label association. Other `FieldLabel` usages in the panel remain
unassociated; same `htmlFor` pattern can be applied if wanted later.

**Issues introduced:** None. `npm run build` exit 0 and
`npx tsc --noEmit` exit 0 in this worktree.

### 2026-06-12: Sitemap excludes test accounts (`claude/sitemap-exclude-test-accounts`)

Targeted one-line fix to `src/app/sitemap.ts`. No other files changed.

**What changed:**
- Added `NOT: { email: { startsWith: 'test-' } }` to the Prisma `user.findMany`
  query that builds author sitemap entries. Test accounts (email pattern
  `test-*@theconsilium.co.uk`) are now excluded from the public sitemap.

**Schema changes:** None.

**New environment variables:** None.

**Architectural decisions:** None. The filter uses Prisma's built-in `NOT`
operator and `startsWith` to keep the fix close to the existing query structure.

**Issues introduced:** None. `npx tsc --noEmit` clean (exit 0). `npm run build`
TypeScript phase passed cleanly; page-data collection aborted on
NEXTAUTH\_SECRET not set in this worktree environment (pre-existing infra issue).

### 2026-06-12: SEO metadata foundations (`claude/seo-metadata-foundations`)

Targeted fix to `src/app/layout.tsx` metadata export only. No layout, component,
or structural changes.

**What changed:**
- Imported `SITE_NAME` and `SITE_DESCRIPTION` from `@/lib/constants` alongside the
  existing `SITE_URL` import.
- `description`: was a hardcoded string; now uses `SITE_DESCRIPTION` constant.
- `openGraph.description`: was `'Ratione et Consilio'` (the Latin motto); now
  uses `SITE_DESCRIPTION` so social share previews show a real description.
- `openGraph.url`: added `SITE_URL`.
- `openGraph.siteName`: added `SITE_NAME`.
- `openGraph.images[0].alt`: added `'The Consilium logo'`.
- `robots`: added `{ index: true, follow: true }`.
- `twitter`: new field with `card: 'summary'`, `title`, `description`
  (`SITE_DESCRIPTION`), and `images: ['/logo.png']`.
- `alternates.canonical`: added `SITE_URL`.

**Schema changes:** None.

**New environment variables:**
- `NEXT_PUBLIC_SITE_URL` has been added to Vercel production
  (value: `https://theconsilium.co.uk`). A redeploy is required for it to take
  effect. This variable drives `SITE_URL` in `src/lib/constants.ts`, which is now
  referenced in the canonical tag, `openGraph.url`, and the RSS link.

**Architectural decisions:** None beyond using the existing constants pattern.

**Issues introduced:** None. `npx tsc --noEmit` clean (exit 0). `npm run build`
TypeScript phase passed cleanly; page-data collection aborted on
NEXTAUTH\_SECRET not set in this worktree environment (pre-existing infra issue,
not caused by these changes; the TypeScript gate is the relevant signal here).

### 2026-06-09: Policy copy edits — Corrections and Privacy (`claude/policy-copy-edit`)

Copy-only task on two pages: remove sentences that read as AI-generated or
marketing filler and replace them with plain, declarative policy statements. No
layout, component, or structural changes; only the flagged sentences were
touched. British spelling; no em/en dashes introduced. PR #86.

**What changed:**
- `src/app/corrections/page.tsx`:
  1. Lede 2nd sentence: "we say so: clearly, promptly, and without qualification"
     → "we correct it promptly and say what changed" (rule-of-three tricolon cut).
  2. "Corrections are not embarrassments to be buried… We are committed to the
     former." → "We do so openly: we do not quietly revise copy or leave a known
     error to stand." (emotional framing / balanced antithesis removed).
  3. Metadata description: dropped "The Consilium is committed to accuracy."
  4. Section heading "Our commitment to accuracy" → "Accuracy".
  5. Removed filler "simply" from "we will not issue a correction simply because…".
- `src/app/privacy/page.tsx`:
  6. Lede: dropped "We believe… without legal jargon" → plain scope statement
     ("This policy sets out what data we collect, why we collect it, how long we
     keep it, and what rights you have over it.").
  7. Cookies: "We use cookies to improve your experience." → "We use a small
     number of cookies."
  8. Removed empty adjective "secure" before "PostgreSQL database".
  9. "reputable providers with their own privacy commitments…" → "Each operates
     under its own privacy policy and, where applicable, UK GDPR."
- "We do not sell your data to anyone, ever." left unchanged, per instruction.

**Dash sweep (both files, full):** no em dash (U+2014), no en dash (U+2013), no
other dash-like Unicode. The only `--` occurrences are CSS custom-property
references in JSX (`var(--bg)` etc.) — code, not copy — and were left untouched.
No dashes in reader-facing copy, so none needed resolving.

**Schema changes:** None.

**New environment variables:** None.

**Architectural decisions:** None.

**Issues introduced:** None. `npx tsc --noEmit` clean (exit 0); `npm run build`
clean (exit 0, "Compiled successfully"; `/corrections` and `/privacy` prerender
static). This worktree was missing two already-declared deps (`@playwright/test`,
`sanitize-html`) and a build-time `.env`; `npm install` and a gitignored local
`.env.local` were used only to run the gate. No `package.json`, lockfile, or
committed-env changes are in the PR.

### 2026-06-05: Sign-out reliability and EDITOR role over-privilege (`consilium/fix-signout-and-editor-ui`)

**What changed:**
- `src/components/layout/EditorialSidebar.tsx`: the sign-out button's `onClick`
  handler was not awaiting the `signOut()` Promise. The handler is now `async` and
  uses `await signOut(...)`, so the redirect to `/editorial/login` is guaranteed to
  complete before the component unmounts or the user can interact with the portal
  again.
- `src/app/editorial/(portal)/page.tsx`: the "Users" stat card (links to
  `/editorial/users`) and the "Manage Users" quick-action link were both gated on
  `isEditor` (true for ADMIN and EDITOR). Changed both guards to `isAdmin`, so EDITOR
  users no longer see links to a route they cannot access.

**Schema changes:** None.

**New environment variables:** None.

**Architectural decisions:**
- Only the two gate expressions (`isEditor` → `isAdmin`) were changed. The underlying
  DB query that fetches `userCount` is still guarded by `isEditor`; it now fetches a
  value that is never displayed for the EDITOR role. A future clean-up could narrow
  that query to `isAdmin`, but that would widen the diff unnecessarily for a bug-fix
  PR.

**Issues introduced:** None. `npx tsc --noEmit` clean, `npm run build` clean (83/83
static pages).

### 2026-06-04: Streak Cadence and Review Fixes (`claude/writer-performance-system`)

Follow-up on PR #72.

**What changed:**
- Writer-settable streak cadence. New `writer_streaks.intervalWeeks` column
  (`Int @default(1)`); `STREAK_INTERVAL_WEEKS` (MIN 1, MAX 8, DEFAULT 1) in
  constants. `recalculateStreakForUser` now reads the writer's intervalWeeks and
  treats two publication weeks as adjacent when they are 1 to intervalWeeks weeks
  apart (weekly behaviour at 1). `GET /api/user/streak` returns intervalWeeks; a new
  `PATCH /api/user/streak` validates and saves it (1 to 8), then recomputes the
  streak. New `src/components/editorial/StreakCadenceControl.tsx` (a labelled select
  that saves and calls router.refresh); `StreakCard` shows the cadence in its label.
  Both are WRITER/ADMIN only.
- Review fixes: `ReadQualityBadge` renders "Not yet scored" for a null score;
  both cron routes include `ranAt` in their error response; the duplicate "Latest
  Verification Report" header was resolved (older reports retitled "Previous").

**Schema changes:**
- `writer_streaks` gains `intervalWeeks` (`INTEGER NOT NULL DEFAULT 1`). Run the
  ALTER TABLE in the Latest Verification Report above. Until it is applied, the
  cadence read and recalc upsert degrade to weekly (guarded), and the dashboard
  streak shows its zero-state; PATCH returns 500.

**New environment variables:** None.

**Architectural decisions:**
- The streak stays anchored to the most recent publication (not "today"), as in
  PR #71, so the daily cron does not reset a streak just because the current period
  has no publication yet. Time-since-last-publish decay is surfaced separately by
  the Growth at-risk flag.
- Setting the cadence recomputes the streak immediately (PATCH calls
  `recalculateStreakForUser`) so the dashboard reflects the change without waiting
  for the nightly cron.

**Issues found:**
- None new. `tsc`, `build` and the test suite are clean.

### 2026-06-03: Writer Performance System (`claude/writer-performance-system`)

Builds on the merged PR #71. Adds the three unbuilt features and aligns the shipped
Parts 1 to 4 to this brief's wording.

**What changed:**
- Part 5 (series completion): real detection in
  `src/lib/gamification/achievements.ts`. A series of at least 2 non-deleted articles
  in which every article is PUBLISHED grants each distinct author a one-time
  `series_complete` achievement (referenceId = seriesId) plus a notification; P2002
  is swallowed for idempotency. The old "no part-count field, skip with a warning"
  stub is removed.
- Part 6 (Growth writer-activity): `src/lib/gamification/writerActivity.ts`
  (`getWriterActivity`, shared by route and page);
  `GET /api/editorial/growth/writer-activity` (ADMIN/GROWTH, 403 otherwise);
  `src/app/editorial/(portal)/growth/writer-activity/page.tsx` (server component,
  at-risk first then most recent). A "Writer Activity" link was added to the Growth
  quick actions on the dashboard.
- Part 7 (commissioning brief): new `SiteSetting` Prisma model mapped to
  `site_settings` (table SQL must be run manually, see below);
  `GET/PATCH /api/editorial/commissioning-brief` (GET public, PATCH ADMIN/GROWTH);
  `src/components/editorial/CommissioningBriefEditor.tsx`. Writers see the rendered
  brief above their article table; ADMIN and GROWTH see the editor.
- Alignment of Parts 1 to 4:
  - Streak (1E): `StreakCard` is now a server-fed presentational stats-grid cell
    (Prisma fetch in the dashboard, not via the API route), WRITER/ADMIN only. Shows
    the number with a flame, "week streak" beneath, and "Best: N weeks"; the
    zero-state shows "Start your streak" with no flame.
  - Engagement (2D): `ReadQualityBadge` now shows the score to one decimal, gold
    (#c9a84c) above 40 and muted at or below. The dashboard column header is
    "Quality" and the column is shown for WRITER only.
  - Commendation (3D): the dashboard line is now italic gold with a thin gold left
    border and no "Editorial note" prefix. (3C) the commendation editor shows for
    PENDING_REVIEW and PUBLISHED only (APPROVED does not exist; SCHEDULED dropped).
  - First publish (4D): new `src/components/editorial/FirstPublishBanner.tsx`
    (`{ achievementId }`, own dismissed state, marks seen on dismiss); the dashboard
    fetches achievements server-side via Prisma. (5B) new
    `src/components/editorial/SeriesCompleteBadges.tsx` renders unseen
    series-complete badges below the banner and marks them seen on dismiss. The old
    SWR `AchievementBanner.tsx` was deleted.
- Cron routes `recalculate-streaks` and `update-engagement-scores` now include
  `ranAt` in their JSON response (`{ ranAt, processed, errors }`) per the brief.
- Constants added to `src/lib/constants.ts`: `ENGAGEMENT_QUALITY_GOLD_THRESHOLD`,
  `WRITER_AT_RISK`, `COMMISSIONING_BRIEF_KEY`, `COMMISSIONING_BRIEF_MAX_LENGTH`,
  `EDITORIAL_API_ROUTES`.

**Schema changes:**
- New `SiteSetting` model (mapped to `site_settings`). As with every other table
  here, no migration is run; the SQL below must be applied manually in Supabase
  before the commissioning brief feature will function. Only `prisma generate` was
  run this session.

SQL TO RUN IN SUPABASE BEFORE THE COMMISSIONING BRIEF WORKS:

```sql
CREATE TABLE IF NOT EXISTS public.site_settings (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     TEXT,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT
);

INSERT INTO public.site_settings ("key", "value") VALUES ('commissioning_brief', NULL)
ON CONFLICT ("key") DO NOTHING;
```

Until this runs, the commissioning-brief GET returns `{ brief: null }`, PATCH returns
a 500, and the dashboard still renders (its server-side read is wrapped in try/catch).

**New environment variables:** None. The new routes reuse `CRON_SECRET` (cron) and
the existing NextAuth session (commissioning brief, writer activity).

**Architectural decisions:**
- Series-completion idempotency relies on the (userId, type, referenceId = seriesId)
  unique plus a P2002 swallow; no Serializable transaction is needed because the
  referenceId is stable per series (unlike first_publish, whose referenceId is the
  article id and which therefore needs the transaction).
- `getWriterActivity` is shared by the route and the page so both compute identical
  figures from one query path; the page applies the at-risk-first sort on top of the
  helper's most-recent-first order.
- Milestones (first publish, series completion) still fire only from the
  scheduled-publish path per the brief. The editor "Publish Now" path does not award
  them; wiring that path remains a recommended follow-up.

**Issues found:**
- The brief's premise (PR #71 unmerged, schema incomplete) was stale: PR #71 is
  merged (commit 373652f is HEAD) and Parts 0 to 4 were already built. Scope was
  confirmed with the requester as "build Parts 5 to 7 and align 0 to 4 to wording".
- No new dependencies. `tsc`, `build` and the test suite are all clean.

### 2026-06-03: Writer Gamification (`claude/writer-gamification`)

**What changed:**
- Added `WriterStreak` and `WriterAchievement` Prisma models (schema only; tables
  already created in Supabase via raw SQL, no migration run). Added `streakData`
  and `achievements` reverse relations to `User`.
- Added `engagementScore` (Float?) and `editorialCommendation` (String?) columns to
  the `Article` model. These columns already existed in Supabase (added via SQL);
  declared here as nullable so reads never fail regardless of the SQL nullability.
- Ran `npx prisma generate` only. No `prisma migrate dev`, `prisma db push`, or SQL.
- Added gamification constants to `src/lib/constants.ts`: `ACHIEVEMENT_TYPES`,
  `NOTIFICATION_TYPE_ACHIEVEMENT`, `ENGAGEMENT_WEIGHTS`, `CRON_ROUTES`,
  `GAMIFICATION_API_ROUTES`.
- Feature 1 (streaks): `src/lib/gamification/streaks.ts`
  (`recalculateStreakForUser`); `src/app/api/cron/recalculate-streaks/route.ts`;
  `.github/workflows/recalculate-streaks.yml` (daily 02:00 UTC);
  `GET /api/user/streak`; `src/components/editorial/StreakCard.tsx` on the dashboard.
- Feature 2 (engagement): `src/lib/gamification/engagement.ts`
  (`computeEngagementScore`); `src/app/api/cron/update-engagement-scores/route.ts`;
  `.github/workflows/update-engagement-scores.yml` (daily 03:00 UTC);
  `src/components/editorial/ReadQualityBadge.tsx` shown per article (labelled
  "Read quality", published articles only).
- Feature 3 (commendations): `PATCH /api/editorial/articles/[id]/commendation`
  (EDITOR/ADMIN, max 200 chars, trim, null to clear);
  `src/components/editorial/CommendationEditor.tsx` wired into `ReviewPanel`;
  "Editorial note" line shown under each article on the dashboard.
- Feature 4 (first publish): `src/lib/gamification/achievements.ts`
  (`awardPublishAchievements`) invoked from `src/lib/scheduledPublishing.ts` after
  a successful publish. Inserts a one-time `first_publish` achievement plus a
  notification.
- Feature 5 (series completion): present but intentionally skipped at runtime; see
  the deviation note in the verification report.
- Feature 6: `GET /api/user/achievements` (joins article/series titles) and
  `PATCH /api/user/achievements/mark-seen`;
  `src/components/editorial/AchievementBanner.tsx` on the dashboard.

**Schema changes:**
- `writer_streaks` and `writer_achievements` tables, plus `articles.engagementScore`
  and `articles.editorialCommendation` columns, were all created manually in the
  Supabase SQL editor before this session. The SQL is already applied; only
  `prisma generate` was run here. The exact SQL column types for `engagementScore`
  (assumed double precision) and `editorialCommendation` (assumed text) should be
  confirmed against the Prisma mapping (Float, String).

**New environment variables:**
- None. The new cron routes reuse the existing `CRON_SECRET`, validated via an
  `Authorization: Bearer` header (same convention as `publish-scheduled`). The two
  new workflows add no new secrets; `CRON_SECRET` must already be set in both Vercel
  and GitHub Actions.

**Architectural decisions:**
- The brief's file paths assume a root `app/`; this repo nests everything under
  `src/`. The "writer dashboard" is `src/app/editorial/(portal)/page.tsx`.
- Achievement awarding is hooked into `scheduledPublishing.ts` (where articles are
  actually set to PUBLISHED and authorId/seriesId are in hand), not the thin route
  wrapper. The editor "approve" path (`/api/editorial/articles/[id]/review`) is a
  separate publish path and is out of scope per the brief; awarding there is a
  possible follow-up.
- Streak weeks are grouped with date-fns ISO-week helpers; adjacency compares each
  week's Monday using the gap normalised to whole UTC days (rounded to a day
  boundary), so it stays correct across 52/53-week year boundaries and across
  daylight-saving transitions in non-UTC runtimes. Crons run in UTC, so the
  boundaries are UTC as specified.
- `currentStreak` is anchored to the most recent publication week (per the brief's
  algorithm), not to the current date.
- Dashboard widgets fetch their own session-protected routes client-side via SWR
  (already a dependency), so they only ever show the signed-in user's own data and
  are never rendered on another writer's profile.
- Status mapping: the brief's UNDER_REVIEW / APPROVED do not exist in
  `ArticleStatus`; the commendation editor shows for PENDING_REVIEW, PUBLISHED and
  SCHEDULED.

**Issues found:**
- Engagement formula coefficients in the brief (30, 20) contradict its worked
  example and 0-100 range; resolved to 0.03 / 0.02 (see verification report).
- Series model has no part-count field, so series completion cannot be detected;
  logged and skipped rather than guessed.
- No new dependencies added. `tsc` and `build` clean.

### 2026-06-03 — Trophy System (`claude/trophy-system`)

**What changed:**
- Added `ArticleTrophy` Prisma model (schema only — no migration run, no `prisma db push`; table already existed in Supabase, applied manually via SQL)
- Added `trophies ArticleTrophy[]` reverse relation to the `Article` model
- Ran `npx prisma generate` to update Prisma Client; no database commands executed
- Added `TROPHY_THRESHOLDS` constant and `TrophyTier` type to `src/lib/constants.ts`
- Created `src/app/api/award-trophies/route.ts` — POST cron route secured by `x-cron-secret` header
- Created `src/app/api/user/trophies/route.ts` — GET trophies for the current session user
- Created `src/app/api/user/trophies/mark-seen/route.ts` — PATCH to mark trophies as seen
- Created `src/components/editorial/TrophySection.tsx` — client component with Framer Motion animation overlay and badge display
- Updated `src/app/editorial/(portal)/page.tsx` — fetches trophies server-side and renders `TrophySection`
- Created `.github/workflows/award-trophies.yml` — hourly cron job hitting `/api/award-trophies`
- Created `docs/AI_STATE.md` (this file)

**Schema changes:**
- `ArticleTrophy` table was created manually in Supabase SQL editor before this session; Prisma schema updated to match
- SQL was already applied; only `prisma generate` was run this session

**New environment variables:**
- `CRON_SECRET` — must be added to Vercel (project settings → Environment Variables) and as a GitHub Actions secret (Settings → Secrets → Actions). Same value in both places. Use a long random string (32+ chars). This variable already existed for `publish-scheduled`; the same secret is reused for `award-trophies`.

**Architectural decisions:**
- Auth on cron route uses `x-cron-secret` header (vs `Authorization: Bearer` used by publish-scheduled) — consistent with the task spec; both patterns are valid, just different conventions
- Trophy data fetched server-side in the dashboard page component and serialized (Dates → ISO strings) before passing to the `TrophySection` client component, avoiding a redundant client-side API call on load
- `createMany` with `skipDuplicates: true` is used as a belt-and-suspenders guard, but the route also pre-checks existing trophies to return an accurate list of newly awarded trophies in the response
- Animation uses Framer Motion (already in bundle at `^12.38.0`); no new dependencies added
- Trophies hidden from Growth-role users (they don't author articles)

**Issues introduced:**
- None known. `npx tsc --noEmit` clean, `npm run build` clean.

---

## Current Schema State

Gamification tables and columns. All were created manually in Supabase via SQL and
are already applied; the Prisma schema mirrors them (no migration is run for them).

| Table / column | Shape | Notes |
|----------------|-------|-------|
| `ArticleTrophy` | id, articleId, trophy, awardedAt, seenAt | unique (articleId, trophy); trophy system |
| `writer_streaks` (`WriterStreak`) | id, userId (unique), currentStreak, longestStreak, intervalWeeks, lastPublishedAt, updatedAt | one row per writer; `intervalWeeks` (default 1) is the writer-set cadence. ALTER TABLE for it NOT yet applied, see Latest report |
| `writer_achievements` (`WriterAchievement`) | id, userId, type, referenceId, awardedAt, seenAt | unique (userId, type, referenceId) |
| `articles.engagementScore` | Float? | per-article read-quality signal, recomputed by cron |
| `articles.editorialCommendation` | String? (text) | one-sentence editor note, dashboard-only |
| `site_settings` (`SiteSetting`) | key (PK), value (text), updatedAt, updatedBy | key-value store; holds `commissioning_brief`. SQL NOT yet applied, see below |

`User` gained `streakData WriterStreak?` and `achievements WriterAchievement[]`
reverse relations.

The `site_settings` table is the only schema item here whose SQL has NOT been run in
Supabase yet. The CREATE TABLE statement is in the Writer Performance System session
entry above and must be applied before the commissioning brief feature will work.

---

## Open PRs

| PR | Branch | Status | Notes |
|----|--------|--------|-------|
| Paginate the archive page (#103) | `claude/article-page-pagination-55a555` | Open, awaiting review | Pagination plus a security/correctness pass over it. Closes a reachable 500 on `/archive?q=a&q=b` that the first two commits introduced, and escapes LIKE wildcards in the search term. No schema changes, no new env vars. Safe to merge. |
| fix: associate Publish At label with scheduled date input in article editor | `claude/schedule-datetime-picker` | Open, awaiting review | One-file a11y fix + this AI_STATE log. No schema changes, no new env vars. Safe to merge immediately. |
| fix: exclude test accounts from public sitemap | `claude/sitemap-exclude-test-accounts` | Merged (#101) | No schema changes, no new env vars. |
| fix: correct og:description, add Twitter card, canonical tag, robots (#100) | `claude/seo-metadata-foundations` | Merged (commit 60610ec) | No schema changes. `NEXT_PUBLIC_SITE_URL` must be set in Vercel and a redeploy triggered for the canonical/og:url values to resolve correctly in production. |
| copy: tighten Corrections and Privacy policy prose (#86) | `claude/policy-copy-edit` | Open, awaiting review | Copy-only edits to two policy pages (9 string changes) + this AI_STATE log. No schema changes, no new env vars, no structural changes. Safe to merge immediately. |
| fix: sign-out reliability and EDITOR role over-privilege | `consilium/fix-signout-and-editor-ui` | Open, awaiting review | No schema changes, no new env vars. Safe to merge immediately. |
| feat: writer performance system - streaks, engagement scores, commendations, achievements, commissioning brief | `claude/writer-performance-system` | Open, awaiting review | Do not merge. Run two SQL statements in Supabase first: the `site_settings` CREATE TABLE (commissioning brief) and the `writer_streaks.intervalWeeks` ALTER TABLE (streak cadence). Both are in the verification reports above. `CRON_SECRET` reused (no new value). |
| feat: writer gamification system - streaks, engagement scores, commendations, milestones (#71) | `claude/writer-gamification` | Merged (commit 373652f) | Superseded by the performance-system branch above. |
| feat: writer trophy system with award animation and cron workflow | `claude/trophy-system` | Open, awaiting review | Do not merge until CRON_SECRET is added to Vercel env vars and GitHub Actions secrets |

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CRON_SECRET` | Vercel + GitHub Actions secret | Shared secret for cron-triggered API routes (`/api/publish-scheduled`, `/api/award-trophies`, `/api/cron/recalculate-streaks`, `/api/cron/update-engagement-scores`) |
| `NEXT_PUBLIC_SITE_URL` | Vercel production | Production origin (`https://theconsilium.co.uk`); read by `src/lib/constants.ts` as `SITE_URL`. Added to Vercel; a redeploy is required for it to take effect. |
| `SITE_URL` | GitHub Actions secret | Production URL used by publish-scheduled workflow |
| `DATABASE_URL` | Vercel | Supabase connection string |
| `NEXTAUTH_SECRET` | Vercel | NextAuth session signing key |
| `GOOGLE_CLIENT_ID` | Vercel | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Vercel | Google OAuth |
