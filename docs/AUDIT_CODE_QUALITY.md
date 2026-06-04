# The Consilium — Code-Quality & Consistency Audit

**Date:** 2026-06-04 · **Branch:** `claude/focused-engelbart-197a1c` · **Base:** `cff0390`
**Scope:** Whole repository (`src/` — 262 files, ~33k LOC, 86 API routes). Read-only audit.
**Lens:** Not "is it broken" (the prior production audit in `AUDIT_RESULTS.md` covered that) but
"does every line read as if one senior engineer wrote it" — consistency, dead code, type safety,
duplication, and craftsmanship.

---

## 1. Verdict

**This codebase is not "vibecoded."** The mechanical and architectural hygiene is at or above what
most senior-written repositories have. The evidence:

| Signal | Result |
|---|---|
| TypeScript | `strict: true`; **typecheck passes clean** (0 errors) |
| ESLint | **0 problems**; rules carry *rationale comments* (`no-explicit-any: error`, `no-console` w/ allowlist) |
| Type coverage | **98.42%** fully-typed (`type-coverage --strict`) |
| `: any` / `@ts-ignore` | 1 / 0 across 33k LOC |
| Duplication (jscpd) | **1.47%** — low; 39 small clones |
| Tests | **205 passing** unit tests on the lib layer |
| Security spine | Constant-time cron + token comparison, magic-byte upload validation, global password `omit`, account lockout, OAuth-bypass gating |

The codebase has already survived one real security audit (`AUDIT_RESULTS.md`, #74 — found & fixed a
P0 author-data leak) and the defensive `// BUG-NN` comments throughout show that hardening was real.

**So the work to make it "uniformly senior" is not a rescue — it's polish:** standardize a few
split conventions, delete dead scaffolding, fix one genuine XSS sink, and close dependency/test gaps.
Findings below are ranked by severity; **none are P0**.

---

## 2. Methodology

1. **Deterministic tools** (installed this pass, now wired into `package.json` — see §7):
   `tsc --noEmit`, `eslint`, `type-coverage --strict`, `knip` (dead code/deps), `jscpd` (duplication),
   `npm audit`, `vitest --coverage`.
2. **House-style derivation** — read the shared spine (`lib/auth`, `rbac`, `cronAuth`, `prisma`,
   `rate-limit`, `publicUser`) to establish the canonical patterns every route *should* follow (§6).
3. **Per-route consistency matrix** — every one of the 86 `route.ts` files classified by authz
   mechanism, methods, and rate-limiting to find deviations.
4. **Subsystem deep-dives** — auth/admin, articles/comments/public, cron/gamification,
   editor/uploads/email. Each suspicious route read in full and given a verdict.

---

## 3. Deterministic results (reproducible via `npm run audit:*`)

- **knip** — 6 dead components, ~10 dead exports, 3 dead types, dependency drift (§5.3).
- **jscpd** — 1.47% duplication; only cluster worth refactoring is editorial article-action route
  boilerplate (§5.4).
- **type-coverage** — 98.42%; the untyped remainder is concentrated in `auth.ts`/`Navbar.tsx` casts
  caused by an incomplete NextAuth type augmentation (§5.5).
- **npm audit** — 17 vulns (6 high). Several highs ride in through the **dead** `uploadthing`
  dependency; removing it clears them (§5.6).
- **coverage** — strong on lib utilities, but the 86 route handlers are essentially untested (§5.7).

---

## 4. Findings — security / correctness

### P2-1 · Stored-XSS sink in search highlighting
`src/app/search/page.tsx:24-30, 267, 272`

```js
function highlight(text, query) {
  ...
  return text.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>')  // text is NOT escaped
}
// rendered: dangerouslySetInnerHTML={{ __html: highlight(result.title, query) }}
```

`result.title` / `result.snippet` are inserted into `dangerouslySetInnerHTML` **without HTML-escaping.**
React escapes these same strings everywhere else, so a `<img src=x onerror=…>` in an article title is
inert on the article page but **executes on the search results page**. The query itself is regex-escaped
(safe); the unescaped value is the article-derived `text`.

- **Exploitability:** requires a WRITER/EDITOR/ADMIN to author the malicious title/snippet (titles come
  from `ARTICLE_MUTATION_ROLES`). Insider / compromised-account threat, not anonymous — hence P2, not P1.
  *Raise to P1 if snippets ever incorporate reader-supplied text (e.g. comments).*
- **Fix (idiomatic — the codebase already has the right helper):** escape first, then wrap. Reuse the
  `escHtml()` already used by the article serializer (`articles/[slug]/page.tsx:154`):

```js
function highlight(text, query) {
  const safe = escHtml(text)
  if (!query.trim()) return safe
  const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2)
  if (!tokens.length) return safe
  const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>')
}
```
(Promote `escHtml` to a shared `lib/` util so both call sites import it.)

### P2-2 · `next` 16.2.2 is inside an open advisory range
`npm audit` flags `next` (range `9.3.4-canary.0 – 16.3.0-canary.5`, **high**). The deployed version
16.2.2 is included. **Action:** review the specific advisory and bump to a patched release — *carefully*,
because `AGENTS.md` documents this as a modified Next 16 with breaking changes. Verify against
`node_modules/next/dist/docs/` before bumping. (Do not blanket `npm audit fix --force`.)

### Verified safe (documented here so they aren't re-flagged)
- `editorial/setup` — guarded by an `adminExists` check; closed after first run. **Safe.**
- `editorial/password-reset` — rate-limited, no user-enumeration, **timing-safe** token comparison with
  dummy-value fallback, transactional update. **Exemplary.**
- `editorial/articles/[id]/view` — intentionally public, rate-limited (1/IP/article/10min), schema-drift
  fallback, surfaces real DB errors. **Safe.**
- `upload` — `getVerifiedSessionUser(ARTICLE_MUTATION_ROLES)` + bucket allowlist + **magic-byte** type
  detection + 10 MB cap + filename sanitization. **Excellent.**
- Article content rendering — structured TipTap-JSON→HTML serializer with `escHtml()` on every
  text/attr and `safeHref()` blocking `javascript:`/`data:` URLs. **Safe** (better than raw-HTML+DOMPurify).
- All 14 `admin/*` routes use `getVerifiedSessionUser(ADMIN_ONLY)`; role-change blocks self-edits and
  validates via `isAllowedRole`. **No privilege-escalation path.**
- All 4 cron routes use the constant-time `verifyCronAuth`. The master prompt's "duplicate publish
  route" hotspot is **already resolved** — only one `publish-scheduled` route exists.

---

## 5. Findings — consistency & craftsmanship (the "looks senior" work)

### 5.1 · `Response.json` vs `NextResponse.json` — an even split  ⟶ highest-visibility polish
**85 files use `Response.json`, 74 use `NextResponse.json`.** Both work, but a near-50/50 split is the
single clearest "many sessions wrote this" signal. **Pick one** (recommend `NextResponse.json` — it's
the Next-idiomatic choice and already required wherever headers/cookies are set) and standardize. Pure
mechanical change, zero behaviour difference, high readability payoff.

### 5.2 · Two authorization styles  ⟶ consistency + a real freshness gap
- **54 routes** use the canonical `getVerifiedSessionUser(ROLES)` (fresh DB re-check of role/ban/active).
- **22 routes** call `getServerSession` raw and read role/id off the token.

Most of the 22 are low-risk own-data reads (`user/*`, `reading-progress/*`) — a *consistency* smell only.
But two are **sensitive** and should move to the helper:
- `editorial/analytics/route.ts:30-35` — hand-rolls `getServerSession` + a manual role check. Replace with
  `getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)`. (Also fixes 5.3.)
- `editorial/notifications`, `articles/[id]/comments*` — confirm role/ownership re-checks.

### 5.3 · Role constants defined in three places
- Canonical: `lib/rbac.ts` (`ANALYTICS_ACCESS_ROLES`, etc.) ✅
- Dead duplicates: `lib/auth.ts:21-22` (`ANALYTICS_ROLES`, `ARTICLE_ACCESS_ROLES` — both unused per knip)
- Local redefinition: `editorial/analytics/route.ts:8` (`ANALYTICS_ROLES = ['ADMIN','GROWTH']`)
- Inline literal: `articles/route.ts:125` (`['ADMIN','EDITOR'].includes(...)`)

**Fix:** delete the dead/local copies; import everything from `rbac.ts`.

### 5.4 · Duplication (low, but one extractable cluster)
The editorial article-action routes (`pin`, `feature`, `commendation`, `review`, plus `admin/.../ban`)
repeat the *auth + param-parse + load-article + update* preamble. Extract a
`withEditorialArticleAction(roles, handler)` wrapper. ~6 routes collapse to a few lines each. Everything
else jscpd found is incidental (chart-config in analytics tabs) — leave it.

### 5.5 · NextAuth type augmentation is incomplete  ⟶ removes the remaining `as` casts
`src/types/next-auth.d.ts` augments `Session`/`User`/`JWT` — but the `JWT` interface is **missing
`roleCheckedAt`, `isActive`, `activeCheckedAt`** (and `Session.user` lacks `isActive`). That gap is why
`auth.ts:224-276` and `Navbar.tsx:146,331` fall back to `as unknown as { role: Role }` casts (the bulk of
the 1.6% untyped code). Complete the augmentation, then delete the casts — `session.user.role = token.role`
will typecheck directly.

### 5.6 · Dependency hygiene
- **Used but unlisted** in `package.json` (works only via transitive resolution — fragile): `pdfjs-dist`
  (`parse-pdf/route.ts`), `dotenv` (prisma scripts), `@prisma/config`. **Add them explicitly.**
- **Dead deps to remove:** `pdf-parse`, `@types/pdf-parse` (replaced by `pdfjs-dist`), `uploadthing`,
  `@uploadthing/react` (0 imports — removal also clears high-severity advisories), `@tiptap/extension-color`.
- **Verify-then-remove:** `@tiptap/extension-table-{cell,header,row}` show 0 imports, but TipTap usually
  needs all four table extensions registered together — confirm tables render before deleting.
- `pg` is flagged unused but is a **peer of `@prisma/adapter-pg`** — keep (suppressed in `knip.json`).

### 5.7 · Dead code (knip — verify each isn't dynamically imported, then delete)
- **Components (6):** `admin/ArticleActions.tsx`, `admin/EditorMetadataSidebar.tsx`,
  `editor/CommentMark.ts`, `editorial/UserManagement.tsx`, `ui/ArticleCharts.tsx`, `ui/EditorialBar.tsx`.
- **Exports (~10):** `auth.ts` (`ANALYTICS_ROLES`, `ARTICLE_ACCESS_ROLES`, `isEditorialUser`),
  `constants.ts` (`SITE_TAGLINE`, `LOGO_URL`, `ROUTES`, `CRON_ROUTES`),
  `content-filter.ts` (`highlightViolations` — also has a latent index-misalignment bug; it greps
  normalized text but slices original), `editorialSchedule.ts` (`EDITORIAL_TIME_ZONE`),
  `email.ts` (`unsubscribeUrl`).
- **Types (3):** `Category`, `TrophyTier`, `AchievementType`.

### 5.8 · Lower-severity craftsmanship notes
- **Silent query failures** — `editorial/analytics` wraps ~30 queries in `.catch(() => 0|[])` with no
  logging. The graceful degradation is deliberate (one failing widget shouldn't 500 the dashboard) but a
  silent dashboard-of-zeros is hard to diagnose. Log the swallowed errors.
- **Inline `// BUG-NN` comments** (e.g. `password-reset`, `upload`, `view`) reference a defunct tracker.
  Convert to plain "why" comments or link to commits/issues.
- **Rate-limit gap** — `comments` POST is rate-limited but the parallel `articles/[id]/comments` POST is
  not. Apply `checkRateLimit` consistently to both comment-creation paths.
- **Rate limiter is per-instance** (`lib/rate-limit.ts`, self-documented) — fine for current traffic; note
  it for when the site scales (a determined attacker hitting multiple Vercel instances bypasses it).
- **Email HTML interpolation** — `auth.ts:44-50` interpolates `lockedEmail`/`ip` into admin-notification
  HTML unescaped. Admin-only and low-risk, but escape for hygiene.
- **`export const dynamic = 'force-dynamic'`** appears on 15 routes inconsistently — audit which
  session/cookie-reading routes actually need it and apply uniformly.

---

## 6. House-style rubric (the canonical patterns — reference for all future code)

| Concern | Canonical pattern | Source |
|---|---|---|
| AuthZ (sensitive) | `const u = await getVerifiedSessionUser(ROLE_CONST); if (!u) return 401/403` | `lib/auth.ts` |
| Role constants | import from `lib/rbac.ts` — never redefine locally | `lib/rbac.ts` |
| Cron auth | `verifyCronAuth(req, 'label')` (constant-time) | `lib/cronAuth.ts` |
| DB client | `prisma` singleton (global `omit` on `User.password`) | `lib/prisma.ts` |
| Public author exposure | `select: PUBLIC_AUTHOR_SELECT` — never `author: true` | `lib/publicUser.ts` |
| Rate limiting | `checkRateLimit(\`scope:${getIp(req)}\`, n, ms)` on public/abuse-prone writes | `lib/rate-limit.ts` |
| HTML output | `escHtml()` + `safeHref()`; never interpolate raw user strings | `articles/[slug]/page.tsx` |
| JSON responses | **`NextResponse.json({ error }, { status })`** (standardize on this) | — |
| Input validation | parse `req.json()` in try/catch → 400; validate types/bounds explicitly | `user/streak/route.ts` |

---

## 7. Reproducible tooling (added this pass)

`package.json` now exposes:
```bash
npm run audit:dead    # knip — dead files/exports/deps
npm run audit:dup     # jscpd — duplication
npm run audit:types   # type-coverage --strict
npm run audit:all     # the above + lint + typecheck
```
Config lives in `knip.json` (suppresses the `schema.prisma` / `pg`-peer false positives) and
`.jscpd.json`. Re-run after any cleanup to confirm the dead-code list reaches zero.

---

## 8. Remediation plan (batched, each independently reviewable)

| # | Batch | Risk | Effort | Contents |
|---|---|---|---|---|
| **A** | Security | low | S | Fix search-XSS (P2-1); investigate `next` advisory (P2-2); rate-limit `articles/[id]/comments`; escape lockout email |
| **B** | Dead-code & deps | low | S–M | Delete 6 components / 10 exports / 3 types; add `pdfjs-dist`+`dotenv`+`@prisma/config`; remove `pdf-parse`/`uploadthing`/`extension-color`; re-run `audit:dead` to zero |
| **C** | AuthZ consistency | med | M | Move `editorial/analytics` (+ other sensitive raw-session routes) to `getVerifiedSessionUser`; consolidate role constants to `rbac.ts` |
| **D** | Type safety | low | S | Complete `next-auth.d.ts`; delete the `as unknown as` casts in `auth.ts`/`Navbar.tsx` |
| **E** | Response style | low | M | Standardize all 159 handlers on `NextResponse.json` |
| **F** | Refactor & polish | low | M | `withEditorialArticleAction` helper; log analytics catches; de-`BUG-NN` comments |
| **G** | Test coverage | med | L | Integration tests for the 86 route handlers (start with auth, articles, cron) |

**Recommended order:** A → B → D → C → E → F → G. A/B/D are low-risk and deliver most of the
"looks senior" payoff immediately. Each batch should land as its own commit, gated by
`npm run audit:all && npm test`.

---

## 9. Remediation completed — 2026-06-04

Batches **A–F** were executed and verified. Final gates:

| Gate | Result |
|---|---|
| `tsc --noEmit` | **PASS** (0 errors) |
| `eslint .` | **PASS** (0 problems) |
| `type-coverage --strict` | **98.4%+** |
| `knip` (dead code) | **0** unused files / exports / types / deps |
| `jscpd` (duplication) | **1.58%** |
| `vitest` | **228 passed** (Batch G added 23 route + security tests) |
| TODO / `BUG-NN` comments | **0 / 0** (was 1 / 25) |

Source footprint: **+226 / −1459 across 48 files** (net **−1,233 lines**) — 6 dead components and
7 dead dependencies removed, one shared util added (`lib/escapeHtml.ts`).

**Done**
- **Security (A):** P2-1 search-XSS fixed (escape-before-`<mark>` via shared `escapeHtml`);
  lockout-email interpolation escaped; editorial-comment routes moved off raw sessions.
- **Dead code & deps (B):** the §5.6–5.7 list driven to **zero**; deps made explicit/removed; `knip` clean.
- **Type safety (D):** `next-auth.d.ts` completed; ~12 `as unknown as` / `as { role }` casts deleted.
- **AuthZ consistency (C):** sensitive raw-session routes → `getVerifiedSessionUser`; all role
  literals consolidated into `rbac.ts` (the `ANALYTICS_ROLES` triplication and trash `TODO` resolved;
  validations use `isRole`).
- **Response style (E):** every handler standardized on `NextResponse.json`.
- **Polish (F):** 25 `BUG-NN` tracker comments de-referenced (explanations kept); 0 TODOs remain.

**Deliberately deferred — with rationale**
- **P2-2 `next` advisory** — needs a careful framework bump given the modified Next 16; tracked, not auto-applied.
- **`withEditorialArticleAction` helper** — the only shared code is the 4-line authz preamble; extracting
  it adds indirection with no integration-test safety net. jscpd is already healthy.
- **Analytics `.catch(() => …)` logging** — the silence is intentional per-widget schema-drift resilience.
- **Prisma `where: { role: { in: […] } }`** — idiomatic data filters, not authorization decisions; left inline.
- **Repo-wide Prettier** — 191/262 files predate `.prettierrc`; a mechanical reformat belongs in its own
  commit (`npm run format`) so it does not bury this audit. Recommended as a separate follow-up.
## 10. Batch G — route integration tests (2026-06-04)

Closed the biggest remaining gap. Added **in-process handler tests** that import the App Router
handlers directly and run them against mocked `prisma`/auth/email — **no live server or database**, so
they run on every `npm test` and in CI (unlike `tests/integration/api.test.ts`, which is a live-server
suite that no-ops when nothing is listening).

- `tests/integration/route-handlers.test.ts` — 18 tests across 6 routes:
  `editorial/setup` (bootstrap guard), `admin/users/[userId]/role` (privilege + self-edit + invalid-role
  + not-found guards, and a successful promotion), `editorial/analytics` (401-when-unauthorized — locks
  in the raw-session→`getVerifiedSessionUser` fix), `upload` (auth guard), `user/streak`
  (cadence type/range validation), and `cron/recalculate-streaks` (CRON_SECRET enforcement).
- `tests/unit/escape-html.test.ts` — 5 tests for the XSS-fix primitive (`&`-first ordering, payload
  neutralisation).
- Harness pattern (`vi.hoisted` + `vi.mock` for `@/lib/prisma` and `@/lib/auth`) is established for
  extending coverage to the rest of the 86 routes.

Also converted the straggler `user/streak` to `getVerifiedSessionUser`, so all five `user/*` routes now
share one auth pattern.

**Still open:** full coverage of all 86 routes (the pattern + highest-risk routes are done), and a live
smoke test against a real database (requires environment secrets not present in this worktree).

