# Article web addresses: permanent URLs, redirects and the 2026-10-24 migration

Owner-run runbook. **Nothing here has been applied to production.** Every production step needs the
owner's explicit go-ahead, in this order.

## What changed and why

Production, read-only, 2026-10-24:

| Article (published 23 Oct, 08:00 UTC) | Current address | Proposed |
|---|---|---|
| Will SI stocks make you rich in 2026? (`cmuvcf4eb000204jp254gpqci`) | `/articles/draft-1791210392433` | `/articles/will-si-stocks-make-you-rich-in-2026` |
| Tulip Mania: Lessons from the 17th century (`cms3hol1f000004l1n2twq7jn`) | `/articles/draft-1785172614450` | `/articles/tulip-mania-lessons-from-the-17th-century` |
| The Unintended Consequences of Sanctions (`cmvftuhn4000208l352xiwcxf`) | `/articles/sanctions-sundaresan` | **keep** (owner decision 2026-10-25: readable; no redirect) |
| When Development Goals Collide - Who Decides What Counts as Progress? (`cmvfrlpha000408js4zi8hla4`) | `/articles/when-development-goals-collide-who-decides-what-counts-as-progress` | keep (already built from its title) |

The reviewed mapping is `docs/seo/article-slug-migration-2026-10-24.json`: the two `draft-` addresses only. Headlines and
content are not changed. "SI" (Super Intelligence) is intentional and stays in the address.
Checked on production: no article text, setting or notification links to an old address; no proposed address
is taken; no correction is pending; analytics, comments and corrections are keyed by article id, so they move
with the article.

Root cause: the editor sent its first autosave before (or while) the headline was typed. With no title the
server stored `draft-<timestamp>`; with a half-typed one the client sent a slug cut from it. Nothing replaced it
later, so it went live. A second defect surfaced at the same time: the next autosave sent `slug: ""`, so draft
`cmvmw11x3000007k3hnqow71p` ("Gulf Oil Is Back…") has an EMPTY slug in production right now, and a second
article doing the same would fail to save (unique slug). The new code repairs that draft on its next save.

### New rules (src/lib/articleSlug.ts)

1. A new article keeps an internal placeholder `draft-<digits>` while it is a draft. Title edits never change it.
2. The first time it is **submitted for review, scheduled or published** (editor, review approve/schedule, the
   scheduled publisher, direct creation as published), a placeholder is replaced by an address built from the
   current title: lowercase, hyphenated, ASCII, at most 80 characters cut at a word, `-2`, `-3`… on collision.
3. Editors and administrators can type an address in the editor (Settings → URL Slug) until publication. It is
   normalised and validated, and refused if any article (including trashed ones) or any retired address has it.
   Writers' clients no longer send one, and the server ignores one if sent.
4. First publication sets `articles."slugLockedAt"`. From then on the address cannot change, even after
   unpublishing. The trigger `articles_slug_guard` enforces this for any code or SQL. The only exception is the
   approved migration below.
5. A retired address answers **301** from `src/proxy.ts`, keeping the query string. Each server instance caches the
   redirect table for up to 60 s; during that window the article page itself redirects (Next sends a 308 there).
   Redirect rows are permanent: no update, and no delete except together with the article (permanent deletion).
6. Canonical, `og:url`, JSON-LD, share links, RSS and the sitemap all read `articles.slug`, so they show the new
   address as soon as it changes, and never an old one.

## Deployment order

1. **Back up**, as for every production change (docs/remediation/backup-and-verify.md).
   **Then finish the security rollouts first:** #155 (`docs/launch/POLICY-ROLLOUT.md`, registry 25 → 26), then #156
   (`docs/security/DATA-API-PERMISSIONS.md`, 26 → 28). Their preflights expect exactly those registry counts, so
   applying this migration before them would make their preflights stop. This migration does not depend on them, and
   they do not touch `slug`, `status` or `slugLockedAt`. (Re-checked read-only on 2026-10-25: every #155 preflight check
   and every #156 check not waiting on #155 still matched.) Until this PR is deployed, don't approve the pending-review
   article that still has a `draft-` address: approved under the old code, it would go live at that placeholder.
2. **Apply the schema migration** (additive; the deployed code ignores it):
   `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261024120000_article_slug_redirects.sql`
   then record it: `supabase migration repair --status applied 20261024120000 --linked`.
   Verify:
   ```sql
   SELECT slug, status, "slugLockedAt" FROM articles WHERE "slugLockedAt" IS NOT NULL;  -- expect the 4 published + 5 trashed, viewed drafts
   SELECT tgname FROM pg_trigger WHERE tgname IN ('articles_slug_guard','article_slug_redirects_guard');  -- 2 rows
   ```
   The migration must be in place BEFORE the code deploys: the new code reads `slugLockedAt` and the redirect table
   (Admin → deployment health reports either one missing).
3. **Merge and deploy the PR.** Smoke test, **read-only** (no test articles, submissions or notifications on
   production; the write paths are covered by CI and the local rehearsal): the four article pages answer 200 at
   their current addresses, `sitemap.xml` and `feed.xml` load, Admin → deployment health shows no missing column,
   table or trigger, and the editorial dashboard lists articles (leave drafts alone: any editor save is a production write).
4. **Dry run the address migration** (read-only):
   ```sh
   DIRECT_URL='<production direct URL>' npm run slugs:migrate -- --plan docs/seo/article-slug-migration-2026-10-24.json
   ```
   It prints the database host, every check, and an approval code tied to this plan AND the current state of both
   articles. Any edit to either article after the dry run invalidates the code.
5. **Apply** (owner approval required), with the code from step 4 and an administrator's email:
   ```sh
   DIRECT_URL='<production direct URL>' npm run slugs:migrate -- --plan docs/seo/article-slug-migration-2026-10-24.json \
     --apply --approve <code> --admin <administrator email>
   ```
   One transaction. It changes only `slug` (not id, title, content, author, dates, `updatedAt`, counters, comments,
   corrections or any relation), writes one redirect row and one `article.slug_migrated` audit entry per article,
   and is all or nothing.
6. **Verify**:
   ```sh
   curl -sI https://www.theconsilium.co.uk/articles/draft-1791210392433 | grep -iE '^(HTTP|location)'   # 301 -> new
   curl -sI https://www.theconsilium.co.uk/articles/will-si-stocks-make-you-rich-in-2026 | head -1       # 200
   curl -s  https://www.theconsilium.co.uk/articles/will-si-stocks-make-you-rich-in-2026 | grep -o '<link rel="canonical"[^>]*>'
   curl -s  https://www.theconsilium.co.uk/sitemap.xml | grep -c 'articles/draft-'                       # 0 (within 5 min)
   ```
   Then in Search Console, use URL Inspection on the two new addresses and request indexing. Do not remove or
   resubmit the sitemap. It is the same file and now lists the new addresses. Google follows the 301s and moves
   the old entries over in its own time.

## Rehearsed (local, 2026-10-24)

On a database built from `main`'s schema plus production-shaped rows (the 4 articles, the pending draft, the
empty-slug draft, a trashed viewed draft): migration applied twice (repeatable, backfill as above, `updatedAt`
untouched); CLI dry run OK; apply refused for a writer; applied by an administrator; `next dev` against it answered
`/articles/draft-1791210392433` with **301** to the new address (query string kept), new address 200, unknown 404,
canonical/og:url/JSON-LD/sitemap/RSS all on the new addresses; revert script restored both old addresses; plan
re-applied cleanly.

## Rollback

* **Code only** (migration and redirects stay): redeploy the previous production build. The old build ignores the new
  column and table, so readers on the new addresses keep working, but old addresses would 404 because the old proxy
  has no redirect. Use the next step if that lasts more than a few minutes.
* **Undo the address migration** (soon after applying, owner-run):
  `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -v migration_id='2026-10-24-launch-articles' -f supabase/manual/20261024120000_article_slug_migration_revert.sql`.
  It restores both old addresses and removes that migration's redirects in one transaction, with an audit entry.
  Browsers and Google cache a 301 permanently, so anyone who already followed it would then land on a 404 at the new
  address. That is why reverting gets worse the longer you wait.
* **Remove the schema** (only after the code is rolled back and the migration is reverted):
  `supabase/manual/20261024120000_article_slug_redirects_rollback.sql`.

## Canonical host

Decided 2026-10-25: `https://theconsilium.co.uk` (apex) becomes the primary domain, with `www` → apex **308**. Every
canonical tag, `og:url`, JSON-LD, sitemap entry, RSS link and share link in this PR already uses the apex. The switch
itself (findings on `NEXTAUTH_URL`, Google OAuth, cookies, Supabase Cron and the GitHub cron workflows, plus the
no-outage order) is a separate draft PR: `chore/apex-primary-domain`, runbook `docs/seo/primary-domain-switch.md`.
It is independent of this migration; either can go first.
