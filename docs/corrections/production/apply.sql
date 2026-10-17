-- Corrections migration 20261017120000: GUARDED APPLY. One transaction: preconditions, the migration file verbatim,
-- postconditions. Any failed check raises and rolls everything back. Run with psql from the repository root:
--
--   psql "$DB" -v ON_ERROR_STOP=1 -f docs/corrections/production/apply.sql
--
-- then record the version (registry only, executes nothing):  supabase migration repair --status applied 20261017120000
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.article_corrections') IS NOT NULL THEN
    RAISE EXCEPTION 'precondition: article_corrections already exists; stop and investigate';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261017120000') THEN
    RAISE EXCEPTION 'precondition: 20261017120000 is already recorded';
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'precondition: unexpected server version %', current_setting('server_version');
  END IF;
END
$$;

CREATE TEMP TABLE corrections_preflight ON COMMIT DROP AS
SELECT (SELECT count(*) FROM articles) AS articles,
       (SELECT count(*) FROM articles WHERE corrected) AS legacy,
       (SELECT md5(string_agg(id || md5(title || coalesce(excerpt, '') || content) || status || coalesce("publishedAt"::text, '') || corrected::text || coalesce("correctionNote", ''), ',' ORDER BY id)) FROM articles) AS fingerprint;

\i supabase/migrations/20261017120000_article_corrections.sql

DO $$
DECLARE
  pre record;
  post_fingerprint text;
BEGIN
  SELECT * INTO pre FROM corrections_preflight;
  SELECT md5(string_agg(id || md5(title || coalesce(excerpt, '') || content) || status || coalesce("publishedAt"::text, '') || corrected::text || coalesce("correctionNote", ''), ',' ORDER BY id))
    INTO post_fingerprint FROM articles;
  IF post_fingerprint IS DISTINCT FROM pre.fingerprint THEN
    RAISE EXCEPTION 'postcondition: articles changed during the migration';
  END IF;
  IF (SELECT count(*) FROM articles) <> pre.articles THEN
    RAISE EXCEPTION 'postcondition: article count changed';
  END IF;
  IF (SELECT count(*) FROM article_corrections) <> pre.legacy
     OR (SELECT count(*) FROM article_corrections WHERE legacy AND status = 'PUBLISHED' AND "publishedAt" IS NULL) <> pre.legacy THEN
    RAISE EXCEPTION 'postcondition: legacy backfill does not match (% legacy articles)', pre.legacy;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'article_corrections_protect' AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'postcondition: protection trigger missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.article_corrections'::regclass
      AND conname IN ('article_corrections_prepared_check', 'article_corrections_published_check', 'article_corrections_state_check',
                      'article_corrections_articleId_fkey', 'article_corrections_supersedesId_fkey', 'article_corrections_pkey')) <> 6 THEN
    RAISE EXCEPTION 'postcondition: constraints missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'article_corrections_one_pending_per_article') THEN
    RAISE EXCEPTION 'postcondition: pending index missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.article_corrections'::regclass) THEN
    RAISE EXCEPTION 'postcondition: RLS not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_table_privilege('anon', 'public.article_corrections', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition: anon can read article_corrections';
  END IF;
  RAISE NOTICE 'corrections migration verified: % legacy row(s) migrated, articles unchanged', pre.legacy;
END
$$;

COMMIT;
