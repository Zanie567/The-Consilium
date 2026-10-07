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
-- Idempotent: re-running replaces the job rather than duplicating it.
--
-- Do not leave two automatic 5-minute schedulers running: once this job has run
-- successfully several times, remove the `schedule:` trigger from
-- .github/workflows/publish-scheduled.yml (keep workflow_dispatch as the manual fallback).
-- =============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'publish-scheduled';
  PERFORM cron.schedule('publish-scheduled', '*/5 * * * *', 'select public.invoke_publish_scheduled()');
END $$;
