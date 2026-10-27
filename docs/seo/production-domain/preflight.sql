-- Publisher host 20261025120000: PREFLIGHT (read-only). Every row must show ok = t.
-- Run AFTER #177's schema step (20261024120000, registry 29) and AFTER docs/seo/primary-domain-switch.md step 1
-- (both hosts serve the site directly). From the repository root:
--   psql -X -v ON_ERROR_STOP=1 -f docs/seo/production-domain/preflight.sql
-- Expected values are production's state from read-only inspection on 2026-10-26. If any row is f, STOP.
BEGIN READ ONLY;

WITH fn AS (
  SELECT p.oid, pg_get_functiondef(p.oid) AS def, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.invoke_publish_scheduled()')
),
checks(check_name, value, expect) AS (
  SELECT 'connected as', current_user::text, 'postgres'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '29'
  UNION ALL SELECT 'latest registry version', (SELECT max(version) FROM supabase_migrations.schema_migrations), '20261024120000'
  UNION ALL SELECT 'registry has 20261025120000',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025120000')::text, 'false'
  UNION ALL SELECT 'publisher calls https://www.theconsilium.co.uk/api/publish-scheduled (times)',
    (SELECT ((length(def) - length(replace(def, '''https://www.theconsilium.co.uk/api/publish-scheduled''', '')))
             / length('''https://www.theconsilium.co.uk/api/publish-scheduled'''))::text FROM fn), '1'
  UNION ALL SELECT 'publisher calls https://theconsilium.co.uk/api/publish-scheduled (times)',
    (SELECT ((length(def) - length(replace(def, '''https://theconsilium.co.uk/api/publish-scheduled''', '')))
             / length('''https://theconsilium.co.uk/api/publish-scheduled'''))::text FROM fn), '0'
  UNION ALL SELECT 'hosts named in the publisher',
    (SELECT string_agg(DISTINCT m[1], ',') FROM fn, regexp_matches(fn.def, 'https?://([a-z0-9.-]+)', 'g') m), 'www.theconsilium.co.uk'
  UNION ALL SELECT 'publisher owner / security definer / config / grants',
    (SELECT owner || ' / ' || prosecdef || ' / ' || coalesce(proconfig::text, 'none') || ' / ' || coalesce(proacl::text, 'default') FROM fn),
    'postgres / true / {"search_path=\"\""} / {postgres=X/postgres}'
  UNION ALL SELECT 'publish-scheduled cron job (active / user / schedule / command)',
    (SELECT active || ' / ' || username || ' / ' || schedule || ' / ' || command FROM cron.job WHERE jobname = 'publish-scheduled'),
    'true / postgres / */5 * * * * / select public.invoke_publish_scheduled()'
  UNION ALL SELECT 'most recent completed publish run: status / outcome',
    (SELECT coalesce(status_code::text, 'null') || ' / ' || coalesce(outcome, 'null') FROM public.scheduler_invocations
      WHERE job = 'publish-scheduled' AND completed_at IS NOT NULL ORDER BY invoked_at DESC LIMIT 1), '200 / success'
  UNION ALL SELECT '#177 schema present (articles."slugLockedAt")',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'slugLockedAt')::text, 'true'
  UNION ALL SELECT '#156 public functions or sequences usable by anon/authenticated',
    ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     + (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                         OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END))::text, '0'
  UNION ALL SELECT '#155 policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'false'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- The definition apply.sql must produce: today's, with only the URL changed. verify.sql prints the live one's md5.
SELECT 'expected publisher fingerprint' AS check_name,
  md5(replace(pg_get_functiondef('public.invoke_publish_scheduled()'::regprocedure),
              '''https://www.theconsilium.co.uk/api/publish-scheduled''', '''https://theconsilium.co.uk/api/publish-scheduled''')) AS value;

COMMIT;
