-- =============================================================================
-- ROLLBACK of 20261025120000: Supabase Cron publishes through https://www.theconsilium.co.uk again
-- Version:   20261025120000
-- Requires:  20261007120000_scheduler_cron_infrastructure.sql (public.invoke_publish_scheduled)
-- =============================================================================
--
-- Part of making the apex the primary domain (docs/seo/primary-domain-switch.md). Apply it at the step that
-- runbook names: AFTER both hosts serve the site directly (no apex -> www redirect) and BEFORE www starts
-- redirecting to the apex. pg_net is not relied on to follow redirects, so the publisher must call the host
-- that answers directly. Apply manually, in one transaction, after owner approval. Never `supabase db push`.
--
-- What it does: rewrites only the URL inside public.invoke_publish_scheduled(), from
--   https://www.theconsilium.co.uk/api/publish-scheduled   to   https://theconsilium.co.uk/api/publish-scheduled
-- The rest of the function body, its owner, its SECURITY DEFINER setting and its grants are kept
-- (CREATE OR REPLACE of the function's own definition). No job, schedule, secret or row changes.
--
-- Repeatable: a function that already uses the apex is left alone. A function that uses neither URL is refused
-- (someone changed it by hand; review before applying).
--
-- Rollback: the same statement with the two URLs swapped (supabase/manual/20261025120000_publish_cron_apex_host_rollback.sql).
-- =============================================================================

DO $$
DECLARE
  old_url CONSTANT text := 'https://theconsilium.co.uk/api/publish-scheduled';
  new_url CONSTANT text := 'https://www.theconsilium.co.uk/api/publish-scheduled';
  def text;
BEGIN
  IF to_regprocedure('public.invoke_publish_scheduled()') IS NULL THEN
    RAISE NOTICE 'invoke_publish_scheduled() does not exist; nothing to change';
    RETURN;
  END IF;
  def := pg_get_functiondef('public.invoke_publish_scheduled()'::regprocedure);
  IF position(quote_literal(new_url) IN def) > 0 AND position(old_url IN def) = 0 THEN
    RAISE NOTICE 'invoke_publish_scheduled() already calls %', new_url;
    RETURN;
  END IF;
  IF position(quote_literal(old_url) IN def) = 0 THEN
    RAISE EXCEPTION 'invoke_publish_scheduled() does not call % as expected; review it before applying', old_url;
  END IF;
  EXECUTE replace(def, quote_literal(old_url), quote_literal(new_url));
  RAISE NOTICE 'invoke_publish_scheduled() now calls %', new_url;
END
$$;
