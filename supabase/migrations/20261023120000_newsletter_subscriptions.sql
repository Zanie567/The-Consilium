-- =============================================================================
-- Migration: newsletter consent, preferences, suppression and campaigns
-- Version:   20261023120000 (unique 14-digit prefix: safe for the Supabase CLI and for manual use)
-- Requires:  subscribers + public.consilium_subscriber_identity (20261006161413), audit_logs, site_settings
-- =============================================================================
--
-- Additive, idempotent and backward-compatible. Apply manually after review, in ONE transaction, with
-- docs/newsletter/production/apply.sql (no BEGIN/COMMIT here, like 20261017120000). Never `supabase db push`.
-- Nothing existing is dropped or rewritten except the one-time classification of historical subscribers.
--
-- What it adds
--   * enums "SubscriberStatus", "SubscriberTokenPurpose", "NewsletterSyncState", "NewsletterCampaignKind",
--     "NewsletterCampaignStatus";
--   * columns on subscribers: status, topic preferences, consent proof, unsubscribe/suppression record and the
--     Resend contact mirror. Column, index and constraint names are exactly those Prisma generates, so a
--     `prisma db push` database and a migrated one are identical;
--   * tables subscriber_tokens (hashed link tokens), subscriber_consent_events (append-only consent record,
--     survives erasure), newsletter_suppressions (hashed do-not-mail / do-not-auto-resubscribe list),
--     newsletter_campaigns (one row per edition: editionKey UNIQUE is the one-send-per-edition guarantee),
--     newsletter_webhook_events (verified Resend deliveries, keyed by svix-id for idempotency);
--   * CHECK constraints: a campaign can only be SCHEDULED/SENDING/SENT for exactly the content that was
--     approved, and a SENT campaign always records its Resend broadcast;
--   * at most one weekly campaign SCHEDULED or SENDING at a time (partial unique index);
--   * trigger newsletter_campaigns_protect: a SENT campaign is immutable apart from delivery counters, and a
--     SENDING or SENT campaign cannot be deleted;
--   * RLS on for every new table, no grants to anon/authenticated, trigger function not executable by them.
--
-- Backward compatibility
--   * The currently deployed code keeps working on the migrated schema: its inserts get status PENDING
--     (never mailed), its reads select only the old columns, its unsubscribe still deletes rows.
--   * Historical rows (present when the status column is first added) become LEGACY: weekly preference kept as
--     the newsletter they asked for, specialAlerts = false (no consent is invented for the new category), and
--     they are NOT mailed until they confirm through the new double opt-in. Each gets a LEGACY_IMPORTED
--     consent event. Re-running the file never reclassifies rows created later.
--
-- Idempotency and interruption (tested in tests/integration/newsletter-migration-db.test.ts)
--   * Every statement can run again without effect: IF NOT EXISTS / guarded DO blocks / deterministic ids.
--   * The one non-repeatable step, classifying the rows that exist BEFORE the status column, is in the same
--     single statement (DO block) as the ADD COLUMN it keys on: a run interrupted anywhere either did both or
--     neither, and a later re-run never reclassifies rows created afterwards.
--   * Normal path: docs/newsletter/production/apply.sql runs the whole file in ONE transaction (all or nothing).
--     A partly applied schema (file run statement by statement, then stopped) is completed by re-running the
--     file, or apply.sql with -v resume=1, which also verifies the end state.
--
-- Rollback (only before any campaign is sent or anyone confirms; it discards consent records):
--   supabase/manual/20261023120000_newsletter_subscriptions_rollback.sql
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriberStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'SUPPRESSED', 'LEGACY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriberTokenPurpose' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "SubscriberTokenPurpose" AS ENUM ('CONFIRM', 'MANAGE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NewsletterSyncState' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "NewsletterSyncState" AS ENUM ('PENDING', 'SYNCED', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NewsletterCampaignKind' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "NewsletterCampaignKind" AS ENUM ('WEEKLY', 'ALERT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NewsletterCampaignStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "NewsletterCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'BLOCKED', 'CANCELLED', 'SKIPPED');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. subscribers: new columns. The status column decides whether this is the first run: only then are the
--    rows that already exist classified as LEGACY.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  first_run boolean := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'subscribers' AND column_name = 'status');
BEGIN
  ALTER TABLE "subscribers"
    ADD COLUMN IF NOT EXISTS "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "specialAlerts" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "consentSource" TEXT,
    ADD COLUMN IF NOT EXISTS "consentVersion" TEXT,
    ADD COLUMN IF NOT EXISTS "consentIpHash" TEXT,
    ADD COLUMN IF NOT EXISTS "preferencesUpdatedAt" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "unsubscribedAt" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "unsubscribeSource" TEXT,
    ADD COLUMN IF NOT EXISTS "suppressedAt" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "suppressionReason" TEXT,
    ADD COLUMN IF NOT EXISTS "resendContactId" TEXT,
    ADD COLUMN IF NOT EXISTS "resendSyncState" "NewsletterSyncState" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS "resendSyncedAt" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "resendSyncAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "resendSyncError" TEXT,
    ADD COLUMN IF NOT EXISTS "resendUpdatedAt" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "resendVerifiedAt" TIMESTAMPTZ(3);

  IF first_run THEN
    -- Historical sign-ups: no double opt-in, no consent proof. Keep them, never mail them, never opt them in to
    -- anything new. Nothing to sync to Resend (they were never there).
    UPDATE "subscribers"
       SET "status" = 'LEGACY', "weeklyDigest" = true, "specialAlerts" = false,
           "consentSource" = 'legacy_signup_form', "resendSyncState" = 'SYNCED';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_resendContactId_key" ON "subscribers"("resendContactId");
CREATE INDEX IF NOT EXISTS "subscribers_status_idx" ON "subscribers"("status");
CREATE INDEX IF NOT EXISTS "subscribers_resendSyncState_idx" ON "subscribers"("resendSyncState");

-- -----------------------------------------------------------------------------
-- 2. New tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "subscriber_tokens" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "purpose" "SubscriberTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    CONSTRAINT "subscriber_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_tokens_tokenHash_key" ON "subscriber_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "subscriber_tokens_subscriberId_purpose_createdAt_idx" ON "subscriber_tokens"("subscriberId", "purpose", "createdAt");
CREATE INDEX IF NOT EXISTS "subscriber_tokens_createdAt_idx" ON "subscriber_tokens"("createdAt");

CREATE TABLE IF NOT EXISTS "subscriber_consent_events" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT,
    "emailHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "weeklyDigest" BOOLEAN,
    "specialAlerts" BOOLEAN,
    "consentVersion" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "actor" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscriber_consent_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "subscriber_consent_events_subscriberId_createdAt_idx" ON "subscriber_consent_events"("subscriberId", "createdAt");
CREATE INDEX IF NOT EXISTS "subscriber_consent_events_emailHash_createdAt_idx" ON "subscriber_consent_events"("emailHash", "createdAt");
CREATE INDEX IF NOT EXISTS "subscriber_consent_events_createdAt_idx" ON "subscriber_consent_events"("createdAt");

CREATE TABLE IF NOT EXISTS "newsletter_suppressions" (
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_suppressions_pkey" PRIMARY KEY ("emailHash")
);

CREATE TABLE IF NOT EXISTS "newsletter_campaigns" (
    "id" TEXT NOT NULL,
    "kind" "NewsletterCampaignKind" NOT NULL,
    "editionKey" TEXT NOT NULL,
    "status" "NewsletterCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "previewText" TEXT,
    "intro" TEXT,
    "articles" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3),
    "windowEnd" TIMESTAMPTZ(3),
    "articleId" TEXT,
    "scheduledFor" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedHash" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "blockedReason" TEXT,
    "resendBroadcastId" TEXT,
    "sendRequestedAt" TIMESTAMPTZ(3),
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "recipientCount" INTEGER,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "bouncedCount" INTEGER NOT NULL DEFAULT 0,
    "complainedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "newsletter_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_campaigns_editionKey_key" ON "newsletter_campaigns"("editionKey");
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_campaigns_resendBroadcastId_key" ON "newsletter_campaigns"("resendBroadcastId");
CREATE INDEX IF NOT EXISTS "newsletter_campaigns_status_scheduledFor_idx" ON "newsletter_campaigns"("status", "scheduledFor");
CREATE INDEX IF NOT EXISTS "newsletter_campaigns_kind_sentAt_idx" ON "newsletter_campaigns"("kind", "sentAt");
-- Not expressible in Prisma: one weekly edition in flight at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_campaigns_one_active_weekly"
  ON "newsletter_campaigns"("kind") WHERE "kind" = 'WEEKLY' AND "status" IN ('SCHEDULED', 'SENDING');

CREATE TABLE IF NOT EXISTS "newsletter_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "lastError" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    CONSTRAINT "newsletter_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "newsletter_webhook_events_status_receivedAt_idx" ON "newsletter_webhook_events"("status", "receivedAt");

-- Foreign keys and checks (guarded: ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_tokens_subscriberId_fkey') THEN
    ALTER TABLE "subscriber_tokens" ADD CONSTRAINT "subscriber_tokens_subscriberId_fkey"
      FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_consent_events_subscriberId_fkey') THEN
    ALTER TABLE "subscriber_consent_events" ADD CONSTRAINT "subscriber_consent_events_subscriberId_fkey"
      FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_campaigns_approved_content') THEN
    ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_approved_content" CHECK (
      "status" NOT IN ('SCHEDULED', 'SENDING', 'SENT')
      OR ("approvedAt" IS NOT NULL AND "scheduledFor" IS NOT NULL AND "approvedHash" = "contentHash"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_campaigns_sent_has_broadcast') THEN
    ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_sent_has_broadcast" CHECK (
      "status" <> 'SENT' OR ("sentAt" IS NOT NULL AND "resendBroadcastId" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_campaigns_edition_key_shape') THEN
    ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_edition_key_shape" CHECK (
      ("kind" = 'WEEKLY' AND "editionKey" ~ '^weekly:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      OR ("kind" = 'ALERT' AND "articleId" IS NOT NULL AND "editionKey" = 'alert:' || "articleId"));
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. A sent campaign is a permanent record.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_newsletter_campaign() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  counters text[] := ARRAY['deliveredCount', 'bouncedCount', 'complainedCount', 'updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('SENDING', 'SENT') THEN
      RAISE EXCEPTION 'newsletter campaign % is % and cannot be deleted', OLD."id", OLD."status";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'SENT' AND (to_jsonb(NEW) - counters) IS DISTINCT FROM (to_jsonb(OLD) - counters) THEN
    RAISE EXCEPTION 'newsletter campaign % was sent and is immutable (delivery counters only)', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS newsletter_campaigns_protect ON "newsletter_campaigns";
CREATE TRIGGER newsletter_campaigns_protect
  BEFORE UPDATE OR DELETE ON "newsletter_campaigns"
  FOR EACH ROW EXECUTE FUNCTION protect_newsletter_campaign();

-- -----------------------------------------------------------------------------
-- 4. Consent record for historical rows (once per subscriber; re-running inserts nothing).
--    The hash matches src/lib/newsletter/identity.ts emailHash().
-- -----------------------------------------------------------------------------
INSERT INTO "subscriber_consent_events" ("id", "subscriberId", "emailHash", "action", "source", "weeklyDigest", "specialAlerts", "actor", "createdAt")
SELECT 'legacy_' || s."id", s."id",
       encode(sha256(convert_to('consilium-newsletter:v1:' || public.consilium_subscriber_identity(s."email"), 'UTF8')), 'hex'),
       'LEGACY_IMPORTED', 'migration_20261023120000', true, false, 'system', CURRENT_TIMESTAMP
  FROM "subscribers" s
 WHERE s."status" = 'LEGACY'
   AND NOT EXISTS (SELECT 1 FROM "subscriber_consent_events" e WHERE e."id" = 'legacy_' || s."id");

-- -----------------------------------------------------------------------------
-- 5. Access: RLS on, nothing for the API roles (the app connects as the table owner).
-- -----------------------------------------------------------------------------
ALTER TABLE "subscriber_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriber_consent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "newsletter_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "newsletter_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "newsletter_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscribers" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "subscriber_tokens", "subscriber_consent_events", "newsletter_suppressions",
  "newsletter_campaigns", "newsletter_webhook_events" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION protect_newsletter_campaign() FROM PUBLIC;
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "subscribers", "subscriber_tokens", "subscriber_consent_events", '
        '"newsletter_suppressions", "newsletter_campaigns", "newsletter_webhook_events" FROM %I', api_role);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION protect_newsletter_campaign() FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;

-- Self-check: every newsletter table is private and RLS-protected.
DO $$
DECLARE
  bad text;
  api_role text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
     AND c.relname IN ('subscribers', 'subscriber_tokens', 'subscriber_consent_events', 'newsletter_suppressions',
                       'newsletter_campaigns', 'newsletter_webhook_events');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is off for: %', bad;
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      SELECT string_agg(c.relname, ', ') INTO bad
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND c.relname IN ('subscribers', 'subscriber_tokens', 'subscriber_consent_events', 'newsletter_suppressions',
                           'newsletter_campaigns', 'newsletter_webhook_events')
         AND has_table_privilege(api_role, c.oid, 'SELECT,INSERT,UPDATE,DELETE');
      IF bad IS NOT NULL THEN
        RAISE EXCEPTION '% can still access: %', api_role, bad;
      END IF;
      IF has_function_privilege(api_role, 'protect_newsletter_campaign()', 'EXECUTE') THEN
        RAISE EXCEPTION '% can execute protect_newsletter_campaign()', api_role;
      END IF;
    END IF;
  END LOOP;
END
$$;
