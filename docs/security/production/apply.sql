-- Data API privileges 20261022120000 + bucket record 20261022120100: GUARDED APPLY. ONE transaction:
-- preconditions, both migration files verbatim, postconditions. Any failed check rolls everything back.
--   psql -X -v ON_ERROR_STOP=1 -f docs/security/production/apply.sql | tee apply-privileges.txt
-- then, only if it exited 0 and printed the "verified" notice (registry only):
--   supabase migration repair --status applied 20261022120000 20261022120100 --linked
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition: connected as %, expected postgres', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261018002859') THEN
    RAISE EXCEPTION 'precondition: apply the public-access hardening (20261018002859) first';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261022120000', '20261022120100')) THEN
    RAISE EXCEPTION 'precondition: 20261022120000/20261022120100 already recorded';
  END IF;
END
$$;

CREATE TEMP TABLE privileges_preflight ON COMMIT DROP AS
SELECT md5(
  (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
  (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
  (SELECT count(*)::text FROM storage.objects)) AS fingerprint,
  (SELECT count(*) FROM storage.buckets) AS buckets;

\i supabase/migrations/20261022120000_data_api_function_sequence_privileges.sql
\i supabase/migrations/20261022120100_article_images_bucket.sql

DO $$
DECLARE
  pre record;
BEGIN
  SELECT * INTO pre FROM privileges_preflight;
  IF md5(
    (SELECT coalesce(string_agg(id || status || coalesce("deletedAt"::text, '') || md5(content), ',' ORDER BY id), '') FROM articles) ||
    (SELECT coalesce(string_agg(id || "isActive"::text, ',' ORDER BY id), '') FROM team_members) ||
    (SELECT count(*)::text FROM storage.objects)) IS DISTINCT FROM pre.fingerprint THEN
    RAISE EXCEPTION 'postcondition: content changed';
  END IF;
  IF (SELECT count(*) FROM storage.buckets) <> pre.buckets THEN
    RAISE EXCEPTION 'postcondition: bucket count changed (article-images was expected to exist already)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.consilium_tag_identity(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.users_display_titles_valid(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: service_role lost EXECUTE on an index/CHECK helper';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole
              AND (defaclnamespace = 'public'::regnamespace OR defaclnamespace = 0)
              AND defaclacl::text ~ '(^|[{,])(anon|authenticated)=') THEN
    RAISE EXCEPTION 'postcondition: postgres default privileges still grant the API roles';
  END IF;
  IF NOT public.users_display_titles_valid(ARRAY['Writer']) OR public.consilium_tag_identity('A  b') <> 'a-b' THEN
    RAISE EXCEPTION 'postcondition: helper functions no longer behave as before';
  END IF;
  RAISE NOTICE 'data api privileges verified: no public function or sequence usable by anon/authenticated, content unchanged';
END
$$;

COMMIT;
