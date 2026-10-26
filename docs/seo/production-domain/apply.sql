-- Publisher host 20261025120000: GUARDED APPLY. ONE transaction: preconditions, the migration file verbatim,
-- postconditions. Any failed check rolls everything back. Run from the repository root ONLY after
-- docs/seo/primary-domain-switch.md step 1 (the apex answers directly):
--   psql -X -v ON_ERROR_STOP=1 -f docs/seo/production-domain/apply.sql
-- then, only if it exited 0 and printed the "verified" notice (registry only):
--   supabase migration repair --status applied 20261025120000
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition: connected as %, expected postgres', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261024120000') THEN
    RAISE EXCEPTION 'precondition: apply #177''s schema (20261024120000) first';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025120000') THEN
    RAISE EXCEPTION 'precondition: 20261025120000 is already recorded';
  END IF;
  IF to_regprocedure('public.invoke_publish_scheduled()') IS NULL THEN
    RAISE EXCEPTION 'precondition: public.invoke_publish_scheduled() is missing';
  END IF;
END
$$;

CREATE TEMP TABLE publisher_preflight ON COMMIT DROP AS
SELECT pg_get_functiondef(p.oid) AS def, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig::text AS config,
       p.proacl::text AS acl,
       (SELECT md5(coalesce(string_agg(jobname || '=' || username || '/' || active || '/' || schedule || '/' || command, ',' ORDER BY jobname), ''))
          FROM cron.job) AS jobs
  FROM pg_proc p WHERE p.oid = 'public.invoke_publish_scheduled()'::regprocedure;

\i supabase/migrations/20261025120000_publish_cron_apex_host.sql

DO $$
DECLARE
  pre record;
  now_def text;
BEGIN
  SELECT * INTO pre FROM publisher_preflight;
  now_def := pg_get_functiondef('public.invoke_publish_scheduled()'::regprocedure);
  IF now_def IS DISTINCT FROM replace(pre.def, '''https://www.theconsilium.co.uk/api/publish-scheduled''',
                                               '''https://theconsilium.co.uk/api/publish-scheduled''') THEN
    RAISE EXCEPTION 'postcondition: the publisher changed in more than its URL';
  END IF;
  IF position('www.theconsilium.co.uk' IN now_def) > 0 THEN
    RAISE EXCEPTION 'postcondition: the publisher still names the www host';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) || '|' || prosecdef || '|' || coalesce(proconfig::text, '') || '|' || coalesce(proacl::text, '')
        FROM pg_proc WHERE oid = 'public.invoke_publish_scheduled()'::regprocedure)
     IS DISTINCT FROM (pre.owner || '|' || pre.prosecdef || '|' || coalesce(pre.config, '') || '|' || coalesce(pre.acl, '')) THEN
    RAISE EXCEPTION 'postcondition: the publisher''s owner, security setting, search_path or grants changed';
  END IF;
  IF (SELECT md5(coalesce(string_agg(jobname || '=' || username || '/' || active || '/' || schedule || '/' || command, ',' ORDER BY jobname), ''))
        FROM cron.job) IS DISTINCT FROM pre.jobs THEN
    RAISE EXCEPTION 'postcondition: a cron job changed';
  END IF;
  IF has_function_privilege('anon', 'public.invoke_publish_scheduled()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.invoke_publish_scheduled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: an API role can execute the publisher';
  END IF;
  RAISE NOTICE 'publisher host verified: invoke_publish_scheduled() now calls https://theconsilium.co.uk/api/publish-scheduled; nothing else changed';
END
$$;

COMMIT;
