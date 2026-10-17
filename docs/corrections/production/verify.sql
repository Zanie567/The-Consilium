-- Corrections migration 20261017120000: VERIFICATION (read-only). Run after apply.sql and after the code deploy.
BEGIN READ ONLY;

SELECT 'table' AS check, (to_regclass('public.article_corrections') IS NOT NULL)::text AS value, 'true' AS expect
UNION ALL SELECT 'registry has 20261017120000', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261017120000')::text, 'true'
UNION ALL SELECT 'protection trigger enabled', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'article_corrections_protect' AND tgenabled <> 'D')::text, 'true'
UNION ALL SELECT 'RLS enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.article_corrections'::regclass)::text, 'true'
UNION ALL SELECT 'anon can select', has_table_privilege('anon', 'public.article_corrections', 'SELECT')::text, 'false'
UNION ALL SELECT 'authenticated can select', has_table_privilege('authenticated', 'public.article_corrections', 'SELECT')::text, 'false'
UNION ALL SELECT 'rows by status', coalesce((SELECT string_agg(status || '=' || n, ', ' ORDER BY status) FROM (SELECT status::text, count(*) n FROM article_corrections GROUP BY status) s), 'none'), 'none (before first use)'
UNION ALL SELECT 'legacy rows with an invented date', (SELECT count(*) FROM article_corrections WHERE legacy AND "publishedAt" IS NOT NULL)::text, '0'
UNION ALL SELECT 'published rows missing approver/snapshot', (SELECT count(*) FROM article_corrections WHERE status = 'PUBLISHED' AND NOT legacy AND ("approvedById" IS NULL OR previous IS NULL OR "publishedAt" IS NULL))::text, '0'
UNION ALL SELECT 'articles with more than one pending', (SELECT count(*) FROM (SELECT "articleId" FROM article_corrections WHERE status = 'PENDING' GROUP BY 1 HAVING count(*) > 1) x)::text, '0'
UNION ALL SELECT 'published corrections on non-public articles', (SELECT count(*) FROM article_corrections c JOIN articles a ON a.id = c."articleId" WHERE c.status = 'PUBLISHED' AND (a.status <> 'PUBLISHED' OR a."deletedAt" IS NOT NULL))::text, 'informational (unpublished later)';

-- Same fingerprint as preflight.sql: must be identical to the value taken before the migration.
SELECT 'articles fingerprint' AS check, md5(string_agg(id || ':' || md5(title || coalesce(excerpt, '') || content) || ':' || status || ':' || coalesce("publishedAt"::text, '') || ':' || corrected::text || ':' || coalesce("correctionNote", ''), ',' ORDER BY id)) AS value
FROM articles;

COMMIT;
