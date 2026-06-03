# AI_STATE.md

Persistent state document for AI-assisted development sessions on The Consilium.
Updated at the end of each session. Read this before starting work.

---

## Latest Verification Report (2026-06-03, writer gamification)

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

---

## Recent Sessions

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
- Streak weeks are grouped with date-fns ISO-week helpers; adjacency uses the
  millisecond gap between each week's Monday so it stays correct across 52/53-week
  year boundaries. Crons run in UTC, so the boundaries are UTC as specified.
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
| `writer_streaks` (`WriterStreak`) | id, userId (unique), currentStreak, longestStreak, lastPublishedAt, updatedAt | one row per writer |
| `writer_achievements` (`WriterAchievement`) | id, userId, type, referenceId, awardedAt, seenAt | unique (userId, type, referenceId) |
| `articles.engagementScore` | Float? | per-article read-quality signal, recomputed by cron |
| `articles.editorialCommendation` | String? (text) | one-sentence editor note, dashboard-only |

`User` gained `streakData WriterStreak?` and `achievements WriterAchievement[]`
reverse relations.

---

## Open PRs

| PR | Branch | Status | Notes |
|----|--------|--------|-------|
| feat: writer gamification system - streaks, engagement scores, commendations, milestones | `claude/writer-gamification` | Open, awaiting review | Do not merge. `CRON_SECRET` must be set in Vercel and GitHub Actions (reused, no new value). Confirm SQL column types match the Prisma Float/String mapping. |
| feat: writer trophy system with award animation and cron workflow | `claude/trophy-system` | Open, awaiting review | Do not merge until CRON_SECRET is added to Vercel env vars and GitHub Actions secrets |

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CRON_SECRET` | Vercel + GitHub Actions secret | Shared secret for cron-triggered API routes (`/api/publish-scheduled`, `/api/award-trophies`, `/api/cron/recalculate-streaks`, `/api/cron/update-engagement-scores`) |
| `SITE_URL` | GitHub Actions secret | Production URL used by publish-scheduled workflow |
| `DATABASE_URL` | Vercel | Supabase connection string |
| `NEXTAUTH_SECRET` | Vercel | NextAuth session signing key |
| `GOOGLE_CLIENT_ID` | Vercel | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Vercel | Google OAuth |
