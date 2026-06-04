# The Consilium — Master Audit, Fix & Verify Prompt

Paste the prompt below into a fresh Claude Code session **at the repository root**. It drives a
thorough, senior-engineer-grade workflow that **(1) audits** the entire application, **(2) fixes**
everything it finds, and **(3) proves** the fixes work through multiple quality gates and
contingencies. See "How to run it effectively" at the bottom for why you should run it
subsystem-by-subsystem rather than all at once.

---

## THE PROMPT

> ### Role & standard
>
> You are a **staff-level software engineer** taking ownership of a production web application
> that real users depend on. Your mandate is to make it work flawlessly: audit it exhaustively,
> fix every issue you find, and **prove** each fix is correct. You hold the code to the standard
> of a senior engineer at a top-tier company — correct, secure, resilient to bad input, free of
> race conditions, free of silent failure. "It probably works" is never acceptable: every claim
> is backed by reading the code, tracing the data flow, or running a command. You are skeptical
> of your own work and you verify before you assert.
>
> A fix that "looks right" but isn't verified is not done. A fix that silently breaks something
> else is worse than the original bug. Your reputation rests on the final state of the code being
> genuinely, provably correct — not on how many issues you closed.
>
> ### The application
>
> **The Consilium** — a student economics publication (University of Edinburgh Economics
> Society). Next.js 16 (App Router) · Prisma 7 · PostgreSQL via Supabase · NextAuth v4 · TipTap 3
> editor · Resend email · UploadThing + Supabase Storage · Tailwind v4 · Chart.js · deployed on
> Vercel. Code is under `src/` (`src/app`, `src/lib`, `src/components`, `src/hooks`).
>
> ### Hard rules (never violate)
>
> - **Never** run `prisma migrate dev` or `prisma db push` against any database. Schema changes
>   are applied **manually in Supabase**; only `prisma generate` runs locally. If a fix requires
>   a schema change, **do not apply it** — instead write the migration SQL into a file under
>   `prisma/migrations-manual/` (create it if needed), update `prisma/schema.prisma`, run
>   `prisma generate`, and flag it in your report as "requires manual Supabase migration before
>   deploy." Drift between `schema.prisma` and the live DB is a real risk class — look for it.
> - This is a **modified Next.js 16** with breaking changes vs. older versions. Before relying on
>   any Next.js behavior (async `params`/`searchParams`, caching, route handlers, `cookies()`),
>   consult `node_modules/next/dist/docs/`, not your training memory.
> - **Do not push, open PRs, or deploy.** Commit locally as you go (see workflow). I will review
>   and push myself.
> - Do not touch external services (Resend, Supabase data, UploadThing, FRED/Alpha Vantage) or
>   delete user data. Refactors must preserve existing behavior unless the behavior is the bug.
>
> ### Established conventions (preserve and enforce them everywhere)
>
> - API routes authorize via `getVerifiedSessionUser(ALLOWED_ROLES)` from `src/lib/auth.ts`,
>   using role constants from `src/lib/rbac.ts` (`ADMIN_ONLY`, `EDITORIAL_MANAGEMENT_ROLES`,
>   `ARTICLE_MUTATION_ROLES`, `ANALYTICS_ACCESS_ROLES`, `EDITORIAL_PORTAL_ROLES`, etc.). Roles:
>   `READER`, `WRITER`, `EDITOR`, `GROWTH`, `ADMIN`. Fixes must use these helpers, not ad-hoc checks.
> - Cron routes validate `CRON_SECRET` via `verifyCronAuth()` in `src/lib/cronAuth.ts`
>   (constant-time, `Authorization: Bearer <secret>`).
> - Role changes only take effect on the user's next sign-in (by design — not a bug).
> - Match the style, naming, and patterns of the surrounding code. Do not introduce new
>   dependencies or new patterns when an existing one fits.
>
> ### Known hotspots (start here, but do not stop here)
>
> Confirm or kill each with evidence, then fix the confirmed ones:
> 1. **Duplicate publish route:** both `src/app/api/cron/publish-scheduled/route.ts` and
>    `src/app/api/publish-scheduled/route.ts` exist. Determine which is live; can scheduled
>    articles be double-published or published with no auth? Consolidate to one authenticated,
>    idempotent route.
> 2. **Cron auth inconsistency:** `recalculate-streaks` and `update-engagement-scores` appear to
>    use `verifyCronAuth`, but `publish-scheduled` may not. Make every automation endpoint
>    authenticated and idempotent.
> 3. **Cron scheduling:** `vercel.json` is `{}` with no `crons` array. Determine how the three
>    cron jobs fire in production. If they don't, scheduled publishing, streak recalculation, and
>    engagement scoring are silently dead — fix the config (and document required env/secret).
> 4. **`/api/award-trophies`** appears to have no auth wrapper — confirm and lock it down.
> 5. **Two rate-limiter modules:** `src/lib/rate-limit.ts` and `src/lib/rate-limiter.ts`.
>    Determine which routes use which, whether limits actually enforce (and survive serverless
>    cold starts / multiple instances), consolidate, and protect any unprotected sensitive route.
> 6. **Gamification (newest code,** `src/lib/gamification/*`): scrutinize date/timezone math,
>    division-by-zero, double-awarding, "mark-seen" not clearing state, and live-API vs cron
>    recompute disagreement.
> 7. **Schema drift:** cross-check `prisma/schema.prisma` against route-handler queries for
>    fields/relations that may not match the live DB.
>
> ### Coverage — audit (and fix) every subsystem
>
> For each: enumerate the user-facing features and the routes/components behind them, verify
> correctness, authorization, input validation, error handling, and edge cases, then fix what's
> broken.
> 1. **Auth & accounts** — Google OAuth + credentials login, signup, forgot/reset password
>    (`/api/auth/*`, `src/lib/auth.ts`), `ADMIN_EMAILS` auto-grant, session/JWT handling, account
>    deletion, banned-user enforcement everywhere a banned user could still act.
> 2. **RBAC** — every route under `src/app/api/admin/*` and `src/app/api/editorial/*`: correct
>    role required server-side, ownership checks (writers editing only their own drafts), no
>    privilege-escalation path.
> 3. **Article lifecycle** — create/edit (TipTap), submit-for-review, review approve/return,
>    publish, scheduled publishing, unpublish, trash/restore, series, pin/feature, commendations,
>    commissioning brief. Drafts must never leak to public surfaces.
> 4. **Public site** — `/articles/[slug]`, categories, tags, authors, archive, search
>    (`/api/search`), `/feed.xml` RSS, corrections, opinion-debate. Only published content
>    exposed; 404s behave; slugs unique; TipTap content renders identically to the editor.
> 5. **Comments** — post, edit, delete, upvote, report, moderation; content filtering
>    (`src/lib/content-filter.ts`); threading; abuse and self-upvote prevention.
> 6. **Newsletter/subscribers** — subscribe, unsubscribe (email link resolves), duplicate
>    handling, Resend failures handled gracefully.
> 7. **Gamification** — streaks, engagement scores, trophies, achievements, leaderboard
>    ordering/ties, mark-seen endpoints, award animations not replaying.
> 8. **Admin** — user list/search, role change, ban/unban, warn, notes, delete user, stats,
>    login-attempts, audit log (every privileged action logged; logs can't be forged).
> 9. **Economic ticker** — `/api/ticker/macro`, `/api/ticker/markets` (FRED + Alpha Vantage):
>    rate limits, expired keys, upstream downtime, caching — never crash the page.
> 10. **Uploads & PDF** — `/api/upload`, `/api/parse-pdf`: size/type limits, malformed/huge
>     files, orphaned files, broken URLs, upload authorization.
> 11. **Analytics** — `/api/analytics/*`: no PII leak, no unbounded queries, tracking not
>     trivially spoofable to poison data.
> 12. **Profile** — reading history, saved/bookmarked articles, debate votes, account settings.
> 13. **Cross-cutting** — error/loading/empty states, N+1 queries and missing indexes on hot
>     paths, missing `await`s, unhandled rejections, race conditions (vote/upvote/streak
>     double-submit), env-var assumptions that only fail in prod, secrets exposed to client
>     (`NEXT_PUBLIC_*` misuse), swallowed errors, `any`-typed boundaries hiding bugs.
>
> ### Severity rubric
>
> - **P0/Critical** — data loss, security/authz hole, anyone-can-X, prod-down, money/PII leak.
> - **P1/High** — a core feature is broken or silently not running for real users.
> - **P2/Medium** — wrong behavior on a real but narrower path; missing validation; race.
> - **P3/Low** — polish, resilience, performance, UX edge cases, tech debt.
>
> ---
>
> ## Workflow — run these phases in order. Do not skip a gate.
>
> ### Phase 0 — Baseline
> Establish a known-good starting point so you can detect regressions you introduce.
> 1. Run and record raw output of: `npm run typecheck`, `npm run lint`, `npm run test`,
>    `npm run build`. This is the **baseline**. Note every pre-existing failure so you never
>    blame yourself for one — but also so you can fix them.
> 2. Build a complete route/feature inventory (every file under `src/app/api/**/route.ts` and
>    every page/component) so coverage is provable.
> 3. Confirm you are on a working branch (not `main`). Commit the inventory/notes if useful.
>
> ### Phase 1 — Audit
> Go subsystem by subsystem. Read the actual handler + the components that call it and trace the
> full request → DB → response path. Test the **unhappy paths** (bad input, missing record, wrong
> role, concurrent calls, upstream failure), not just the happy path. For every issue, record:
> Title · Severity · `file.ts:line` · what's wrong · blast radius · how you verified it ·
> Confidence (Confirmed / Likely / Needs-investigation). Confirm or kill every known hotspot.
> Produce the full findings list before fixing, so you fix in priority order with full context.
>
> ### Phase 2 — Fix (one issue at a time, highest severity first)
> For **each** confirmed issue, in this loop:
> 1. State the issue and the intended fix in one or two sentences.
> 2. Make the **smallest correct change** that fully resolves it. Fix the root cause, not the
>    symptom. Do not bundle unrelated changes.
> 3. **Per-fix gate (must pass before moving on):**
>    - `npm run typecheck` — clean (no new errors vs baseline).
>    - `npm run lint` — clean (no new errors vs baseline).
>    - `npm run test` — all green; if no test covers the bug, **write one** that fails before your
>      fix and passes after, then keep it.
>    - Re-read the changed code and the call sites to confirm you didn't break a contract.
>    - For security/authz/race fixes, explicitly reason about how the fix could be bypassed.
> 4. **Contingency:** if the gate fails or the fix balloons in scope or risk, `git stash`/revert
>    the change, record it as "attempted — needs design decision," and move on. Never leave the
>    tree in a broken state to chase a single fix.
> 5. Commit the fix alone with a message describing what and why (e.g.
>    `fix(cron): authenticate publish-scheduled route`). Small, reviewable commits.
>
> ### Phase 3 — Verification sweep (multiple independent checks)
> After all fixes, run the full battery and do not declare done until every check passes:
> 1. **Full tooling gate:** `npm run typecheck && npm run lint && npm run test && npm run build`
>    — all clean. Paste the results.
> 2. **Regression re-audit:** re-read every file you changed and its callers once more, fresh, as
>    if reviewing someone else's PR. Look specifically for things your fix could have broken.
> 3. **Adversarial self-review:** for each P0/P1 fix, try to defeat it — construct the input,
>    role, or sequence that would still break it. If you can, it's not fixed; loop back to Phase 2.
> 4. **Cross-cutting recheck:** confirm no fix introduced an N+1, a swallowed error, a missing
>    `await`, a leaked secret, or a broken auth/ownership check.
> 5. **Coverage reconciliation:** confirm every subsystem in the checklist was audited and every
>    confirmed issue is either fixed, reverted-with-reason, or explicitly deferred. No silent gaps.
>
> ### Phase 4 — Manual verification plan (what code alone can't prove)
> Some issues (cron scheduling, env vars, OAuth, email delivery, live DB schema) cannot be
> confirmed statically. Produce a concrete, step-by-step manual test plan I can run: the exact
> flows to click through as each role (reader/writer/editor/admin), the curl commands to hit cron
> routes with `CRON_SECRET`, and the env/Vercel settings to verify. For anything you *can* verify
> by running `npm run dev` and exercising it, do so and report what you observed.
>
> ### Output — a single Markdown report at `docs/AUDIT_RESULTS.md`
> - **Executive summary:** starting health vs. ending health, counts by severity found/fixed/
>   deferred, and the top risks that remain.
> - **Findings & fixes**, grouped by subsystem, sorted by severity. Each: Title · Severity ·
>   `file.ts:line` · what was wrong · the fix (with the commit hash) · how you verified the fix ·
>   final status (Fixed / Reverted-needs-decision / Deferred) · Confidence.
> - **Gate results:** paste the final typecheck / lint / test / build output.
> - **Coverage table:** every subsystem marked Audited / Partially / Not reached. If you run low
>   on budget, say exactly what remains — never imply coverage or verification you didn't achieve.
> - **Requires-human:** manual test plan, any schema migrations to apply in Supabase, env/Vercel
>   config to set, and any issue you reverted and why.
>
> Work autonomously through the phases. The bar is: at the end, the tooling gate is green, every
> confirmed issue is fixed-and-verified or explicitly flagged for a human, and you can defend the
> correctness of each change. If you run low on context, finish the current subsystem cleanly,
> write the report with an accurate coverage table, commit, and tell me exactly where to resume.

---

## How to run it effectively

A single pass over ~90 API routes + 77 components will exhaust the model's context and produce
shallow work. For senior-grade depth, run the prompt in **scoped passes**, each appending to the
same `docs/AUDIT_RESULTS.md` and committing as it goes:

1. **Pass 0** — Phase 0 baseline + full inventory + confirm/kill the 7 known hotspots.
2. **Pass 1** — Auth, RBAC, Admin (security-critical) → audit **and fix** → gates.
3. **Pass 2** — Article lifecycle + public rendering + comments → audit, fix, gates.
4. **Pass 3** — Gamification + crons + subscribers + ticker + uploads → audit, fix, gates.
5. **Pass 4** — Analytics, profile, cross-cutting (perf, races, error states) → audit, fix, gates.
6. **Pass 5** — Full Phase 3 verification sweep across everything + Phase 4 manual plan.

To scope a pass, append: *"This pass: subsystems N–M only. Run Phases 1–2 for them, then the
per-fix and verification gates. Append to docs/AUDIT_RESULTS.md and update the coverage table."*

**Always pair this with dynamic verification.** Run the app (`npm run dev`) and smoke-test the
core flows as each role: sign in, publish an article, schedule one, comment, subscribe +
unsubscribe, hit a cron route with the `CRON_SECRET`. Static analysis finds logic bugs; only
running it finds the integration and config bugs — especially the cron-scheduling and env-var
classes, which cannot be confirmed from code alone.
