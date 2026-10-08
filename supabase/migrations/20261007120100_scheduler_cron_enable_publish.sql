-- =============================================================================
-- Migration: ENABLE the 5-minute scheduled-publish trigger in Supabase Cron
-- Date: 2026-10-07            REVIEW BEFORE APPLYING (see docs/scheduler-supabase-cron.md)
-- =============================================================================
--
-- Apply ONLY after, in this order:
--   1. the purge fix (PR #118) is merged and deployed and verified in production;
--   2. 20261007120000_scheduler_cron_infrastructure.sql is applied;
--   3. the Vault secret `cron_secret` exists and equals the production CRON_SECRET;
--   4. a controlled `select public.invoke_publish_scheduled();` returned a request id and the
--      recorded status_code is 200.
--
-- The order above is ENFORCED, not just documented: this migration raises (and so schedules
-- nothing) unless the infrastructure, the Vault secret, the reconciler job and a recorded
-- successful controlled invocation all exist.
--
-- Idempotent: re-running replaces the job rather than duplicating it (and pg_cron itself allows
-- only one job per name).
--
-- Do not leave two automatic 5-minute schedulers running: once this job has run
-- successfully several times, remove the `schedule:` trigger from
-- .github/workflows/publish-scheduled.yml (keep workflow_dispatch as the manual fallback).
-- =============================================================================

DO $$
DECLARE
  -- THE PUBLISH INTERVAL. This is the single source of truth for a fresh install. Standard 5-field cron
  -- (UTC; `cron.timezone` is GMT on Supabase) or pg_cron's "N seconds" form (1-59). Keep it at one minute or
  -- slower: the reconciler, the 10-minute `lost` threshold and the cadence check in the runbook assume it.
  -- To change a LIVE schedule without re-running this file, see "Changing the interval" in
  -- docs/scheduler-supabase-cron.md (cron.alter_job), then update this value so the two do not drift.
  v_schedule CONSTANT TEXT := '*/5 * * * *';
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'Refusing to schedule the publisher: pg_cron is not installed. Apply 20261007120000_scheduler_cron_infrastructure.sql first.';
  END IF;

  IF to_regclass('public.scheduler_invocations') IS NULL
     OR to_regprocedure('public.invoke_publish_scheduled()') IS NULL
     OR to_regprocedure('public.reconcile_scheduler_invocations()') IS NULL THEN
    RAISE EXCEPTION 'Refusing to schedule the publisher: the infrastructure migration is not applied. Apply 20261007120000_scheduler_cron_infrastructure.sql first.';
  END IF;

  -- Existence only: never decrypt here.
  IF to_regclass('vault.secrets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION 'Refusing to schedule the publisher: Vault secret "cron_secret" does not exist. Create it first (see docs/scheduler-supabase-cron.md, step 3).';
  END IF;

  -- Without the reconciler there is no recorded outcome and no retention.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-scheduler-invocations') THEN
    RAISE EXCEPTION 'Refusing to schedule the publisher: the reconcile-scheduler-invocations job is not scheduled.';
  END IF;

  -- The controlled invocation must already have reached the endpoint and been answered 2xx.
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduler_invocations WHERE job = 'publish-scheduled' AND outcome = 'success'
  ) THEN
    RAISE EXCEPTION 'Refusing to schedule the publisher: no successful controlled invocation is recorded. Run "select public.invoke_publish_scheduled();", wait a minute, and confirm outcome = success in public.scheduler_invocations.';
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'publish-scheduled';
  PERFORM cron.schedule('publish-scheduled', v_schedule, 'select public.invoke_publish_scheduled()');
END $$;
