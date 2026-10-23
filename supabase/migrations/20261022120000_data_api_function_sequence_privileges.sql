-- =============================================================================
-- Migration: stop new functions and sequences becoming Data API surface by default
-- Version:   20261022120000 (after 20261018002859_launch_public_access_hardening)
-- =============================================================================
--
-- Apply separately, after owner approval, with docs/security/production/apply.sql. Merging
-- the code does NOT apply this file. Like 20261017120000 it has no BEGIN/COMMIT of its own.
--
-- WHY (read-only inspection of production, 2026-10-22; reproduced on a local Supabase stack):
--   * Tables are already safe by default: 20260408000100 removed Supabase's automatic
--     anon/authenticated table grants for objects postgres creates. Supabase's 30 October 2026
--     change additionally stops granting service_role on NEW tables; nothing in this app uses
--     service_role for tables (Prisma connects as the owner; service_role is Storage only).
--   * Functions are NOT covered by either. Every function postgres creates in public is
--     executable by PUBLIC (a PostgreSQL built-in default) and, through Supabase's default
--     privileges, by anon and authenticated, which makes it callable at /rest/v1/rpc/<name>
--     with the public anon key. Past migrations had to remember a REVOKE for every SECURITY
--     DEFINER function (20261007120000, 20261012110000, 20261017120000); one forgotten REVOKE
--     would expose it. Three helpers are callable by anon today: users_display_titles_valid,
--     consilium_tag_identity and consilium_subscriber_identity (pure, no data access).
--   * Sequences: new sequences default to USAGE/SELECT/UPDATE for anon and authenticated, and
--     scheduler_invocations_id_seq carries those grants. Not reachable through PostgREST, but
--     there is no reason for API roles to hold them.
--
-- WHAT IS KEPT: postgres (owner, Prisma) and service_role keep EXECUTE on the three helpers,
-- which back the users CHECK constraint and the tag/subscriber unique indexes. No table grant,
-- RLS policy, storage rule or data row changes. supabase_admin's own default privileges in
-- public cannot be changed by postgres; the regression tests instead require every object in
-- public to be owned by postgres.
--
-- Repeatable: REVOKE and ALTER DEFAULT PRIVILEGES ... REVOKE are no-ops when already applied.
-- =============================================================================

-- 1. Future functions created by postgres: no implicit EXECUTE for PUBLIC (global default, which
--    cannot be revoked per schema) and none for the API roles in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 2. Future sequences created by postgres in public: none for the API roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 3. Existing objects.
REVOKE EXECUTE ON FUNCTION public.users_display_titles_valid(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consilium_tag_identity(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consilium_subscriber_identity(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Self-check: no function or sequence in public is left usable by the API roles.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'functions still executable by anon/authenticated: %', bad;
  END IF;
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                                     OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') END;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'sequences still usable by anon/authenticated: %', bad;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Rollback (only if a reviewed client genuinely needs one of these; grant that one object
-- explicitly instead of restoring the defaults):
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.users_display_titles_valid(text[]), public.consilium_tag_identity(text),
--     public.consilium_subscriber_identity(text) TO PUBLIC;
-- -----------------------------------------------------------------------------
