# Schema drift & `article_comments` deployment plan (read-only — nothing applied)

Investigated directly against the live Supabase project (`scllbuwkcqtmfogsgalt`,
`Zanie567's Project`, the one `.env.local`'s `DATABASE_URL`/`DIRECT_URL` point at) via
read-only `SELECT`s. No DDL was run.

## 1. What's actually live vs. what's declared

**Indexes on `public.articles`** — queried with `pg_indexes`:

| Declared in `prisma/schema.prisma:211-215` | Present in production? |
|---|---|
| `articles_pkey` (id) | ✅ yes |
| `articles_slug_key` (slug, unique) | ✅ yes |
| `@@index([authorId])` | ❌ **missing** |
| `@@index([categoryId])` | ❌ **missing** |
| `@@index([status, deletedAt])` | ❌ **missing** |
| `@@index([publishedAt])` | ❌ **missing** |
| `@@index([scheduledAt])` | ❌ **missing** |

This is worse than "a few missing indexes" — **every non-unique index the schema
declares on `articles` is absent**. `[status, deletedAt]` backs the exact
`publishedArticleWhere()` filter (`src/lib/articleQueries.ts`) that every public page,
the homepage, category pages, and the feed run on every request; `scheduledAt` backs
the publish-cron's lookup. Today these run as sequential scans. Not urgent at current
row counts, but it will degrade silently as the table grows, not fail loudly.

**`public.article_comments`**: `to_regclass('public.article_comments')` → `NULL`.
**Confirmed absent.** The inline review-commenting API routes and the Prisma
`ArticleComment` model (`prisma/schema.prisma:219-244`) depend on a table that does not
exist in production. Any request to those routes 500s with a Postgres
"relation does not exist" error today.

**Why tracking can't be trusted here**: `list_migrations` (Supabase's own tracked
migration history) shows **exactly one** entry —
`20260610222208_add_comments_hiddenbody_and_debate_votes_anoniphash` — and the
`_prisma_migrations` table doesn't exist at all. Yet RLS *is* demonstrably enabled on
`articles` in production (`relrowsecurity = true`), which can only have come from
`supabase/migrations/20260408_enable_rls.sql` — a migration that was clearly applied
but never registered in either tracking table. **Conclusion: changes have
historically been pasted directly into the Supabase SQL editor, bypassing both
Prisma's and Supabase's migration ledgers.** Neither ledger is a reliable source of
truth for "what's actually live" in this project — only direct introspection is.

## 2. Why `article_comments` specifically was never applied

`supabase/migrations/add_article_comments.sql` and
`add_article_comments_quoted_text.sql` are the only two files in
`supabase/migrations/` that **don't** follow the `<timestamp>_<name>.sql` convention
every other file in that directory (and everything in `supabase/manual/`) uses. The
file's own header says *"ACTION REQUIRED: Run this SQL in the Supabase SQL editor
BEFORE deploying... It is NOT managed by Prisma migrate — execute it manually."* —
i.e. it was written as a manual step, placed in the wrong directory (not
`supabase/manual/`, which is where this repo's other hand-applied migrations live),
and nobody ran it. It fell through a process gap, not a technical one.

## 3. Reconciliation plan (proposed — not executed)

### `article_comments` (higher priority — currently causing live 500s)
1. Move `add_article_comments.sql` + `add_article_comments_quoted_text.sql` into
   `supabase/manual/` with a proper `<timestamp>_` prefix, consolidating them into one
   file (the second is a strict superset — `quoted_text` can just be a column in the
   `CREATE TABLE` of the first) so there's one canonical script.
2. Run the consolidated script once via the Supabase SQL editor against production,
   during a low-traffic window — it's pure `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX
   IF NOT EXISTS`, additive and non-locking on unrelated tables, so no downtime is
   expected, but it should still be a deliberate, watched step given the ledger gap
   above means there's no automated rollback trail.
3. Immediately after, re-run `to_regclass('public.article_comments')` and the two
   `idx_article_comments_*` index checks to confirm, rather than trusting either
   migration ledger.
4. Only then re-enable/verify the review-commenting UI paths that depend on it.

### Missing `articles` indexes (lower priority — correctness is fine, this is a latent performance risk)
1. Confirm current `articles` row count and query latency on the public list/feed
   routes first (`EXPLAIN ANALYZE` on the `publishedArticleWhere()` query) to have a
   before/after baseline — the audit's conviction that this is "urgent" should be
   tested, not assumed.
2. Add the five indexes with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (not inside a
   transaction, not via a blocking `CREATE INDEX`) so table writes aren't locked out
   during creation — Prisma's generated migration for `@@index` does **not** use
   `CONCURRENTLY` by default, so this should be hand-written SQL run directly, not
   `prisma migrate deploy`.
3. Land it as a properly timestamped file in `supabase/migrations/` (fixing the
   pattern that caused the `article_comments` gap) and verify with `pg_indexes`
   afterward, again not trusting the ledger.
4. Given `_prisma_migrations` doesn't exist and `prisma migrate deploy` has apparently
   never been run against this database, do **not** introduce it now as a new
   deployment step without first deciding whether to baseline it
   (`prisma migrate resolve --applied`) against everything already live — running
   `migrate deploy` cold against a database with an untracked history is the likeliest
   way to turn this drift into an actual incident.

Nothing above has been executed. I did not run any `CREATE`/`ALTER`/migration
command — only `SELECT`s against `pg_indexes`, `pg_class`, `pg_enum`, and
`to_regclass`.
