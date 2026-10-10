-- =============================================================================
-- Migration: trigger functions are not callable through the API
-- Version:   20261012110000 (unique 14-digit prefix)
-- Requires:  20261011_hidden_debate_article_guard.sql and 20261012100000_article_hidden_by_debate_marker.sql
-- =============================================================================
--
-- Apply manually after review; idempotent. Changes privileges only: no table, row, trigger or function body.
--
-- Why: PostgreSQL grants EXECUTE on every new function to PUBLIC, and Supabase's default privileges add anon,
-- authenticated and service_role, so the two trigger functions below appear under /rest/v1/rpc/. The Supabase
-- advisor flags the SECURITY DEFINER one (0028/0029). This is hygiene, not an exploitable hole: a function that
-- returns `trigger` raises "trigger functions can only be called as triggers" when called directly, and anon/
-- authenticated hold no write privilege on articles or debates in any case. Verified on PostgreSQL 17.11.
--
-- Why it is safe: the privilege is checked when CREATE TRIGGER runs, not when the trigger fires. A role that
-- updates an article needs no EXECUTE on the trigger function (tests/integration/admin-overhaul-migrations.test.ts
-- proves the guard and the marker trigger still fire for an owner and for a non-owner role without EXECUTE).
-- The owner keeps EXECUTE, so re-running migrations 3 and 4 (CREATE OR REPLACE) is unaffected.
--
-- Rollback (restores exactly the grants these functions had):
--   GRANT EXECUTE ON FUNCTION prevent_hidden_debate_article_publication(), clear_article_hidden_by_debate()
--     TO PUBLIC, anon, authenticated;
--   (on a database without the Supabase roles, omit anon/authenticated)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION prevent_hidden_debate_article_publication() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION clear_article_hidden_by_debate() FROM PUBLIC;

-- anon / authenticated exist on Supabase; a plain PostgreSQL database may not have them.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION prevent_hidden_debate_article_publication() FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION clear_article_hidden_by_debate() FROM %I', r);
    END IF;
  END LOOP;
END $$;
