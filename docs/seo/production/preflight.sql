-- Article addresses 20261024120000: PREFLIGHT (read-only). Every row must show ok = t.
-- Run from the repository root AFTER #155 (20261018002859) and #156 (20261022120000/20261022120100):
--   psql -X -v ON_ERROR_STOP=1 -f docs/seo/production/preflight.sql
-- Expected values are production's state from read-only inspection on 2026-10-26 (registry 28). If any row is f,
-- STOP: something changed since review. Do not edit an expectation to make it pass.
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'connected as', current_user::text, 'postgres'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '28'
  UNION ALL SELECT 'latest registry version', (SELECT max(version) FROM supabase_migrations.schema_migrations), '20261022120100'
  UNION ALL SELECT 'registry has 20261024120000',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261024120000')::text, 'false'
  UNION ALL SELECT 'articles."slugLockedAt" exists',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'slugLockedAt')::text, 'false'
  UNION ALL SELECT 'article_slug_redirects exists', (to_regclass('public.article_slug_redirects') IS NOT NULL)::text, 'false'
  UNION ALL SELECT 'slug guard functions and triggers',
    ((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('guard_article_slug', 'protect_article_slug_redirect'))
     + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('articles_slug_guard', 'article_slug_redirects_guard')))::text, '0'
  UNION ALL SELECT '#155 policy anon_read_published_articles',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_published_articles'),
    '((status = ''PUBLISHED''::"ArticleStatus") AND ("deletedAt" IS NULL) AND ("hiddenByDebateAt" IS NULL))'
  UNION ALL SELECT '#155 policy anon_read_team_members',
    (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_read_team_members'), 'false'
  UNION ALL SELECT '#155 storage.objects client policies',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')::text, '0'
  UNION ALL SELECT '#156 public functions or sequences usable by anon/authenticated',
    ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     + (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                         OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END))::text, '0'
  UNION ALL SELECT '#156 postgres defaults granting API roles',
    (SELECT count(*) FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole
      AND (defaclnamespace = 'public'::regnamespace OR defaclnamespace = 0) AND defaclacl::text ~ '(^|[{,])(anon|authenticated)=')::text, '0'
  UNION ALL SELECT 'anon column grants on articles', (SELECT count(*) FROM pg_attribute a, aclexplode(a.attacl) x
      WHERE a.attrelid = 'public.articles'::regclass AND x.grantee = 'anon'::regrole)::text, '19'
  UNION ALL SELECT 'duplicate non-empty slugs',
    (SELECT count(*) FROM (SELECT slug FROM articles WHERE slug <> '' GROUP BY slug HAVING count(*) > 1) d)::text, '0'
  UNION ALL SELECT 'approved new addresses already taken',
    (SELECT count(*) FROM articles WHERE slug IN ('will-si-stocks-make-you-rich-in-2026', 'tulip-mania-lessons-from-the-17th-century'))::text, '0'
  UNION ALL SELECT 'other sessions holding strong locks on articles',
    (SELECT count(*) FROM pg_locks l WHERE l.relation = 'public.articles'::regclass AND l.pid <> pg_backend_pid()
       AND l.mode IN ('ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'))::text, '0'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

-- Informational (no expectation). Counts only; no content is read.
SELECT 'published articles' AS info, (SELECT count(*) FROM articles WHERE status = 'PUBLISHED')::text AS value
UNION ALL SELECT 'articles the backfill will lock (published, ever published, hidden by a debate, or viewed)',
  (SELECT count(*) FROM articles WHERE status = 'PUBLISHED' OR "publishedAt" IS NOT NULL OR "hiddenByDebateAt" IS NOT NULL OR "viewCount" > 0)::text
UNION ALL SELECT 'drafts with an empty slug (repaired by the new code on next save)', (SELECT count(*) FROM articles WHERE slug = '')::text
UNION ALL SELECT 'unpublished articles on a draft- placeholder (renamed by the new code at submit/schedule/publish)',
  (SELECT count(*) FROM articles WHERE slug ~ '^draft-[0-9]+$' AND status <> 'PUBLISHED' AND "deletedAt" IS NULL)::text
UNION ALL SELECT 'published articles on a draft- placeholder (the approved slug migration)',
  (SELECT count(*) FROM articles WHERE slug ~ '^draft-[0-9]+$' AND status = 'PUBLISHED')::text;

-- Fingerprint of article identity and content (not counters that live traffic moves); compare with verify.sql.
SELECT 'content fingerprint' AS check_name,
  md5(coalesce(string_agg((to_jsonb(a) - 'viewCount' - 'engagementScore' - 'updatedAt' - 'slugLockedAt')::text, ',' ORDER BY a.id), '')) AS value
FROM articles a;

COMMIT;
