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
-- SECRET HANDLING: the secret is NEVER in this file. It lives in Supabase Vault under the name
-- `publish_cron_secret` and is created by hand (see the runbook). It is a DEDICATED, publish-only
-- secret (Vercel PUBLISH_CRON_SECRET): the application accepts it on /api/publish-scheduled and on no
-- other route, so even though pg_net queues request headers where database login roles can read
-- them, what leaks cannot purge trash or run any other job. The shared CRON_SECRET must never be put
-- in Vault. The function below reads the secret at call time and sends it as
-- `Authorization: Bearer <secret>`. Nothing here logs it:
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
  --   auth_failure   401/403: Vault `publish_cron_secret` differs from the production PUBLISH_CRON_SECRET
  --   http_error     any other non-2xx (307 wrong host, 404, 5xx ...)
  --   timeout        pg_net gave up waiting (30 s)
  --   network_error  no status and no timeout: DNS, TLS, connection refused
  --   lost           no response recorded by pg_net 10 minutes after the call
  --   not_sent       the call was never made (Vault secret missing or empty, or pg_net refused to queue it)
  --   bad_response   2xx, but the body is not the publish endpoint's JSON (a CDN, firewall or
  --                  maintenance page answering 200): the request was delivered but the publisher did not run
  outcome       TEXT        NOT NULL DEFAULT 'pending'
                CHECK (outcome IN ('pending','success','auth_failure','http_error','timeout','network_error','lost','not_sent','bad_response')),
  -- Read from the endpoint's own JSON answer ({"due":n,"published":n,"warnings":[...]}) when outcome = 'success'.
  -- NULL for every other outcome. These separate "the endpoint ran" from "articles were published"
  -- from "something non-fatal went wrong" (an author email or notification failed).
  articles_due       INTEGER,
  articles_published INTEGER,
  warning_count      INTEGER
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
  WHERE name = 'publish_cron_secret'
  LIMIT 1;

  -- Retention does not depend on the reconciler job staying alive: this runs every 5 minutes.
  DELETE FROM public.scheduler_invocations WHERE invoked_at < now() - interval '30 days';

  IF v_secret IS NULL OR v_secret = '' THEN
    INSERT INTO public.scheduler_invocations (job, error, completed_at, outcome)
    VALUES ('publish-scheduled', 'vault secret "publish_cron_secret" is missing or empty; request not sent', now(), 'not_sent');
    RAISE WARNING 'invoke_publish_scheduled: vault secret publish_cron_secret is missing';
    RETURN NULL;
  END IF;

  BEGIN
    SELECT net.http_post(
      url                  := 'https://www.theconsilium.co.uk/api/publish-scheduled',
      body                 := '{}'::jsonb,
      headers              := jsonb_build_object(
                                'Content-Type',  'application/json',
                                'Authorization', 'Bearer ' || v_secret
                              ),
      timeout_milliseconds := 30000
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net refused to queue the request. Record it instead of letting it escape as a failed cron
    -- run that leaves no row here. The message is scrubbed of the secret BEFORE it is truncated
    -- (truncating first could leave half of it behind).
    INSERT INTO public.scheduler_invocations (job, error, completed_at, outcome)
    VALUES ('publish-scheduled',
            'request could not be queued (SQLSTATE ' || SQLSTATE || '): ' || left(replace(SQLERRM, v_secret, '[redacted]'), 300),
            now(), 'not_sent');
    RAISE WARNING 'invoke_publish_scheduled: request could not be queued (SQLSTATE %)', SQLSTATE;
    RETURN NULL;
  END;

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
DECLARE
  r              RECORD;
  v_body         JSONB;
  v_valid        BOOLEAN;
  v_outcome      TEXT;
  v_due          INTEGER;
  v_published    INTEGER;
  v_warnings     INTEGER;
BEGIN
  -- One response at a time, each in its own sub-transaction, so a single odd response can never stop
  -- the others from being classified (a failing set-based UPDATE would abort every row, every minute).
  FOR r IN
    SELECT i.id AS invocation_id, resp.status_code, resp.content, resp.timed_out, resp.error_msg, resp.created
    FROM public.scheduler_invocations i
    JOIN net._http_response resp ON resp.id = i.request_id
    WHERE i.completed_at IS NULL
  LOOP
    BEGIN
      v_body := NULL; v_valid := FALSE; v_due := NULL; v_published := NULL; v_warnings := NULL;

      -- A 2xx only counts as the publisher having run if the body is the endpoint's own JSON:
      -- an object with numeric "due" and "published". Nested IFs, not AND, because Postgres does not
      -- guarantee that the right-hand side of an AND is skipped when the left-hand side is false.
      IF NOT COALESCE(r.timed_out, FALSE) AND r.status_code BETWEEN 200 AND 299 THEN
        BEGIN
          v_body := r.content::jsonb;
        EXCEPTION WHEN OTHERS THEN
          v_body := NULL;
        END;
        IF jsonb_typeof(v_body) = 'object' THEN
          IF jsonb_typeof(v_body -> 'due') = 'number' AND jsonb_typeof(v_body -> 'published') = 'number' THEN
            IF (v_body ->> 'due')::NUMERIC BETWEEN 0 AND 1000000
               AND (v_body ->> 'published')::NUMERIC BETWEEN 0 AND 1000000 THEN
              v_valid     := TRUE;
              v_due       := (v_body ->> 'due')::NUMERIC::INTEGER;
              v_published := (v_body ->> 'published')::NUMERIC::INTEGER;
              IF jsonb_typeof(v_body -> 'warnings') = 'array' THEN
                v_warnings := jsonb_array_length(v_body -> 'warnings');
              ELSE
                v_warnings := 0;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;

      v_outcome := CASE
                     WHEN COALESCE(r.timed_out, FALSE)       THEN 'timeout'
                     WHEN r.status_code BETWEEN 200 AND 299  THEN CASE WHEN v_valid THEN 'success' ELSE 'bad_response' END
                     WHEN r.status_code IN (401, 403)        THEN 'auth_failure'
                     WHEN r.status_code IS NOT NULL          THEN 'http_error'
                     ELSE                                         'network_error'
                   END;

      UPDATE public.scheduler_invocations
      SET status_code        = r.status_code,
          response_body      = left(r.content, 2000),
          error              = COALESCE(
                                 r.error_msg,
                                 CASE WHEN r.timed_out THEN 'request timed out' END,
                                 CASE WHEN v_outcome = 'bad_response'
                                      THEN 'HTTP 2xx, but the body is not the publish endpoint''s JSON' END
                               ),
          completed_at       = COALESCE(r.created, now()),
          outcome            = v_outcome,
          articles_due       = v_due,
          articles_published = v_published,
          warning_count      = v_warnings
      WHERE id = r.invocation_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.scheduler_invocations
      SET status_code  = r.status_code,
          error        = 'reconciler could not process the response (SQLSTATE ' || SQLSTATE || ')',
          completed_at = now(),
          outcome      = 'bad_response'
      WHERE id = r.invocation_id;
    END;
  END LOOP;

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

-- pg_cron never prunes cron.job_run_details (Supabase documents this), and the reconciler alone adds
-- 1,440 rows a day, so left alone it grows without limit on a 500 MB Free-plan database. Keep 7 days.
-- It is database-wide: pg_cron is not installed anywhere in this project before this migration, so no
-- other job's history exists to be affected. Rows still 'running' (no end_time) are judged by start_time,
-- so a stuck entry is eventually removed too. This command is plain SQL on purpose (no function, so no
-- new privileged object); the reliable record of every call is public.scheduler_invocations, not this table.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-cron-run-details';
  PERFORM cron.schedule(
    'prune-cron-run-details',
    '23 3 * * *',
    $cmd$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$cmd$
  );
END $$;
