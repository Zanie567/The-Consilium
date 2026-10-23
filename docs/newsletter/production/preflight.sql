-- Newsletter migration 20261023120000: PREFLIGHT (read-only). Run first; every row must match "expect".
--   psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/preflight.sql   (session set-up: docs/corrections/PRODUCTION-RUNBOOK.md §0)
BEGIN READ ONLY;

SELECT 'server version' AS check, current_setting('server_version') AS value, '17.x' AS expect
UNION ALL SELECT 'subscribers.status exists', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscribers' AND column_name = 'status')::text, 'false'
UNION ALL SELECT 'newsletter_campaigns exists', (to_regclass('public.newsletter_campaigns') IS NOT NULL)::text, 'false'
UNION ALL SELECT 'SubscriberStatus type exists', EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriberStatus')::text, 'false'
UNION ALL SELECT 'identity function exists', (to_regprocedure('public.consilium_subscriber_identity(text)') IS NOT NULL)::text, 'true'
UNION ALL SELECT 'identity unique index exists', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'subscribers_normalized_email_key')::text, 'true'
UNION ALL SELECT 'registry has 20261023120000', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023120000')::text, 'false'
UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, 'informational (25 on 2026-10-20, more if #155/#156 applied)'
UNION ALL SELECT 'subscribers (become LEGACY)', (SELECT count(*) FROM subscribers)::text, '3 on 2026-10-09; informational'
UNION ALL SELECT 'subscribers RLS on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscribers'::regclass)::text, 'true'
UNION ALL SELECT 'anon can read subscribers', CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_table_privilege('anon', 'public.subscribers', 'SELECT')::text ELSE 'no anon role' END, 'false'
UNION ALL SELECT 'newsletter site_settings rows', (SELECT count(*) FROM site_settings WHERE key LIKE 'newsletter.%')::text, '0'
UNION ALL SELECT 'other sessions holding locks on subscribers', (SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'subscribers' AND l.pid <> pg_backend_pid() AND l.mode IN ('ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'))::text, '0';

-- Fingerprint of the subscriber list (ids + addresses), to compare after the migration (must be identical).
SELECT 'subscribers fingerprint' AS check, md5(coalesce(string_agg(id || ':' || email || ':' || "subscribedAt"::text, ',' ORDER BY id), '')) AS value FROM subscribers;

COMMIT;
