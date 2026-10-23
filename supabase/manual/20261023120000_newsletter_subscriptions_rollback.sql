-- =============================================================================
-- ROLLBACK for supabase/migrations/20261023120000_newsletter_subscriptions.sql
-- =============================================================================
-- Only while the newsletter has never been used for real: it DISCARDS consent records, suppressions,
-- campaigns and webhook history, and every subscriber's status/preferences (the subscriber rows and their
-- email addresses are kept). Deploy the previous application build FIRST: the newsletter code cannot run
-- without these columns. Run in ONE transaction after a verified backup; never on a database where a
-- campaign has been SENT (the guard below refuses).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.newsletter_campaigns') IS NOT NULL
     AND EXISTS (SELECT 1 FROM newsletter_campaigns WHERE "status" IN ('SENT', 'SENDING')) THEN
    RAISE EXCEPTION 'refusing to roll back: a newsletter campaign has been sent or is sending';
  END IF;
END
$$;

DROP TABLE IF EXISTS "newsletter_webhook_events";
DROP TABLE IF EXISTS "newsletter_campaigns";
DROP FUNCTION IF EXISTS protect_newsletter_campaign();
DROP TABLE IF EXISTS "newsletter_suppressions";
DROP TABLE IF EXISTS "subscriber_consent_events";
DROP TABLE IF EXISTS "subscriber_tokens";

DROP INDEX IF EXISTS "subscribers_resendContactId_key";
DROP INDEX IF EXISTS "subscribers_status_idx";
DROP INDEX IF EXISTS "subscribers_resendSyncState_idx";
ALTER TABLE "subscribers"
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "weeklyDigest",
  DROP COLUMN IF EXISTS "specialAlerts",
  DROP COLUMN IF EXISTS "confirmedAt",
  DROP COLUMN IF EXISTS "consentSource",
  DROP COLUMN IF EXISTS "consentVersion",
  DROP COLUMN IF EXISTS "consentIpHash",
  DROP COLUMN IF EXISTS "preferencesUpdatedAt",
  DROP COLUMN IF EXISTS "unsubscribedAt",
  DROP COLUMN IF EXISTS "unsubscribeSource",
  DROP COLUMN IF EXISTS "suppressedAt",
  DROP COLUMN IF EXISTS "suppressionReason",
  DROP COLUMN IF EXISTS "resendContactId",
  DROP COLUMN IF EXISTS "resendSyncState",
  DROP COLUMN IF EXISTS "resendSyncedAt",
  DROP COLUMN IF EXISTS "resendSyncAttempts",
  DROP COLUMN IF EXISTS "resendSyncError",
  DROP COLUMN IF EXISTS "resendUpdatedAt",
  DROP COLUMN IF EXISTS "resendVerifiedAt";

DROP TYPE IF EXISTS "NewsletterCampaignStatus";
DROP TYPE IF EXISTS "NewsletterCampaignKind";
DROP TYPE IF EXISTS "NewsletterSyncState";
DROP TYPE IF EXISTS "SubscriberTokenPurpose";
DROP TYPE IF EXISTS "SubscriberStatus";

DELETE FROM site_settings WHERE key IN ('newsletter.paused', 'newsletter.weekly.autoSend');
