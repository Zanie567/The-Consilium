-- Article addresses 20261024120000: GUARDED APPLY. ONE transaction: preconditions, the migration file verbatim,
-- postconditions. Any failed check raises and rolls everything back. Run from the repository root:
--
--   psql -X -v ON_ERROR_STOP=1 -f docs/seo/production/apply.sql
--
-- then, only if this exited 0 and printed the "verified" notice, record the version (registry only):
--   supabase migration repair --status applied 20261024120000
-- `articles` is locked against writes (reads continue) for the length of the transaction, so the before/after
-- comparison is exact: the deployed site's view counter and editors wait a moment rather than race the check.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition: connected as %, expected postgres', current_user;
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations
       WHERE version IN ('20261018002859', '20261022120000', '20261022120100')) <> 3 THEN
    RAISE EXCEPTION 'precondition: apply #155 (20261018002859) and #156 (20261022120000, 20261022120100) first';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261024120000') THEN
    RAISE EXCEPTION 'precondition: 20261024120000 is already recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'slugLockedAt')
     OR to_regclass('public.article_slug_redirects') IS NOT NULL THEN
    RAISE EXCEPTION 'precondition: the slug objects already exist (partly applied?); stop and investigate';
  END IF;
END
$$;

LOCK TABLE articles IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE slug_preflight ON COMMIT DROP AS
SELECT
  (SELECT md5(coalesce(string_agg((to_jsonb(a) - 'slugLockedAt')::text, ',' ORDER BY a.id), '')) FROM articles a) AS every_column,
  (SELECT count(*) FROM articles
    WHERE status = 'PUBLISHED' OR "publishedAt" IS NOT NULL OR "hiddenByDebateAt" IS NOT NULL OR "viewCount" > 0) AS to_lock,
  (SELECT count(*) FROM articles WHERE status = 'PUBLISHED' AND "deletedAt" IS NULL AND "hiddenByDebateAt" IS NULL) AS live,
  (SELECT md5(coalesce(string_agg(policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' ORDER BY schemaname, tablename, policyname), ''))
     FROM pg_policies) AS policies;

\i supabase/migrations/20261024120000_article_slug_redirects.sql

DO $$
DECLARE
  pre record;
  locked bigint;
  anon_visible bigint;
BEGIN
  SELECT * INTO pre FROM slug_preflight;

  IF (SELECT md5(coalesce(string_agg((to_jsonb(a) - 'slugLockedAt')::text, ',' ORDER BY a.id), '')) FROM articles a)
     IS DISTINCT FROM pre.every_column THEN
    RAISE EXCEPTION 'postcondition: an article column other than slugLockedAt changed (slug, status, dates, counters or content)';
  END IF;
  SELECT count(*) INTO locked FROM articles WHERE "slugLockedAt" IS NOT NULL;
  IF locked <> pre.to_lock THEN
    RAISE EXCEPTION 'postcondition: % article(s) locked, expected %', locked, pre.to_lock;
  END IF;
  IF EXISTS (SELECT 1 FROM articles WHERE status = 'PUBLISHED' AND "slugLockedAt" IS NULL) THEN
    RAISE EXCEPTION 'postcondition: a published article is not locked';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('articles_slug_guard', 'article_slug_redirects_guard') AND tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'postcondition: the two slug triggers are not both present and enabled';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.article_slug_redirects'::regclass)
     OR (SELECT count(*) FROM article_slug_redirects) <> 0 THEN
    RAISE EXCEPTION 'postcondition: article_slug_redirects must have RLS on and no rows';
  END IF;
  IF has_table_privilege('anon', 'public.article_slug_redirects', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.article_slug_redirects', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'postcondition: an API role holds a privilege on article_slug_redirects';
  END IF;
  -- #156's invariant: nothing in public is usable by the API roles (covers the two new trigger functions).
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
               AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                                OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END) THEN
    RAISE EXCEPTION 'postcondition: a public function or sequence is usable by anon/authenticated';
  END IF;
  -- #155's policies are untouched.
  IF (SELECT md5(coalesce(string_agg(policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' ORDER BY schemaname, tablename, policyname), ''))
        FROM pg_policies) IS DISTINCT FROM pre.policies THEN
    RAISE EXCEPTION 'postcondition: a row-level security policy changed';
  END IF;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO anon_visible FROM public.articles;
  RESET ROLE;
  IF anon_visible <> pre.live THEN
    RAISE EXCEPTION 'postcondition: anon sees % articles, expected the % live ones', anon_visible, pre.live;
  END IF;

  RAISE NOTICE 'article slug schema verified: % article(s) locked, % live visible to anon, content unchanged', locked, anon_visible;
END
$$;

COMMIT;
