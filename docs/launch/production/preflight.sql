-- Public-access hardening 20261018002859: PREFLIGHT (read-only). Every row must show ok = t.
-- Run from the repository root:  psql -X -v ON_ERROR_STOP=1 -f docs/launch/production/preflight.sql
-- Expected values are production's state from read-only inspection on 2026-10-22. If any row is f, STOP:
-- something changed since this was reviewed. Do not edit the expectation to make it pass.
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'connected as', current_user::text, 'postgres'
  UNION ALL SELECT 'server version major', split_part(current_setting('server_version'), '.', 1), '17'
  UNION ALL SELECT 'registry has 20261018002859',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261018002859')::text, 'false'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '25'
  UNION ALL SELECT 'latest registry version', (SELECT max(version) FROM supabase_migrations.schema_migrations), '20261017120000'
  UNION ALL SELECT 'public tables without RLS',
    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND NOT relrowsecurity)::text, '0'
  UNION ALL SELECT 'anon/authenticated table-level privileges on public tables',
    (SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m')
        AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole))::text, '0'
  UNION ALL SELECT 'anon column grants (tables:columns)',
    (SELECT string_agg(relname || ':' || n, ',' ORDER BY relname) FROM (
       SELECT c.relname, count(*) n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x
        WHERE c.relnamespace = 'public'::regnamespace AND x.grantee = 'anon'::regrole GROUP BY 1) s),
    'article_tags:2,articles:19,categories:4,series:5,tags:4,team_members:7'
  UNION ALL SELECT 'authenticated column grants',
    (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x
      WHERE c.relnamespace = 'public'::regnamespace AND x.grantee = 'authenticated'::regrole)::text, '0'
  UNION ALL SELECT 'policy anon_read_published_articles',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_published_articles'),
    '(status = ''PUBLISHED''::"ArticleStatus")'
  UNION ALL SELECT 'policy anon_read_published_article_tags',
    (SELECT regexp_replace(qual, '\s+', ' ', 'g') FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_published_article_tags'),
    '(EXISTS ( SELECT 1 FROM articles WHERE ((articles.id = article_tags."articleId") AND (articles.status = ''PUBLISHED''::"ArticleStatus"))))'
  UNION ALL SELECT 'policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'true'
  UNION ALL SELECT 'storage.objects policies',
    (SELECT string_agg(policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), ' ; ' ORDER BY policyname)
       FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'),
    'Allow authenticated uploads qt2lnz_0|INSERT|{authenticated}||(bucket_id = ''article-images''::text) ; Allow public reads qt2lnz_0|SELECT|{public}|(bucket_id = ''article-images''::text)|'
  UNION ALL SELECT 'buckets (id:public)',
    (SELECT string_agg(id || ':' || public, ',' ORDER BY id) FROM storage.buckets), 'article-images:true,avatars:true'
  UNION ALL SELECT 'postgres may manage storage.objects policies (supautils)',
    (current_setting('supautils.policy_grants', true) LIKE '%"storage.objects"%')::text, 'true'
  UNION ALL SELECT 'users_display_titles_valid config / security definer',
    (SELECT coalesce(proconfig::text, 'none') || ' / ' || prosecdef FROM pg_proc WHERE oid = 'public.users_display_titles_valid(text[])'::regprocedure),
    'none / false'
  UNION ALL SELECT 'guards enabled (corrections, hidden debate x2)',
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('article_corrections_protect','articles_hidden_debate_guard','articles_clear_hidden_by_debate') AND tgenabled = 'O')::text, '3'
  UNION ALL SELECT 'other sessions holding strong locks on articles/team_members/storage.objects',
    (SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE c.oid IN ('public.articles'::regclass, 'public.team_members'::regclass, 'storage.objects'::regclass)
        AND l.pid <> pg_backend_pid() AND l.mode IN ('ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))::text, '0'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- Informational (no expectation): context for the operator's record. Counts only; no content is read.
SELECT 'Supabase Auth accounts' AS info, (SELECT count(*) FROM auth.users)::text AS value
UNION ALL SELECT 'article-images objects owned by a Supabase Auth user',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'article-images' AND owner IS NOT NULL)::text
UNION ALL SELECT 'published articles that are trashed or hidden-by-debate (currently exposed via the Data API)',
  (SELECT count(*) FROM articles WHERE status = 'PUBLISHED' AND ("deletedAt" IS NOT NULL OR "hiddenByDebateAt" IS NOT NULL))::text
UNION ALL SELECT 'inactive team cards (currently exposed via the Data API)',
  (SELECT count(*) FROM team_members WHERE NOT "isActive")::text;

-- Fingerprint of content the migration must not change; compare with verify.sql.
SELECT 'content fingerprint' AS check_name, md5(
  (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
  (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
  (SELECT count(*)::text FROM storage.objects)) AS value;

COMMIT;
