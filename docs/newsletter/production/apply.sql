-- Newsletter migration 20261023120000: GUARDED APPLY. One transaction: preconditions, the migration file verbatim,
-- postconditions. Any failed check raises and rolls everything back. Run with psql from the repository root:
--
--   psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/apply.sql   (session set-up: docs/corrections/PRODUCTION-RUNBOOK.md §0)
--
-- then, only if this exited 0, record the version (registry only):  supabase migration repair --status applied 20261023120000 --linked
--
-- INTERRUPTIONS
--   * This script is ONE transaction. If psql, the network or the server stops part-way, PostgreSQL rolls the
--     whole thing back: nothing was applied. Re-run preflight.sql (it must match again) and this script unchanged.
--   * If the migration file was instead run WITHOUT a transaction (e.g. pasted into an editor that runs
--     statements one by one) and stopped part-way, finish it with resume mode, which accepts a partly
--     applied schema and verifies the end state:
--       psql -X -v ON_ERROR_STOP=1 -v resume=1 -f docs/newsletter/production/apply.sql
--     Every statement in the migration is idempotent; the one-time LEGACY classification is inside a single
--     statement together with the column it depends on, so it either happened fully or not at all.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
\if :{?resume}
SELECT set_config('newsletter.apply_mode', 'resume', true) AS apply_mode;
\else
SELECT set_config('newsletter.apply_mode', 'first', true) AS apply_mode;
\endif

DO $$
DECLARE
  partly boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscribers' AND column_name = 'status');
BEGIN
  IF partly AND current_setting('newsletter.apply_mode') <> 'resume' THEN
    RAISE EXCEPTION 'precondition: the newsletter schema is already (partly) present. If an earlier run stopped part-way, re-run with -v resume=1; otherwise stop and investigate';
  END IF;
  IF partly THEN
    -- Dynamic: on a first apply the column does not exist and a static reference would not even compile.
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM subscribers WHERE status::text NOT IN ('LEGACY', 'PENDING'))$q$ INTO partly;
    IF partly THEN
      RAISE EXCEPTION 'precondition (resume): subscribers already have non-legacy statuses; the new code has been running. Stop and investigate';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023120000') THEN
    RAISE EXCEPTION 'precondition: 20261023120000 is already recorded';
  END IF;
  IF to_regprocedure('public.consilium_subscriber_identity(text)') IS NULL THEN
    RAISE EXCEPTION 'precondition: consilium_subscriber_identity is missing (20261006161413 not applied)';
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'precondition: unexpected server version %', current_setting('server_version');
  END IF;
END
$$;

CREATE TEMP TABLE newsletter_preflight ON COMMIT DROP AS
SELECT (SELECT count(*) FROM subscribers) AS subscribers,
       (SELECT md5(coalesce(string_agg(id || ':' || email || ':' || "subscribedAt"::text, ',' ORDER BY id), '')) FROM subscribers) AS fingerprint;

\i supabase/migrations/20261023120000_newsletter_subscriptions.sql

DO $$
DECLARE
  pre record;
BEGIN
  SELECT * INTO pre FROM newsletter_preflight;
  IF (SELECT md5(coalesce(string_agg(id || ':' || email || ':' || "subscribedAt"::text, ',' ORDER BY id), '')) FROM subscribers) IS DISTINCT FROM pre.fingerprint THEN
    RAISE EXCEPTION 'postcondition: subscriber ids/addresses changed';
  END IF;
  IF current_setting('newsletter.apply_mode') = 'first' THEN
    IF (SELECT count(*) FROM subscribers WHERE status = 'LEGACY' AND NOT "specialAlerts" AND "confirmedAt" IS NULL) <> pre.subscribers THEN
      RAISE EXCEPTION 'postcondition: not every historical subscriber is LEGACY with no alerts consent';
    END IF;
  END IF;
  -- Both modes: nobody is subscribed to anything new, nobody counts as confirmed, every LEGACY row has its record.
  IF EXISTS (SELECT 1 FROM subscribers WHERE "specialAlerts" OR "confirmedAt" IS NOT NULL OR status NOT IN ('LEGACY', 'PENDING')) THEN
    RAISE EXCEPTION 'postcondition: a subscriber appears confirmed or opted in to alerts';
  END IF;
  IF (SELECT count(*) FROM subscriber_consent_events WHERE action = 'LEGACY_IMPORTED') <> (SELECT count(*) FROM subscribers WHERE status = 'LEGACY') THEN
    RAISE EXCEPTION 'postcondition: legacy consent records do not match the LEGACY rows';
  END IF;
  IF (SELECT count(*) FROM newsletter_campaigns) <> 0 OR (SELECT count(*) FROM newsletter_suppressions) <> 0 THEN
    RAISE EXCEPTION 'postcondition: new tables are not empty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'newsletter_campaigns_protect' AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'postcondition: protection trigger missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('newsletter_campaigns_approved_content', 'newsletter_campaigns_sent_has_broadcast', 'newsletter_campaigns_edition_key_shape', 'subscriber_tokens_subscriberId_fkey', 'subscriber_consent_events_subscriberId_fkey')) <> 5 THEN
    RAISE EXCEPTION 'postcondition: constraints missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'newsletter_campaigns_one_active_weekly') THEN
    RAISE EXCEPTION 'postcondition: one-active-weekly index missing';
  END IF;
  -- RLS and grants are asserted by the migration's own self-check; nothing to repeat here.
  RAISE NOTICE 'newsletter migration verified (%): % subscriber(s) LEGACY, addresses unchanged', current_setting('newsletter.apply_mode'), (SELECT count(*) FROM subscribers WHERE status = 'LEGACY');
END
$$;

COMMIT;
