-- Newsletter migration 20261023120000: GUARDED APPLY. One transaction: preconditions, the migration file verbatim,
-- postconditions. Any failed check raises and rolls everything back. Run with psql from the repository root:
--
--   psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/apply.sql   (session set-up: docs/corrections/PRODUCTION-RUNBOOK.md §0)
--
-- then, only if this exited 0, record the version (registry only):  supabase migration repair --status applied 20261023120000 --linked
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscribers' AND column_name = 'status') THEN
    RAISE EXCEPTION 'precondition: subscribers.status already exists; stop and investigate (a re-run would not reclassify, but this should be a first apply)';
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
  IF (SELECT count(*) FROM subscribers WHERE status = 'LEGACY' AND NOT "specialAlerts" AND "confirmedAt" IS NULL) <> pre.subscribers THEN
    RAISE EXCEPTION 'postcondition: not every historical subscriber is LEGACY with no alerts consent';
  END IF;
  IF (SELECT count(*) FROM subscriber_consent_events WHERE action = 'LEGACY_IMPORTED') <> pre.subscribers THEN
    RAISE EXCEPTION 'postcondition: legacy consent records do not match';
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
  RAISE NOTICE 'newsletter migration verified: % historical subscriber(s) classified LEGACY, addresses unchanged', pre.subscribers;
END
$$;

COMMIT;
