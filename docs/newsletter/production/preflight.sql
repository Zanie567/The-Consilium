-- Newsletter migration 20261026120000: PREFLIGHT (read-only). Every row must show ok = t.
-- Run AFTER #155 and #156 (and, in the agreed order, after #177's schema step and #178's publisher step):
--   psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/preflight.sql   (session set-up: docs/corrections/PRODUCTION-RUNBOOK.md §0)
-- The schema does not depend on #177/#178; only the R5 cron activation needs #178 (newsletter_cron_enable.sql refuses
-- before it). Expected values are production's state from read-only inspection on 2026-10-26. If any row is f, STOP.
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'connected as', current_user::text, 'postgres'
  UNION ALL SELECT 'server version major', split_part(current_setting('server_version'), '.', 1), '17'
  UNION ALL SELECT '#155 and #156 recorded',
    (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261018002859', '20261022120000', '20261022120100'))::text, '3'
  UNION ALL SELECT 'every recorded version is older than 20261026120000 (applied in order)',
    ((SELECT max(version) FROM supabase_migrations.schema_migrations) < '20261026120000')::text, 'true'
  UNION ALL SELECT 'registry has 20261026120000',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261026120000')::text, 'false'
  UNION ALL SELECT 'subscribers.status exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscribers' AND column_name = 'status')::text, 'false'
  UNION ALL SELECT 'newsletter tables exist',
    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN
      ('subscriber_tokens', 'subscriber_consent_events', 'newsletter_suppressions', 'newsletter_campaigns', 'newsletter_webhook_events'))::text, '0'
  UNION ALL SELECT 'SubscriberStatus type exists', EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriberStatus')::text, 'false'
  UNION ALL SELECT 'newsletter functions exist',
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('protect_newsletter_campaign', 'invoke_newsletter_tick'))::text, '0'
  UNION ALL SELECT 'identity function and unique index exist',
    ((to_regprocedure('public.consilium_subscriber_identity(text)') IS NOT NULL)
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'subscribers_normalized_email_key'))::text, 'true'
  UNION ALL SELECT 'subscribers RLS on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscribers'::regclass)::text, 'true'
  UNION ALL SELECT 'API-role privileges on subscribers',
    (has_table_privilege('anon', 'public.subscribers', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.subscribers', 'SELECT,INSERT,UPDATE,DELETE'))::text, 'false'
  UNION ALL SELECT 'newsletter site_settings rows', (SELECT count(*) FROM site_settings WHERE key LIKE 'newsletter.%')::text, '0'
  UNION ALL SELECT 'newsletter-tick cron job', (SELECT count(*) FROM cron.job WHERE jobname = 'newsletter-tick')::text, '0'
  UNION ALL SELECT '#156 public functions or sequences usable by anon/authenticated',
    ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     + (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                         OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END))::text, '0'
  UNION ALL SELECT '#155 policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'false'
  UNION ALL SELECT 'other sessions holding strong locks on subscribers',
    (SELECT count(*) FROM pg_locks l WHERE l.relation = 'public.subscribers'::regclass AND l.pid <> pg_backend_pid()
       AND l.mode IN ('ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'))::text, '0'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- Informational (no expectation). Counts only.
SELECT 'registry rows (verify.sql expects one more)' AS info, (SELECT count(*) FROM supabase_migrations.schema_migrations)::text AS value
UNION ALL SELECT 'subscribers (all become LEGACY: never mailed until they confirm again)', (SELECT count(*) FROM subscribers)::text;

-- Fingerprint of the subscriber list (ids + addresses + dates): verify.sql must print the same value.
SELECT 'subscribers fingerprint' AS check_name,
  md5(coalesce(string_agg(id || ':' || email || ':' || "subscribedAt"::text, ',' ORDER BY id), '')) AS value FROM subscribers;

COMMIT;
