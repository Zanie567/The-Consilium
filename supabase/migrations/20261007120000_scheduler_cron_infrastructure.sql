-- =============================================================================
-- Migration: Supabase Cron + pg_net plumbing for the scheduled-publish trigger
-- Date: 2026-10-07            REVIEW BEFORE APPLYING (see docs/scheduler-supabase-cron.md)
-- =============================================================================
--
-- Why: GitHub Actions cron has been delayed by hours on this repo (hourly workflow ran
-- every 4-5 h, daily one ~6 h late), so a 5-minute publish cadence never held. Supabase
-- Cron runs inside the database and fires on time. Vercel Hobby cannot do 5-minute crons.
--
-- This file installs the PLUMBING ONLY. It does NOT schedule the publisher: that is the
-- separate migration 20261007120100_scheduler_cron_enable_publish.sql, applied after a
-- controlled manual invocation has been verified.
--
-- Additive and idempotent. Touches no existing table. Apply with the Supabase
-- apply_migration tool or the SQL editor, like the other migrations in this folder.
--
-- SECRET HANDLING: the cron secret is NEVER in this file. It lives in Supabase Vault under
-- the name `cron_secret` and is created by hand (see the runbook). The function below reads
-- it at call time and sends it as `Authorization: Bearer <secret>`. Nothing here logs it:
-- pg_cron logs only the command text `select public.invoke_publish_scheduled()`, and
-- pg_net's response table does not keep request headers.
--
-- OBSERVABILITY: pg_net deletes responses after `pg_net.ttl` (6 hours), so every invocation
-- is recorded in public.scheduler_invocations and a once-a-minute reconciler copies the
-- HTTP status and a body excerpt into it before the response expires. Verification queries
-- are in the runbook.
-- =============================================================================

-- pg_cron installs into pg_catalog and pg_net into `extensions` on Supabase.
-- supabase_vault is already installed on this project (checked read-only 2026-10-07).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- One row per outbound call. Operator-facing audit of the scheduler itself.
CREATE TABLE IF NOT EXISTS public.scheduler_invocations (
  id            BIGSERIAL PRIMARY KEY,
  job           TEXT        NOT NULL,
  request_id    BIGINT,                 -- pg_net request id; NULL when the call was never made
  invoked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_code   INTEGER,                -- filled by the reconciler once the response lands
  response_body TEXT,                   -- first 2000 chars only
  error         TEXT,                   -- local failure (missing secret) or pg_net error/timeout
  completed_at  TIMESTAMPTZ,
  -- One explicit category per call, so a failure is never inferred from free text:
  --   pending        queued, no response yet (normal for the first minute)
  --   success        any 2xx (the endpoint returns 200)
  --   auth_failure   401/403: Vault secret differs from the production CRON_SECRET
  --   http_error     any other non-2xx (307 wrong host, 404, 5xx ...)
  --   timeout        pg_net gave up waiting (30 s)
  --   network_error  no status and no timeout: DNS, TLS, connection refused
  --   lost           no response recorded by pg_net 10 minutes after the call
  --   not_sent       the call was never made (Vault secret missing or empty)
  outcome       TEXT        NOT NULL DEFAULT 'pending'
                CHECK (outcome IN ('pending','success','auth_failure','http_error','timeout','network_error','lost','not_sent'))
);
CREATE INDEX IF NOT EXISTS scheduler_invocations_job_invoked_idx
  ON public.scheduler_invocations (job, invoked_at DESC);
CREATE INDEX IF NOT EXISTS scheduler_invocations_pending_idx
  ON public.scheduler_invocations (request_id) WHERE completed_at IS NULL AND request_id IS NOT NULL;

-- Deny-by-default for PostgREST: RLS on with no policies, no grants to API roles. Only the
-- database owner (and the SECURITY DEFINER functions below) can read or write it.
ALTER TABLE public.scheduler_invocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduler_invocations FROM PUBLIC;
-- Supabase's default privileges grant new public objects to anon, authenticated AND service_role,
-- so all three are revoked explicitly. The owner (postgres) keeps access, and so does the dashboard.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN REVOKE ALL ON public.scheduler_invocations FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.scheduler_invocations FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN REVOKE ALL ON public.scheduler_invocations FROM service_role; END IF;
END $$;

-- Calls the canonical production endpoint. Returns the pg_net request id (NULL if it could
-- not even be queued). A missing secret is recorded and returned, never raised, so cron.job_run_details
-- stays "succeeded" for a call that was never made: the scheduler_invocations row is the truth.
CREATE OR REPLACE FUNCTION public.invoke_publish_scheduled()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  -- Retention does not depend on the reconciler job staying alive: this runs every 5 minutes.
  DELETE FROM public.scheduler_invocations WHERE invoked_at < now() - interval '30 days';

  IF v_secret IS NULL OR v_secret = '' THEN
    INSERT INTO public.scheduler_invocations (job, error, completed_at, outcome)
    VALUES ('publish-scheduled', 'vault secret "cron_secret" is missing or empty; request not sent', now(), 'not_sent');
    RAISE WARNING 'invoke_publish_scheduled: vault secret cron_secret is missing';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url                  := 'https://www.theconsilium.co.uk/api/publish-scheduled',
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object(
                              'Content-Type',  'application/json',
                              'Authorization', 'Bearer ' || v_secret
                            ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  INSERT INTO public.scheduler_invocations (job, request_id)
  VALUES ('publish-scheduled', v_request_id);

  RETURN v_request_id;
END;
$$;

-- Copies finished pg_net responses into scheduler_invocations (so history outlives the
-- 6-hour pg_net TTL), flags requests that never got a response, and keeps 30 days of rows.
CREATE OR REPLACE FUNCTION public.reconcile_scheduler_invocations()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.scheduler_invocations i
  SET status_code   = r.status_code,
      response_body = left(r.content, 2000),
      error         = COALESCE(r.error_msg, CASE WHEN r.timed_out THEN 'request timed out' END),
      completed_at  = COALESCE(r.created, now()),
      outcome       = CASE
                        WHEN r.timed_out                      THEN 'timeout'
                        WHEN r.status_code BETWEEN 200 AND 299 THEN 'success'
                        WHEN r.status_code IN (401, 403)       THEN 'auth_failure'
                        WHEN r.status_code IS NOT NULL         THEN 'http_error'
                        ELSE                                        'network_error'
                      END
  FROM net._http_response r
  WHERE r.id = i.request_id
    AND i.completed_at IS NULL;

  -- No response after 10 minutes (and past the 30 s request timeout): record it as lost.
  UPDATE public.scheduler_invocations
  SET error = 'no response recorded by pg_net', completed_at = now(), outcome = 'lost'
  WHERE completed_at IS NULL
    AND request_id IS NOT NULL
    AND invoked_at < now() - interval '10 minutes';

  DELETE FROM public.scheduler_invocations WHERE invoked_at < now() - interval '30 days';
END;
$$;

-- Only the owner may run them. They are SECURITY DEFINER and one reads Vault, so no API role
-- may be able to call them through PostgREST /rpc.
REVOKE ALL ON FUNCTION public.invoke_publish_scheduled()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_scheduler_invocations() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.invoke_publish_scheduled()        FROM anon;
    REVOKE ALL ON FUNCTION public.reconcile_scheduler_invocations() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.invoke_publish_scheduled()        FROM authenticated;
    REVOKE ALL ON FUNCTION public.reconcile_scheduler_invocations() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.invoke_publish_scheduled()        FROM service_role;
    REVOKE ALL ON FUNCTION public.reconcile_scheduler_invocations() FROM service_role;
  END IF;
END $$;

-- The reconciler is harmless (reads pg_net, writes only our table), so it is scheduled here.
-- The PUBLISHER is not: see 20261007120100_scheduler_cron_enable_publish.sql.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reconcile-scheduler-invocations';
  PERFORM cron.schedule('reconcile-scheduler-invocations', '* * * * *', 'select public.reconcile_scheduler_invocations()');
END $$;
