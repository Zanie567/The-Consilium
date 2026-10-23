-- Public-access hardening 20261018002859: GUARDED APPLY. ONE transaction: preconditions, the migration file
-- verbatim, postconditions. Any failed check raises and rolls everything back. Run from the repository root:
--
--   psql -X -v ON_ERROR_STOP=1 -f docs/launch/production/apply.sql | tee apply.txt
--
-- then, only if this exited 0 and printed the "verified" notice, record the version (registry only):
--   supabase migration repair --status applied 20261018002859 --linked
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition: connected as %, expected postgres', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261018002859') THEN
    RAISE EXCEPTION 'precondition: 20261018002859 is already recorded';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND policyname IN ('anon_read_published_articles', 'anon_read_published_article_tags', 'anon_read_team_members')) <> 3 THEN
    RAISE EXCEPTION 'precondition: an expected public policy is missing; stop and investigate';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname NOT IN ('Allow authenticated uploads qt2lnz_0', 'Allow public reads qt2lnz_0')) THEN
    RAISE EXCEPTION 'precondition: storage.objects has policies this review did not see; stop and investigate';
  END IF;
  IF current_setting('supautils.policy_grants', true) NOT LIKE '%"storage.objects"%' THEN
    RAISE EXCEPTION 'precondition: postgres may not manage storage.objects policies here';
  END IF;
END
$$;

CREATE TEMP TABLE hardening_preflight ON COMMIT DROP AS
SELECT md5(
  (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
  (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
  (SELECT count(*)::text FROM storage.objects)) AS fingerprint,
  (SELECT count(*) FROM articles WHERE status = 'PUBLISHED' AND "deletedAt" IS NULL AND "hiddenByDebateAt" IS NULL) AS live_articles,
  (SELECT count(*) FROM categories) AS categories;

\i supabase/migrations/20261018002859_launch_public_access_hardening.sql

DO $$
DECLARE
  pre record;
  post text;
  anon_visible bigint;
BEGIN
  SELECT * INTO pre FROM hardening_preflight;
  SELECT md5(
    (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
    (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
    (SELECT count(*)::text FROM storage.objects)) INTO post;
  IF post IS DISTINCT FROM pre.fingerprint THEN
    RAISE EXCEPTION 'postcondition: content changed during the migration';
  END IF;

  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_published_articles')
     IS DISTINCT FROM '((status = ''PUBLISHED''::"ArticleStatus") AND ("deletedAt" IS NULL) AND ("hiddenByDebateAt" IS NULL))' THEN
    RAISE EXCEPTION 'postcondition: article policy not as reviewed';
  END IF;
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'postcondition: team policy not as reviewed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    RAISE EXCEPTION 'postcondition: storage.objects still has client policies';
  END IF;

  -- What the Data API will now return to anonymous visitors, evaluated as the anon role itself.
  -- Counts only: no row content is read. The live article count must be unchanged.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO anon_visible FROM public.articles;
  IF anon_visible <> pre.live_articles THEN
    RAISE EXCEPTION 'postcondition: anon sees % articles, expected the % live ones', anon_visible, pre.live_articles;
  END IF;
  IF (SELECT count(*) FROM public.team_members) <> 0 THEN
    RAISE EXCEPTION 'postcondition: anon can still read team cards';
  END IF;
  IF (SELECT count(*) FROM public.categories) <> pre.categories THEN
    RAISE EXCEPTION 'postcondition: anon no longer sees every category';
  END IF;
  RESET ROLE;

  RAISE NOTICE 'public-access hardening verified: % live article(s) visible to anon, content unchanged', anon_visible;
END
$$;

COMMIT;
