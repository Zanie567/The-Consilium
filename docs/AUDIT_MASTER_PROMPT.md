# The Consilium — Master Audit Prompt

Paste the prompt below into a fresh Claude Code session **at the repository root**. It is
designed to drive a thorough, senior-engineer-grade audit of the entire application. See
"How to run it effectively" at the bottom for why you should run it subsystem-by-subsystem
rather than all at once.

---

## THE PROMPT

> ### Role & standard
>
> You are a **staff-level software engineer** conducting a pre-launch quality audit of a
> production web application that real users depend on. You hold the code to the standard of
> a senior engineer at a top-tier company: correct, secure, resilient to bad input, free of
> race conditions, and free of silent failure. "It probably works" is not acceptable — every
> claim you make is backed by reading the actual code, tracing the data flow, or running a
> command. You are skeptical of your own conclusions and you verify before you assert.
>
> Your job is **not** to be reassuring. Your job is to find everything that is broken,
> fragile, insecure, or subtly wrong — and to prove it. A clean report that misses a real bug
> is a failure. If you are unsure whether something is a bug, investigate until you are sure;
> if you still cannot be sure, say so explicitly and explain what you could not verify.
>
> ### The application
>
> **The Consilium** — a student economics publication (University of Edinburgh Economics
> Society). Next.js 16 (App Router) · Prisma 7 · PostgreSQL via Supabase · NextAuth v4 ·
> TipTap 3 editor · Resend email · UploadThing + Supabase Storage · Tailwind v4 · Chart.js ·
> deployed on Vercel.
>
> Important environment facts (do not violate these):
> - **Never** run `prisma migrate dev` or `prisma db push` against any database. Schema
>   changes are applied **manually in Supabase**; only `prisma generate` is run locally. This
>   means schema drift between `prisma/schema.prisma` and the live DB is a real, expected risk
>   class — look for it.
> - This is a **modified Next.js 16** with breaking changes vs. older versions. Before relying
>   on any Next.js behavior (async `params`/`searchParams`, caching, route handlers, `cookies()`),
>   consult `node_modules/next/dist/docs/` rather than your training memory.
> - The codebase is laid out under `src/` (`src/app`, `src/lib`, `src/components`, `src/hooks`).
> - Read-only audit by default. **Do not change code, the database, or any external service**
>   unless I explicitly ask you to fix something.
>
> ### Established codebase conventions (verify they are followed everywhere)
>
> - **AuthN/AuthZ:** API routes authorize via `getVerifiedSessionUser(ALLOWED_ROLES)` from
>   `src/lib/auth.ts`, using role constants from `src/lib/rbac.ts` (`ADMIN_ONLY`,
>   `EDITORIAL_MANAGEMENT_ROLES`, `ARTICLE_MUTATION_ROLES`, `ANALYTICS_ACCESS_ROLES`,
>   `EDITORIAL_PORTAL_ROLES`, etc.). Roles: `READER`, `WRITER`, `EDITOR`, `GROWTH`, `ADMIN`.
> - **Cron auth:** cron routes should validate `CRON_SECRET` via `verifyCronAuth()` in
>   `src/lib/cronAuth.ts` (constant-time, `Authorization: Bearer <secret>`).
> - Role changes only take effect on the user's next sign-in (by design — not a bug).
>
> ### Known hotspots (start here, but do not stop here)
>
> These were flagged on a first pass and need confirmation + a verdict. Treat each as a
> hypothesis to prove or disprove, then keep going beyond them:
>
> 1. **Duplicate publish route:** both `src/app/api/cron/publish-scheduled/route.ts` and
>    `src/app/api/publish-scheduled/route.ts` exist. Determine which is live, whether both can
>    run, and whether scheduled articles can be double-published or published with no auth.
> 2. **Cron auth inconsistency:** `recalculate-streaks` and `update-engagement-scores` appear
>    to use `verifyCronAuth`, but `publish-scheduled` may not. Confirm every cron/automation
>    endpoint is authenticated and idempotent.
> 3. **Cron scheduling:** `vercel.json` is currently `{}` with no `crons` array. Determine how
>    (or whether) the three cron jobs actually fire in production. If they don't, scheduled
>    publishing, streak recalculation, and engagement scoring are silently dead.
> 4. **`/api/award-trophies`** appears to have no auth wrapper — confirm whether it can be
>    invoked by anyone, and what side effects that has.
> 5. **Two rate-limiter modules:** `src/lib/rate-limit.ts` and `src/lib/rate-limiter.ts`.
>    Determine which routes use which, whether limits are actually enforced (and survive
>    serverless cold starts / multiple instances — in-memory limiters usually don't), and
>    whether any sensitive route is unprotected.
> 6. **Gamification is the newest code** (`src/lib/gamification/*`: streaks, engagement,
>    achievements, writerActivity). Scrutinize date/timezone math, division-by-zero, double
>    awarding, "mark-seen" not clearing state, and disagreement between the live API and the
>    cron recompute.
> 7. **Manual schema drift:** cross-check `prisma/schema.prisma` against the queries in route
>    handlers for fields/relations that may not match the live DB.
>
> ### Coverage — audit every one of these subsystems
>
> For each, enumerate the user-facing features and the routes/components behind them, then
> verify correctness, authorization, input validation, error handling, and edge cases:
>
> 1. **Auth & accounts** — Google OAuth + credentials login, signup, forgot/reset password
>    (`/api/auth/*`, `src/lib/auth.ts`), `ADMIN_EMAILS` auto-grant, session/JWT handling,
>    account deletion, banned-user enforcement everywhere a banned user could still act.
> 2. **RBAC** — every route under `src/app/api/admin/*` and `src/app/api/editorial/*`: confirm
>    the correct role set is required server-side, ownership checks exist (writers editing only
>    their own drafts), and there is no privilege-escalation path (e.g. editor changing a user
>    to admin, user editing their own role).
> 3. **Article lifecycle** — create/edit (TipTap), submit-for-review, review approve/return,
>    publish, scheduled publishing, unpublish, trash/restore, series, pin/feature,
>    commendations, commissioning brief. Verify drafts never leak to public surfaces.
> 4. **Public site** — `/articles/[slug]`, categories, tags, authors, archive, search
>    (`/api/search`), `/feed.xml` RSS, corrections, opinion-debate. Verify only published
>    content is exposed, 404s behave, slugs are unique, and TipTap content renders identically
>    to the editor (tables, images, links, alignment, embeds).
> 5. **Comments** — post, edit, delete, upvote, report, moderation; content filtering
>    (`src/lib/content-filter.ts`); nesting/threading; abuse and self-upvote prevention.
> 6. **Newsletter/subscribers** — subscribe, **unsubscribe** (link in emails resolves),
>    double-opt-in if any, duplicate handling, Resend failures handled gracefully.
> 7. **Gamification** — streaks, engagement scores, trophies, achievements, leaderboard
>    ordering/ties, "mark-seen" endpoints, award animations not replaying.
> 8. **Admin** — user list/search, role change, ban/unban, warn, notes, delete user, stats,
>    login-attempts, audit log (every privileged action is logged; logs can't be forged).
> 9. **Economic ticker** — `/api/ticker/macro`, `/api/ticker/markets` (FRED + Alpha Vantage):
>    handle rate limits, expired keys, upstream downtime, and caching without crashing the page.
> 10. **Uploads & PDF** — `/api/upload`, `/api/parse-pdf`: size/type limits, malformed/huge
>     files, orphaned files, broken URLs, auth on who can upload.
> 11. **Analytics** — `/api/analytics/*` tracking and reporting: no PII leak, no unbounded
>     queries, tracking can't be trivially spoofed to poison data.
> 12. **Profile** — reading history, saved/bookmarked articles, debate votes, account settings.
> 13. **Cross-cutting** — error/loading/empty states, N+1 queries and missing indexes on hot
>     paths (analytics, leaderboard, feeds), missing `await`s, unhandled promise rejections,
>     race conditions (vote/upvote/streak double-submit), env-var assumptions that only fail in
>     prod, secrets exposed to the client (`NEXT_PUBLIC_*` misuse), `console.error` swallowing,
>     and any `any`-typed boundaries hiding bugs.
>
> ### Method
>
> 1. Start by running the project's own checks and report the raw results:
>    `npm run typecheck`, `npm run lint`, `npm run test`. Treat every error/warning as a lead.
> 2. Build a route/feature inventory before judging anything, so coverage is provable.
> 3. For each subsystem, read the actual handler + the components that call it, and trace the
>    full request → DB → response path. Check the unhappy paths (bad input, missing record,
>    wrong role, concurrent calls, upstream failure), not just the happy path.
> 4. Confirm or kill each known hotspot above with evidence.
> 5. Prefer proof over assertion: cite `file.ts:line`, show the offending snippet, and where
>    feasible give a concrete reproduction (the exact request, role, or input that triggers it).
>
> ### Severity rubric
>
> - **P0 / Critical** — data loss, security/authz hole, anyone-can-X, prod-down, money/PII leak.
> - **P1 / High** — a core feature is broken or silently not running for real users.
> - **P2 / Medium** — wrong behavior on a real but narrower path; missing validation; race.
> - **P3 / Low** — polish, resilience, performance, UX edge cases, tech debt.
>
> ### Output format
>
> Produce a single Markdown report:
> - **Executive summary:** overall health, count by severity, and the 3–5 things to fix first.
> - **Findings**, grouped by subsystem then sorted by severity. Each finding:
>   - Title · Severity · `file.ts:line`
>   - What's wrong (1–3 sentences)
>   - Why it matters / blast radius
>   - How to reproduce or how I verified it
>   - Recommended fix (concise; do not implement it yet)
>   - Confidence: Confirmed / Likely / Needs-investigation
> - **Coverage table:** every subsystem above marked Audited / Partially audited / Not reached,
>   so nothing is silently skipped. If you run low on budget, say what you did not get to —
>   never imply full coverage you didn't achieve.
> - **Open questions:** anything you could not verify from code alone (e.g. prod env vars,
>   live DB schema, whether Vercel crons are configured) and exactly what you'd need to confirm.
>
> Do not fix anything yet. Deliver the report first; I will choose what to fix.

---

## How to run it effectively

A single pass over ~90 API routes + 77 components will exhaust the model's context and produce
shallow results. For senior-grade depth, run the prompt in **passes**, each scoped to a slice,
and have it append to one growing report:

1. **Pass 0 — tooling + inventory:** run `typecheck`/`lint`/`test`, build the route/feature map,
   and confirm/kill the 7 known hotspots. This alone surfaces the highest-value issues fastest.
2. **Pass 1 — auth, RBAC, admin** (security-critical).
3. **Pass 2 — article lifecycle + public rendering + comments.**
4. **Pass 3 — gamification + crons + subscribers + ticker + uploads.**
5. **Pass 4 — analytics, profile, cross-cutting (perf, races, error states).**

To scope a pass, append to the prompt: *"This pass: audit only subsystems N–M. Append findings
to the existing report and update the coverage table."*

Pair the static audit with **dynamic verification** — run the app (`npm run dev`) and smoke-test
the core flows as each role (reader / writer / editor / admin): sign in, publish an article,
schedule one, comment, subscribe + unsubscribe, trigger a cron route with the `CRON_SECRET`.
Static analysis finds logic bugs; only running it finds integration and config bugs (especially
the cron-scheduling and env-var classes, which can't be confirmed from code alone).
