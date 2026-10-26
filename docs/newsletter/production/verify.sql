-- Newsletter migration 20261026120000: VERIFY (read-only), after apply.sql and the registry repair, BEFORE merging.
-- Every row must show ok = t.
--   psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/verify.sql
BEGIN READ ONLY;

WITH t(name) AS (VALUES ('subscribers'), ('subscriber_tokens'), ('subscriber_consent_events'), ('newsletter_suppressions'),
                        ('newsletter_campaigns'), ('newsletter_webhook_events')),
checks(check_name, value, expect) AS (
  SELECT 'registry has 20261026120000',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261026120000')::text, 'true'
  UNION ALL SELECT '20261026120000 is the latest recorded version',
    ((SELECT max(version) FROM supabase_migrations.schema_migrations) = '20261026120000')::text, 'true'
  UNION ALL SELECT 'subscribers in a status other than LEGACY or PENDING',
    (SELECT count(*) FROM subscribers WHERE status::text NOT IN ('LEGACY', 'PENDING'))::text, '0'
  UNION ALL SELECT 'subscribers confirmed or opted in to alerts',
    (SELECT count(*) FROM subscribers WHERE "confirmedAt" IS NOT NULL OR "specialAlerts")::text, '0'
  UNION ALL SELECT 'LEGACY rows each have their consent record',
    ((SELECT count(*) FROM subscribers WHERE status = 'LEGACY')
     = (SELECT count(*) FROM subscriber_consent_events WHERE action = 'LEGACY_IMPORTED'))::text, 'true'
  UNION ALL SELECT 'campaigns / suppressions',
    (SELECT count(*) FROM newsletter_campaigns)::text || ' / ' || (SELECT count(*) FROM newsletter_suppressions)::text, '0 / 0'
  UNION ALL SELECT 'RLS on all six newsletter tables',
    (SELECT bool_and(c.relrowsecurity) FROM t JOIN pg_class c ON c.oid = to_regclass('public.' || t.name))::text, 'true'
  UNION ALL SELECT 'API-role privileges on the newsletter tables',
    (SELECT bool_or(has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
       FROM t JOIN pg_class c ON c.oid = to_regclass('public.' || t.name))::text, 'false'
  UNION ALL SELECT 'campaign protection trigger enabled',
    (SELECT count(*) FROM pg_trigger WHERE tgname = 'newsletter_campaigns_protect' AND tgenabled = 'O')::text, '1'
  UNION ALL SELECT '#156 public functions or sequences usable by anon/authenticated',
    ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     + (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                         OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END))::text, '0'
  UNION ALL SELECT 'newsletter pause switch row (absent = paused)',
    coalesce((SELECT value FROM site_settings WHERE key = 'newsletter.paused'), 'absent'), 'absent'
  UNION ALL SELECT 'newsletter-tick cron job (enabled only at rollout R5)', (SELECT count(*) FROM cron.job WHERE jobname = 'newsletter-tick')::text, '0'
  UNION ALL SELECT '#155 policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'false'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- Same as preflight.sql: must be identical.
SELECT 'subscribers fingerprint' AS check_name,
  md5(coalesce(string_agg(id || ':' || email || ':' || "subscribedAt"::text, ',' ORDER BY id), '')) AS value FROM subscribers;

COMMIT;
