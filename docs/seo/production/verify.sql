-- Article addresses 20261024120000: VERIFICATION (read-only). Run after apply.sql + registry repair, before the
-- code is merged. Every row must show ok = t.
--   psql -X -v ON_ERROR_STOP=1 -f docs/seo/production/verify.sql
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'registry has 20261024120000',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261024120000')::text, 'true'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '29'
  UNION ALL SELECT 'articles."slugLockedAt" exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'slugLockedAt')::text, 'true'
  UNION ALL SELECT 'article_slug_redirects: RLS on',
    coalesce((SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass('public.article_slug_redirects')), 'missing'), 'true'
  UNION ALL SELECT 'slug triggers present and enabled',
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('articles_slug_guard', 'article_slug_redirects_guard') AND tgenabled = 'O')::text, '2'
  UNION ALL SELECT 'published articles without a locked address',
    (SELECT count(*) FROM articles WHERE status = 'PUBLISHED' AND "slugLockedAt" IS NULL)::text, '0'
  UNION ALL SELECT 'API-role privileges on article_slug_redirects',
    (has_table_privilege('anon', 'public.article_slug_redirects', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.article_slug_redirects', 'SELECT,INSERT,UPDATE,DELETE'))::text, 'false'
  UNION ALL SELECT 'API-role column grants on article_slug_redirects',
    (SELECT count(*) FROM pg_attribute a, aclexplode(a.attacl) x
      WHERE a.attrelid = to_regclass('public.article_slug_redirects') AND x.grantee IN ('anon'::regrole, 'authenticated'::regrole))::text, '0'
  UNION ALL SELECT '#156 public functions or sequences usable by anon/authenticated',
    ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     + (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                         OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END))::text, '0'
  UNION ALL SELECT '#155 policy anon_read_published_articles',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_published_articles'),
    '((status = ''PUBLISHED''::"ArticleStatus") AND ("deletedAt" IS NULL) AND ("hiddenByDebateAt" IS NULL))'
  UNION ALL SELECT '#155 policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'false'
  UNION ALL SELECT '#155 storage.objects client policies',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')::text, '0'
  UNION ALL SELECT 'anon column grants on articles (slugLockedAt not exposed)', (SELECT count(*) FROM pg_attribute a, aclexplode(a.attacl) x
      WHERE a.attrelid = 'public.articles'::regclass AND x.grantee = 'anon'::regrole)::text, '19'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- Same fingerprint as preflight.sql: must be identical to the value recorded before the migration.
SELECT 'content fingerprint' AS check_name,
  md5(coalesce(string_agg((to_jsonb(a) - 'viewCount' - 'engagementScore' - 'updatedAt' - 'slugLockedAt')::text, ',' ORDER BY a.id), '')) AS value
FROM articles a;

COMMIT;
