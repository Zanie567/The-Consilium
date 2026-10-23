-- Data API privileges 20261022120000 (+ bucket record 20261022120100): PREFLIGHT (read-only).
-- Run AFTER the public-access hardening rollout (20261018002859). Every row must show ok = t.
--   psql -X -v ON_ERROR_STOP=1 -f docs/security/production/preflight.sql | tee preflight-privileges.txt
-- Expected values are production's state from read-only inspection on 2026-10-22, plus 20261018002859.
-- If any row is f, STOP. Do not edit an expectation to make it pass.
BEGIN READ ONLY;

WITH checks(check_name, value, expect) AS (
  SELECT 'connected as', current_user::text, 'postgres'
  UNION ALL SELECT 'prerequisite 20261018002859 recorded',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261018002859')::text, 'true'
  UNION ALL SELECT 'registry has 20261022120000',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261022120000')::text, 'false'
  UNION ALL SELECT 'registry has 20261022120100',
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261022120100')::text, 'false'
  UNION ALL SELECT 'registry rows', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, '26'
  UNION ALL SELECT 'public functions executable by anon',
    (SELECT coalesce(string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text), 'none') FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    'consilium_subscriber_identity(text),consilium_tag_identity(text),users_display_titles_valid(text[])'
  UNION ALL SELECT 'public sequences usable by anon',
    (SELECT coalesce(string_agg(relname, ',' ORDER BY relname), 'none') FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' AND CASE WHEN relkind = 'S' THEN has_sequence_privilege('anon', oid, 'USAGE,SELECT,UPDATE') END),
    'scheduler_invocations_id_seq'
  UNION ALL SELECT 'postgres default: functions in public',
    (SELECT defaclacl::text FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole AND defaclobjtype = 'f'
       AND defaclnamespace = 'public'::regnamespace),
    '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  UNION ALL SELECT 'postgres default: sequences in public',
    (SELECT defaclacl::text FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole AND defaclobjtype = 'S'
       AND defaclnamespace = 'public'::regnamespace),
    '{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}'
  UNION ALL SELECT 'postgres global function default (none = PUBLIC may execute)',
    coalesce((SELECT defaclacl::text FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole AND defaclobjtype = 'f'
       AND defaclnamespace = 0), 'none'), 'none'
  UNION ALL SELECT 'objects in public not owned by postgres',
    ((SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m','S','f') AND relowner <> 'postgres'::regrole)
     + (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proowner <> 'postgres'::regrole))::text, '0'
  UNION ALL SELECT 'article-images bucket (public)',
    coalesce((SELECT public::text FROM storage.buckets WHERE id = 'article-images'), 'missing'), 'true'
  UNION ALL SELECT 'storage.objects client policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')::text, '0'
)
SELECT check_name, value, expect, value IS NOT DISTINCT FROM expect AS ok FROM checks;

SELECT 'content fingerprint' AS check_name, md5(
  (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
  (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
  (SELECT count(*)::text FROM storage.objects) ||
  (SELECT coalesce(string_agg(id || public::text, ',' ORDER BY id), '') FROM storage.buckets)) AS value;

COMMIT;
