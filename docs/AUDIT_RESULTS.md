# The Consilium — Production Audit & Fixes

Branch: `claude/beautiful-albattani-69c757` · Base: `d7aa5ce` (HEAD before audit)
Date: 2026-06-04

---

## 1. Executive summary

| | Starting state | Ending state |
|---|---|---|
| `npm run typecheck` | **FAIL** — 11 errors (stale Prisma client) | **PASS** (0) |
| `npm run lint` | PASS w/ 4 warnings | **PASS** (0 problems) |
| `npm run test` | 193 passed / 7 xfail / 18 skip | **199 passed** / 7 xfail / 18 skip |
| `npm run build` | **FAIL** (type-check phase) | **PASS** |

**Headline finding (P0, fixed):** the public article APIs (`GET /api/articles` and
`GET /api/articles/[id]`) returned each article's `author` via `include: { author: true }`,
serialising the author's **bcrypt password hash, email, ban status, failed-login count and
lockout time to any unauthenticated visitor**. Fixed with a global Prisma `omit` on
`User.password` (defence-in-depth) plus safe author selects on the public endpoints.

**Counts:** 1 P0, ~3 P2, ~9 P3/observations confirmed. **6 issues fixed & committed** (the
P0 + 1 authz consistency P2 + 4 consolidations/hardening). Remaining items are P3 or
operational and are documented in §5.

**Biggest remaining risk is operational, not code:** two schema changes are declared in
`prisma/schema.prisma` but **not yet applied to the live Supabase database** (the
`writer_streaks.intervalWeeks` column and the `site_settings` table). The code is guarded to
degrade gracefully, but the streak-cadence and commissioning-brief features will not function
until the SQL in §5 is run.

### About the baseline "FAIL"
The typecheck/build failures at the start were **not a code defect** — `prisma/schema.prisma`
was correct, but the generated Prisma Client in `node_modules` was stale (the new gamification
models hadn't been regenerated in this worktree). Running `npx prisma generate` (the only DB
command the rules permit, and exactly what Vercel runs via the `postinstall` hook) resolved
them. Vercel deployments were therefore **not** broken by this. The genuine code-level issues
are listed below.

---

## 2. Hotspot dispositions (the 7 called out in the brief)

| # | Hotspot | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Duplicate publish route | **CONFIRMED → fixed** | `/api/cron/publish-scheduled` was unreferenced (no workflow, no Vercel cron) and had divergent, side-effect-free logic. Deleted (commit `223d675`). |
| 2 | Cron auth inconsistency | **CONFIRMED → fixed** | `publish-scheduled` + `award-trophies` used non-constant-time `!==`; streak/engagement crons used `verifyCronAuth`. Unified on constant-time `verifyCronAuth` (commit `03617fc`). |
| 3 | `vercel.json` is `{}` / crons dead | **KILLED** | All 4 crons fire via **GitHub Actions** (`.github/workflows/*.yml`), not Vercel. `{}` does not disable them; `postinstall: prisma generate` covers the build. `vercel.json.backup` is legacy. See §5 for a config note. |
| 4 | `/api/award-trophies` unauthenticated | **KILLED** | It *is* authenticated (`x-cron-secret` vs `CRON_SECRET`, 401/500). Only flaw was non-constant-time compare — fixed under #2. |
| 5 | Two rate-limiter modules | **CONFIRMED → fixed** | `rate-limit.ts` + `rate-limiter.ts` were duplicates. Consolidated into `rate-limit.ts`, deleted `rate-limiter.ts` (commit `f96c8d8`). In-memory/per-instance tradeoff is documented and unchanged. |
| 6 | Gamification correctness | **AUDITED — sound** | Streak math (ISO-week dedupe, round-to-weeks adjacency, no divide-by-zero, correct single/empty), engagement (views floored at 1, rates clamped), achievements (first-publish Serializable race guard; series-complete idempotent via unique key + P2002 swallow), mark-seen (scoped to caller, sets `seenAt`), and the missing-column/table guards all verified correct. No fix needed. |
| 7 | Schema drift | **CONFIRMED (operational)** | Stale client (fixed via `prisma generate`); two SQL statements pending on live DB (see §5). Also: `article_comments` table is accessed via raw SQL and is not modelled in Prisma (intentional, noted). |

---

## 3. Findings & fixes by subsystem (severity-sorted)

### Auth & accounts — AUDITED, no defects
- `getVerifiedSessionUser` re-reads the user from the DB every call and checks
  `isActive`/`isBanned`/role — it does **not** trust the JWT. The JWT callback re-checks
  ban/role/active every 60s and demotes deleted/banned users to READER. Credentials flow handles
  lockout (5 attempts/15 min), banned/inactive/OAuth-only accounts, and admin lockout email.
- Password reset (`/api/auth/forgot-password`): 256-bit `randomBytes` token, 1-hour expiry,
  single-use (checked+set in a transaction), enumeration-safe, rate-limited, resets lockout.
  **Secure.**
- Confidence: High (read every branch).

### P0 — Author password hash + PII leak via article APIs · **FIXED** (`4e8184b`)
- **Where:** `src/app/api/articles/route.ts:106` (public list) and
  `src/app/api/articles/[id]/route.ts:25-43` (published-article branch, returned to anonymous
  callers).
- **What:** `include: { author: true }` serialised the full `User` row — `password` (bcrypt
  hash), `email`, `isBanned`, `bannedReason`, `failedLoginAttempts`, `lockedUntil`,
  `adminNotes` — to unauthenticated clients. `src/lib/prisma.ts` had no `omit`; `User.password`
  is a real column.
- **Blast radius:** any visitor could read every author's password hash + email by calling
  `GET /api/articles` or `GET /api/articles/{id}` of a published article.
- **Fix:** global `omit: { user: { password: true } }` in `prisma.ts` (kills the hash leak on
  *every* query and relation, current and future); `auth.ts` credentials `authorize` overrides
  it with `omit: { password: false }` (the only reader of the hash; never returns it to a
  client). New `src/lib/publicUser.ts#PUBLIC_AUTHOR_SELECT` (id, name, slug, image, bio) applied
  to both public endpoints to also drop email + security columns.
- **Verified:** `tests/unit/public-user.test.ts` (select contract — runs in the gate);
  `tests/integration/api.test.ts` server-gated assertions that live responses omit
  `password`/`email`; adversarially confirmed no other `omit:{password:false}` and that the
  raw-SQL comment queries select only `u.name` (no `*`/password); build collects page data
  cleanly with the omit.
- **Confidence:** High.

### P2 — Editor article deletion not category-scoped · **FIXED** (`1068208`)
- **Where:** `src/app/api/articles/[id]/route.ts` DELETE.
- **What:** `GET` and `PUT` restrict a category-scoped EDITOR to their assigned categories, but
  `DELETE` let any EDITOR soft-delete any article (privilege over-reach; recoverable via 30-day
  trash).
- **Fix:** mirrored the same `categoryEditor` check on delete. Admins and the article's own
  author unaffected.
- **Verified:** typecheck/lint/test green; logic mirrors the audited PUT/GET guard.
- **Confidence:** High.

### P2 — Duplicate / divergent publish route · **FIXED** (`223d675`)
- **Where:** `src/app/api/cron/publish-scheduled/route.ts` (deleted).
- **What:** unreferenced orphan that published via a raw `updateMany` **without** awarding
  achievements, emailing the author, creating notifications, or purging trash — all of which the
  live route (`/api/publish-scheduled` → `publishScheduledArticles()`) does. A footgun if ever
  wired up.
- **Verified:** zero references (grep across ts/tsx/yml/json); build regenerates route types
  cleanly; full gate green.
- **Confidence:** High.

### P3 — Cron secret compared in non-constant-time · **FIXED** (`03617fc`)
- **Where:** `publish-scheduled` + `award-trophies` (`provided !== secret`).
- **Fix:** both now use `verifyCronAuth` (SHA-256 + `timingSafeEqual`); `verifyCronAuth` extended
  to accept `x-cron-secret` alongside `Authorization: Bearer` so all four crons share one check.
  Behaviour otherwise identical (500 unset / 401 bad).
- **Confidence:** High.

### P3 — Duplicate rate-limiter modules · **FIXED** (`f96c8d8`)
- Consolidated `rate-limiter.ts` into `rate-limit.ts` (kept `getIp` + `unref()`'d prune timer,
  added `retryAfterSeconds`); repointed 2 importers + the unit test; deleted `rate-limiter.ts`.
- Note: in-memory limiting is per-serverless-instance (documented tradeoff; a global limiter
  would need Redis/Upstash = new dependency — out of scope).

### P3 — ESLint warnings · **FIXED** (`1754c9d`)
- `award-trophies` `console.log` → `console.warn` (config allows only warn/error; matches the
  publish-scheduled cron's logging); removed an unused `eslint-disable` directive on the
  dashboard. Lint now reports 0 problems.

### Article lifecycle — AUDITED, sound
- Writers can only edit their own DRAFT/REJECTED articles and cannot self-publish
  (`WRITER_UPDATE_STATUSES` excludes PUBLISHED). `authorId`/series/correction fields are
  admin/editor-only. Scheduled publishing uses a compare-and-set `updateMany` (race-safe, no
  double-publish), guards each side-effect, and purges >30-day trash. Editor review path is
  category-scoped with future-date validation.
- Known, **intended** gap: the editor "approve"/"Publish Now" path does not award first-publish/
  series achievements — only the scheduled-publish cron does (documented in `docs/AI_STATE.md`).
  Listed in §5 as a recommended follow-up.

### Public site — AUDITED, no draft leaks
- `/articles/[slug]`, `/feed.xml`, `/archive`, `/category/[slug]`, `/tag/[slug]`,
  `/author/[slug]`, `/` (home), search and the articles API all filter
  `status: 'PUBLISHED', deletedAt: null`. `/corrections` is a static policy page (no query).
  `/opinion-debate` shows debate articles, which are always created `PUBLISHED` (see P3 note
  below).

### Comments — AUDITED, minor items only
- POST: auth + 5/min rate limit + `stripHtml` + 3–1000 length + content filter + verifies
  article is PUBLISHED + validates parent belongs to same article. DELETE: owner or ADMIN/EDITOR,
  soft-delete preserving original body. Upvote/GET: safe user select (no email). 
- P3: self-upvote not prevented (max +1 via unique constraint); reply-to-reply allowed but
  renders only one nesting level (orphaned deep replies); upvote/report have no rate limit.

### RBAC / Admin — AUDITED, sound
- Every `/api/admin/*` route uses `getVerifiedSessionUser(ADMIN_ONLY)`. `editorial/users`
  create/update/delete are ADMIN_ONLY with isolated role/password changes, a field allowlist, and
  audit logging; user deletion is FK-safe (User relations cascade) — though it **hard-deletes the
  user's published articles** (intended GDPR behaviour). Role-change route blocks self-change.
- P3: `editorial/users/[id]` PATCH does not block an admin demoting themselves (the dedicated
  role route does).

### Newsletter — AUDITED, works
- Unsubscribe token (`email.ts#unsubscribeUrl`) is `HMAC-SHA256(email, NEXTAUTH_SECRET)`,
  identical to `unsubscribe/page.tsx#verifyToken` — the link resolves. `deleteMany` is
  idempotent. P3: HMAC compared non-constant-time (forging requires breaking HMAC — impractical).

### Uploads — AUDITED, strong
- `/api/upload`: staff-only, bucket allowlist, **magic-byte signature validation** (ignores
  browser MIME), 10 MB cap, filename sanitisation. P3: AVIF/HEIF check (`ftyp` at offset 4) also
  matches some video containers — harmless (stored as image, no execution).

### Other observations (P3 / not fixed — see §5)
- **Email HTML injection:** `articleSubmittedEmail`/`articlePublishedEmail` interpolate
  `articleTitle`/`writerName` without `esc()` (other templates do escape). Writer-controlled;
  mitigated by email-client sandboxing. `sendEmail` itself never throws (self-contained
  try/catch), so email failures never corrupt request flows.
- **Unbounded query:** `editorial/analytics` `handleDistribution` does
  `prisma.articleView.findMany({ select: { source: true } })` with no `take` — loads every view
  row into memory. ADMIN/GROWTH-only; replace with a `groupBy(['source'])`.
- **Debate freshness:** `/opinion-debate` renders `forArticle`/`againstArticle` content without
  re-checking `status` — only matters if a debate article is later unpublished.
- **Analytics spoofing:** `/api/analytics/track` is unauthenticated (by design) and only
  rate-limited (60/min/IP) — view counts are inflatable but not a security hole.

---

## 4. Final verification gate (pasted)

```
$ npm run typecheck   → tc=0   (PASS, was 11 errors)
$ npm run lint        → lint=0  (PASS, 0 problems, was 4 warnings)
$ npm run test        → Test Files 6 passed (6)
                        Tests 199 passed | 7 expected fail | 18 skipped (224)
$ npm run build       → build=0 (PASS — "Compiled successfully", TypeScript checked,
                        all routes built; was FAILING)
```
(Build run with a gitignored placeholder `.env.local`, required only for page-data collection;
not committed.)

---

## 5. Requires human

### 5a. Supabase migrations to apply BEFORE these features work (rules forbid me applying them)
Both are declared in `prisma/schema.prisma` and `docs/AI_STATE.md`; code degrades gracefully
until applied.

```sql
-- Streak cadence (writer_streaks.intervalWeeks)
ALTER TABLE public.writer_streaks
  ADD COLUMN IF NOT EXISTS "intervalWeeks" INTEGER NOT NULL DEFAULT 1;

-- Commissioning brief (site_settings table)
CREATE TABLE IF NOT EXISTS public.site_settings (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     TEXT,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT
);
INSERT INTO public.site_settings ("key", "value") VALUES ('commissioning_brief', NULL)
ON CONFLICT ("key") DO NOTHING;
```
Until applied: `GET/PATCH /api/user/streak` and the streak-cadence control return 500 / weekly
default; commissioning-brief GET returns `{brief:null}` and PATCH 500; the dashboard still
renders (guarded). After applying, run `npx prisma generate` locally (no migration).

### 5b. Vercel / env config to verify
- `vercel.json` is `{}`. Crons run via GitHub Actions, so this is fine, **but** confirm Vercel
  has `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `CRON_SECRET`, Google OAuth, Supabase
  and `RESEND_API_KEY` set in the dashboard (the old `vercel.json.backup` mapped some via legacy
  `@secret` references — do **not** restore it blindly; those secret refs may not exist).
- Confirm `CRON_SECRET` is identical in Vercel and GitHub Actions secrets, and `SITE_URL` is set
  in Actions (used by `publish-scheduled.yml`).

### 5c. Manual verification plan (what code can't prove)
Cron routes (replace `$SECRET`):
```bash
# publish-scheduled (Bearer) — expect 200 JSON {due,published,...}; wrong/missing → 401
curl -i -X POST https://theconsilium.co.uk/api/publish-scheduled -H "Authorization: Bearer $SECRET"
# award-trophies (x-cron-secret) — expect 200 {awarded,checked,...}
curl -i -X POST https://theconsilium.co.uk/api/award-trophies -H "x-cron-secret: $SECRET"
# both streak/engagement crons accept Bearer; all four return 401 with no/!valid secret
```
P0 leak verification (must NOT contain `password`/`email`):
```bash
curl -s https://theconsilium.co.uk/api/articles | python3 -c "import sys,json;print([a.get('author') for a in json.load(sys.stdin)][:1])"
```
Role flows to click through: READER (comment/upvote/bookmark, no editorial access);
WRITER (draft→submit, cannot publish, cannot edit others' articles, streak card);
EDITOR (review only assigned categories, cannot delete other categories' articles — now enforced);
ADMIN (users, roles, ban/unban, delete). Newsletter: subscribe → click the unsubscribe link in
the email → confirm removal.

### 5d. Recommended follow-ups (P3 / not done — verification or product decisions needed)
1. Award milestones on the editor "Publish Now" path (currently scheduled-publish only).
2. `esc()` the title/name in `articleSubmittedEmail` + `articlePublishedEmail`.
3. Replace the unbounded `articleView.findMany` in analytics `handleDistribution` with
   `groupBy(['source'])` (verify totals against real data).
4. Block admin self-demotion in `editorial/users/[id]` PATCH for consistency.
5. Consider modelling `article_comments` in Prisma (currently raw-SQL only).

---

## 6. Coverage table

| Subsystem | Coverage | Notes |
|---|---|---|
| Auth (OAuth/credentials/JWT/lockout/ban) | **Audited** | Sound |
| Password reset / forgot-password | **Audited** | Secure |
| RBAC — admin/* & editorial/* | **Audited** | All ADMIN_ONLY / correct constants |
| Article lifecycle (CRUD/submit/review/schedule/publish/trash) | **Audited** | P2 delete fixed; achieve-on-approve gap noted |
| Public site & draft-leak surfaces | **Audited** | No leaks |
| Comments (public) | **Audited** | Minor P3s |
| Editorial inline comments (`article_comments`, raw SQL) | **Audited** | Safe selects |
| Newsletter (subscribe/unsubscribe) | **Audited** | Works |
| Gamification (streaks/engagement/achievements/trophies/mark-seen/brief) | **Audited** | Sound + guards verified |
| Cron routes & GitHub workflows | **Audited** | Fixed |
| Uploads (`/api/upload`) | **Audited** | Strong |
| Debate voting | **Audited** | Race-safe (P3: error matched by string) |
| Rate limiting | **Audited** | Consolidated |
| Analytics (`/api/analytics/*`, `editorial/analytics`) | **Partial** | Authz verified; 1 unbounded query noted; per-tab math spot-checked not exhaustively |
| Profile (reading-history/saved/account/stats) | **Partial** | Authz pattern verified (self-scoped); bodies not deep-read |
| `/api/parse-pdf` | **Not reached** | Auth confirmed (getVerified); validation not read |
| Ticker (`/api/ticker/*` FRED/Alpha Vantage) | **Not reached** | Availability/caching not audited |
| Team / bookmarks / reading-progress / contact | **Partial** | Authz from inventory + tests; not deep-read |

---

## 7. Commits (this branch, oldest→newest)
| Hash | Summary |
|---|---|
| `4e8184b` | fix(security): stop leaking author password hash + PII via article APIs (**P0**) |
| `1068208` | fix(authz): scope editor article deletion to assigned categories (P2) |
| `223d675` | refactor: remove orphaned /api/cron/publish-scheduled duplicate route (P2) |
| `03617fc` | fix(security): constant-time CRON_SECRET check on all cron routes (P3) |
| `f96c8d8` | refactor: consolidate duplicate rate limiters into one module (P3) |
| `1754c9d` | chore(lint): clear remaining ESLint warnings (P3) |

No changes were reverted. No fix left the tree broken. The Prisma client was regenerated locally
(`npx prisma generate`) — not a committed change; Vercel does this via `postinstall`.
