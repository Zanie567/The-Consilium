-- =============================================================================
-- Migration: close the Data API (PostgREST) and Storage bypasses found before launch
-- Version:   20261018002859 (first proposed in draft PR #151; extended 2026-10-22)
-- =============================================================================
--
-- Apply separately, after owner approval, using docs/launch/POLICY-ROLLOUT.md. Merging the
-- code does NOT apply this file. Do not use a blanket `supabase db push`.
--
-- WHY: the website reads and writes through Prisma (role postgres, which bypasses RLS) and
-- uploads through the server's service-role key. These statements govern only the separate
-- Data API surface that anyone holding the public anon key can call directly. Read-only
-- inspection of production on 2026-10-22 found:
--
--   1. anon_read_published_articles checked status only. Soft deletion keeps the status, so
--      trashed articles (and any article carrying the hidden-by-debate marker) stayed
--      readable, including their full text.
--   2. anon_read_published_article_tags inherited the same gap.
--   3. anon_read_team_members was USING (true): inactive and hidden cards were readable.
--   4. "Allow authenticated uploads qt2lnz_0" (dashboard-created) let any Supabase Auth JWT
--      write any file type and size into article-images, skipping the app's role, size and
--      content checks. This app does not use Supabase Auth, so no legitimate client needs it.
--   5. "Allow public reads qt2lnz_0" (dashboard-created) let anyone LIST article-images,
--      which enumerates images uploaded for unpublished drafts. Public URLs keep working
--      without it: a public bucket serves /object/public/... without any policy.
--   6. public.users_display_titles_valid(text[]) had no pinned search_path (advisor 0011).
--
-- Every statement is repeatable. Nothing here reads, modifies or deletes article, team or
-- storage rows. Required privileges: run as postgres. On Supabase, postgres may manage
-- policies on storage.objects through supautils.policy_grants (verified on the project and
-- on supabase/postgres 17 locally).
--
-- Transaction: like 20261017120000, this file has no BEGIN/COMMIT of its own. On production it
-- runs inside docs/launch/production/apply.sql, which wraps preconditions, this file and
-- postconditions in ONE transaction. Run standalone only with `psql --single-transaction`.
-- =============================================================================


-- 6. Pure validation using built-ins only. Invoker rights and the CHECK constraint are unchanged.
ALTER FUNCTION public.users_display_titles_valid(text[]) SET search_path = pg_catalog;

-- 1. Same rule as the site (src/lib/articleQueries.ts PUBLISHED_ARTICLE_WHERE). Policy
--    expressions on the table itself need no column privileges, so the anon column allowlist
--    stays exactly as it is (deletedAt / hiddenByDebateAt remain unreadable).
ALTER POLICY anon_read_published_articles ON public.articles
  USING (status = 'PUBLISHED' AND "deletedAt" IS NULL AND "hiddenByDebateAt" IS NULL);

-- 2. Deliberately NOT repeating the deletedAt test here: the subquery runs as anon, so it is
--    filtered by the articles policy above (RLS applies inside policy subqueries), and naming
--    "deletedAt" would require a column grant anon must not have.
ALTER POLICY anon_read_published_article_tags ON public.article_tags
  USING (EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_tags."articleId" AND articles.status = 'PUBLISHED'
  ));

-- 3. Public roster visibility combines card state with linked-account moderation in users,
--    which the Data API cannot (and must not) read. The site serves the roster via Prisma.
ALTER POLICY anon_read_team_members ON public.team_members USING (false);

-- 4 and 5. Dashboard-created Storage policies. Uploads go through /api/upload (service role,
--    after NextAuth RBAC, size limits and content sniffing); deletes and cleanup use the
--    service role too. Neither path relies on these policies.
DROP POLICY IF EXISTS "Allow authenticated uploads qt2lnz_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads qt2lnz_0" ON storage.objects;

-- Self-check before commit: refuse to finish in a half-hardened state.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO bad
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (roles && ARRAY['anon','authenticated','public']::name[])
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL', 'SELECT')
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%article-images%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'article-images still has client-facing Storage policies: %', bad;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.users_display_titles_valid(text[])'::regprocedure
       AND proconfig @> ARRAY['search_path=pg_catalog'] AND NOT prosecdef
  ) THEN
    RAISE EXCEPTION 'users_display_titles_valid search_path was not pinned';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Rollback (reopens the exposures above; fix forward instead wherever possible)
-- -----------------------------------------------------------------------------
--   ALTER POLICY anon_read_published_articles ON public.articles USING (status = 'PUBLISHED');
--   ALTER POLICY anon_read_team_members ON public.team_members USING (true);
--   CREATE POLICY "Allow public reads qt2lnz_0" ON storage.objects
--     FOR SELECT TO public USING (bucket_id = 'article-images');
--   ALTER FUNCTION public.users_display_titles_valid(text[]) RESET search_path;
--   (The article_tags policy text is unchanged; the authenticated upload policy should not
--    be recreated.)
