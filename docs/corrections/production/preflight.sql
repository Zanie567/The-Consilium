-- Corrections migration 20261017120000: PREFLIGHT (read-only). Run first; every row must match "expect".
BEGIN READ ONLY;

SELECT 'server version' AS check, current_setting('server_version') AS value, '17.x' AS expect
UNION ALL SELECT 'article_corrections exists', (to_regclass('public.article_corrections') IS NOT NULL)::text, 'false'
UNION ALL SELECT 'CorrectionType exists', EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CorrectionType')::text, 'false'
UNION ALL SELECT 'CorrectionStatus exists', EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CorrectionStatus')::text, 'false'
UNION ALL SELECT 'registry has 20261017120000', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261017120000')::text, 'false'
UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '24 (as of 2026-10-17)'
UNION ALL SELECT 'articles total', (SELECT count(*) FROM articles)::text, 'informational'
UNION ALL SELECT 'legacy rows to migrate (corrected = true)', (SELECT count(*) FROM articles WHERE corrected)::text, '0 on 2026-10-17'
UNION ALL SELECT 'notes not marked corrected (not migrated)', (SELECT count(*) FROM articles WHERE NOT corrected AND nullif(btrim("correctionNote"), '') IS NOT NULL)::text, '0 on 2026-10-17'
UNION ALL SELECT 'anon role exists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')::text, 'true'
UNION ALL SELECT 'other sessions holding locks on articles', (SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'articles' AND l.pid <> pg_backend_pid() AND l.mode IN ('ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'))::text, '0';

-- Fingerprint of the articles' reader-facing data, to compare after the migration (must be identical).
SELECT 'articles fingerprint' AS check, md5(string_agg(id || ':' || md5(title || coalesce(excerpt, '') || content) || ':' || status || ':' || coalesce("publishedAt"::text, '') || ':' || corrected::text || ':' || coalesce("correctionNote", ''), ',' ORDER BY id)) AS value
FROM articles;

COMMIT;
