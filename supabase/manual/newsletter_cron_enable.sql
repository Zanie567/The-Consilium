-- =============================================================================
-- MANUAL, OWNER-APPROVED ACTIVATION: hourly newsletter tick from Supabase Cron.
-- NOT a migration. Merging does not run it. Apply only at step R5 of docs/newsletter/ROLLOUT.md, after
-- 20261026120000 is applied, the code is deployed, the Vault secret exists, and #178's switch to the apex is done
-- (20261025120000: the publisher already calls https://theconsilium.co.uk; www then redirects, which pg_net does not follow).
-- =============================================================================
--
-- What it does: one pg_cron job, `newsletter-tick`, at minute 7 of every hour (UTC), calling
-- POST https://theconsilium.co.uk/api/cron/newsletter with `Authorization: Bearer <Vault newsletter_cron_secret>`
-- (= Vercel NEWSLETTER_CRON_SECRET, at least 32 characters, generated with `openssl rand -hex 32 | tr -d '\n'`).
-- The secret never appears in cron.job or its logs: the job runs `select public.invoke_newsletter_tick()`.
-- The tick is idempotent and fail-closed (paused by default, sends only approved campaigns), so an extra or
-- missed run is harmless; hourly gives the Friday 18:00 edition at most ~1 hour of trigger delay.
--
-- It does NOT use public.scheduler_invocations (that table's reconciler validates the publisher's JSON).
-- Monitor in the editorial Newsletter page, the Vercel logs for /api/cron/newsletter and net._http_response.
--
-- Rollback: select cron.unschedule('newsletter-tick');  (and optionally drop function public.invoke_newsletter_tick())

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'pg_cron and pg_net must be installed (20261007120000_scheduler_cron_infrastructure.sql)';
  END IF;
  IF to_regclass('public.newsletter_campaigns') IS NULL THEN
    RAISE EXCEPTION 'apply 20261026120000_newsletter_subscriptions.sql first';
  END IF;
  -- Same host as the article publisher, which #178 (20261025120000) moved to the apex. Refuse until then:
  -- before the switch the apex redirects to www, and pg_net does not follow redirects.
  IF to_regprocedure('public.invoke_publish_scheduled()') IS NULL
     OR position('https://theconsilium.co.uk/api/publish-scheduled' IN pg_get_functiondef('public.invoke_publish_scheduled()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the article publisher does not call https://theconsilium.co.uk yet: finish #178 (docs/seo/primary-domain-switch.md) first';
  END IF;
  IF to_regclass('vault.secrets') IS NULL OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'newsletter_cron_secret') THEN
    RAISE EXCEPTION 'create the Vault secret "newsletter_cron_secret" first (same value as Vercel NEWSLETTER_CRON_SECRET)';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.invoke_newsletter_tick()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'newsletter_cron_secret' LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE WARNING 'invoke_newsletter_tick: vault secret newsletter_cron_secret is missing or too short; not sent';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url                  := 'https://theconsilium.co.uk/api/cron/newsletter',
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  ) INTO v_request_id;
  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_newsletter_tick: request could not be queued (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END;
$$;

-- Only the job owner (postgres) may run it: never callable through the Data API.
REVOKE EXECUTE ON FUNCTION public.invoke_newsletter_tick() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE EXECUTE ON FUNCTION public.invoke_newsletter_tick() FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE EXECUTE ON FUNCTION public.invoke_newsletter_tick() FROM authenticated'; END IF;
END
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'newsletter-tick';
SELECT cron.schedule('newsletter-tick', '7 * * * *', 'select public.invoke_newsletter_tick()');
