-- Newsletter migration 20261023120000: VERIFY (read-only), after apply.sql and the registry repair.
BEGIN READ ONLY;
SELECT 'registry has 20261023120000' AS check, EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023120000')::text AS value, 'true' AS expect
UNION ALL SELECT 'subscribers by status', (SELECT string_agg(status || '=' || n, ', ' ORDER BY status) FROM (SELECT status::text, count(*) n FROM subscribers GROUP BY 1) s), 'LEGACY=<preflight count> (plus any PENDING sign-ups since)'
UNION ALL SELECT 'any subscriber opted in to alerts', EXISTS (SELECT 1 FROM subscribers WHERE "specialAlerts")::text, 'false'
UNION ALL SELECT 'any ACTIVE subscriber', EXISTS (SELECT 1 FROM subscribers WHERE status = 'ACTIVE')::text, 'false (until someone confirms)'
UNION ALL SELECT 'campaigns', (SELECT count(*) FROM newsletter_campaigns)::text, '0'
UNION ALL SELECT 'RLS on all newsletter tables', (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('subscribers', 'subscriber_tokens', 'subscriber_consent_events', 'newsletter_suppressions', 'newsletter_campaigns', 'newsletter_webhook_events'))::text, 'true'
UNION ALL SELECT 'anon can read any newsletter table', CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN (SELECT bool_or(has_table_privilege('anon', c.oid, 'SELECT')) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('subscribers', 'subscriber_tokens', 'subscriber_consent_events', 'newsletter_suppressions', 'newsletter_campaigns', 'newsletter_webhook_events'))::text ELSE 'no anon role' END, 'false'
UNION ALL SELECT 'pause switch row', coalesce((SELECT value FROM site_settings WHERE key = 'newsletter.paused'), '(absent = paused)'), '(absent = paused)';
SELECT 'subscribers fingerprint' AS check, md5(coalesce(string_agg(id || ':' || email || ':' || "subscribedAt"::text, ',' ORDER BY id), '')) AS value FROM subscribers;
COMMIT;
