# AI_STATE.md

Persistent state document for AI-assisted development sessions on The Consilium.
Updated at the end of each session. Read this before starting work.

---

## Recent Sessions

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

## Open PRs

| PR | Branch | Status | Notes |
|----|--------|--------|-------|
| feat: writer trophy system with award animation and cron workflow | `claude/trophy-system` | Open, awaiting review | Do not merge until CRON_SECRET is added to Vercel env vars and GitHub Actions secrets |

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CRON_SECRET` | Vercel + GitHub Actions secret | Shared secret for cron-triggered API routes (`/api/publish-scheduled`, `/api/award-trophies`) |
| `SITE_URL` | GitHub Actions secret | Production URL used by publish-scheduled workflow |
| `DATABASE_URL` | Vercel | Supabase connection string |
| `NEXTAUTH_SECRET` | Vercel | NextAuth session signing key |
| `GOOGLE_CLIENT_ID` | Vercel | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Vercel | Google OAuth |
