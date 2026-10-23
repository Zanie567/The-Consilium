-- =============================================================================
-- Migration: declare the article-images Storage bucket in the repository
-- Version:   20261022120100
-- =============================================================================
--
-- The bucket was created in the Supabase dashboard on 2026-04-06, so a rebuild from this
-- repository (a new environment or disaster recovery) would come up without it and every
-- article image upload would fail. This records production's configuration as observed
-- read-only on 2026-10-22: public (images are served by public URL), no size or MIME limit at
-- the bucket level (/api/upload enforces both before uploading with the service role).
--
-- On production this is a no-op: the row exists and ON CONFLICT leaves it untouched. No policy
-- is created: clients never write or list Storage directly (see 20261018002859).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('article-images', 'article-images', true)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
