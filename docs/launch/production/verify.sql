-- Public-access hardening 20261018002859: VERIFICATION (read-only). Run after apply.sql + registry repair,
-- and again after the code deploy. Every row must show ok = t.
--   psql -X -v ON_ERROR_STOP=1 -f docs/launch/production/verify.sql | tee verify.txt
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'registry has 20261018002859',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261018002859')::text, 'true'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '26'
  UNION ALL SELECT 'policy anon_read_published_articles',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_published_articles'),
    '((status = ''PUBLISHED''::"ArticleStatus") AND ("deletedAt" IS NULL) AND ("hiddenByDebateAt" IS NULL))'
  UNION ALL SELECT 'policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'false'
  UNION ALL SELECT 'storage.objects policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')::text, '0'
  UNION ALL SELECT 'users_display_titles_valid config / security definer',
    (SELECT coalesce(proconfig::text, 'none') || ' / ' || prosecdef FROM pg_proc WHERE oid = 'public.users_display_titles_valid(text[])'::regprocedure),
    '{search_path=pg_catalog} / false'
  UNION ALL SELECT 'public tables without RLS',
    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND NOT relrowsecurity)::text, '0'
  UNION ALL SELECT 'anon column grants (tables:columns)',
    (SELECT string_agg(relname || ':' || n, ',' ORDER BY relname) FROM (
       SELECT c.relname, count(*) n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x
        WHERE c.relnamespace = 'public'::regnamespace AND x.grantee = 'anon'::regrole GROUP BY 1) s),
    'article_tags:2,articles:19,categories:4,series:5,tags:4,team_members:7'
  UNION ALL SELECT 'guards enabled (corrections, hidden debate x2)',
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('article_corrections_protect','articles_hidden_debate_guard','articles_clear_hidden_by_debate') AND tgenabled = 'O')::text, '3'
  UNION ALL SELECT 'buckets (id:public)', (SELECT string_agg(id || ':' || public, ',' ORDER BY id) FROM storage.buckets), 'article-images:true,avatars:true'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- Same fingerprint as preflight.sql: must be identical to the value recorded before the migration.
SELECT 'content fingerprint' AS check_name, md5(
  (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
  (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
  (SELECT count(*)::text FROM storage.objects)) AS value;

COMMIT;
