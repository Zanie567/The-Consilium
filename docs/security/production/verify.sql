-- Data API privileges 20261022120000 + 20261022120100: VERIFICATION (read-only). Every row ok = t.
--   psql -X -v ON_ERROR_STOP=1 -f docs/security/production/verify.sql | tee verify-privileges.txt
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'registry has 20261022120000 and 20261022120100',
    ((SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261022120000', '20261022120100')) = 2)::text, 'true'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '28'
  UNION ALL SELECT 'public functions executable by anon or authenticated',
    (SELECT coalesce(string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text), 'none') FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 'none'
  UNION ALL SELECT 'public sequences usable by anon or authenticated',
    (SELECT coalesce(string_agg(relname, ',' ORDER BY relname), 'none') FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'S'
        AND CASE WHEN relkind = 'S' THEN has_sequence_privilege('anon', oid, 'USAGE,SELECT,UPDATE')
                                      OR has_sequence_privilege('authenticated', oid, 'USAGE,SELECT,UPDATE') END), 'none'
  UNION ALL SELECT 'postgres defaults granting API roles',
    (SELECT count(*) FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole
      AND (defaclnamespace = 'public'::regnamespace OR defaclnamespace = 0) AND defaclacl::text ~ '(^|[{,])(anon|authenticated)=')::text, '0'
  UNION ALL SELECT 'postgres global function default excludes PUBLIC',
    coalesce((SELECT (defaclacl::text !~ '(^|[{,])=X') ::text FROM pg_default_acl
      WHERE defaclrole = 'postgres'::regrole AND defaclobjtype = 'f' AND defaclnamespace = 0), 'missing'), 'true'
  UNION ALL SELECT 'service_role keeps helper EXECUTE',
    (has_function_privilege('service_role', 'public.consilium_tag_identity(text)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.consilium_subscriber_identity(text)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.users_display_titles_valid(text[])', 'EXECUTE'))::text, 'true'
  UNION ALL SELECT 'article-images bucket (public)',
    coalesce((SELECT public::text FROM storage.buckets WHERE id = 'article-images'), 'missing'), 'true'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

SELECT 'content fingerprint' AS check_name, md5(
  (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
  (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
  (SELECT count(*)::text FROM storage.objects) ||
  (SELECT coalesce(string_agg(id || public::text, ',' ORDER BY id), '') FROM storage.buckets)) AS value;

COMMIT;
